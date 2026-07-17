"""Pont HTTP local OTKB → EECoach.

EECoach (SPA déployée sur GitHub Pages) est un outil COACH qui prépare des paquets
d'exercices ; OTKB est l'usine locale qui sait répondre au « quels puzzles
tactiques PASSENT PAR cette position ? » (through-position) sur le corpus INTÉGRAL
(18 Go, jamais déployable). Ce module expose cette logique — déjà écrite et mesurée
dans `explorer/` et `ui/data.py` — derrière quelques routes HTTP JSON que la vue
coach d'EECoach interroge en `localhost`.

Le pont parle la MÊME langue que l'outil coach OTKB (`otkb ui`) — c'est lui le
format de référence, validé sur maquettes le 16/07 :
- filtres par NIVEAUX ÉLÈVE FIDE multi-sélection (`ui/levels.py`, plages fusionnées,
  chemin rapide de l'index préservé) — pas des bornes de rating nues ;
- motifs TRADUITS en français (`assets/themes.json`, « fork » → « Fourchette ») ;
- chaque ligne porte la position POSÉE (après le coup adverse `moves[0]`) et le
  TRAIT du solveur — ce que l'élève verra, pas la position interne du puzzle.

Choix d'architecture :
- **`UiData`** (une connexion sqlite `check_same_thread=False` + verrou) plutôt que
  `Database` nu : c'est la façade que l'UI NiceGUI utilise déjà — multi-plages,
  pagination sur l'union, PGN multi. Le pont ne réécrit AUCUNE logique métier.
- **CORS ouvert** (`Access-Control-Allow-Origin: *`) : le fetch HTTPS→localhost est
  autorisé par les navigateurs (localhost = « potentially trustworthy »), mais la
  requête cross-origin exige l'en-tête. Le pont ne sert QUE des données publiques
  de puzzles (aucun secret, aucune donnée d'élève).

Stdlib (`http.server`, `json`, `urllib`) + python-chess (déjà requis par `resolve_fen`).
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import chess

from .explorer.query import MoveParseError, resolve_fen
from .logging_setup import get_logger
from .ui.data import UiData
from .ui.levels import LEVELS, levels_ranges

logger = get_logger(__name__)

_SORTS = ("popularity", "rating_asc", "rating_desc")

# Asset nom d'ouverture → coups UCI (1200 entrées) et labels FR des thèmes,
# chargés une fois à la demande.
_ASSETS = Path(__file__).with_name("assets")
_openings_cache: dict[str, str] | None = None
_theme_fr_cache: dict[str, str] | None = None


def _openings() -> dict[str, str]:
    global _openings_cache
    if _openings_cache is None:
        _openings_cache = json.loads(
            (_ASSETS / "openings_moves.json").read_text(encoding="utf-8"))
    return _openings_cache


def _theme_fr() -> dict[str, str]:
    global _theme_fr_cache
    if _theme_fr_cache is None:
        _theme_fr_cache = {
            slug: str(v.get("label_fr") or slug)
            for slug, v in json.loads(
                (_ASSETS / "themes.json").read_text(encoding="utf-8")).items()
            if isinstance(v, dict)
        }
    return _theme_fr_cache


def _fr_themes(raw: str, limit: int = 4) -> str:
    """« fork mateIn2 short » → « Fourchette · Mat en 2 · Court » (au plus `limit`).

    Même règle que l'outil coach OTKB (`ui/app.py::_fr_themes`)."""
    fr = _theme_fr()
    toks = [t for t in (raw or "").split() if t]
    return " · ".join(fr.get(t, t) for t in toks[:limit])


def _ranges_from_qs(qs: dict) -> list[tuple[int | None, int | None]]:
    """Plages de rating depuis la query-string : `levels=` (clés FIDE de levels.py,
    fusionnées) prime ; repli sur `min=`/`max=` nus ; défaut = tout."""
    raw_levels = (qs.get("levels") or [""])[0].strip()
    if raw_levels:
        return levels_ranges(raw_levels.split(","))
    def _i(key: str) -> int | None:
        v = (qs.get(key) or [""])[0].strip()
        try:
            return int(v) if v else None
        except ValueError:
            return None
    return [(_i("min"), _i("max"))]


class _Handler(BaseHTTPRequestHandler):
    # Injectée par `serve()` (attribut de classe ; UiData sérialise ses lectures).
    data: UiData = None  # type: ignore[assignment]

    server_version = "otkb-bridge/1.1"

    # ---- envoi ----
    def _send(self, code: int, payload: object, *, ctype: str = "application/json") -> None:
        if ctype.startswith("application/json"):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        else:
            body = payload if isinstance(payload, bytes) else str(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _err(self, code: int, message: str) -> None:
        self._send(code, {"error": message})

    def do_OPTIONS(self) -> None:  # noqa: N802 (nom imposé par BaseHTTPRequestHandler)
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)
        try:
            if route == "/health":
                return self._health()
            if route == "/through":
                return self._through(qs)
            if route == "/puzzle":
                return self._puzzle(qs)
            if route == "/levels":
                return self._levels_route()
            if route == "/openings":
                return self._openings_route()
            if route == "/export":
                return self._export(qs)
            return self._err(404, f"route inconnue : {route}")
        except MoveParseError as exc:
            return self._err(400, str(exc))
        except Exception as exc:  # garde-fou : jamais planter le serveur sur une requête
            logger.exception("bridge: erreur sur %s", self.path)
            return self._err(500, f"erreur interne : {exc}")

    # ---- routes ----
    def _health(self) -> None:
        con = self.data.db.conn
        puzzles = con.execute("SELECT COUNT(*) c FROM puzzles").fetchone()["c"]
        openings = con.execute("SELECT COUNT(*) c FROM openings").fetchone()["c"]
        self._send(200, {"ok": True, "puzzles": puzzles, "openings": openings,
                         "service": "otkb-bridge"})

    def _resolve(self, qs: dict) -> str:
        moves = (qs.get("moves") or [None])[0]
        fen = (qs.get("fen") or [None])[0]
        return resolve_fen(moves=moves, fen=fen)

    def _through(self, qs: dict) -> None:
        nfen = self._resolve(qs)
        # tri par défaut = difficulté croissante, comme l'outil coach OTKB
        # (holder["th_sort"] = "rating_asc") ; « popularity » reste accepté.
        sort = (qs.get("sort") or ["rating_asc"])[0]
        if sort not in _SORTS:
            sort = "rating_asc"
        def _i(key: str, default: int) -> int:
            v = (qs.get(key) or [""])[0].strip()
            try:
                return int(v) if v else default
            except ValueError:
                return default
        limit = _i("limit", 45)
        offset = _i("offset", 0)
        ranges = _ranges_from_qs(qs)
        total = self.data.count_through_multi(nfen, ranges)
        rows = self.data.puzzles_through_multi(
            nfen, ranges, sort=sort, limit=limit, offset=offset)
        out = []
        for s in rows:
            # Position POSÉE (après moves[0], le coup adverse) + trait du solveur —
            # même construction que _preview_of dans l'outil coach.
            pd = self.data.puzzle(s.puzzle_id)
            if pd is None or not pd.moves:
                continue
            board = chess.Board(pd.fen)
            try:
                board.push_uci(pd.moves[0])
            except (ValueError, AssertionError):
                continue
            out.append({
                "id": s.puzzle_id, "rating": s.rating,
                "fen": board.board_fen(),                 # placement seul (aperçu)
                "white": board.turn == chess.WHITE,       # trait du SOLVEUR
                "themes_fr": _fr_themes(s.themes),
            })
        self._send(200, {"nfen": nfen, "total": total, "sort": sort, "puzzles": out})

    def _puzzle(self, qs: dict) -> None:
        pid = (qs.get("id") or [""])[0].strip()
        if not pid:
            return self._err(400, "paramètre `id` requis")
        pz = self.data.puzzle(pid)
        if pz is None:
            return self._err(404, f"puzzle introuvable : {pid}")
        self._send(200, {
            "id": pz.puzzle_id, "fen": pz.fen, "moves": pz.moves,
            "rating": pz.rating, "themes": pz.themes, "game_url": pz.game_url,
        })

    def _levels_route(self) -> None:
        """Les niveaux élève FIDE de l'outil coach (libellés pastille compris) —
        le client rend EXACTEMENT ces pastilles, la vérité vit dans levels.py."""
        self._send(200, {"levels": [
            {"key": lv.key, "short": lv.short, "label": lv.label}
            for lv in LEVELS
        ]})

    def _openings_route(self) -> None:
        ops = _openings()
        self._send(200, {"openings": [
            {"name": name.replace("_", " "), "moves": moves}
            for name, moves in sorted(ops.items())
        ]})

    def _export(self, qs: dict) -> None:
        nfen = self._resolve(qs)
        sort = (qs.get("sort") or ["rating_asc"])[0]
        if sort not in _SORTS:
            sort = "rating_asc"
        raw_limit = (qs.get("limit") or [""])[0].strip()
        limit = int(raw_limit) if raw_limit.isdigit() else None
        full = (qs.get("full") or ["0"])[0] in ("1", "true", "yes")
        ranges = _ranges_from_qs(qs)
        pgn = self.data.through_pgn_multi(
            nfen, ranges, sort=sort, limit=limit, annotated=full)
        logger.info("bridge export %s : %d octets", nfen, len(pgn))
        self._send(200, pgn, ctype="application/x-chess-pgn")

    # Journalise via le logger du projet plutôt que sur stderr brut.
    def log_message(self, fmt: str, *args) -> None:  # noqa: A002
        logger.info("bridge %s - %s", self.address_string(), fmt % args)


def serve(db_path: Path | str, host: str = "127.0.0.1", port: int = 8127) -> None:
    """Démarre le pont (bloquant). `Ctrl+C` pour arrêter."""
    _Handler.data = UiData(str(db_path))
    httpd = HTTPServer((host, port), _Handler)
    logger.info("Pont OTKB en écoute sur http://%s:%d (Ctrl+C pour arrêter)", host, port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Pont OTKB arrêté.")
    finally:
        httpd.server_close()
        _Handler.data.db.close()
