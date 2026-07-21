"""Fetch a player's games from the Lichess API and feed the personal import (D16).

``lichess.org/api/games/user/<name>`` streams the player's games as PGN. Unlike the
Opening Explorer host, this endpoint is reachable and a token raises the rate limit. We
only *download* here; the matching stays the existing no-recalc personal flow
(:func:`opening_analytics.personal.import_pgn`) — nothing is recomputed at import.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from . import http, personal
from .config import Config

GAMES_URL = "https://lichess.org/api/games/user/{username}"


def build_params(
    *,
    max_games: int | None = None,
    rated: bool | None = None,
    perf_type: str | None = None,
    since: int | None = None,
    until: int | None = None,
) -> dict[str, object]:
    """Query parameters for the games export. Clocks/evals are dropped (we don't need
    them) to keep the download lean; ``perf_type`` is a comma list (e.g. ``rapid,classical``).
    """
    params: dict[str, object] = {"clocks": "false", "evals": "false"}
    if max_games is not None:
        params["max"] = max_games
    if rated is not None:
        params["rated"] = "true" if rated else "false"
    if perf_type:
        params["perfType"] = perf_type
    if since is not None:
        params["since"] = since
    if until is not None:
        params["until"] = until
    return params


def fetch_pgn(config: Config, username: str, **opts) -> str:
    """Download ``username``'s games as raw PGN text (network)."""
    url = GAMES_URL.format(username=username)
    return http.get_text(
        url,
        build_params(**opts),
        user_agent=config.user_agent,
        accept="application/x-chess-pgn",
        token=config.lichess_token,
        timeout=120.0,
    )


def fetch_and_import(
    conn: sqlite3.Connection,
    config: Config,
    username: str,
    *,
    dest_dir: "str | Path | None" = None,
    **opts,
) -> tuple[personal.ImportResult, Path]:
    """Download ``username``'s games, save the PGN, and import their personal errors.

    Returns ``(ImportResult, pgn_path)``. The PGN is kept under ``reports/games/`` (or
    ``dest_dir``) so the import is reproducible offline afterwards.
    """
    pgn = fetch_pgn(config, username, **opts)
    base = Path(dest_dir) if dest_dir else config.reports_dir / "games"
    dest = base / f"{username.lower()}.pgn"
    result = personal.import_pgn_text(conn, pgn, username, dest)
    return result, dest
