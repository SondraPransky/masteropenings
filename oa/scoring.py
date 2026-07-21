"""Criticality scoring (D6/D23) with the Phase C engine-cost co-factor.

    Criticality = frequency x max(Delta winrate, 0) x log(games) x severity

* frequency      — how often humans at this rating play the mistake (D13 already gated it),
* Delta winrate  — the human winrate lost versus the best move, per bucket (D6: the cost
                   is measured in *human* winrate, not raw centipawns),
* log(games)     — statistical weight, so rare-but-flashy cells don't dominate (D13),
* severity       — Phase C (D6/D12): ``(eval_loss / mistake_cp) ** exponent`` folds the
                   engine's centipawn cost back in, so a 3-pawn blunder outweighs a
                   1-pawn slip that costs the same human winrate. Sub-linear (exponent
                   0.5 by default) and = 1.0 at the 1-pawn threshold, so it *adds*
                   resolution without rescaling the familiar range. exponent 0 disables it.

The winrate of a move is ``(wins + 0.5 * draws) / games`` from the side-to-move
perspective (the percentages stored in `position_stats` are already stm-relative).
"""

from __future__ import annotations

import math
import sqlite3

from . import db
from .config import Config


def winrate_score(win_pct: float, draw_pct: float) -> float:
    """Expected score in [0, 1] from win/draw percentages (stm POV)."""
    return (win_pct + 0.5 * draw_pct) / 100.0


def eval_severity(eval_loss_cp: int | None, mistake_cp: int, exponent: float) -> float:
    """Phase C co-factor: how much the engine cost amplifies Criticality.

    ``(eval_loss / mistake_cp) ** exponent`` — 1.0 at the 1-pawn threshold, sub-linear
    above it. Returns 1.0 (no effect) when disabled or when data is missing.
    """
    if not eval_loss_cp or exponent <= 0 or mistake_cp <= 0:
        return 1.0
    return (eval_loss_cp / mistake_cp) ** exponent


def compute_criticality(
    frequency: float, delta_winrate: float, games: int,
    *, eval_loss_cp: int | None = None, mistake_cp: int = 100,
    severity_exponent: float = 0.0,
) -> float:
    """The D23 Criticality score. ``delta_winrate`` is clamped at 0 (a move that scores
    at least as well as the best move for humans is not *costly*, whatever the engine says).

    Passing ``eval_loss_cp`` with a positive ``severity_exponent`` applies the Phase C
    engine-cost co-factor; the default (no eval, exponent 0) is the winrate-only score.
    """
    if games <= 1:
        return 0.0
    base = frequency * max(delta_winrate, 0.0) * math.log(games)
    return base * eval_severity(eval_loss_cp, mistake_cp, severity_exponent)


def _bucket_winrates(rows: list[sqlite3.Row]) -> dict[str, float]:
    """Map move_uci -> winrate for one (position, bucket)."""
    return {
        r["move_uci"]: winrate_score(r["win_pct"], r["draw_pct"]) for r in rows
    }


def _best_reference_winrate(
    winrates: dict[str, float],
    rows: list[sqlite3.Row],
    best_move_uci: str | None,
    min_games: int,
) -> float:
    """Winrate of the reference (best) move.

    Prefer the engine's best move if humans actually played it at this bucket; otherwise
    fall back to the strongest sufficiently-played human move.
    """
    if best_move_uci and best_move_uci in winrates:
        return winrates[best_move_uci]
    candidates = [
        winrates[r["move_uci"]]
        for r in rows
        if int(r["games"]) >= min_games and r["move_uci"] in winrates
    ]
    return max(candidates) if candidates else 0.0


def delta_winrate_for(
    rows: list[sqlite3.Row], best_move_uci: str | None, mistake_move_uci: str, min_games: int
) -> float:
    """Human winrate (stm POV) the mistake loses versus the reference move, at one bucket.

    Single source of truth shared by scoring (fills every error) and detection (the winrate
    rescue, D6): both must measure the human cost identically.
    """
    winrates = _bucket_winrates(rows)
    ref = _best_reference_winrate(winrates, rows, best_move_uci, min_games)
    return ref - winrates.get(mistake_move_uci, 0.0)


def score_chapter(conn: sqlite3.Connection, config: Config, chapter_id: int) -> int:
    """Fill delta_winrate and criticality for every error in a chapter. Returns count."""
    errors = db.errors_for_chapter(conn, chapter_id)
    min_games = config.thresholds.min_games
    updated = 0

    for err in errors:
        rows = db.get_stats(conn, err["position_id"], err["elo_bucket"])
        delta = delta_winrate_for(
            rows, err["best_move_uci"], err["mistake_move_uci"], min_games
        )
        criticality = compute_criticality(
            err["mistake_frequency"], delta, int(err["mistake_games"]),
            eval_loss_cp=err["eval_loss_cp"], mistake_cp=config.thresholds.mistake_cp,
            severity_exponent=config.thresholds.criticality_severity_exponent,
        )
        conn.execute(
            "UPDATE errors SET delta_winrate = ?, criticality = ? WHERE id = ?",
            (round(delta, 4), round(criticality, 6), err["id"]),
        )
        updated += 1

    conn.commit()
    return updated
