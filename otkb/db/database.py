"""Couche d'accès SQLite (SPEC §6, module Base de données).

Fournit : application du schéma, réglages persistés, caches d'ID pour les
dimensions (Openings/Themes), insertion d'un puzzle + jonctions. Conçue pour
un traitement interruptible/reprenable (INSERT OR IGNORE, transactions).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable

from .. import SCHEMA_VERSION
from ..logging_setup import get_logger
from ..models import PuzzleRow
from ..openings import compute_family, humanize

logger = get_logger(__name__)

_SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# Index de schema.sql coûteux à créer sur une table `positions` peuplée (mesuré :
# ~8 min pour un composite sur 34,6 M lignes). `init_schema` (CREATE INDEX IF NOT
# EXISTS) les crée SILENCIEUSEMENT s'ils manquent — indiscernable d'un gel. On ne
# bloque pas (init_schema reste idempotent et non interactif, il tourne dans des
# pipelines) : on PRÉVIENT. Cf. wayfinder ticket 005 (17/07).
_HEAVY_POSITION_INDEXES = (
    "idx_positions_normfen_puzzle",
    "idx_positions_normfen_rating",
    "idx_positions_puzzle",
    "idx_positions_game_ply",
)
_HEAVY_ROWS_THRESHOLD = 1_000_000


class Database:
    """Enveloppe fine autour d'une connexion SQLite au schéma OTKB."""

    def __init__(self, path: Path | str, *, check_same_thread: bool = True) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False : requis par l'UI (NiceGUI sert les requêtes
        # depuis un threadpool). Lecture seule côté UI, pas de course d'écriture.
        self.conn = sqlite3.connect(self.path, check_same_thread=check_same_thread)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        # attendre un verrou (jusqu'à 30 s) plutôt que d'échouer immédiatement en
        # « database is locked » : robustesse quand un run download écrit pendant
        # qu'un lecteur (explorateur) est ouvert sur la même base.
        self.conn.execute("PRAGMA busy_timeout = 30000")
        # PERF LECTURE — la base est ÉNORME (15+ Go avec l'index `positions`) et
        # l'usage dominant est la lecture (explorateur). Les défauts SQLite sont
        # inadaptés : 2 Mo de cache de pages et aucun mappage mémoire, si bien que
        # chaque nouvelle position paie des I/O disque (mesuré : compteur « à
        # travers » à 4,4 s à froid contre 0,26 s à chaud). On agrandit le cache et
        # on mappe le fichier : purement lecture, aucun risque pour les données.
        self.conn.execute("PRAGMA cache_size = -262144")    # 256 Mo de cache de pages
        self.conn.execute("PRAGMA mmap_size = 4294967296")  # mappe jusqu'à 4 Go
        self.conn.execute("PRAGMA temp_store = MEMORY")
        # caches d'ID pour éviter un round-trip par jonction
        self._opening_ids: dict[str, int] = {}
        self._theme_ids: dict[str, int] = {}

    # -- cycle de vie ------------------------------------------------------
    def __enter__(self) -> "Database":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def close(self) -> None:
        self.conn.close()

    # -- schéma & réglages -------------------------------------------------
    def init_schema(self) -> None:
        """Applique schema.sql (idempotent) et note la version de schéma."""
        self._warn_heavy_indexes()
        self.conn.executescript(_SCHEMA_PATH.read_text(encoding="utf-8"))
        self._ensure_game_id()
        self.set_setting("schema_version", str(SCHEMA_VERSION))
        self.conn.commit()
        logger.info("Schéma appliqué (version %s) sur %s", SCHEMA_VERSION, self.path)

    def _warn_heavy_indexes(self) -> None:
        """Annonce les index lourds que schema.sql s'apprête à créer.

        Sur une base neuve (table absente/petite), rien à dire. Sur une base
        peuplée à qui il manque un index lourd — base copiée, reconstruite, ou
        schéma enrichi — la création prendra plusieurs minutes : sans ce log,
        `init_schema` semble gelé. MAX(position_id) sert de volumétrie O(1)
        (`positions` est append-only, jamais d'UPDATE/DELETE en pratique).
        """
        row = self.conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='positions'"
        ).fetchone()
        if row is None:
            return
        maxid = self.conn.execute(
            "SELECT MAX(position_id) FROM positions"
        ).fetchone()[0] or 0
        if maxid < _HEAVY_ROWS_THRESHOLD:
            return
        present = {r[1] for r in self.conn.execute("PRAGMA index_list('positions')")}
        for name in _HEAVY_POSITION_INDEXES:
            if name not in present:
                logger.warning(
                    "init_schema va créer l'index %s sur ~%s lignes de `positions` : "
                    "plusieurs minutes SANS autre signe de vie — laisser tourner.",
                    name, f"{maxid:,}".replace(",", " "),
                )

    def _ensure_game_id(self) -> None:
        """Migration idempotente : colonne `puzzles.game_id` + backfill + index.

        Pour une base existante créée avant le schéma v3 (colonne absente).
        Backfill en pur SQL : l'id = 8 car. après 'https://lichess.org/' (pos 21).
        """
        cols = [r[1] for r in self.conn.execute("PRAGMA table_info(puzzles)")]
        if "game_id" not in cols:
            self.conn.execute("ALTER TABLE puzzles ADD COLUMN game_id TEXT")
        self.conn.execute(
            "UPDATE puzzles SET game_id = substr(game_url, 21, 8) "
            "WHERE game_id IS NULL AND game_url IS NOT NULL"
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_puzzles_gameid ON puzzles(game_id)"
        )

    def set_setting(self, key: str, value: str) -> None:
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def set_settings(self, mapping: dict[str, str]) -> None:
        for key, value in mapping.items():
            self.set_setting(key, value)
        self.conn.commit()

    def get_setting(self, key: str, default: str | None = None) -> str | None:
        row = self.conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else default

    # -- dimensions (get-or-create avec cache) -----------------------------
    def get_or_create_opening(self, tag: str) -> int:
        """Insère un tag d'ouverture (famille provisoire = lui-même).

        La vraie famille/variation est résolue globalement plus tard par
        `recompute_families` (grill #6).
        """
        cached = self._opening_ids.get(tag)
        if cached is not None:
            return cached
        cur = self.conn.execute(
            "INSERT INTO openings(tag, family, variation, name) VALUES(?,?,?,?) "
            "ON CONFLICT(tag) DO NOTHING",
            (tag, tag, None, humanize(tag)),
        )
        if cur.lastrowid and cur.rowcount:
            opening_id = cur.lastrowid
        else:
            opening_id = self.conn.execute(
                "SELECT opening_id FROM openings WHERE tag = ?", (tag,)
            ).fetchone()["opening_id"]
        self._opening_ids[tag] = opening_id
        return opening_id

    def recompute_families(self) -> None:
        """Post-pass global : résout family/variation sur TOUTES les ouvertures.

        À lancer une fois l'ingestion terminée. Idempotent.
        """
        rows = self.conn.execute("SELECT tag FROM openings").fetchall()
        known = {r["tag"] for r in rows}
        for tag in known:
            family, variation = compute_family(tag, known)
            self.conn.execute(
                "UPDATE openings SET family = ?, variation = ? WHERE tag = ?",
                (family, variation, tag),
            )
        self.conn.commit()
        logger.info("Familles recalculées sur %d ouvertures", len(known))

    def get_or_create_theme(self, name: str) -> int:
        cached = self._theme_ids.get(name)
        if cached is not None:
            return cached
        cur = self.conn.execute(
            "INSERT INTO themes(name) VALUES(?) ON CONFLICT(name) DO NOTHING",
            (name,),
        )
        if cur.lastrowid and cur.rowcount:
            theme_id = cur.lastrowid
        else:
            theme_id = self.conn.execute(
                "SELECT theme_id FROM themes WHERE name = ?", (name,)
            ).fetchone()["theme_id"]
        self._theme_ids[name] = theme_id
        return theme_id

    # -- insertion d'un puzzle + jonctions ---------------------------------
    def insert_puzzle(
        self,
        puzzle: PuzzleRow,
        opening_tags: Iterable[str],
        themes: Iterable[str],
    ) -> None:
        """Insère un puzzle et ses liens. Idempotent (INSERT OR IGNORE).

        `opening_tags` = tags bruts (cf. openings.parse_opening_tags).
        """
        self.conn.execute(
            "INSERT OR IGNORE INTO puzzles("
            " puzzle_id, fen, normalized_fen, fullmove, side_to_move, moves,"
            " rating, rating_deviation, popularity, nb_plays, game_url, game_id,"
            " opening_tags, themes) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                puzzle.puzzle_id, puzzle.fen, puzzle.normalized_fen,
                puzzle.fullmove, puzzle.side_to_move, puzzle.moves,
                puzzle.rating, puzzle.rating_deviation, puzzle.popularity,
                puzzle.nb_plays, puzzle.game_url, puzzle.game_id,
                puzzle.opening_tags, puzzle.themes,
            ),
        )
        for tag in opening_tags:
            oid = self.get_or_create_opening(tag)
            self.conn.execute(
                "INSERT OR IGNORE INTO puzzle_openings(puzzle_id, opening_id) "
                "VALUES(?, ?)",
                (puzzle.puzzle_id, oid),
            )
        for theme in themes:
            tid = self.get_or_create_theme(theme)
            self.conn.execute(
                "INSERT OR IGNORE INTO puzzle_themes(puzzle_id, theme_id) "
                "VALUES(?, ?)",
                (puzzle.puzzle_id, tid),
            )

    def commit(self) -> None:
        self.conn.commit()

    # -- utilitaires -------------------------------------------------------
    def count(self, table: str) -> int:
        # `table` provient du code, jamais d'entrée utilisateur.
        return self.conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
