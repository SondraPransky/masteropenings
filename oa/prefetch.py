"""Prefetch the popular opening tree into the local cache.

A one-time, bounded, resumable breadth-first walk from the starting position. At each
position it caches the 9-bucket human stats (so future chapter analyses become cache
hits) and follows only the moves played in at least ``min_games_follow`` games, down to
``max_ply``. Because positions are deduplicated by FEN-4, this pre-warms the shared
opening tree once; afterwards any mainstream repertoire chapter is (near) instant.

``count_only`` walks the same tree using just the aggregate "peek" call per position, so
you can size the crawl (how many positions?) before committing to the full fetch.
"""

from __future__ import annotations

import sqlite3
from collections import deque
from dataclasses import dataclass

import chess

from . import db
from .config import Config
from .explorer import LichessExplorerClient, total_games
from .fen import fen4, side_to_move
from .http import HttpError


@dataclass
class PrefetchResult:
    visited: int = 0          # distinct positions walked
    cached: int = 0           # positions stored this run
    followed: int = 0         # child edges enqueued
    stopped_early: bool = False   # network gave out
    capped: bool = False          # hit the --max-positions safety limit


def prefetch(
    conn: sqlite3.Connection,
    config: Config,
    *,
    max_ply: int = 12,
    min_games_follow: int = 5000,
    count_only: bool = False,
    positions_only: bool = False,
    max_positions: int | None = None,
    progress_every: int = 25,
    client: LichessExplorerClient | None = None,
) -> PrefetchResult:
    client = client or LichessExplorerClient(conn, config)
    result = PrefetchResult()
    seen: set[str] = set()
    queue: deque[tuple[chess.Board, int]] = deque([(chess.Board(), 0)])

    while queue:
        board, ply = queue.popleft()
        f4 = fen4(board)
        if f4 in seen:
            continue
        seen.add(f4)
        result.visited += 1

        moves = _process_position(
            conn, client, config, f4, min_games_follow, count_only, positions_only, result
        )
        if moves is None:  # network gave out — stop cleanly, cache so far is intact
            result.stopped_early = True
            break

        # Safety cap: stop once we've stored the requested number of positions, so an
        # unexpectedly huge tree (low --min-games-follow at high --max-ply) can't run away.
        if max_positions is not None and result.cached >= max_positions:
            result.capped = True
            break

        if ply < max_ply:
            for uci in moves:
                child = board.copy(stack=False)
                try:
                    child.push_uci(uci)
                except ValueError:
                    continue
                if fen4(child) not in seen:
                    queue.append((child, ply + 1))
                    result.followed += 1

        if result.visited % progress_every == 0:
            print(f"      walked {result.visited} positions, cached {result.cached}, "
                  f"queue {len(queue)} ...", flush=True)

    return result


def _process_position(
    conn: sqlite3.Connection,
    client: LichessExplorerClient,
    config: Config,
    f4: str,
    min_games_follow: int,
    count_only: bool,
    positions_only: bool,
    result: PrefetchResult,
) -> list[str] | None:
    """Cache the position (unless count_only) and return the popular moves to follow.

    ``positions_only`` stores the position row (so a later ``ingest-evals`` can fill its
    eval from the dump) but skips the 9 per-bucket Explorer stat calls — ~10x fewer calls,
    for building a broad opening eval base cheaply. The position is left un-fetched, so a
    later full prefetch/analyze still pulls its stats.

    Returns None only if the network is unavailable (caller stops the crawl).
    """
    row = db.get_position_by_fen(conn, f4)

    # Resume path: already cached -> read followable moves from the DB, no network.
    # (Only when its stats were actually fetched; positions_only rows re-peek to resume.)
    if row is not None and db.explorer_done(conn, int(row["id"])):
        return db.followable_moves(conn, int(row["id"]), min_games_follow)

    try:
        agg = client.get_bucket(f4, None)
    except HttpError as exc:
        print(f"      stopping: Explorer unavailable ({exc}).", flush=True)
        return None

    if agg is None:
        return []

    if not count_only and total_games(agg) >= config.thresholds.min_games:
        pos_id = db.upsert_position(conn, f4, side_to_move(f4))
        if positions_only:
            conn.commit()
        else:
            client.fetch_position_stats(pos_id, f4, aggregate=agg)
        result.cached += 1

    return [
        m["uci"]
        for m in (agg.get("moves") or [])
        if total_games(m) >= min_games_follow and m.get("uci")
    ]
