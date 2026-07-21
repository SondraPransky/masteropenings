"""Repertoire gaps (M17) — where your prepared lines say nothing.

The error detector answers "where do humans blunder?". This answers the complementary,
repertoire-first question: **"which frequent opponent replies does my repertoire not
cover?"**. For every position in a chapter where it is the *opponent's* turn, we read the
Explorer stats already in the base and flag each frequent opponent move whose resulting
position is reached by no path in the chapter.

Coverage is judged by the child's FEN-4 (D7/D8), not by string-matching the move order, so
a reply you meet through a different move order (a transposition) counts as covered — you
already know what to do, you just reach it another way.

Pure view over `paths` + `positions` + `position_stats`. No network, no recalculation:
it re-reads the base the prefetch already filled (D1/D11), so it is rating-aware by bucket.
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from dataclasses import dataclass

import chess

from . import db
from .config import Thresholds
from .fen import fen4
from .ingest import iter_chapter_positions


@dataclass
class Gap:
    position_id: int
    fen4: str
    line_uci: str              # a representative move sequence reaching the gap position
    line_san: str              # the same line in figurine-free SAN (for display)
    ply: int                   # depth of the gap position (opponent to move)
    opp_move_uci: str          # the uncovered frequent opponent reply
    opp_move_san: str
    games: int                 # games with this reply at the bucket (the sample behind it)
    total_games: int           # total games at the position/bucket (the denominator)
    frequency: float           # games / total_games — the ranking signal
    elo_bucket: int

    @property
    def move_no(self) -> str:
        """Display move number for the gap (whose reply is the opponent's)."""
        return f"{self.ply // 2 + 1}{'.' if self.ply % 2 == 0 else '...'}"


# ---------------------------------------------------------------------------
# Repertoire colour. A chapter is a repertoire for one side; a gap is only a
# question at the *opponent's* moves (your own moves are your choice, not a hole).
# We infer the player's colour from commitment: across the tree, the side that
# tends to have a single prepared continuation per node is the player; the side
# that fans out into several covered replies is the opponent.
# ---------------------------------------------------------------------------
def infer_repertoire_color(conn: sqlite3.Connection, chapter_id: int) -> str:
    """Best-guess player colour ('w'|'b') for a chapter, from branching commitment.

    The player commits to lines (low branching at their nodes); they cover several of the
    opponent's tries (higher branching at opponent nodes). Ties fall back to the root: a
    single first move ⇒ White repertoire, several ⇒ Black (covering White's first moves).
    """
    side_of: dict[str, str] = {}
    for row in conn.execute(
        "SELECT pa.move_sequence AS seq, p.side_to_move AS stm "
        "FROM paths pa JOIN positions p ON p.id = pa.position_id WHERE pa.chapter_id = ?",
        (chapter_id,),
    ):
        side_of[row["seq"]] = row["stm"]

    children: dict[str, set[str]] = defaultdict(set)
    for seq in side_of:
        if not seq:
            continue
        parent = " ".join(seq.split()[:-1])
        children[parent].add(seq)

    tally: dict[str, list[int]] = {"w": [], "b": []}
    for parent, kids in children.items():
        parent_side = side_of.get(parent)          # side that plays the children moves
        if parent_side in tally:
            tally[parent_side].append(len(kids))

    mean_w = sum(tally["w"]) / len(tally["w"]) if tally["w"] else None
    mean_b = sum(tally["b"]) / len(tally["b"]) if tally["b"] else None
    if mean_w is not None and mean_b is not None and mean_w != mean_b:
        return "w" if mean_w < mean_b else "b"

    # Fallback: how many first moves does the repertoire prescribe at the root?
    root_children = len(children.get("", set()))
    return "w" if root_children <= 1 else "b"


def repertoire_gaps(
    conn: sqlite3.Connection,
    chapter_id: int,
    *,
    bucket: int,
    color: str | None = None,
    min_games: int = Thresholds().min_games,
    min_frequency: float = 0.0,
    limit: int | None = None,
) -> list[Gap]:
    """Frequent opponent replies your repertoire leaves unanswered, most-glaring first.

    ``bucket`` selects the Elo tranche (D11); ``min_games`` is the statistical-validity
    floor (D13) — a reply seen in fewer games at this bucket is noise, not a gap.
    ``color`` is the player's colour (auto-inferred when omitted).
    """
    if color is None:
        color = infer_repertoire_color(conn, chapter_id)
    opponent = "b" if color == "w" else "w"

    positions = iter_chapter_positions(conn, chapter_id)
    chapter_fens = {row["fen4"] for row in positions}

    gaps: list[Gap] = []
    for pos in positions:
        if pos["side_to_move"] != opponent:
            continue                                   # your move — not a coverage question
        stats = db.get_stats(conn, int(pos["id"]), bucket)
        total = sum(int(s["games"]) for s in stats)
        if total == 0:
            continue                                   # no stats at this bucket — can't judge
        board = _replay(pos["sample_sequence"])
        if board is None:
            continue
        for s in stats:
            games = int(s["games"])
            if games < min_games:
                continue
            frequency = games / total
            if frequency < min_frequency:
                continue
            child_fen = _child_fen(board, s["move_uci"])
            if child_fen is None or child_fen in chapter_fens:
                continue                               # illegal to parse, or already covered
            gaps.append(Gap(
                position_id=int(pos["id"]), fen4=pos["fen4"],
                line_uci=pos["sample_sequence"] or "",
                line_san=_san_line(pos["sample_sequence"]),
                ply=int(pos["min_ply"]),
                opp_move_uci=s["move_uci"],
                opp_move_san=s["move_san"] or _san_of(board, s["move_uci"]),
                games=games, total_games=total, frequency=frequency,
                elo_bucket=bucket,
            ))

    # Rank by how often you actually face the reply (frequency), sample size only breaks ties.
    gaps.sort(key=lambda gp: (gp.frequency, gp.games), reverse=True)
    return gaps[:limit] if limit is not None else gaps


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _replay(move_sequence: str | None) -> chess.Board | None:
    board = chess.Board()
    for uci in (move_sequence or "").split():
        try:
            board.push_uci(uci)
        except ValueError:
            return None
    return board


def _child_fen(board: chess.Board, uci: str) -> str | None:
    """FEN-4 of the position after ``uci``, or None if the move can't be parsed here."""
    try:
        child = board.copy(stack=False)
        child.push_uci(uci)
    except ValueError:
        return None
    return fen4(child)


def _san_of(board: chess.Board, uci: str) -> str:
    try:
        return board.san(chess.Move.from_uci(uci))
    except (ValueError, AssertionError):
        return uci


def _san_line(move_sequence: str | None) -> str:
    ucis = (move_sequence or "").split()
    if not ucis:
        return "(départ)"
    board = chess.Board()
    try:
        return board.variation_san([chess.Move.from_uci(u) for u in ucis])
    except (ValueError, AssertionError):
        return move_sequence or ""
