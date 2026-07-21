"""FEN-4 canonicalisation (D7).

The identity of a position is its FEN reduced to 4 fields — piece placement, side to
move, castling rights, en-passant square — dropping the halfmove and fullmove counters.
This is the deduplication key for `positions` and it is exactly what the Lichess Opening
Explorer and the evals dump key on, so the same string matches across all sources.
"""

from __future__ import annotations

import chess


def fen4(fen_or_board: "str | chess.Board") -> str:
    """Return the 4-field FEN of a position.

    Accepts either a ``chess.Board`` or a FEN string (with or without move counters).
    """
    if isinstance(fen_or_board, chess.Board):
        board = fen_or_board
    else:
        board = chess.Board(_ensure_full_fen(fen_or_board))
    # board.fen() -> "<pieces> <turn> <castling> <ep> <halfmove> <fullmove>"
    parts = board.fen().split(" ")
    return " ".join(parts[:4])


def side_to_move(fen4_str: str) -> str:
    """Return ``"w"`` or ``"b"`` — the side to move in a FEN-4 string."""
    fields = fen4_str.split(" ")
    if len(fields) < 2:
        raise ValueError(f"not a valid FEN: {fen4_str!r}")
    return fields[1]


def _ensure_full_fen(fen: str) -> str:
    """Pad a possibly-truncated FEN to 6 fields so ``chess.Board`` can parse it."""
    fields = fen.strip().split(" ")
    if len(fields) == 4:
        fields += ["0", "1"]        # halfmove clock, fullmove number
    elif len(fields) == 5:
        fields += ["1"]
    return " ".join(fields)
