"""Worker Supabase D18 — analyse les modules EECoach avec le moteur OA.

Boucle : lire les modules (PGN) du coach dans Supabase -> les analyser avec le
pipeline OA (erreurs humaines par tranche Elo, cache local `data-oa/cache.sqlite`,
re-analyse gratuite par FEN-4) -> deposer UN document compact par module dans la
table `oa_analyses` (migration-007) que la section coach « Analyse d'ouvertures »
de la SPA lit telle quelle (FEN complets + SAN precalcules : la SPA ne recalcule rien).

Auth : cle publishable + login coach par mot de passe (RLS) — jamais de cle
secrete. Creds lus dans `.env` a la racine (gitignore, memes variables que la
gate : GATE_COACH_EMAIL / GATE_COACH_PWD). Le token Lichess (stats humaines)
vient de l'env `OA_LICHESS_TOKEN` — sans lui, AUCUNE erreur ne peut etre
detectee (evals seules) : le worker refuse alors de tourner sauf --force.

Lancement (racine EECoach) :
    py -m oa.eecoach_worker [--modules id1,id2] [--limit-positions N]
                            [--no-deepen] [--dry-run] [--json-out dir]

Zero dependance hors stdlib + python-chess (deja requis par le package).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from . import danger_depth, db, expected_value, gaps, heatmap, ingest, lifetime
from .config import BUCKET_FIDE_EQUIV, ELO_BUCKETS, Config
from .fen import _ensure_full_fen, side_to_move
from .pipeline import analyze_chapter

# ── Supabase (cle PUBLIQUE, identique a app.js / tests/gate/gate.mjs) ────────
SUPABASE_URL = "https://smoftbuyejoyxlonhjcu.supabase.co"
SUPABASE_KEY = "sb_publishable_Bn0asUgcNYPYA1wnl9bokw_k1xshFC4"

# Console Windows : cp1252 ne sait pas imprimer les fleches/coches du worker.
for _stream in (sys.stdout, sys.stderr):
    if _stream is not None and hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent          # racine du repo EECoach
DATA_DIR = ROOT / "data-oa"                            # cache sqlite local (gitignore)

# Plafonds du doc jsonb (Supabase gratuit : viser < 300 Ko / module).
# ⚠ Le cap des erreurs est PAR TRANCHE (revue 21/07) : un cap global par
# criticality etait domine par les buckets <1600 (volumineux) et laissait les
# tranches 2200/2500 quasi vides dans la SPA (mesure : 8/40 et 0/2 gardees).
CAP_ERRORS_PER_BUCKET = 40   # erreurs gardees par tranche servie (DOC_BUCKETS)
CAP_GAPS_PER_CELL = 15    # trous par (couleur x tranche)
CAP_LIFETIME = 40
CAP_EXPECTED_PER_BUCKET = 15
CAP_DANGER = 40
# Tranches servies aux vues par-tranche (la zone calibree D12 : 1600 Lichess et +).
DOC_BUCKETS = (1600, 1800, 2000, 2200, 2500)


# ── .env + HTTP minimal ──────────────────────────────────────────────────────
def _load_env(path: Path) -> dict[str, str]:
    """Parse KEY=VALUE (le format du .env de la gate), sans dependance."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


class SupabaseHttpError(Exception):
    """Erreur HTTP Supabase — une Exception ordinaire (PAS SystemExit) pour que
    la boucle par module puisse continuer et que le 401 puisse etre re-tente."""

    def __init__(self, method: str, url: str, code: int, detail: str):
        super().__init__(f"✗ Supabase {method} {url.split('?')[0]} -> {code} : {detail}")
        self.code = code


def _http_json(method: str, url: str, *, token: str | None = None,
               body: object | None = None, extra: dict[str, str] | None = None):
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if extra:
        headers.update(extra)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:300]
        raise SupabaseHttpError(method, url, err.code, detail)


def _login(email: str, pwd: str) -> tuple[str, str]:
    """-> (access_token, user_id). Patron exact de tests/gate/gate.mjs."""
    data = _http_json("POST", f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                      body={"email": email, "password": pwd})
    return data["access_token"], data["user"]["id"]


def _fetch_modules(token: str, uid: str) -> list[dict]:
    rows = _http_json(
        "GET",
        f"{SUPABASE_URL}/rest/v1/modules?select=id,name,pgn,extra"
        f"&teacher_id=eq.{uid}&order=updated_at.desc",
        token=token,
    )
    out = []
    for r in rows or []:
        ex = r.get("extra") or {}
        # Analysables : un vrai module d'ouverture du coach — PGN present,
        # ni paquet d'exercices, ni couche d'edition eleve (overlay).
        if (r.get("pgn") or "").strip() and not ex.get("isExercise") and ex.get("overlayOf") is None:
            out.append(r)
    return out


def _reset_chapter(conn, chapter_key: str) -> None:
    """Purge paths + errors du chapitre AVANT re-analyse, pour que le doc
    reflete exactement le PGN courant du module (sinon l'ingestion APPEND et
    les erreurs s'accumulent a travers les runs — lignes supprimees comprises).
    Les caches chers (positions / stats / evals, cles par FEN-4) sont conserves."""
    row = conn.execute("SELECT id FROM chapters WHERE name = ?", (chapter_key,)).fetchone()
    if row is None:
        return
    cid = int(row["id"])
    conn.execute("DELETE FROM errors WHERE chapter_id = ?", (cid,))
    conn.execute("DELETE FROM paths WHERE chapter_id = ?", (cid,))
    conn.commit()


# ── Construction du document d'analyse (vue pure du cache OA) ────────────────
def _sample_lines(conn, chapter_id: int) -> dict[int, str]:
    """position_id -> ligne SAN representative la plus courte (contexte d'affichage)."""
    lines: dict[int, str] = {}
    for pos in ingest.iter_chapter_positions(conn, chapter_id):
        seq = (pos["sample_sequence"] or "").split()
        lines[int(pos["id"])] = lifetime._san_line(seq)
    return lines


def build_analysis_doc(conn, chapter_id: int, chapter_name: str) -> dict:
    """Le doc jsonb complet d'un module : meta + errors + gaps + diagnostics.

    Tout est precalcule (FEN complets, SAN, libelles de ligne) pour que la SPA
    n'ait qu'a afficher. Chaque section est plafonnee (Supabase gratuit).
    """
    san_of = _sample_lines(conn, chapter_id)

    # 1. Erreurs (le coeur) — tri criticality (l'ORDER BY de la requete), cap
    # PAR TRANCHE et restreint aux tranches que la SPA sait filtrer (DOC_BUCKETS)
    # — un cap global laissait 2200/2500 vides et des buckets <1600 sans chip.
    all_errors = db.errors_for_chapter(conn, chapter_id)
    kept_per_bucket: dict[int, int] = {}
    errors = []
    for e in all_errors:
        bucket = int(e["elo_bucket"])
        if bucket not in DOC_BUCKETS:
            continue
        if kept_per_bucket.get(bucket, 0) >= CAP_ERRORS_PER_BUCKET:
            continue
        kept_per_bucket[bucket] = kept_per_bucket.get(bucket, 0) + 1
        f4 = e["fen4"]
        errors.append({
            "fen": _ensure_full_fen(f4),
            "stm": side_to_move(f4),                     # le camp qui faute
            "line": san_of.get(int(e["position_id"]), ""),
            "san": e["mistake_move_san"] or e["mistake_move_uci"],
            "uci": e["mistake_move_uci"],
            # bestSan = un SAN ou rien — JAMAIS le repli UCI (un kp.san en UCI
            # rendrait l'exercice insoluble dans le drill, revue 21/07).
            "bestSan": e["best_move_san"],
            "bestUci": e["best_move_uci"],
            "freq": round(float(e["mistake_frequency"]), 4),
            "games": int(e["mistake_games"]),
            "lossCp": int(e["eval_loss_cp"]),
            "dwr": round(float(e["delta_winrate"]), 4) if e["delta_winrate"] is not None else None,
            "crit": round(float(e["criticality"] or 0.0), 5),
            "bucket": int(e["elo_bucket"]),
            "type": e["error_type"],
        })

    # 2. Trous du repertoire — les 2 couleurs x tranches calibrees.
    color = gaps.infer_repertoire_color(conn, chapter_id)
    gap_doc: dict[str, dict[str, list]] = {}
    for col in ("w", "b"):
        per_bucket: dict[str, list] = {}
        for bucket in DOC_BUCKETS:
            rows = gaps.repertoire_gaps(conn, chapter_id, bucket=bucket, color=col,
                                        limit=CAP_GAPS_PER_CELL)
            per_bucket[str(bucket)] = [{
                "fen": _ensure_full_fen(g.fen4),
                "line": g.line_san,
                "moveNo": g.move_no,
                "san": g.opp_move_san,
                "freq": round(g.frequency, 4),
                "games": g.games,
                "total": g.total_games,
            } for g in rows]
        gap_doc[col] = per_bucket

    # 3. Diagnostics compacts.
    hm = heatmap.chapter_heatmap(conn, chapter_id)
    heat = [[ply, bucket, round(crit, 5)] for (ply, bucket), crit in sorted(hm.grid.items())]

    lifes = lifetime.chapter_error_lifetimes(conn, chapter_id)[:CAP_LIFETIME]
    life_doc = [{
        "san": lf.mistake_san, "bestSan": lf.best_san, "line": lf.line,
        "buckets": lf.buckets, "span": lf.span,
        "peak": round(lf.peak, 5), "peakFreq": round(lf.peak_freq, 4),
    } for lf in lifes]

    expected: dict[str, list] = {}
    for bucket in DOC_BUCKETS:
        evs = expected_value.chapter_expected_values(conn, chapter_id, bucket)
        expected[str(bucket)] = [{
            "line": ev.line, "san": ev.mistake_san,
            "reach": round(ev.reach_probability, 5),
            "crit": round(ev.peak_criticality, 5),
            "ev": round(ev.expected_value, 6),
        } for ev in evs[:CAP_EXPECTED_PER_BUCKET]]

    dangers = danger_depth.chapter_danger_depths(conn, chapter_id)[:CAP_DANGER]
    danger_doc = [{
        "line": d.line, "move": d.danger_move,
        "san": d.first_mistake_san, "crit": round(d.peak_criticality, 5),
    } for d in dangers]

    return {
        "v": 1,
        "chapter": chapter_name,
        "analyzedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "buckets": list(ELO_BUCKETS),
        "docBuckets": list(DOC_BUCKETS),
        "fide": {str(k): v for k, v in BUCKET_FIDE_EQUIV.items()},
        "repColor": color,
        "totals": {"errors": len(all_errors), "kept": len(errors)},
        "errors": errors,
        "gaps": gap_doc,
        "heatmap": heat,
        "lifetime": life_doc,
        "expected": expected,
        "danger": danger_doc,
    }


# ── Boucle principale ────────────────────────────────────────────────────────
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Worker Supabase D18 : modules EECoach -> analyses OA")
    ap.add_argument("--modules", help="ids de modules a analyser (separes par des virgules) ; defaut = tous")
    ap.add_argument("--limit-positions", type=int, default=None, help="borne le nb de positions analysees (passe rapide)")
    ap.add_argument("--no-deepen", action="store_true", help="saute l'etape 6 (lignes de refutation Stockfish)")
    ap.add_argument("--dry-run", action="store_true", help="analyse + doc, sans push Supabase")
    ap.add_argument("--json-out", help="dossier ou ecrire les docs JSON produits (debug/seed)")
    ap.add_argument("--force", action="store_true", help="tourner meme sans OA_LICHESS_TOKEN (aucune erreur ne sera detectee)")
    args = ap.parse_args(argv)

    env = {**_load_env(ROOT / ".env"), **os.environ}
    email, pwd = env.get("GATE_COACH_EMAIL"), env.get("GATE_COACH_PWD")
    if not email or not pwd:
        print("✗ Renseigne GATE_COACH_EMAIL / GATE_COACH_PWD dans .env (les creds de la gate).")
        return 2
    if not env.get("OA_LICHESS_TOKEN") and not args.force:
        print("✗ OA_LICHESS_TOKEN absent : sans les stats humaines Lichess, AUCUNE erreur ne peut\n"
              "  etre detectee (le doc serait vide). Cree un token (lichess.org/account/oauth/token)\n"
              "  ou relance avec --force en connaissance de cause.")
        return 2
    os.environ.setdefault("OA_LICHESS_TOKEN", env.get("OA_LICHESS_TOKEN", ""))

    print(f"→ Connexion Supabase ({email}) …")
    try:
        token, uid = _login(email, pwd)
        modules = _fetch_modules(token, uid)
    except SupabaseHttpError as err:
        print(err)
        return 1
    if args.modules:
        wanted = {m.strip() for m in args.modules.split(",")}
        modules = [m for m in modules if str(m["id"]) in wanted]
    if not modules:
        print("Aucun module analysable (PGN present, ni exercice ni overlay).")
        return 0
    print(f"→ {len(modules)} module(s) a analyser.")

    DATA_DIR.mkdir(exist_ok=True)
    conn = db.connect(DATA_DIR / "cache.sqlite")
    db.init_db(conn)
    config = Config()

    pushed = 0
    for mod in modules:
        mid, name = str(mod["id"]), mod["name"] or f"module {mod['id']}"
        # La cle de chapitre embarque l'ID DU MODULE : le cache OA dedupe les
        # chapitres par nom, et deux modules homonymes fusionneraient sinon en
        # un seul chapitre (analyses croisees — revue 21/07).
        chap_key = f"{name} [eecoach:{mid}]"
        print(f"\n═══ {name} ({mid}) ═══")
        with tempfile.NamedTemporaryFile("w", suffix=".pgn", delete=False,
                                         encoding="utf-8") as tmp:
            tmp.write(mod["pgn"])
            pgn_path = Path(tmp.name)
        try:
            _reset_chapter(conn, chap_key)
            result = analyze_chapter(
                conn, config, pgn_path, chap_key,
                no_deepen=args.no_deepen,
                limit_positions=args.limit_positions,
                on_progress=lambda msg: print("  " + msg),
            )
        except Exception as err:                      # un module en echec ne bloque pas les autres
            print(f"  ✗ analyse en echec : {err}")
            continue
        finally:
            pgn_path.unlink(missing_ok=True)

        doc = build_analysis_doc(conn, result.chapter_id, name)
        size_kb = len(json.dumps(doc, ensure_ascii=False).encode("utf-8")) / 1024
        print(f"  doc : {len(doc['errors'])} erreurs (sur {doc['totals']['errors']}), "
              f"{size_kb:.0f} Ko")
        if size_kb > 300:
            print("  ⚠ doc > 300 Ko — envisager de baisser les plafonds.")

        if args.json_out:
            out_dir = Path(args.json_out)
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"oa-{mid}.json").write_text(
                json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")

        if args.dry_run:
            print("  (dry-run : pas de push)")
            continue

        # Push tolerant : une longue analyse (20 min/module) peut faire expirer
        # le token (~1 h) — on re-loge une fois sur 401 ; tout autre echec de
        # push n'abandonne QUE ce module, pas les suivants.
        body = [{"module_id": mid, "teacher_id": uid,
                 "updated_at": datetime.now(timezone.utc).isoformat(),
                 "data": doc}]
        try:
            try:
                _http_json("POST", f"{SUPABASE_URL}/rest/v1/oa_analyses", token=token,
                           body=body, extra={"Prefer": "resolution=merge-duplicates"})
            except SupabaseHttpError as err:
                if err.code != 401:
                    raise
                print("  … token expire, reconnexion")
                token, uid = _login(email, pwd)
                _http_json("POST", f"{SUPABASE_URL}/rest/v1/oa_analyses", token=token,
                           body=body, extra={"Prefer": "resolution=merge-duplicates"})
        except SupabaseHttpError as err:
            print(f"  ✗ push en echec : {err}")
            continue
        pushed += 1
        print("  ✓ pousse dans oa_analyses")

    print(f"\n✓ Termine — {pushed} analyse(s) poussee(s)." if not args.dry_run
          else "\n✓ Termine (dry-run).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
