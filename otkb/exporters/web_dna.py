"""ADN par famille pré-calculé (JSON) pour le site web.

Le site charge ce petit fichier `family-dna.json` (corpus COMPLET) pour rendre
instantanément l'accueil, la liste des ouvertures et chaque fiche ADN — sans
toucher à la grosse base sql.js (réservée à l'explorateur de position et au
solveur). Contenu par famille : volume, rating/coup d'apparition moyens, motifs
dominants, variantes les plus jouées, cases critiques / de sacrifice.

Pur SQL + stdlib, offline. Les cases sont agrégées en UNE passe sur
`puzzle_analysis` (dédupliquée par (famille, puzzle_id)), les stats et motifs
viennent des caches d'ADN (`statistics`, `family_motifs`).
"""

from __future__ import annotations

import json
from collections import Counter

from ..db import Database


def family_dna_payload(db: Database, *, min_count: int = 50, top_motifs: int = 8,
                       top_vars: int = 8, top_squares: int = 8) -> list[dict]:
    """Construit la liste ADN par famille (corpus complet), triée par volume."""
    con = db.conn

    # 1) stats de base par famille (cache statistics, scope='family')
    fams: dict[str, dict] = {}
    for r in con.execute(
        "SELECT key AS fam, puzzle_count AS n, avg_rating AS rating, avg_fullmove AS fm "
        "FROM statistics WHERE scope = 'opening_family' AND puzzle_count >= ?",
        (min_count,),
    ):
        fams[r["fam"]] = {
            "tag": r["fam"], "name": r["fam"].replace("_", " "),
            "n": r["n"], "rating": round(r["rating"]) if r["rating"] else None,
            "fm": round(r["fm"], 1) if r["fm"] else None,
            "motifs": [], "vars": [], "crit": {}, "sac": {},
        }

    # 2) motifs dominants (cache family_motifs) → % = count / n
    motifs: dict[str, list] = {}
    for r in con.execute(
        "SELECT family AS fam, label_fr, slug, count FROM family_motifs ORDER BY count DESC"
    ):
        motifs.setdefault(r["fam"], [])
        if len(motifs[r["fam"]]) < top_motifs and r["fam"] in fams:
            n = fams[r["fam"]]["n"] or 1
            motifs[r["fam"]].append({
                "label": r["label_fr"] or r["slug"],
                "pct": round(100.0 * r["count"] / n, 1),
            })
    for fam, ms in motifs.items():
        if fam in fams:
            fams[fam]["motifs"] = ms

    # 3) variantes les plus jouées (volume par sous-ouverture)
    vars_by: dict[str, list] = {}
    for r in con.execute(
        """
        SELECT o.family AS fam, o.variation AS v, COUNT(DISTINCT po.puzzle_id) AS c
        FROM openings o JOIN puzzle_openings po ON po.opening_id = o.opening_id
        WHERE o.family IS NOT NULL AND o.variation IS NOT NULL
        GROUP BY o.family, o.variation
        ORDER BY c DESC
        """
    ):
        vars_by.setdefault(r["fam"], [])
        if len(vars_by[r["fam"]]) < top_vars and r["fam"] in fams:
            vars_by[r["fam"]].append({"v": r["v"], "c": r["c"]})
    for fam, vs in vars_by.items():
        if fam in fams:
            fams[fam]["vars"] = vs

    # 4) cases critiques / de sacrifice — UNE passe, dédupliquée par (famille, puzzle)
    crit: dict[str, Counter] = {}
    sac: dict[str, Counter] = {}
    for r in con.execute(
        """
        SELECT DISTINCT o.family AS fam, a.puzzle_id, a.critical_squares AS c, a.sacrifices AS s
        FROM puzzle_analysis a
        JOIN puzzle_openings po ON po.puzzle_id = a.puzzle_id
        JOIN openings o ON o.opening_id = po.opening_id
        WHERE o.family IS NOT NULL
        """
    ):
        fam = r["fam"]
        if fam not in fams:
            continue
        cc = crit.setdefault(fam, Counter())
        ss = sac.setdefault(fam, Counter())
        for sq in (r["c"] or "").split():
            cc[sq] += 1
        for token in (r["s"] or "").split():          # "N@e6"
            _, _, sq = token.partition("@")
            if sq:
                ss[sq] += 1
    for fam in fams:
        fams[fam]["crit"] = dict(crit.get(fam, Counter()).most_common(top_squares))
        fams[fam]["sac"] = dict(sac.get(fam, Counter()).most_common(top_squares))

    return sorted(fams.values(), key=lambda d: d["n"], reverse=True)


def corpus_totals(db: Database) -> dict:
    """Chiffres du corpus complet (pour l'accueil, sans charger la grosse base)."""
    con = db.conn
    return {
        "puzzles": con.execute("SELECT COUNT(*) FROM puzzles").fetchone()[0],
        "openings": con.execute("SELECT COUNT(*) FROM openings").fetchone()[0],
        "families": con.execute(
            "SELECT COUNT(DISTINCT family) FROM openings WHERE family IS NOT NULL"
        ).fetchone()[0],
        "motifs": con.execute("SELECT COUNT(*) FROM themes WHERE is_motif = 1").fetchone()[0],
    }


def write_family_dna(db: Database, path, *, min_count: int = 50) -> int:
    """Écrit `family-dna.json` = {totals, families}. Renvoie le nombre de familles."""
    families = family_dna_payload(db, min_count=min_count)
    payload = {"totals": corpus_totals(db), "families": families}
    from pathlib import Path

    Path(path).write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    return len(families)
