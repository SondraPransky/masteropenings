"""Lichess Opening Explorer client (D1/D11).

Fills `position_stats` with rating-aware human statistics: for each position we make one
call per Elo bucket (the API aggregates the buckets passed in a single ``ratings`` param,
so to keep 9 *separate* rows we query one bucket at a time), merging the rapid+classical
speeds into a single "thoughtful" cadence profile.

Win/draw/loss percentages are stored from the **side-to-move** perspective so that
downstream winrate comparisons (D6) are directly meaningful.

Explorer response (relevant fields):

    {
      "white": 1234, "draws": 567, "black": 890,   # totals across all listed moves
      "moves": [
        { "uci": "e2e4", "san": "e4",
          "white": 700, "draws": 300, "black": 400, "averageRating": 1650 },
        ...
      ],
      "opening": { "eco": "C50", "name": "Italian Game" }
    }
"""

from __future__ import annotations

import sqlite3
import time

from . import db
from .config import Config
from .fen import side_to_move
from .http import HttpError, get_json

# Sentinel: distinguishes "aggregate not provided" from "aggregate is None (no data)".
_UNSET = object()


def total_games(data: dict | None) -> int:
    """White + draws + black across the moves in an Explorer response."""
    if not data:
        return 0
    return int(data.get("white", 0)) + int(data.get("draws", 0)) + int(data.get("black", 0))


class LichessExplorerClient:
    def __init__(self, conn: sqlite3.Connection, config: Config):
        self._conn = conn
        self._config = config
        self._explorer = config.explorer
        self._last_call = 0.0
        self._warned = False

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call
        wait = self._explorer.request_delay_s - elapsed
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.monotonic()

    def get_bucket(self, fen4: str, bucket: int | None) -> dict | None:
        """Raw Explorer JSON for one position.

        ``bucket`` restricts to one rating band; ``None`` returns the aggregate across all
        bands (used as a cheap "peek" to decide whether the per-bucket calls are worth it).
        """
        self._throttle()
        params = {
            "variant": self._explorer.variant,
            "fen": fen4,
            "speeds": ",".join(self._explorer.speeds),
            "moves": self._explorer.moves,
            "topGames": 0,
            "recentGames": 0,
        }
        if bucket is not None:
            params["ratings"] = str(bucket)
        else:
            params["ratings"] = ",".join(str(b) for b in self._explorer.ratings)
        return get_json(
            self._explorer.base_url,
            params,
            user_agent=self._config.user_agent,
            token=self._config.lichess_token,
            timeout=self._explorer.timeout_s,
            max_retries=self._explorer.max_retries,
            retry_delay=self._explorer.request_delay_s,
        )

    def fetch_position_stats(
        self, position_id: int, fen4: str, *, skip_cached: bool = True, aggregate=_UNSET
    ) -> int:
        """Fetch and store the 9 Elo-bucket stat rows for one position.

        ``aggregate`` lets a caller pass an already-fetched aggregate response (from
        ``get_bucket(fen4, None)``) so the peek call isn't repeated. Returns the number of
        network calls made.
        """
        stm = side_to_move(fen4)
        ratings = self._explorer.ratings
        if skip_cached and db.explorer_done(self._conn, position_id):
            return 0

        fetched = 0
        # Peek: one aggregate call across all bands. If the whole position has fewer than
        # min_games total, no single bucket can reach the D13 threshold (buckets are
        # subsets) — so skip the 9 per-bucket calls entirely.
        if aggregate is _UNSET:
            try:
                agg = self.get_bucket(fen4, None)
            except HttpError as exc:
                self._warn(exc)
                return fetched
            fetched += 1
        else:
            agg = aggregate
        if agg:
            opening = agg.get("opening") or {}
            if opening:
                db.set_position_opening(
                    self._conn, position_id, opening.get("eco"), opening.get("name")
                )
        if total_games(agg) < self._config.thresholds.min_games:
            for bucket in ratings:
                db.replace_stats_for_bucket(self._conn, position_id, bucket, [])
            db.mark_explorer_fetched(self._conn, position_id)
            self._conn.commit()
            return fetched

        for bucket in ratings:
            if skip_cached and db.has_stats(self._conn, position_id, bucket):
                continue
            try:
                data = self.get_bucket(fen4, bucket)
            except HttpError as exc:
                self._warn(exc)
                continue
            fetched += 1
            if data is None:
                db.replace_stats_for_bucket(self._conn, position_id, bucket, [])
                continue
            rows = [_move_row(m, stm) for m in (data.get("moves") or [])]
            db.replace_stats_for_bucket(self._conn, position_id, bucket, rows)
        db.mark_explorer_fetched(self._conn, position_id)
        self._conn.commit()
        return fetched

    def _warn(self, exc: HttpError) -> None:
        if self._warned:
            return
        self._warned = True
        if exc.status == 401 and not self._config.lichess_token:
            print("      ERROR: Lichess Opening Explorer now requires a token. Create one "
                  "at https://lichess.org/account/oauth/token and set it:  "
                  "$env:OA_LICHESS_TOKEN=\"<token>\"  (PowerShell). Stats will be empty.")
        else:
            print(f"      warning: Explorer unavailable ({exc}); stats will be incomplete.")


def _move_row(move: dict, stm: str) -> dict:
    """Turn one Explorer move entry into a position_stats row (side-to-move POV)."""
    white = int(move.get("white", 0))
    draws = int(move.get("draws", 0))
    black = int(move.get("black", 0))
    games = white + draws + black
    if stm == "w":
        wins, losses = white, black
    else:
        wins, losses = black, white
    win_pct = 100.0 * wins / games if games else 0.0
    draw_pct = 100.0 * draws / games if games else 0.0
    loss_pct = 100.0 * losses / games if games else 0.0
    return {
        "move_uci": move.get("uci"),
        "move_san": move.get("san"),
        "games": games,
        "white": white,
        "draws": draws,
        "black": black,
        "win_pct": round(win_pct, 2),
        "draw_pct": round(draw_pct, 2),
        "loss_pct": round(loss_pct, 2),
        "avg_rating": move.get("averageRating"),
    }
