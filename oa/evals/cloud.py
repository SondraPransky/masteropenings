"""Lichess cloud-eval backend (D2 via live API).

Queries ``https://lichess.org/api/cloud-eval`` — Lichess's stored Stockfish evaluations
for known positions. Opening positions have near-complete coverage, which is exactly
what we need. cp/mate are returned from White's point of view.

Response shape (relevant fields):

    {
      "fen": "...",
      "depth": 36, "knodes": 12345,
      "pvs": [ { "moves": "e2e4 e7e5 ...", "cp": 21 },   # or "mate": 3
               ... ]
    }
"""

from __future__ import annotations

from ..config import EvalConfig
from ..http import get_json
from .base import Eval


class LichessCloudEvalSource:
    name = "cloud"

    def __init__(self, config: EvalConfig, user_agent: str, token: str | None = None):
        self._config = config
        self._user_agent = user_agent
        self._token = token

    def get(self, fen4: str) -> Eval | None:
        data = get_json(
            self._config.cloud_base_url,
            {"fen": fen4, "multiPv": self._config.multi_pv},
            user_agent=self._user_agent,
            token=self._token,
            timeout=self._config.timeout_s,
        )
        if not data:
            return None
        pvs = data.get("pvs") or []
        if not pvs:
            return None
        top = pvs[0]
        moves = (top.get("moves") or "").split()
        best = moves[0] if moves else None
        return Eval(
            fen4=fen4,
            best_move_uci=best,
            cp=top.get("cp"),
            mate=top.get("mate"),
            depth=data.get("depth"),
            source=self.name,
            pv=moves,
        )
