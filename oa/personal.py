"""Personal layer (D16): branch a player's games onto the built base — no recalculation.

Import a player's PGN, replay each game, and wherever the player (identified by username)
made a move that we have already catalogued as a costly mistake (`errors`), record a
personal error. We only judge the player's own moves, only in positions we have already
analysed, and we reuse the existing eval / criticality — nothing is recomputed.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import chess
import chess.pgn

from . import db
from .config import ELO_BUCKETS, Thresholds
from .detect import eval_loss_cp, white_cp_of
from .evals.base import Eval
from .fen import fen4, side_to_move
from .ingest import _open_pgn


@dataclass
class ImportResult:
    games_seen: int = 0          # games in the file
    games_imported: int = 0      # games where the username played
    games_skipped: int = 0       # username not a player
    errors_found: int = 0
    positions_in_territory: int = 0   # player-to-move positions that were already analysed
    deviations_found: int = 0    # "left theory" moves judged from cached child evals


def _elo_to_bucket(elo: int | None) -> int | None:
    """Nearest lower Explorer bucket for a rating (None if no rating)."""
    if elo is None:
        return None
    bucket = None
    for lower in ELO_BUCKETS:
        if elo >= lower:
            bucket = lower
        else:
            break
    return bucket


def _player_color(headers, username: str) -> str | None:
    u = username.lower()
    if (headers.get("White") or "").lower() == u:
        return "w"
    if (headers.get("Black") or "").lower() == u:
        return "b"
    return None


def _player_elo(headers, color: str) -> int | None:
    raw = headers.get("WhiteElo" if color == "w" else "BlackElo")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def import_pgn(
    conn: sqlite3.Connection, pgn_path: "str | Path", username: str,
    *, mistake_cp: int = Thresholds().mistake_cp, account_id: int | None = None,
) -> ImportResult:
    """Import all games in a PGN where ``username`` played; record their personal errors
    and left-theory deviations (``mistake_cp`` = the loss above which a deviation is costly).
    Games are owned by ``account_id`` (defaults to the implicit local account)."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    result = ImportResult()
    with _open_pgn(Path(pgn_path)) as handle:
        while True:
            game = chess.pgn.read_game(handle)
            if game is None:
                break
            result.games_seen += 1
            color = _player_color(game.headers, username)
            if color is None:
                result.games_skipped += 1
                continue
            result.games_imported += 1
            elo = _player_elo(game.headers, color)
            game_id = db.insert_personal_game(conn, {
                "account_id": account_id,
                "source": "pgn", "username": username.lower(), "player_color": color,
                "player_elo": elo,
                "white": game.headers.get("White"), "black": game.headers.get("Black"),
                "result": game.headers.get("Result"), "date": game.headers.get("Date"),
                "event": game.headers.get("Event"),
            })
            _scan_game(conn, game, color, _elo_to_bucket(elo), game_id, result,
                       mistake_cp)
    conn.commit()
    return result


def import_pgn_text(
    conn: sqlite3.Connection, pgn_text: str, username: str, dest_path: "str | Path",
    *, mistake_cp: int = Thresholds().mistake_cp, account_id: int | None = None,
) -> ImportResult:
    """Persist ``pgn_text`` to ``dest_path`` then import it (used by the Lichess fetch).

    Keeping a local copy means an import is reproducible offline and the raw games stay
    on disk; the matching itself is the same no-recalc :func:`import_pgn` flow.
    """
    dest = Path(dest_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(pgn_text, encoding="utf-8")
    return import_pgn(conn, dest, username, mistake_cp=mistake_cp, account_id=account_id)


def _scan_game(conn, game, color, bucket, game_id, result: ImportResult,
               mistake_cp: int) -> None:
    board = game.board()
    player_turn = chess.WHITE if color == "w" else chess.BLACK
    ply = 0
    territory = 0
    for move in game.mainline_moves():
        if board.turn == player_turn:
            pos = db.get_position_by_fen(conn, fen4(board))
            if pos is not None:
                result.positions_in_territory += 1
                territory += 1
                err = db.find_catalogued_error(conn, int(pos["id"]), move.uci(), bucket)
                if err is not None:
                    db.insert_personal_error(conn, {
                        "personal_game_id": game_id, "position_id": int(pos["id"]),
                        "error_id": int(err["id"]), "ply": ply,
                        "played_uci": move.uci(), "played_san": board.san(move),
                        "best_move_uci": err["best_move_uci"],
                        "best_move_san": err["best_move_san"],
                        "eval_loss_cp": err["eval_loss_cp"],
                        "criticality": err["criticality"],
                        "elo_bucket": err["elo_bucket"], "error_type": err["error_type"],
                    })
                    result.errors_found += 1
                else:
                    _record_deviation(conn, board, move, pos, game_id, ply, result,
                                      mistake_cp)
        board.push(move)
        ply += 1
    db.set_personal_game_territory(conn, game_id, territory)


def _record_deviation(conn, board, move, pos, game_id, ply, result: ImportResult,
                      mistake_cp: int) -> None:
    """Record a 'left theory' deviation — a player move that is neither the best move nor
    a catalogued error — but ONLY if the child position is already evaluated (D16: no
    recalculation). The eval loss is then read straight from the cache."""
    if move.uci() == pos["best_move_uci"]:
        return                                  # still in theory (the best move)
    parent_white = white_cp_of(Eval(fen4=pos["fen4"], cp=pos["eval_cp"],
                                     mate=pos["eval_mate"]))
    if parent_white is None:
        return                                  # parent not evaluated — can't judge
    child = board.copy(stack=False)
    child.push(move)
    child_pos = db.get_position_by_fen(conn, fen4(child))
    if child_pos is None:
        return                                  # child not in the base — skip (no recalc)
    child_white = white_cp_of(Eval(fen4=child_pos["fen4"], cp=child_pos["eval_cp"],
                                   mate=child_pos["eval_mate"]))
    if child_white is None:
        return                                  # child in base but unevaluated — skip
    loss = eval_loss_cp(parent_white, child_white, side_to_move(pos["fen4"]))
    db.insert_personal_deviation(conn, {
        "personal_game_id": game_id, "position_id": int(pos["id"]), "ply": ply,
        "played_uci": move.uci(), "played_san": board.san(move),
        "best_move_san": pos["best_move_san"],
        "eval_loss_cp": int(loss), "costly": 1 if loss >= mistake_cp else 0,
    })
    result.deviations_found += 1


def personal_report(
    conn: sqlite3.Connection, username: str, account_id: int | None = None
) -> list[sqlite3.Row]:
    """A player's personal errors, most critical first (feeds M15 and the CLI report)."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    return db.personal_errors_for_user(conn, username, account_id)


def deviations(
    conn: sqlite3.Connection, username: str, account_id: int | None = None
) -> list[sqlite3.Row]:
    """A player's 'left theory' deviations judged from cached child evals (costliest first)."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    return db.personal_deviations_for_user(conn, username, account_id)


# ---------------------------------------------------------------------------
# M21 — progress over time. As a student re-imports games, are they making fewer
# catalogued mistakes? We bucket their games by calendar period (from the PGN date,
# not the import date, so re-imports of old games don't distort the trend) and report
# the error rate = personal errors / player-to-move positions in analysed territory.
# ---------------------------------------------------------------------------
@dataclass
class ProgressPeriod:
    period: str
    games: int = 0
    territory: int = 0     # in-territory player-to-move positions (the denominator)
    errors: int = 0

    @property
    def error_rate(self) -> float | None:
        return self.errors / self.territory if self.territory else None


def _period_key(date_str: str | None, granularity: str) -> str:
    """A sortable period label from a PGN date ('YYYY.MM.DD'); '?' fields -> 'unknown'."""
    if not date_str:
        return "unknown"
    parts = date_str.replace("-", ".").split(".")
    year = parts[0]
    if not year.isdigit():
        return "unknown"
    if granularity == "month" and len(parts) >= 2 and parts[1].isdigit():
        return f"{year}-{parts[1].zfill(2)}"
    return year


def progress(
    conn: sqlite3.Connection, username: str, *, granularity: str = "month",
    account_id: int | None = None,
) -> list[ProgressPeriod]:
    """A player's catalogued-error rate per calendar period, oldest first."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    errs_by_game: dict[int, int] = {}
    for row in conn.execute(
        "SELECT pe.personal_game_id AS gid, COUNT(*) AS n FROM personal_errors pe "
        "JOIN personal_games pg ON pg.id = pe.personal_game_id "
        "WHERE pg.account_id = ? AND pg.username = ? GROUP BY pe.personal_game_id",
        (account_id, username.lower()),
    ).fetchall():
        errs_by_game[int(row["gid"])] = int(row["n"])

    periods: dict[str, ProgressPeriod] = {}
    for game in db.personal_games_for_user(conn, username, account_id):
        key = _period_key(game["date"], granularity)
        p = periods.setdefault(key, ProgressPeriod(period=key))
        p.games += 1
        p.territory += int(game["territory_positions"] or 0)
        p.errors += errs_by_game.get(int(game["id"]), 0)

    ordered = sorted(periods.values(), key=lambda p: (p.period == "unknown", p.period))
    return ordered


# ---------------------------------------------------------------------------
# M24 — personal training priority. Replaces plain criticality ordering in the
# personal deck: occurrences × peer frequency × eval loss × time since review.
# ---------------------------------------------------------------------------
NEW_CARD_DAYS = 30   # recency assigned to a never-reviewed position (treated as overdue)


def priority_score(
    occurrences: int, peer_frequency: float, eval_loss_cp: int, days_since_review: int
) -> float:
    """M24 priority. All factors multiply, so a mistake you repeat, that peers also fall
    for, that costs a lot, and that you haven't drilled recently, floats to the top."""
    loss_pawns = max(0.0, eval_loss_cp / 100.0)
    freq = max(peer_frequency, 0.01)        # floor: a missing peer stat shouldn't zero it
    recency = 1.0 + max(0, days_since_review) / 30.0
    return occurrences * freq * loss_pawns * recency


def _days_since(last_review: str | None, today: date, default: int) -> int:
    if not last_review:
        return default
    try:
        return max(0, (today - date.fromisoformat(last_review)).days)
    except ValueError:
        return default


def ranked_priorities(
    conn: sqlite3.Connection, username: str, *, today: date | None = None,
    account_id: int | None = None,
) -> list[dict]:
    """Positions the player erred at, ranked by M24 priority (highest first)."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    today = today or date.today()
    out: list[dict] = []
    for r in db.personal_priority_rows(conn, username, account_id):
        days = _days_since(r["last_review"], today, NEW_CARD_DAYS)
        score = priority_score(
            int(r["occurrences"]), float(r["peer_frequency"] or 0.0),
            int(r["eval_loss_cp"] or 0), days,
        )
        out.append({
            "position_id": int(r["position_id"]),
            "occurrences": int(r["occurrences"]),
            "peer_frequency": float(r["peer_frequency"] or 0.0),
            "eval_loss_cp": int(r["eval_loss_cp"] or 0),
            "played_san": r["played_san"], "best_move_san": r["best_move_san"],
            "elo_bucket": r["elo_bucket"], "days_since_review": days,
            "due_date": r["due_date"], "priority": score,
        })
    out.sort(key=lambda d: d["priority"], reverse=True)
    return out


def line_for_position(conn: sqlite3.Connection, position_id: int) -> str:
    """A representative SAN line reaching a position (shortest path in any chapter)."""
    row = conn.execute(
        "SELECT move_sequence FROM paths WHERE position_id = ? ORDER BY ply ASC LIMIT 1",
        (position_id,),
    ).fetchone()
    if row is None or not row["move_sequence"]:
        return "(start)"
    board = chess.Board()
    moves = [chess.Move.from_uci(u) for u in row["move_sequence"].split()]
    try:
        return board.variation_san(moves)
    except (ValueError, AssertionError):
        return row["move_sequence"]
