"""Local Stockfish backend (D2 fallback).

Optional: only active if a Stockfish binary is available (config path or on PATH). If no
binary is found the source is inert — ``get`` returns ``None`` and never raises — so the
pipeline runs fine with cloud-eval alone. Once you install Stockfish, this fills the
gaps cloud-eval leaves for rare positions.
"""

from __future__ import annotations

import multiprocessing
import os
import shutil
from pathlib import Path

import chess
import chess.engine

from ..config import EvalConfig
from ..fen import _ensure_full_fen
from .base import Eval


def find_stockfish(explicit_path: str | None = None) -> str | None:
    """Locate a Stockfish binary: explicit path, then PATH, then known install spots."""
    if explicit_path and Path(explicit_path).exists():
        return explicit_path
    on_path = shutil.which("stockfish")
    if on_path:
        return on_path
    # Common Windows locations that a fresh-install shell hasn't picked up in PATH yet.
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        Path(local) / "Microsoft" / "WinGet" / "Links" / "stockfish.exe",
        Path(r"C:\Program Files\Stockfish\stockfish.exe"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


class StockfishEvalSource:
    name = "stockfish"

    def __init__(self, config: EvalConfig):
        self._config = config
        self._path = find_stockfish(config.stockfish_path)
        self._engine: chess.engine.SimpleEngine | None = None

    @property
    def available(self) -> bool:
        return self._path is not None

    def _ensure_engine(self) -> chess.engine.SimpleEngine | None:
        if not self.available:
            return None
        if self._engine is None:
            self._engine = chess.engine.SimpleEngine.popen_uci(self._path)
            self._engine.configure(self._engine_options())
        return self._engine

    def _analyse(self, board: chess.Board) -> chess.engine.InfoDict:
        engine = self._ensure_engine()
        if engine is None:
            raise chess.engine.EngineError("no Stockfish binary available")
        return engine.analyse(board, self._limit())

    def _restart(self) -> None:
        """Discard a dead engine so the next call spawns a fresh one."""
        if self._engine is not None:
            try:
                self._engine.quit()
            except chess.engine.EngineError:
                pass
        self._engine = None

    def _limit(self) -> chess.engine.Limit:
        movetime = self._config.stockfish_movetime_ms
        if movetime and movetime > 0:
            return chess.engine.Limit(time=movetime / 1000.0)
        return chess.engine.Limit(depth=self._config.stockfish_depth)

    def _engine_options(self) -> dict:
        threads = self._config.stockfish_threads
        if threads <= 0:
            time_mode = self._config.stockfish_movetime_ms > 0
            # Fixed-depth: 1 thread is deterministic and faster to a given depth.
            # Time-limit: use spare cores so more nodes are searched in the budget.
            threads = max(1, (multiprocessing.cpu_count() or 1) - 1) if time_mode else 1
        return {"Threads": threads, "Hash": self._config.stockfish_hash_mb}

    def get(self, fen4: str) -> Eval | None:
        if not self.available:
            return None
        board = chess.Board(_ensure_full_fen(fen4))
        if board.is_game_over():
            return None
        try:
            info = self._analyse(board)
        except chess.engine.EngineError as exc:
            # Engine died (crash, killed process, broken pipe). Restart and retry once;
            # if it fails again, skip this position rather than freezing the whole run.
            self._restart()
            try:
                info = self._analyse(board)
            except chess.engine.EngineError:
                print(f"      warning: Stockfish failed on a position ({exc}); skipping.")
                return None
        score = info["score"].white()   # White POV, matching our convention
        pv = [m.uci() for m in info.get("pv", [])]
        return Eval(
            fen4=fen4,
            best_move_uci=pv[0] if pv else None,
            cp=score.score(),                 # None when it's a mate score
            mate=score.mate(),
            depth=info.get("depth"),
            source=self.name,
            pv=pv,
        )

    def close(self) -> None:
        if self._engine is not None:
            self._engine.quit()
            self._engine = None
