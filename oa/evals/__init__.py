"""Eval sources (D2/D5): the "best move + eval" layer.

`EvalSource` is the interface; the MVP ships a cloud backend (Lichess cloud-eval) and an
optional local Stockfish backend, chained by `EvalResolver`. The Lichess evals *dump*
(D2 primary) can be added later as another `EvalSource` with no change to callers.
"""

from .base import Eval, EvalSource
from .cloud import LichessCloudEvalSource
from .resolver import EvalResolver
from .stockfish import StockfishEvalSource

__all__ = [
    "Eval",
    "EvalSource",
    "LichessCloudEvalSource",
    "StockfishEvalSource",
    "EvalResolver",
]
