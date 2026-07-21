"""Criticality heatmap (M10) — a pure view over `errors`: peak Criticality by move depth
(ply of the decision position) and Elo bucket. Shows where costly mistakes cluster along a
chapter's lines and how that shifts with rating (D6/D11). No recalculation.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from . import db
from .config import ELO_BUCKETS


@dataclass
class Heatmap:
    plies: list[int]                       # sorted decision depths present
    buckets: list[int]                     # ELO_BUCKETS
    grid: dict[tuple[int, int], float]     # (ply, bucket) -> peak criticality
    max_crit: float

    def move_label(self, ply: int) -> str:
        """A human move label from a ply count: '8.' (White to move) or '8...' (Black)."""
        return f"{ply // 2 + 1}{'.' if ply % 2 == 0 else '...'}"


def _position_ply(conn: sqlite3.Connection, chapter_id: int, position_id: int) -> int | None:
    row = conn.execute(
        "SELECT MIN(ply) AS ply FROM paths WHERE chapter_id = ? AND position_id = ?",
        (chapter_id, position_id),
    ).fetchone()
    return int(row["ply"]) if row and row["ply"] is not None else None


def chapter_heatmap(conn: sqlite3.Connection, chapter_id: int) -> Heatmap:
    grid: dict[tuple[int, int], float] = {}
    plies: set[int] = set()
    max_crit = 0.0
    for e in db.errors_for_chapter(conn, chapter_id):
        ply = _position_ply(conn, chapter_id, int(e["position_id"]))
        if ply is None:
            continue
        crit = e["criticality"] or 0.0
        key = (ply, int(e["elo_bucket"]))
        if crit > grid.get(key, 0.0):
            grid[key] = crit
        plies.add(ply)
        max_crit = max(max_crit, crit)
    return Heatmap(sorted(plies), list(ELO_BUCKETS), grid, max_crit)
