"""Expected-value criticality (A2) — "what you'll actually face".

A brilliant trap that nobody reaches is worth less to study than a modest mistake that
occurs every game. This weights each decision point by its **reach probability** at a given
Elo — the product of how often each move along the line to it is actually played at that
bucket — times its Criticality. Pure view over `position_stats` + `errors` (no recalc), and
rating-aware (D11): the same line ranks differently at 1200 and at 2000.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

import chess

from . import db
from .export_pgn import collect_decisions
from .fen import fen4


@dataclass
class ExpectedValue:
    position_id: int
    line: str
    mistake_san: str
    reach_probability: float     # P(reaching this decision) at the bucket
    peak_criticality: float
    expected_value: float        # reach_probability * peak_criticality


def _san_line(path_ucis: list[str]) -> str:
    board = chess.Board()
    moves = [chess.Move.from_uci(u) for u in path_ucis]
    try:
        return board.variation_san(moves) if moves else "(start)"
    except (ValueError, AssertionError):
        return " ".join(path_ucis)


def path_reach_probability(
    conn: sqlite3.Connection, path_ucis: list[str], bucket: int
) -> float:
    """Product of the played frequency of each move along the line, at ``bucket``.

    A move whose position has no stats at this bucket contributes a factor of 1 (unknown,
    not penalised), so partially-covered lines still get a sensible relative score.
    """
    board = chess.Board()
    prob = 1.0
    for uci in path_ucis:
        pos = db.get_position_by_fen(conn, fen4(board))
        if pos is not None:
            rows = db.get_stats(conn, int(pos["id"]), bucket)
            total = sum(int(r["games"]) for r in rows)
            if total > 0:
                played = next((int(r["games"]) for r in rows if r["move_uci"] == uci), 0)
                prob *= played / total
        board.push_uci(uci)
    return prob


def chapter_expected_values(
    conn: sqlite3.Connection, chapter_id: int, bucket: int, *, min_criticality: float = 0.05
) -> list[ExpectedValue]:
    """Decision points ranked by expected value = reach probability × Criticality."""
    out: list[ExpectedValue] = []
    for dec in collect_decisions(conn, chapter_id):
        if dec.peak < min_criticality:
            continue
        reach = path_reach_probability(conn, dec.path_ucis, bucket)
        worst = max(dec.mistakes.values(), key=lambda m: m.peak)
        out.append(ExpectedValue(
            position_id=dec.position_id,
            line=_san_line(dec.path_ucis),
            mistake_san=worst.san,
            reach_probability=reach,
            peak_criticality=dec.peak,
            expected_value=reach * dec.peak,
        ))
    out.sort(key=lambda e: e.expected_value, reverse=True)
    return out
