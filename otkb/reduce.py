"""Réduction de la base OTKB : 18,4 Go → ~5 Go, corpus INTACT (plan figé 18/07).

Construit une NOUVELLE base (`--out`, l'original n'est jamais touché) destinée au
RUNTIME de l'explorateur (pont EECoach, UI) :

- `normalized_fen TEXT (58 o)` → hash 64 bits (8 o) dans `positions`, `puzzles`
  et les clés des 3 caches (`position_counts`/`children`/`popularity`). Le hash
  porte sur la CHAÎNE normalisée (cf. `db.database.fen_hash64`) : sémantique
  d'égalité identique au TEXT → compteurs vérifiables à l'octet près.
- `positions` perd ses colonnes que AUCUN chemin runtime ne lit (vérifié par
  grep : eco, opening_tags, themes, white_elo, black_elo, opening_id) et
  l'index d'ingestion `idx_positions_puzzle`.
- `downloads`/`updates` (bookkeeping d'ingestion) ne sont pas copiées.
- `games` EST copiée : l'export PGN annoté (`LEFT JOIN games`) en a besoin.

La base réduite est un ARTEFACT de lecture : l'ingestion continue sur la grande
base, puis on relance `reduce`. Le marqueur `settings.fen_key = blake2b64` fait
basculer `Database.fen_key` — les requêtes SQL, elles, ne changent pas.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from .db.database import FEN_KEY_BLAKE2B64, FEN_KEY_SETTING, fen_hash64
from .logging_setup import get_logger

logger = get_logger(__name__)

# Tables copiées verbatim (mêmes colonnes, mêmes valeurs).
_VERBATIM = {
    "openings": ["CREATE INDEX idx_openings_family ON openings(family)"],
    "themes": ["CREATE INDEX idx_themes_motif ON themes(is_motif)"],
    "puzzle_openings": ["CREATE INDEX idx_po_opening ON puzzle_openings(opening_id)"],
    "puzzle_themes": ["CREATE INDEX idx_pt_theme ON puzzle_themes(theme_id)"],
    "statistics": [],
    "family_motifs": [],
    "family_top_puzzles": [],
    "puzzle_analysis": [],
    "games": [],
}


def _copy_verbatim(con: sqlite3.Connection, table: str, extra_sql: list[str]) -> None:
    src_sql = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    if src_sql is None:
        logger.warning("reduce : table absente de la source, ignorée : %s", table)
        return
    # Les REFERENCES sautent (artefact de lecture, pas d'écriture à contraindre)
    # mais les PRIMARY KEY restent (ce sont les index de lecture).
    ddl = src_sql[0].replace("CREATE TABLE", "CREATE TABLE z.", 1)
    con.execute(ddl)
    con.execute(f"INSERT INTO z.{table} SELECT * FROM main.{table}")
    for sql in extra_sql:
        con.execute(sql.replace("CREATE INDEX ", "CREATE INDEX z."))


def cmd_reduce(cfg, out: str | None) -> None:
    src_path = Path(cfg.db_path)
    out_path = Path(out) if out else src_path.with_name("otkb-z.db")
    if out_path.exists():
        raise SystemExit(f"reduce : {out_path} existe déjà — supprime-le d'abord (l'original, lui, n'est jamais touché)")

    t0 = time.time()
    con = sqlite3.connect(src_path)
    con.create_function("fenkey", 1, fen_hash64, deterministic=True)
    con.execute(f"ATTACH DATABASE '{out_path.as_posix()}' AS z")
    # Artefact neuf écrit d'un bloc : journal inutile, la moitié du temps gagnée.
    con.execute("PRAGMA z.journal_mode = OFF")
    con.execute("PRAGMA z.synchronous = OFF")
    con.execute("PRAGMA cache_size = -262144")

    step = lambda msg: logger.info("reduce [%5.0fs] %s", time.time() - t0, msg)

    # settings + marqueur de clé
    con.execute("CREATE TABLE z.settings (key TEXT PRIMARY KEY, value TEXT)")
    con.execute("INSERT INTO z.settings SELECT * FROM main.settings")
    con.execute(
        "INSERT OR REPLACE INTO z.settings(key, value) VALUES (?, ?)",
        (FEN_KEY_SETTING, FEN_KEY_BLAKE2B64),
    )
    step("settings copiés + marqueur fen_key")

    # puzzles : normalized_fen → hash (le reste inchangé)
    con.execute("""
        CREATE TABLE z.puzzles (
            puzzle_id        TEXT PRIMARY KEY,
            fen              TEXT NOT NULL,
            normalized_fen   INTEGER NOT NULL,
            fullmove         INTEGER NOT NULL,
            side_to_move     TEXT NOT NULL,
            moves            TEXT NOT NULL,
            rating           INTEGER,
            rating_deviation INTEGER,
            popularity       INTEGER,
            nb_plays         INTEGER,
            game_url         TEXT,
            game_id          TEXT,
            opening_tags     TEXT,
            themes           TEXT
        )""")
    con.execute("""
        INSERT INTO z.puzzles
        SELECT puzzle_id, fen, fenkey(normalized_fen), fullmove, side_to_move,
               moves, rating, rating_deviation, popularity, nb_plays,
               game_url, game_id, opening_tags, themes
        FROM main.puzzles""")
    con.execute("CREATE INDEX z.idx_puzzles_normfen ON puzzles(normalized_fen)")
    step("puzzles (1,2 M) hashés + index")

    for table, extra in _VERBATIM.items():
        _copy_verbatim(con, table, extra)
        step(f"{table} copiée verbatim")

    # positions : LE cœur — hash + seules les colonnes que le runtime lit.
    con.execute("""
        CREATE TABLE z.positions (
            position_id    INTEGER PRIMARY KEY,
            normalized_fen INTEGER NOT NULL,
            game_id        TEXT,
            puzzle_id      TEXT,
            ply            INTEGER,
            puzzle_rating  INTEGER
        )""")
    con.execute("""
        INSERT INTO z.positions
        SELECT position_id, fenkey(normalized_fen), game_id, puzzle_id, ply, puzzle_rating
        FROM main.positions""")
    step("positions (34,6 M) hashées")
    con.execute("CREATE INDEX z.idx_positions_normfen_puzzle ON positions(normalized_fen, puzzle_id)")
    step("index normfen_puzzle")
    con.execute("CREATE INDEX z.idx_positions_normfen_rating ON positions(normalized_fen, puzzle_rating, puzzle_id)")
    step("index normfen_rating")
    con.execute("CREATE INDEX z.idx_positions_game_ply ON positions(game_id, ply)")
    step("index game_ply")

    # Caches — clés hashées, structures identiques (dont WITHOUT ROWID :
    # le scan arrière du tri popularité en dépend).
    con.execute("""
        CREATE TABLE z.position_counts (
            normalized_fen INTEGER PRIMARY KEY,
            through_count  INTEGER NOT NULL
        )""")
    con.execute("""
        INSERT INTO z.position_counts
        SELECT fenkey(normalized_fen), through_count FROM main.position_counts""")
    con.execute("""
        CREATE TABLE z.position_children (
            parent_fen  INTEGER NOT NULL,
            child_fen   INTEGER NOT NULL,
            game_count  INTEGER NOT NULL,
            PRIMARY KEY (parent_fen, child_fen)
        )""")
    con.execute("""
        INSERT INTO z.position_children
        SELECT fenkey(parent_fen), fenkey(child_fen), game_count FROM main.position_children""")
    con.execute("""
        CREATE TABLE z.position_popularity (
            normalized_fen INTEGER NOT NULL,
            popularity     INTEGER NOT NULL,
            puzzle_id      TEXT    NOT NULL,
            puzzle_rating  INTEGER NOT NULL,
            PRIMARY KEY (normalized_fen, popularity, puzzle_id)
        ) WITHOUT ROWID""")
    con.execute("""
        INSERT INTO z.position_popularity
        SELECT fenkey(normalized_fen), popularity, puzzle_id, puzzle_rating
        FROM main.position_popularity""")
    step("caches (counts/children/popularity) hashés")

    # Garde-fou collisions : le hash remplace une égalité TEXT — le nombre de
    # clés distinctes doit être STRICTEMENT conservé, sinon deux positions ont
    # fusionné (les compteurs mentiraient en silence).
    for table in ("positions", "puzzles"):
        a = con.execute(f"SELECT COUNT(DISTINCT normalized_fen) FROM main.{table}").fetchone()[0]
        b = con.execute(f"SELECT COUNT(DISTINCT normalized_fen) FROM z.{table}").fetchone()[0]
        if a != b:
            raise SystemExit(f"reduce : COLLISION de hash dans {table} ({a} clés → {b}) — base réduite invalide")
        step(f"0 collision sur {table} ({a:,} clés distinctes)")

    con.execute("ANALYZE z")
    con.commit()
    con.execute("DETACH DATABASE z")
    con.close()

    src_go = src_path.stat().st_size / 1e9
    out_go = out_path.stat().st_size / 1e9
    logger.info("reduce : %s (%.2f Go) → %s (%.2f Go, −%.0f %%) en %.0f s",
                src_path.name, src_go, out_path.name, out_go,
                100 * (1 - out_go / src_go), time.time() - t0)
    print(f"OK : {out_path} — {out_go:.2f} Go (source {src_go:.2f} Go, intacte)")
