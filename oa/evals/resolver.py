"""EvalResolver — chains eval sources and caches results on `positions` (D2/D8).

Tries the configured sources in order (default: cloud -> stockfish). The first source
that returns an Eval wins. Results are cached on the `positions` row keyed by FEN-4, so
each position is evaluated only once across the whole database (the golden rule).
"""

from __future__ import annotations

import sqlite3

import chess

from .. import db
from ..config import Config
from ..fen import _ensure_full_fen, side_to_move
from ..http import HttpError
from .base import Eval, EvalSource
from .cloud import LichessCloudEvalSource
from .stockfish import StockfishEvalSource


class EvalResolver:
    def __init__(self, conn: sqlite3.Connection, config: Config):
        self._conn = conn
        self._config = config
        self._sources: list[EvalSource] = self._build_sources(config)
        self._warned: set[str] = set()

    @staticmethod
    def _build_sources(config: Config) -> list[EvalSource]:
        registry = {
            "cloud": lambda: LichessCloudEvalSource(
                config.eval, config.user_agent, config.lichess_token
            ),
            "stockfish": lambda: StockfishEvalSource(config.eval),
        }
        sources: list[EvalSource] = []
        for name in config.eval.order:
            factory = registry.get(name)
            if factory is not None:
                sources.append(factory())
        return sources

    def get(self, fen4: str, *, use_cache: bool = True) -> Eval | None:
        """Return an Eval for the position, using the DB cache then live sources."""
        if use_cache:
            cached = self._from_cache(fen4)
            if cached is not None:
                return cached

        for source in self._sources:
            try:
                result = source.get(fen4)
            except (HttpError, OSError) as exc:
                self._warn_once(source.name, exc)
                continue
            if result is not None:
                self._store(fen4, result)
                return result
        return None

    def close(self) -> None:
        """Release any long-lived source (e.g. the Stockfish engine subprocess)."""
        for source in self._sources:
            closer = getattr(source, "close", None)
            if callable(closer):
                closer()

    def _warn_once(self, source_name: str, exc: Exception) -> None:
        """Emit at most one warning per source so a network outage stays quiet."""
        if source_name not in self._warned:
            self._warned.add(source_name)
            print(f"      warning: eval source '{source_name}' unavailable ({exc}); "
                  "continuing.")

    def _from_cache(self, fen4: str) -> Eval | None:
        row = db.get_position_by_fen(self._conn, fen4)
        if row is None or row["eval_source"] is None:
            return None
        if row["eval_cp"] is None and row["eval_mate"] is None:
            return None
        pv_col = row["best_pv"] if "best_pv" in row.keys() else None
        pv = pv_col.split() if pv_col else ([row["best_move_uci"]] if row["best_move_uci"] else [])
        return Eval(
            fen4=fen4,
            best_move_uci=row["best_move_uci"],
            cp=row["eval_cp"],
            mate=row["eval_mate"],
            depth=row["eval_depth"],
            source=row["eval_source"],
            pv=pv,
        )

    def _store(self, fen4: str, ev: Eval) -> None:
        pos_id = db.upsert_position(self._conn, fen4, side_to_move(fen4))
        best_san = _uci_to_san(fen4, ev.best_move_uci)
        db.set_position_eval(
            self._conn,
            pos_id,
            best_move_uci=ev.best_move_uci,
            best_move_san=best_san,
            eval_cp=ev.cp,
            eval_mate=ev.mate,
            eval_depth=ev.depth,
            eval_source=ev.source,
            # Keep the principal variation (capped) so the trainer can chain a refutation
            # from a single eval instead of re-fetching each ply.
            best_pv=" ".join(ev.pv[:12]) if ev.pv else None,
        )
        self._conn.commit()


def _uci_to_san(fen4: str, uci: str | None) -> str | None:
    if not uci:
        return None
    try:
        board = chess.Board(_ensure_full_fen(fen4))
        return board.san(chess.Move.from_uci(uci))
    except (ValueError, AssertionError):
        return None
