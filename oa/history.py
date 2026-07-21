"""Review history (P4) — the motivating loop: "am I improving?".

Pure aggregation over ``review_log`` (append-only). The journal answers what the SM-2 state
alone cannot: across days, are you recalling more and hesitating less? We bucket reviews by
calendar day and report the recall rate (1 − lapses/total) and the median response time — the
two signals a student actually feels. Rating-aware: an ``elo_bucket`` filter is honoured, so
progress can be read at the level you play.

No recomputation, no network — it re-reads the base like every other view.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from . import db


def _day(reviewed_at: str) -> str:
    """The calendar day of an ISO datetime ('2026-07-18T21:03:11' -> '2026-07-18')."""
    return (reviewed_at or "")[:10] or "inconnu"


def _median(values: list[int]) -> int | None:
    if not values:
        return None
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) // 2


@dataclass
class DayStats:
    day: str
    reviews: int = 0
    recalled: int = 0            # grade != 'again' — you produced the move
    lapsed: int = 0              # grade == 'again' — you missed it
    _times: list[int] = field(default_factory=list, repr=False)

    @property
    def recall_rate(self) -> float | None:
        return self.recalled / self.reviews if self.reviews else None

    @property
    def median_ms(self) -> int | None:
        return _median(self._times)


@dataclass
class Summary:
    reviews: int = 0
    recalled: int = 0
    lapsed: int = 0
    days_active: int = 0
    median_ms: int | None = None

    @property
    def recall_rate(self) -> float | None:
        return self.recalled / self.reviews if self.reviews else None


_UNSET = db._STUDENT_UNSET


def daily_progress(
    conn: sqlite3.Connection, account_id: int, *, chapter_id: int | None = None,
    username: str | None = None, elo_bucket: int | None = None, student_id=_UNSET,
) -> list[DayStats]:
    """One row per calendar day (oldest first): reviews, recall rate, median response time."""
    days: dict[str, DayStats] = {}
    for r in db.reviews_for_account(conn, account_id, chapter_id=chapter_id,
                                    username=username, student_id=student_id):
        if elo_bucket is not None and r["elo_bucket"] != elo_bucket:
            continue
        key = _day(r["reviewed_at"])
        d = days.setdefault(key, DayStats(day=key))
        d.reviews += 1
        if r["grade"] == "again":
            d.lapsed += 1
        else:
            d.recalled += 1
        if r["response_ms"] is not None:
            d._times.append(int(r["response_ms"]))
    return [days[k] for k in sorted(days)]


def summary(
    conn: sqlite3.Connection, account_id: int, *, chapter_id: int | None = None,
    username: str | None = None, elo_bucket: int | None = None, student_id=_UNSET,
) -> Summary:
    """Totals across the whole journal (respecting the same optional filters)."""
    out = Summary()
    times: list[int] = []
    days = daily_progress(conn, account_id, chapter_id=chapter_id, username=username,
                          elo_bucket=elo_bucket, student_id=student_id)
    for d in days:
        out.reviews += d.reviews
        out.recalled += d.recalled
        out.lapsed += d.lapsed
        times.extend(d._times)
    out.days_active = len([d for d in days if d.reviews])
    out.median_ms = _median(times)
    return out
