"""EvalSource interface and the Eval value object (D2/D5).

Convention: ``cp`` and ``mate`` are always expressed from **White's point of view**
(positive = good for White), matching the Lichess cloud-eval API. Perspective
normalisation to the side-to-move happens once, in detect.py, so every source can share
the same sign convention.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

# Centipawn value assigned to a forced mate when comparing to normal evals.
MATE_CP = 100_000


@dataclass
class Eval:
    fen4: str
    best_move_uci: str | None = None
    cp: int | None = None            # White POV centipawns (None if only mate is known)
    mate: int | None = None          # mate-in-N, White POV sign (+ = White mates)
    depth: int | None = None
    source: str = "unknown"          # 'cloud' | 'stockfish' | 'dump'
    pv: list[str] = field(default_factory=list)   # principal variation, UCI

    def white_cp(self) -> int | None:
        """A single comparable centipawn number from White's POV (mate -> +/-MATE_CP)."""
        if self.mate is not None:
            if self.mate == 0:
                # Side to move is checkmated; caller normalises by side-to-move.
                return 0
            return MATE_CP if self.mate > 0 else -MATE_CP
        return self.cp


@runtime_checkable
class EvalSource(Protocol):
    """A source that can return an evaluation for a FEN-4 position."""

    name: str

    def get(self, fen4: str) -> Eval | None:
        """Return an Eval for the position, or None if this source has no data."""
        ...
