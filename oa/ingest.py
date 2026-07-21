"""PGN ingestion — chapters, positions, paths (D3/D8/D17).

Reads a PGN chapter file (one file = one chapter = one opening module, D17), walks the
full move tree (mainline + variations), and materialises:

  * `positions` deduplicated by FEN-4 (D7),
  * `paths` — the concrete move sequences that reach each position (D8).

A transposition (same FEN-4 reached by different move sequences) yields several paths
pointing at a single position — the position is analysed only once.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.pgn

from . import db
from .fen import fen4, side_to_move


@dataclass
class IngestResult:
    chapter_id: int
    chapter_name: str
    games: int
    positions_seen: int          # nodes walked (including root repeats)
    unique_positions: int        # distinct FEN-4 in this chapter
    paths: int


def ingest_chapter(
    conn: sqlite3.Connection,
    pgn_path: "str | Path",
    name: str | None = None,
    account_id: int | None = None,
) -> IngestResult:
    """Ingest one PGN file into the DB. Chapter name defaults to the filename stem.
    The chapter is owned by ``account_id`` (defaults to the implicit local account)."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    pgn_path = Path(pgn_path)
    chapter_name = name or pgn_path.stem
    chapter_id = db.upsert_chapter(conn, chapter_name, str(pgn_path), account_id)

    games = 0
    nodes = 0
    paths = 0
    unique: set[str] = set()

    with _open_pgn(pgn_path) as handle:
        while True:
            game = chess.pgn.read_game(handle)
            if game is None:
                break
            games += 1
            g_nodes, g_paths, g_unique = _ingest_game(conn, chapter_id, game)
            nodes += g_nodes
            paths += g_paths
            unique |= g_unique

    conn.commit()
    return IngestResult(
        chapter_id=chapter_id,
        chapter_name=chapter_name,
        games=games,
        positions_seen=nodes,
        unique_positions=len(unique),
        paths=paths,
    )


def _open_pgn(pgn_path: Path):
    """Open a PGN tolerant of encoding: UTF-8 (with/without BOM), else Latin-1.

    PGNs come from many tools; ChessBase exports are often Latin-1, modern ones UTF-8.
    We decode strictly first so we don't silently mangle text, then fall back.
    """
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            handle = pgn_path.open("r", encoding=encoding)
            handle.read()          # force a decode pass to validate the encoding
            handle.seek(0)
            return handle
        except UnicodeDecodeError:
            handle.close()
    # Last resort: never crash on a stray byte.
    return pgn_path.open("r", encoding="utf-8", errors="replace")


def _ingest_game(
    conn: sqlite3.Connection, chapter_id: int, game: chess.pgn.Game
) -> tuple[int, int, set[str]]:
    """Walk one game's full move tree, recording positions and paths.

    Returns (nodes_walked, paths_created, {unique fen4}).
    """
    nodes = 0
    paths = 0
    unique: set[str] = set()

    # Stack of (node, board_after_node, ucis_from_root, parent_path_id).
    root_board = game.board()
    root_f4 = fen4(root_board)
    root_pos = db.upsert_position(conn, root_f4, side_to_move(root_f4))
    unique.add(root_f4)
    root_path = db.upsert_path(conn, chapter_id, root_pos, 0, "", None)
    nodes += 1
    paths += 1

    stack: list[tuple[chess.pgn.GameNode, chess.Board, list[str], int]] = [
        (game, root_board, [], root_path)
    ]

    while stack:
        node, board, ucis, parent_path = stack.pop()
        for child in node.variations:
            move = child.move
            child_board = board.copy(stack=False)
            child_board.push(move)
            child_ucis = ucis + [move.uci()]
            f4 = fen4(child_board)
            unique.add(f4)

            pos_id = db.upsert_position(conn, f4, side_to_move(f4))
            path_id = db.upsert_path(
                conn,
                chapter_id,
                pos_id,
                len(child_ucis),
                " ".join(child_ucis),
                parent_path,
            )
            nodes += 1
            paths += 1
            stack.append((child, child_board, child_ucis, path_id))

    return nodes, paths, unique


def iter_chapter_positions(
    conn: sqlite3.Connection, chapter_id: int
) -> list[sqlite3.Row]:
    """Distinct positions reached in a chapter, with a representative path (SAN-free).

    Ordered by shallowest ply first so the analysis walks the tree top-down.
    """
    return conn.execute(
        """
        SELECT p.*, MIN(pa.ply) AS min_ply,
               (SELECT move_sequence FROM paths
                  WHERE position_id = p.id AND chapter_id = ?
                  ORDER BY ply ASC LIMIT 1) AS sample_sequence
          FROM positions p
          JOIN paths pa ON pa.position_id = p.id
         WHERE pa.chapter_id = ?
      GROUP BY p.id
      ORDER BY min_ply ASC, p.id ASC
        """,
        (chapter_id, chapter_id),
    ).fetchall()
