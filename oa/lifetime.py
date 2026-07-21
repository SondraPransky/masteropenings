"""Error lifetime (M22) — the Elo span over which a mistake stays a costly, frequent error.

A pure view over the `errors` table (no recalculation): for each mistake (position ×
mistake move) we collect the Elo buckets where it was flagged, so we can report its
*ceiling* — the highest bucket where humans still fall for it. A trap that survives to
2000+ is fundamental; one that dies out by 1200 is a beginner-only slip. This is exactly
the rating-aware insight Chessable can't give on real data (D11).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

import chess

from . import db
from .export_pgn import _shortest_path


@dataclass
class ErrorLifetime:
    position_id: int
    mistake_uci: str
    mistake_san: str
    best_san: str | None
    error_type: str
    line: str
    buckets: list[int] = field(default_factory=list)   # sorted buckets where flagged
    peak: float = 0.0                                    # max criticality across buckets
    peak_freq: float = 0.0                               # max frequency across buckets

    @property
    def first_bucket(self) -> int:
        return self.buckets[0]

    @property
    def last_bucket(self) -> int:
        return self.buckets[-1]

    @property
    def span(self) -> str:
        lo, hi = self.first_bucket, self.last_bucket
        return f"{lo}+" if lo == hi else f"{lo}–{hi}"


def _san_line(path_ucis: list[str]) -> str:
    if not path_ucis:
        return "(start)"
    board = chess.Board()
    moves = [chess.Move.from_uci(u) for u in path_ucis]
    try:
        return board.variation_san(moves)
    except (ValueError, AssertionError):
        return " ".join(path_ucis)


def chapter_error_lifetimes(
    conn: sqlite3.Connection, chapter_id: int, *, min_criticality: float = 0.0
) -> list[ErrorLifetime]:
    """One entry per distinct mistake, sorted by how high up the Elo ladder it survives.

    Ties (same ceiling) are broken by peak criticality. ``min_criticality`` filters on the
    mistake's peak so noise at a single low bucket doesn't dominate.
    """
    groups: dict[tuple[int, str], ErrorLifetime] = {}
    for e in db.errors_for_chapter(conn, chapter_id):
        key = (int(e["position_id"]), e["mistake_move_uci"])
        life = groups.get(key)
        if life is None:
            life = ErrorLifetime(
                position_id=int(e["position_id"]),
                mistake_uci=e["mistake_move_uci"],
                mistake_san=e["mistake_move_san"] or e["mistake_move_uci"],
                best_san=e["best_move_san"] or e["best_move_uci"],
                error_type=e["error_type"],
                line=_san_line(_shortest_path(conn, chapter_id, int(e["position_id"]))),
            )
            groups[key] = life
        life.buckets.append(int(e["elo_bucket"]))
        life.peak = max(life.peak, e["criticality"] or 0.0)
        life.peak_freq = max(life.peak_freq, e["mistake_frequency"] or 0.0)

    out = []
    for life in groups.values():
        life.buckets = sorted(set(life.buckets))
        if life.peak >= min_criticality:
            out.append(life)
    out.sort(key=lambda l: (l.last_bucket, l.peak), reverse=True)
    return out
