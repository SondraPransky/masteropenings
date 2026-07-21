"""EEcoach layer (D18, phase 2): branch students' recall failures onto the built base.

EEcoach (the coach's own platform) records which position a student failed to recall, and
when. We read those failures (a CSV export, so no live DB credentials are needed), match
each to a position by FEN-4, and — where the position is already analysed — inherit its
criticality at the student's rating bucket. Nothing is recomputed (D18: "branches onto the
DB like the personal layer"). The taught repertoire itself becomes ordinary PGN chapters
run through `analyze`; this module only adds the recall-failure signal on top.

Expected CSV columns (a header row; `fen` OR `line` is enough to locate the position):

    student,rating,reviewed_at,fen,line,expected,played
"""

from __future__ import annotations

import csv
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import chess

from . import db
from .fen import _ensure_full_fen, fen4
from .personal import _elo_to_bucket, _period_key


@dataclass
class ImportStats:
    rows_seen: int = 0
    imported: int = 0
    matched: int = 0            # failures that landed on an analysed position
    skipped_unparsable: int = 0


def _int_or_none(value) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _board_from_fen(fen_str: str) -> chess.Board:
    parts = fen_str.split()
    if len(parts) >= 6:
        return chess.Board(fen_str)
    return chess.Board(_ensure_full_fen(" ".join(parts[:4])))


def _board_from_line(line: str) -> chess.Board:
    board = chess.Board()
    for token in line.replace(",", " ").split():
        try:
            board.push_san(token)
        except ValueError:
            board.push_uci(token)      # UCI fallback; propagates if truly invalid
    return board


def _fen4_of(raw: dict) -> str | None:
    fen = (raw.get("fen") or "").strip()
    line = (raw.get("line") or "").strip()
    try:
        if fen:
            return fen4(_board_from_fen(fen))
        if line:
            return fen4(_board_from_line(line))
    except (ValueError, IndexError):
        return None
    return None


def load_csv(path: "str | Path") -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def import_failures(
    conn: sqlite3.Connection, rows: list[dict], account_id: int | None = None
) -> ImportStats:
    """Record a batch of recall-failure rows, matching each to the base by FEN-4.
    The failures are owned by ``account_id`` (the coach; defaults to the local account)."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    stats = ImportStats()
    for raw in rows:
        stats.rows_seen += 1
        student = (raw.get("student") or "").strip()
        f4 = _fen4_of(raw)
        if not student or f4 is None:
            stats.skipped_unparsable += 1
            continue
        rating = _int_or_none(raw.get("rating"))
        bucket = _elo_to_bucket(rating)
        pos = db.get_position_by_fen(conn, f4)
        position_id = int(pos["id"]) if pos is not None else None
        crit = (db.peak_criticality_for_position(conn, position_id, bucket)
                if position_id is not None else None)
        db.insert_eecoach_failure(conn, {
            "account_id": account_id,
            "student": student, "rating": rating,
            "reviewed_at": (raw.get("reviewed_at") or "").strip() or None,
            "position_id": position_id, "fen4": f4,
            "expected_move": (raw.get("expected") or "").strip() or None,
            "played_move": (raw.get("played") or "").strip() or None,
            "in_territory": 1 if position_id is not None else 0,
            "elo_bucket": bucket, "criticality": crit,
        })
        stats.imported += 1
        if position_id is not None:
            stats.matched += 1
    conn.commit()
    return stats


def import_csv(
    conn: sqlite3.Connection, path: "str | Path", account_id: int | None = None
) -> ImportStats:
    return import_failures(conn, load_csv(path), account_id)


def student_report(
    conn: sqlite3.Connection, student: str, account_id: int | None = None
) -> list[sqlite3.Row]:
    """A student's recall failures, most critical (of the analysed ones) first."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    return db.eecoach_failures_for_student(conn, student, account_id)


@dataclass
class CohortHotspot:
    position_id: int
    line: str
    expected_move: str | None
    students: int          # distinct students who failed here
    failures: int          # total recall failures here
    criticality: float | None


def cohort_hotspots(
    conn: sqlite3.Connection, *, min_students: int = 1, account_id: int | None = None
) -> list[CohortHotspot]:
    """Positions the *group* fails most — curriculum priority (A4). Analysed positions only,
    ranked by how many distinct students trip on them, then total failures and criticality."""
    from .personal import line_for_position
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    rows = conn.execute(
        """
        SELECT position_id,
               COUNT(DISTINCT student) AS students,
               COUNT(*)                AS failures,
               MAX(criticality)        AS crit,
               MAX(expected_move)      AS expected
          FROM eecoach_failures
         WHERE account_id = ? AND in_territory = 1 AND position_id IS NOT NULL
         GROUP BY position_id
        HAVING students >= ?
         ORDER BY students DESC, failures DESC, crit DESC
        """,
        (account_id, min_students),
    ).fetchall()
    return [CohortHotspot(
        position_id=int(r["position_id"]),
        line=line_for_position(conn, int(r["position_id"])),
        expected_move=r["expected"], students=int(r["students"]),
        failures=int(r["failures"]),
        criticality=None if r["crit"] is None else float(r["crit"]),
    ) for r in rows]


@dataclass
class FailurePeriod:
    period: str
    failures: int = 0
    matched: int = 0        # of those, ones on an analysed (critical) position


def failures_over_time(
    conn: sqlite3.Connection, student: str, *, granularity: str = "month",
    account_id: int | None = None,
) -> list[FailurePeriod]:
    """Recall failures per calendar period (from reviewed_at), oldest first (M21-style)."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    periods: dict[str, FailurePeriod] = {}
    for row in db.eecoach_failures_for_student(conn, student, account_id):
        key = _period_key(row["reviewed_at"], granularity)
        p = periods.setdefault(key, FailurePeriod(period=key))
        p.failures += 1
        if row["in_territory"]:
            p.matched += 1
    return sorted(periods.values(), key=lambda p: (p.period == "unknown", p.period))
