"""Error detection (D4/D12/D13).

An error is a **costly human divergence**: a move that is frequent enough to matter, is
not the best move, and loses at least ~1 pawn versus the best move at that rating. Only
cells with enough games (D13) are exploited.

The measure of "loss" is centipawns from the **side-to-move** perspective:

    loss = sign * (eval_after_human_move - eval_of_position)

where both evals are White-POV and ``sign = -1`` when White is to move, ``+1`` for Black.
A good move keeps the loss near zero; a blunder produces a large positive loss.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

import chess

from . import db, scoring
from .config import Config
from .evals.base import MATE_CP, Eval
from .evals.resolver import EvalResolver
from .fen import _ensure_full_fen, fen4, side_to_move


@dataclass
class DetectStats:
    positions_examined: int = 0
    cells_examined: int = 0
    candidate_moves: int = 0
    errors_found: int = 0
    skipped_no_parent_eval: int = 0
    skipped_no_child_eval: int = 0


def white_cp_of(ev: Eval | None) -> int | None:
    """A single comparable White-POV centipawn number, or None if unusable."""
    if ev is None:
        return None
    if ev.cp is not None:
        return ev.cp
    if ev.mate is not None and ev.mate != 0:
        return MATE_CP if ev.mate > 0 else -MATE_CP
    return None


def eval_loss_cp(parent_white_cp: int, child_white_cp: int, stm: str) -> int:
    """Centipawns lost by the side to move, given parent/child White-POV evals."""
    sign = -1 if stm == "w" else 1
    return sign * (child_white_cp - parent_white_cp)


def error_threshold_for(thresholds, bucket: int) -> int:
    """The cp loss at which a move counts as an error at this Elo bucket (rating-aware).

    Reads ``thresholds.error_threshold_cp``; for a bucket not in the table, uses the nearest
    lower band. Falls back to the flat ``mistake_cp`` if no table is set."""
    table = getattr(thresholds, "error_threshold_cp", None)
    if not table:
        return thresholds.mistake_cp
    if bucket in table:
        return table[bucket]
    lowers = [b for b in table if b <= bucket]
    return table[max(lowers)] if lowers else min(table.values())


def detect_position(
    conn: sqlite3.Connection,
    resolver: EvalResolver,
    config: Config,
    position_row: sqlite3.Row,
    *,
    chapter_id: int | None = None,
    path_id: int | None = None,
    stats: DetectStats | None = None,
) -> int:
    """Detect errors for one position across all Elo buckets. Returns errors found."""
    stats = stats or DetectStats()
    thresholds = config.thresholds
    fen4_str = position_row["fen4"]
    stm = side_to_move(fen4_str)
    best_uci = position_row["best_move_uci"]

    parent_white = white_cp_of(
        Eval(fen4=fen4_str, cp=position_row["eval_cp"], mate=position_row["eval_mate"])
    )
    if parent_white is None:
        stats.skipped_no_parent_eval += 1
        return 0

    stats.positions_examined += 1
    board = chess.Board(_ensure_full_fen(fen4_str))
    found = 0

    for bucket in config.explorer.ratings:
        rows = db.get_stats(conn, position_row["id"], bucket)
        if not rows:
            continue
        total_games = sum(int(r["games"]) for r in rows)
        if total_games == 0:
            continue
        stats.cells_examined += 1

        bar = error_threshold_for(thresholds, bucket)

        for r in rows:
            move_uci = r["move_uci"]
            games = int(r["games"])
            if games < thresholds.min_games:
                continue          # D13: not statistically valid
            if move_uci == best_uci:
                continue          # the recommended move is never an error
            stats.candidate_moves += 1

            child_eval = _child_eval(resolver, board, move_uci)
            child_white = white_cp_of(child_eval)
            if child_white is None:
                stats.skipped_no_child_eval += 1
                continue

            loss = eval_loss_cp(parent_white, child_white, stm)
            # D12 (rating-aware cp bar) OR the winrate rescue (D6): a frequent human trap that
            # costs real winrate is an error even below the cp bar. The rescue keeps the
            # highest-value low-cp errors that a purely engine-cost bar would discard.
            if loss < bar and not _winrate_rescued(
                thresholds, rows, best_uci, move_uci, games, total_games, loss
            ):
                continue

            error_type = "puzzle" if loss >= thresholds.blunder_cp else "flashcard"
            db.upsert_error(
                conn,
                {
                    "position_id": position_row["id"],
                    "chapter_id": chapter_id,
                    "path_id": path_id,
                    "elo_bucket": bucket,
                    "best_move_uci": best_uci,
                    "best_move_san": position_row["best_move_san"],
                    "mistake_move_uci": move_uci,
                    "mistake_move_san": r["move_san"],
                    "mistake_games": games,
                    "mistake_frequency": round(games / total_games, 4),
                    "eval_loss_cp": int(loss),
                    "delta_winrate": None,      # filled by scoring
                    "criticality": None,        # filled by scoring
                    "error_type": error_type,
                },
            )
            found += 1
            stats.errors_found += 1

    conn.commit()
    return found


def _winrate_rescued(thresholds, rows, best_uci, move_uci, games, total_games, loss) -> bool:
    """True if a below-cp-bar move still qualifies as an error on human winrate cost (D6).

    A move is rescued when it is played often enough (`winrate_rescue_min_freq`), costs enough
    human winrate versus the reference move (`winrate_rescue_delta`), and is still at least
    marginally worse for the engine (`winrate_rescue_min_loss_cp`, so we don't rescue noise).
    """
    if not getattr(thresholds, "winrate_rescue", False):
        return False
    if loss < thresholds.winrate_rescue_min_loss_cp:
        return False
    if games / total_games < thresholds.winrate_rescue_min_freq:
        return False
    delta = scoring.delta_winrate_for(rows, best_uci, move_uci, thresholds.min_games)
    return delta >= thresholds.winrate_rescue_delta


def _child_eval(resolver: EvalResolver, board: chess.Board, move_uci: str) -> Eval | None:
    """Eval of the position after playing ``move_uci`` from ``board``."""
    try:
        move = chess.Move.from_uci(move_uci)
    except ValueError:
        return None
    if move not in board.legal_moves:
        return None
    child = board.copy(stack=False)
    child.push(move)
    return resolver.get(fen4(child))
