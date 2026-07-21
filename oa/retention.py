"""Retention analytics for the trainer (A5) — a health read of a spaced-repetition deck.

Derived purely from the SM-2 state already stored on `sr_cards` / `personal_cards` (no new
tracking): how many cards are new / learning / mature, how many are due, and which ones are
"leeches" — cards you keep failing (many lapses, or a collapsed ease factor). Same shape for
the chapter decks and a player's own-error deck.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from . import db

MATURE_DAYS = 21       # interval at which a card counts as "known"
LEECH_LAPSES = 4       # this many relapses => a leech
LEECH_EASE = 1.7       # or a collapsed ease factor (min is 1.3)


@dataclass
class Retention:
    label: str
    total: int = 0
    new: int = 0
    learning: int = 0
    mature: int = 0
    leeches: int = 0
    due: int = 0
    total_lapses: int = 0
    avg_ease: float | None = None

    @property
    def mature_pct(self) -> float:
        seen = self.total - self.new
        return (self.mature / seen) if seen else 0.0


@dataclass
class Leech:
    line: str
    lapses: int
    ease: float
    reps: int


def _summary(conn: sqlite3.Connection, table: str, where: str, params: tuple,
             label: str) -> Retention:
    row = conn.execute(
        f"""
        SELECT COUNT(*)                                                        AS total,
               SUM(CASE WHEN reps = 0 THEN 1 ELSE 0 END)                        AS new,
               SUM(CASE WHEN reps > 0 AND interval_days < ? THEN 1 ELSE 0 END)  AS learning,
               SUM(CASE WHEN interval_days >= ? THEN 1 ELSE 0 END)              AS mature,
               SUM(CASE WHEN lapses >= ? OR (reps > 0 AND ease <= ?)
                        THEN 1 ELSE 0 END)                                      AS leeches,
               SUM(CASE WHEN due_date IS NOT NULL AND due_date <= ?
                        THEN 1 ELSE 0 END)                                      AS due,
               SUM(lapses)                                                      AS lapses,
               AVG(ease)                                                        AS avg_ease
          FROM {table} WHERE {where}
        """,
        (MATURE_DAYS, MATURE_DAYS, LEECH_LAPSES, LEECH_EASE, db.today_iso(), *params),
    ).fetchone()
    return Retention(
        label=label, total=int(row["total"] or 0), new=int(row["new"] or 0),
        learning=int(row["learning"] or 0), mature=int(row["mature"] or 0),
        leeches=int(row["leeches"] or 0), due=int(row["due"] or 0),
        total_lapses=int(row["lapses"] or 0),
        avg_ease=None if row["avg_ease"] is None else round(float(row["avg_ease"]), 2),
    )


def _leeches(conn: sqlite3.Connection, table: str, where: str, params: tuple,
             limit: int) -> list[Leech]:
    from .personal import line_for_position
    rows = conn.execute(
        f"""
        SELECT position_id, lapses, ease, reps FROM {table}
         WHERE {where} AND (lapses >= ? OR (reps > 0 AND ease <= ?))
         ORDER BY lapses DESC, ease ASC LIMIT ?
        """,
        (*params, LEECH_LAPSES, LEECH_EASE, limit),
    ).fetchall()
    return [Leech(line_for_position(conn, int(r["position_id"])), int(r["lapses"]),
                  float(r["ease"]), int(r["reps"])) for r in rows]


def chapter_retention(conn: sqlite3.Connection, chapter_id: int, name: str) -> Retention:
    return _summary(conn, "sr_cards", "chapter_id = ?", (chapter_id,), f"chapter:{name}")


def chapter_leeches(conn: sqlite3.Connection, chapter_id: int, limit: int = 10) -> list[Leech]:
    return _leeches(conn, "sr_cards", "chapter_id = ?", (chapter_id,), limit)


def personal_retention(conn: sqlite3.Connection, username: str) -> Retention:
    return _summary(conn, "personal_cards", "username = ?", (username.lower(),),
                    f"personal:{username}")


def personal_leeches(conn: sqlite3.Connection, username: str, limit: int = 10) -> list[Leech]:
    return _leeches(conn, "personal_cards", "username = ?", (username.lower(),), limit)
