"""Confusable positions (A6) — near-identical boards that need different moves.

A frequent source of human error: two positions that look almost the same (a piece one
square over, a tempo different) but where the right move flips. This finds pairs of a
chapter's decision points whose boards differ in only a few squares, share the side to move,
yet have different engine best moves. Pure board comparison over the base — no recalc.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from . import db


@dataclass
class ConfusablePair:
    line_a: str
    best_a: str
    line_b: str
    best_b: str
    distance: int          # squares that differ (1 = a single-square shift)


def _piece_map(fen4_str: str) -> list[str]:
    """The 64 squares of a FEN-4's placement field, '.' for empty."""
    placement = fen4_str.split()[0]
    squares: list[str] = []
    for ch in placement:
        if ch == "/":
            continue
        if ch.isdigit():
            squares.extend("." * int(ch))
        else:
            squares.append(ch)
    return squares


def _distance(a: list[str], b: list[str]) -> int:
    return sum(1 for x, y in zip(a, b) if x != y)


def chapter_confusables(
    conn: sqlite3.Connection, chapter_id: int, *, max_diff: int = 2
) -> list[ConfusablePair]:
    """Decision-point pairs with board distance in [1, max_diff], same side to move, but a
    different best move. Most similar (smallest distance) first."""
    from .personal import line_for_position
    rows = conn.execute(
        """
        SELECT DISTINCT p.id, p.fen4, p.best_move_uci, p.best_move_san, p.side_to_move
          FROM positions p
          JOIN errors e ON e.position_id = p.id
         WHERE e.chapter_id = ? AND p.best_move_uci IS NOT NULL
        """,
        (chapter_id,),
    ).fetchall()
    items = [(r, _piece_map(r["fen4"])) for r in rows]

    pairs: list[tuple[int, sqlite3.Row, sqlite3.Row]] = []
    for i in range(len(items)):
        ri, mi = items[i]
        for j in range(i + 1, len(items)):
            rj, mj = items[j]
            if ri["side_to_move"] != rj["side_to_move"]:
                continue
            if ri["best_move_uci"] == rj["best_move_uci"]:
                continue
            d = _distance(mi, mj)
            if 1 <= d <= max_diff:
                pairs.append((d, ri, rj))

    pairs.sort(key=lambda t: t[0])
    return [ConfusablePair(
        line_a=line_for_position(conn, int(a["id"])),
        best_a=a["best_move_san"] or a["best_move_uci"],
        line_b=line_for_position(conn, int(b["id"])),
        best_b=b["best_move_san"] or b["best_move_uci"],
        distance=d,
    ) for d, a, b in pairs]
