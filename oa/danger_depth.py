"""Danger depth (A3) — how deep each line stays safe before its first costly mistake.

For every root-to-leaf line in a chapter, find the first ply where a catalogued error
appears. A line that only gets sharp at move 12 is calmer to play than one that derails at
move 6. Pure view over `paths` + `errors` (no recalc), so it just re-reads the base.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

import chess

from . import db
from .fen import fen4


@dataclass
class LineDanger:
    line: str
    danger_ply: int | None      # ply of the first error on this line (None = stays clean)
    first_mistake_san: str | None
    peak_criticality: float

    @property
    def danger_move(self) -> str:
        if self.danger_ply is None:
            return "—"
        return f"{self.danger_ply // 2 + 1}{'.' if self.danger_ply % 2 == 0 else '...'}"


def _leaf_sequences(conn: sqlite3.Connection, chapter_id: int) -> list[str]:
    """Move sequences that are not a strict prefix of any longer sequence (the leaf lines)."""
    rows = conn.execute(
        "SELECT move_sequence FROM paths WHERE chapter_id = ? AND move_sequence <> '' "
        "ORDER BY ply DESC",
        (chapter_id,),
    ).fetchall()
    seqs = [r["move_sequence"] for r in rows]
    leaves: list[str] = []
    for s in seqs:
        prefix = s + " "
        if not any(other.startswith(prefix) for other in seqs):
            leaves.append(s)
    return leaves


def _error_positions(
    conn: sqlite3.Connection, chapter_id: int, min_criticality: float
) -> dict[int, tuple[float, str]]:
    """position_id -> (peak criticality, worst mistake SAN) for the chapter's errors,
    keeping only positions whose peak criticality clears ``min_criticality`` (so a trivial
    near-threshold error on a shared early position doesn't mark every line dangerous)."""
    out: dict[int, tuple[float, str]] = {}
    for e in db.errors_for_chapter(conn, chapter_id):
        pid = int(e["position_id"])
        crit = e["criticality"] or 0.0
        if crit < min_criticality:
            continue
        if pid not in out or crit > out[pid][0]:
            out[pid] = (crit, e["mistake_move_san"] or e["mistake_move_uci"])
    return out


def chapter_danger_depths(
    conn: sqlite3.Connection, chapter_id: int, *, min_criticality: float = 0.05
) -> list[LineDanger]:
    """One entry per leaf line, sharpest (shallowest first meaningful error) first."""
    errors = _error_positions(conn, chapter_id, min_criticality)
    out: list[LineDanger] = []
    for seq in _leaf_sequences(conn, chapter_id):
        ucis = seq.split()
        board = chess.Board()
        danger: LineDanger | None = None
        for ply, uci in enumerate(ucis):
            pos = db.get_position_by_fen(conn, fen4(board))
            if pos is not None and int(pos["id"]) in errors:
                crit, san = errors[int(pos["id"])]
                danger = LineDanger(_san_line(ucis), ply, san, crit)
                break
            board.push_uci(uci)
        if danger is None:
            danger = LineDanger(_san_line(ucis), None, None, 0.0)
        out.append(danger)
    # Sharpest first (shallow danger), clean lines (None) last.
    out.sort(key=lambda d: (d.danger_ply is None, d.danger_ply or 0, -d.peak_criticality))
    return out


def _san_line(ucis: list[str]) -> str:
    board = chess.Board()
    moves = [chess.Move.from_uci(u) for u in ucis]
    try:
        return board.variation_san(moves) if moves else "(start)"
    except (ValueError, AssertionError):
        return " ".join(ucis)
