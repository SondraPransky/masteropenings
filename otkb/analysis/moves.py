"""Extraction des signaux tactiques d'une solution de puzzle (offline).

Convention Lichess : dans `Moves`, l'index 0 = coup de l'adversaire, les indices
IMPAIRS = coups du solutionneur. Les signaux ne concernent que le solutionneur.

- cases critiques  : cases d'arrivée des coups du solutionneur.
- sacrifice        : le solutionneur pose une pièce sur une case où l'adversaire
  la capture au coup suivant, en donnant plus de matériel qu'il n'en prend
  (heuristique nette et vérifiable ; la validité « tactique » est garantie par le
  fait que le puzzle est gagnant).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import chess

_VALUE = {
    chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
    chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0,
}


@dataclass(frozen=True, slots=True)
class Sacrifice:
    piece: str   # symbole majuscule : P N B R Q
    square: str  # case algébrique : e6

    def token(self) -> str:
        return f"{self.piece}@{self.square}"


@dataclass(slots=True)
class SolutionAnalysis:
    critical_squares: list[str] = field(default_factory=list)
    sacrifices: list[Sacrifice] = field(default_factory=list)


def _captured_value(board: chess.Board, move: chess.Move) -> int:
    if board.is_en_passant(move):
        return _VALUE[chess.PAWN]
    victim = board.piece_at(move.to_square)
    return _VALUE[victim.piece_type] if victim else 0


def analyze_solution(fen: str, moves_uci: list[str]) -> SolutionAnalysis:
    """Analyse la solution depuis la position `fen`. Robuste aux données douteuses."""
    result = SolutionAnalysis()
    board = chess.Board(fen)
    n = len(moves_uci)

    for i, uci in enumerate(moves_uci):
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            break
        if move not in board.legal_moves:
            break

        is_solver = i % 2 == 1
        gain = _captured_value(board, move) if board.is_capture(move) else 0
        moving = board.piece_at(move.from_square)
        board.push(move)

        if is_solver and moving is not None:
            sq = chess.square_name(move.to_square)
            result.critical_squares.append(sq)

            # sacrifice : l'adversaire reprend sur la même case au coup suivant
            if i + 1 < n:
                try:
                    reply = chess.Move.from_uci(moves_uci[i + 1])
                except ValueError:
                    continue
                if (
                    reply in board.legal_moves
                    and reply.to_square == move.to_square
                    and board.is_capture(reply)
                    and _VALUE[moving.piece_type] > gain
                ):
                    result.sacrifices.append(
                        Sacrifice(piece=moving.symbol().upper(), square=sq)
                    )
    return result
