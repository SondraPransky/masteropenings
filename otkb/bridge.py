"""Pont HTTP local OTKB → EECoach.

EECoach (SPA déployée sur GitHub Pages) est un outil COACH qui prépare des paquets
d'exercices ; OTKB est l'usine locale qui sait répondre au « quels puzzles
tactiques PASSENT PAR cette position ? » (through-position) sur le corpus INTÉGRAL
(18 Go, jamais déployable). Ce module expose cette logique — déjà écrite et mesurée
dans `explorer/` et `exporters/` — derrière quelques routes HTTP JSON que la vue
coach d'EECoach interroge en `localhost`.

Choix d'architecture :

- **`HTTPServer` mono-thread** (pas `ThreadingHTTPServer`) : la connexion sqlite est
  liée à son thread créateur (`check_same_thread=True`) ; un serveur mono-thread
  sert les requêtes DANS ce même thread, donc aucune contrainte de concurrence.
  Pour un coach unique en local, la sérialisation des requêtes est sans coût
  perceptible (tri popularité déjà à ~1 ms grâce au cache `position_popularity`).
- **CORS ouvert** (`Access-Control-Allow-Origin: *`) : le fetch HTTPS→localhost est
  autorisé par les navigateurs (localhost = « potentially trustworthy »), mais la
  requête cross-origin exige quand même l'en-tête. Le pont ne sert QUE des données
  publiques de puzzles (aucun secret, aucune donnée d'élève).
- **Zéro logique métier réécrite** : le pont ne fait qu'appeler `resolve_fen`,
  `list_puzzles_through`, `count_puzzles_through`, `get_puzzle`,
  `export_through_position`.

Stdlib seule (`http.server`, `json`, `urllib`, `tempfile`).
"""

from __future__ import annotations

import json
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .db import Database
from .explorer.insights import count_puzzles_through, list_puzzles_through
from .explorer.query import MoveParseError, get_puzzle, resolve_fen
from .exporters.pgn_export import export_through_position
from .logging_setup import get_logger

logger = get_logger(__name__)

_SORTS = ("popularity", "rating_asc", "rating_desc")


def _int_or_none(qs: dict, key: str) -> int | None:
    """Lit un entier optionnel d'une query-string (None si absent/vide/invalide)."""
    raw = (qs.get(key) or [""])[0].strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


class _Handler(BaseHTTPRequestHandler):
    # Injecté par `serve()` (attribut de classe → partagé, thread unique).
    db: Database = None  # type: ignore[assignment]

    server_version = "otkb-bridge/1.0"

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
        con = self.db.conn
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
        sort = (qs.get("sort") or ["popularity"])[0]
        if sort not in _SORTS:
            sort = "popularity"
        limit = _int_or_none(qs, "limit") or 45
        offset = _int_or_none(qs, "offset") or 0
        rmin = _int_or_none(qs, "min")
        rmax = _int_or_none(qs, "max")
        total = count_puzzles_through(self.db, nfen, rating_min=rmin, rating_max=rmax)
        rows = list_puzzles_through(
            self.db, nfen, sort=sort, limit=limit, offset=offset,
            rating_min=rmin, rating_max=rmax,
        )
        self._send(200, {
            "nfen": nfen,
            "total": total,
            "sort": sort,
            "puzzles": [
                {"id": r.puzzle_id, "rating": r.rating,
                 "popularity": r.popularity, "themes": r.themes}
                for r in rows
            ],
        })

    def _puzzle(self, qs: dict) -> None:
        pid = (qs.get("id") or [""])[0].strip()
        if not pid:
            return self._err(400, "paramètre `id` requis")
        pz = get_puzzle(self.db, pid)
        if pz is None:
            return self._err(404, f"puzzle introuvable : {pid}")
        self._send(200, {
            "id": pz.puzzle_id, "fen": pz.fen, "moves": pz.moves,
            "rating": pz.rating, "themes": pz.themes, "game_url": pz.game_url,
        })

    def _export(self, qs: dict) -> None:
        nfen = self._resolve(qs)
        sort = (qs.get("sort") or ["popularity"])[0]
        if sort not in _SORTS:
            sort = "popularity"
        limit = _int_or_none(qs, "limit")
        rmin = _int_or_none(qs, "min")
        rmax = _int_or_none(qs, "max")
        full = (qs.get("full") or ["0"])[0] in ("1", "true", "yes")
        # Réutilise l'exporter testé (écrit un fichier) via un temporaire, puis relit.
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".pgn", delete=False, encoding="utf-8"
        ) as tmp:
            tmp_path = Path(tmp.name)
        try:
            written = export_through_position(
                self.db, nfen, tmp_path, limit=limit, sort=sort,
                rating_min=rmin, rating_max=rmax, annotated=full,
            )
            pgn = tmp_path.read_text(encoding="utf-8")
        finally:
            tmp_path.unlink(missing_ok=True)
        logger.info("bridge export %s : %d exercices", nfen, written)
        self._send(200, pgn, ctype="application/x-chess-pgn")

    # Journalise via le logger du projet plutôt que sur stderr brut.
    def log_message(self, fmt: str, *args) -> None:  # noqa: A002
        logger.info("bridge %s - %s", self.address_string(), fmt % args)


def serve(db: Database, host: str = "127.0.0.1", port: int = 8127) -> None:
    """Démarre le pont (bloquant). `Ctrl+C` pour arrêter."""
    _Handler.db = db
    httpd = HTTPServer((host, port), _Handler)
    logger.info("Pont OTKB en écoute sur http://%s:%d (Ctrl+C pour arrêter)", host, port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Pont OTKB arrêté.")
    finally:
        httpd.server_close()
