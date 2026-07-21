"""Spaced repetition for the trainer — SM-2 scheduling + card selection (D15, revised).

A card is a decision point (a position with detected errors). SM-2 keeps its ease,
interval and due date; the position it trains and the errors it teaches live in the
existing `positions` / `errors` tables. Card selection is rating-aware (M20): an optional
Elo bucket restricts practice to the mistakes that matter at the player's level.
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

from . import db, export_pgn

MIN_EASE = 1.3

# Grade buttons map to SM-2 quality: Again / Hard / Good / Easy.
QUALITY = {"again": 1, "hard": 2, "good": 4, "easy": 5}


def sm2(ease: float, interval_days: int, reps: int, quality: int) -> tuple[float, int, int, int]:
    """One SM-2 review. Returns (ease, interval_days, reps, lapses_delta).

    Ease is recomputed every review and floored at 1.3. quality < 3 is a lapse: reps reset
    and the card is due again tomorrow; quality >= 3 grows the interval (1, 6, then × ease).
    """
    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    ease = max(MIN_EASE, ease)

    if quality < 3:
        return ease, 1, 0, 1

    reps += 1
    if reps == 1:
        interval = 1
    elif reps == 2:
        interval = 6
    else:
        interval = max(1, round(interval_days * ease))
    return ease, interval, reps, 0


def sync_cards(conn: sqlite3.Connection, chapter_id: int, min_criticality: float = 0.05) -> int:
    """Create one card per path reaching a decision point (peak Criticality ≥ threshold).

    A transposition (same position via several move orders) becomes several cards, so each
    concrete line is drilled and scheduled on its own (D15). Idempotent.
    """
    created = 0
    for dec in export_pgn.collect_decisions(conn, chapter_id):
        if dec.peak < min_criticality:
            continue
        mode = "puzzle" if any(m.error_type == "puzzle" for m in dec.mistakes.values()) \
            else "flashcard"
        for path in db.paths_for_position(conn, chapter_id, dec.position_id):
            db.upsert_card(conn, dec.position_id, chapter_id, int(path["id"]), mode)
            created += 1
    conn.commit()
    return created


def _bucket_positions(conn: sqlite3.Connection, chapter_id: int, bucket: int) -> set[int]:
    """Position ids that have a detected error at this Elo bucket (M20 filter)."""
    rows = conn.execute(
        "SELECT DISTINCT position_id FROM errors WHERE chapter_id = ? AND elo_bucket = ?",
        (chapter_id, bucket),
    ).fetchall()
    return {int(r["position_id"]) for r in rows}


def _allowed_positions(
    conn: sqlite3.Connection, chapter_id: int, bucket: int | None,
    include: "set[int] | None",
) -> "set[int] | None":
    """The effective position whitelist for card selection: the Elo-bucket set (M20)
    intersected with an optional assignment subset (``include``). ``None`` means no limit;
    an empty set means nothing qualifies (the callers short-circuit on that)."""
    allowed = _bucket_positions(conn, chapter_id, bucket) if bucket is not None else None
    if include is not None:
        allowed = include if allowed is None else (allowed & include)
    return allowed


def next_card(
    conn: sqlite3.Connection, chapter_id: int, bucket: int | None = None,
    exclude: tuple[int, ...] = (), include: "set[int] | None" = None,
) -> sqlite3.Row | None:
    """The next card to study: the most-overdue one, else the most critical new one.

    ``bucket`` (an Elo lower-bound) restricts to positions that err at that level.
    ``exclude`` skips card ids the student passed this session (« passer cette carte ») —
    they stay due, they just don't come straight back.
    """
    allowed = _allowed_positions(conn, chapter_id, bucket, include)
    if allowed is not None and not allowed:
        return None

    def _filter(rows):
        rows = [r for r in rows if int(r["id"]) not in exclude]
        if allowed is None:
            return rows
        return [r for r in rows if int(r["position_id"]) in allowed]

    today = db.today_iso()
    due = _filter(conn.execute(
        "SELECT * FROM sr_cards WHERE chapter_id = ? AND due_date IS NOT NULL "
        "AND due_date <= ? ORDER BY due_date ASC",
        (chapter_id, today),
    ).fetchall())
    if due:
        return due[0]

    new = _filter(conn.execute(
        "SELECT c.*, MAX(e.criticality) AS peak FROM sr_cards c "
        "JOIN errors e ON e.position_id = c.position_id AND e.chapter_id = c.chapter_id "
        "WHERE c.chapter_id = ? AND c.due_date IS NULL "
        "GROUP BY c.id ORDER BY peak DESC",
        (chapter_id,),
    ).fetchall())
    return new[0] if new else None


def remaining_cards(
    conn: sqlite3.Connection, chapter_id: int, bucket: int | None = None,
    include: "set[int] | None" = None,
) -> int:
    """How many cards are still in today's queue (due + never seen), same filters as
    ``next_card`` — feeds the trainer's « restantes » counter."""
    allowed = _allowed_positions(conn, chapter_id, bucket, include)
    if allowed is not None and not allowed:
        return 0
    rows = conn.execute(
        "SELECT position_id FROM sr_cards WHERE chapter_id = ? "
        "AND (due_date IS NULL OR due_date <= ?)",
        (chapter_id, db.today_iso()),
    ).fetchall()
    if allowed is None:
        return len(rows)
    return sum(1 for r in rows if int(r["position_id"]) in allowed)


def _due_after(quality: int, interval: int) -> str:
    """Due date after a review. A lapse (quality < 3) stays due TODAY: the failed card is
    re-served at the end of today's queue (Anki-style relearn) instead of vanishing until
    tomorrow — a student who misses a move wants to retry it this session."""
    days = interval if quality >= 3 else 0
    return (date.today() + timedelta(days=days)).isoformat()


def grade(conn: sqlite3.Connection, card_id: int, quality: int) -> int:
    """Apply an SM-2 review to a card. Returns the new interval in days."""
    card = db.get_card(conn, card_id)
    if card is None:
        raise ValueError(f"no card {card_id}")
    ease, interval, reps, lapses_delta = sm2(
        card["ease"], card["interval_days"], card["reps"], quality
    )
    due = _due_after(quality, interval)
    db.update_card_sr(
        conn, card_id,
        ease=ease, interval_days=interval, reps=reps,
        lapses=card["lapses"] + lapses_delta, due_date=due,
    )
    return interval


# ---------------------------------------------------------------------------
# Option B: per-mistake punish deck. One card per (path × opponent trap), scheduled
# independently — so each trap resurfaces on its own timetable. Same SM-2.
# ---------------------------------------------------------------------------
def sync_punish_cards(
    conn: sqlite3.Connection, chapter_id: int, min_criticality: float = 0.05
) -> int:
    """One punish card per (path × opponent mistake) whose peak Criticality ≥ threshold. Idempotent."""
    created = 0
    for dec in export_pgn.collect_decisions(conn, chapter_id):
        for mis in dec.mistakes.values():
            if mis.peak < min_criticality or not mis.uci:
                continue
            for path in db.paths_for_position(conn, chapter_id, dec.position_id):
                db.upsert_punish_card(conn, dec.position_id, chapter_id, int(path["id"]), mis.uci)
                created += 1
    conn.commit()
    return created


def next_punish_card(
    conn: sqlite3.Connection, chapter_id: int, side: str, bucket: int | None = None,
    exclude: tuple[int, ...] = (), include: "set[int] | None" = None,
) -> sqlite3.Row | None:
    """The next opponent trap to drill for a player of colour ``side`` ('white'|'black').

    You punish the opponent, so only decision points where it's the OPPONENT to move count.
    Most-overdue first, else the most critical never-seen trap. ``bucket`` restricts to traps
    that err at that Elo level (M20); ``exclude`` skips traps passed this session."""
    if side not in ("white", "black"):
        return None
    opp = "b" if side == "white" else "w"      # the erring side at a punishable decision point
    allowed = _allowed_positions(conn, chapter_id, bucket, include)
    if allowed is not None and not allowed:
        return None

    def _ok(rows):
        rows = [r for r in rows if int(r["id"]) not in exclude]
        if allowed is None:
            return rows
        return [r for r in rows if int(r["position_id"]) in allowed]

    due = _ok(conn.execute(
        "SELECT pc.* FROM punish_cards pc JOIN positions p ON p.id = pc.position_id "
        "WHERE pc.chapter_id = ? AND p.side_to_move = ? AND pc.due_date IS NOT NULL "
        "AND pc.due_date <= ? ORDER BY pc.due_date ASC",
        (chapter_id, opp, db.today_iso()),
    ).fetchall())
    if due:
        return due[0]

    new = _ok(conn.execute(
        "SELECT pc.*, MAX(e.criticality) AS peak FROM punish_cards pc "
        "JOIN positions p ON p.id = pc.position_id "
        "JOIN errors e ON e.position_id = pc.position_id AND e.chapter_id = pc.chapter_id "
        "AND e.mistake_move_uci = pc.mistake_uci "
        "WHERE pc.chapter_id = ? AND p.side_to_move = ? AND pc.due_date IS NULL "
        "GROUP BY pc.id ORDER BY peak DESC",
        (chapter_id, opp),
    ).fetchall())
    return new[0] if new else None


def remaining_punish_cards(
    conn: sqlite3.Connection, chapter_id: int, side: str, bucket: int | None = None,
    include: "set[int] | None" = None,
) -> int:
    """Today's queue size for the punish deck, same filters as ``next_punish_card``."""
    if side not in ("white", "black"):
        return 0
    opp = "b" if side == "white" else "w"
    allowed = _allowed_positions(conn, chapter_id, bucket, include)
    if allowed is not None and not allowed:
        return 0
    rows = conn.execute(
        "SELECT pc.position_id FROM punish_cards pc JOIN positions p ON p.id = pc.position_id "
        "WHERE pc.chapter_id = ? AND p.side_to_move = ? "
        "AND (pc.due_date IS NULL OR pc.due_date <= ?)",
        (chapter_id, opp, db.today_iso()),
    ).fetchall()
    if allowed is None:
        return len(rows)
    return sum(1 for r in rows if int(r["position_id"]) in allowed)


def next_mixed_card(
    conn: sqlite3.Connection, chapter_id: int, side: str, bucket: int | None = None,
    exclude_main: tuple[int, ...] = (), exclude_punish: tuple[int, ...] = (),
    include: "set[int] | None" = None,
) -> tuple[str, sqlite3.Row] | tuple[None, None]:
    """Main-deck selection when the player has a colour: YOUR decision points come from
    ``sr_cards``, opponent traps come one per mistake from ``punish_cards`` (the Option B
    granularity — a 13-trap position is 13 independently-scheduled cards, not one note).

    Returns ``(deck, row)`` with deck ``'main'`` or ``'punish'``. Most-overdue first across
    both decks, else the most critical never-seen candidate of either."""
    if side not in ("white", "black"):
        return None, None
    my = "w" if side == "white" else "b"
    opp = "b" if my == "w" else "w"
    allowed = _allowed_positions(conn, chapter_id, bucket, include)
    if allowed is not None and not allowed:
        return None, None
    today = db.today_iso()

    def _ok(rows, excl):
        rows = [r for r in rows if int(r["id"]) not in excl]
        if allowed is None:
            return rows
        return [r for r in rows if int(r["position_id"]) in allowed]

    due_main = _ok(conn.execute(
        "SELECT c.* FROM sr_cards c JOIN positions p ON p.id = c.position_id "
        "WHERE c.chapter_id = ? AND p.side_to_move = ? AND c.due_date IS NOT NULL "
        "AND c.due_date <= ? ORDER BY c.due_date ASC",
        (chapter_id, my, today)).fetchall(), exclude_main)
    due_pun = _ok(conn.execute(
        "SELECT pc.* FROM punish_cards pc JOIN positions p ON p.id = pc.position_id "
        "WHERE pc.chapter_id = ? AND p.side_to_move = ? AND pc.due_date IS NOT NULL "
        "AND pc.due_date <= ? ORDER BY pc.due_date ASC",
        (chapter_id, opp, today)).fetchall(), exclude_punish)
    due = ([("main", due_main[0])] if due_main else []) + \
          ([("punish", due_pun[0])] if due_pun else [])
    if due:
        return min(due, key=lambda t: t[1]["due_date"])

    new_main = _ok(conn.execute(
        "SELECT c.*, MAX(e.criticality) AS peak FROM sr_cards c "
        "JOIN positions p ON p.id = c.position_id "
        "JOIN errors e ON e.position_id = c.position_id AND e.chapter_id = c.chapter_id "
        "WHERE c.chapter_id = ? AND p.side_to_move = ? AND c.due_date IS NULL "
        "GROUP BY c.id ORDER BY peak DESC",
        (chapter_id, my)).fetchall(), exclude_main)
    new_pun = _ok(conn.execute(
        "SELECT pc.*, MAX(e.criticality) AS peak FROM punish_cards pc "
        "JOIN positions p ON p.id = pc.position_id "
        "JOIN errors e ON e.position_id = pc.position_id AND e.chapter_id = pc.chapter_id "
        "AND e.mistake_move_uci = pc.mistake_uci "
        "WHERE pc.chapter_id = ? AND p.side_to_move = ? AND pc.due_date IS NULL "
        "GROUP BY pc.id ORDER BY peak DESC",
        (chapter_id, opp)).fetchall(), exclude_punish)
    new = ([("main", new_main[0])] if new_main else []) + \
          ([("punish", new_pun[0])] if new_pun else [])
    if new:
        return max(new, key=lambda t: t[1]["peak"] or 0.0)
    return None, None


def remaining_mixed_cards(
    conn: sqlite3.Connection, chapter_id: int, side: str, bucket: int | None = None,
    include: "set[int] | None" = None,
) -> tuple[int, int]:
    """Today's queue for the mixed deck, split ``(your_moves, counters)`` — the trainer
    shows the split so choosing a colour doesn't silently double the day's debt."""
    if side not in ("white", "black"):
        return 0, 0
    my = "w" if side == "white" else "b"
    opp = "b" if my == "w" else "w"
    allowed = _allowed_positions(conn, chapter_id, bucket, include)
    if allowed is not None and not allowed:
        return 0, 0
    today = db.today_iso()

    def _count(rows):
        if allowed is None:
            return len(rows)
        return sum(1 for r in rows if int(r["position_id"]) in allowed)

    mains = conn.execute(
        "SELECT c.position_id FROM sr_cards c JOIN positions p ON p.id = c.position_id "
        "WHERE c.chapter_id = ? AND p.side_to_move = ? "
        "AND (c.due_date IS NULL OR c.due_date <= ?)",
        (chapter_id, my, today)).fetchall()
    puns = conn.execute(
        "SELECT pc.position_id FROM punish_cards pc JOIN positions p ON p.id = pc.position_id "
        "WHERE pc.chapter_id = ? AND p.side_to_move = ? "
        "AND (pc.due_date IS NULL OR pc.due_date <= ?)",
        (chapter_id, opp, today)).fetchall()
    return _count(mains), _count(puns)


def grade_punish(conn: sqlite3.Connection, card_id: int, quality: int) -> int:
    """Apply an SM-2 review to one punish card (an opponent trap). Returns the new interval."""
    card = db.get_punish_card(conn, card_id)
    if card is None:
        raise ValueError(f"no punish card {card_id}")
    ease, interval, reps, lapses_delta = sm2(
        card["ease"], card["interval_days"], card["reps"], quality
    )
    due = _due_after(quality, interval)
    db.update_punish_card_sr(
        conn, card_id, ease=ease, interval_days=interval, reps=reps,
        lapses=card["lapses"] + lapses_delta, due_date=due,
    )
    return interval


# ---------------------------------------------------------------------------
# Personal deck (M13): train on a player's OWN errors. Same SM-2, own table.
# ---------------------------------------------------------------------------
def sync_personal_cards(
    conn: sqlite3.Connection, username: str, account_id: int | None = None
) -> int:
    """One personal card per distinct position the user erred at. Idempotent."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    rows = conn.execute(
        "SELECT pe.position_id AS pid, "
        "MAX(CASE WHEN pe.error_type = 'puzzle' THEN 1 ELSE 0 END) AS has_puzzle "
        "FROM personal_errors pe JOIN personal_games pg ON pg.id = pe.personal_game_id "
        "WHERE pg.account_id = ? AND pg.username = ? GROUP BY pe.position_id",
        (account_id, username.lower()),
    ).fetchall()
    for r in rows:
        mode = "puzzle" if r["has_puzzle"] else "flashcard"
        db.upsert_personal_card(conn, username, int(r["pid"]), mode, account_id)
    conn.commit()
    return len(rows)


def next_personal_card(
    conn: sqlite3.Connection, username: str, account_id: int | None = None,
    exclude: tuple[int, ...] = (),
) -> sqlite3.Row | None:
    """Most-overdue personal card, else the highest-priority new one (M24).

    New cards are ordered by the M24 training priority (occurrences × peer frequency ×
    eval loss × time since review) instead of raw criticality. ``exclude`` skips card
    ids passed this session.
    """
    from .personal import ranked_priorities  # local import avoids a module cycle

    if account_id is None:
        account_id = db.ensure_local_account(conn)
    user = username.lower()
    due = [r for r in conn.execute(
        "SELECT * FROM personal_cards WHERE account_id = ? AND username = ? "
        "AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date ASC",
        (account_id, user, db.today_iso()),
    ).fetchall() if int(r["id"]) not in exclude]
    if due:
        return due[0]

    for ranked in ranked_priorities(conn, username, account_id=account_id):
        card = conn.execute(
            "SELECT * FROM personal_cards WHERE account_id = ? AND username = ? "
            "AND position_id = ? AND due_date IS NULL",
            (account_id, user, ranked["position_id"]),
        ).fetchone()
        if card is not None and int(card["id"]) not in exclude:
            return card
    return None


def remaining_personal_cards(
    conn: sqlite3.Connection, username: str, account_id: int | None = None
) -> int:
    """Today's queue size for a personal deck, same filter as ``next_personal_card``."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    return conn.execute(
        "SELECT COUNT(*) FROM personal_cards WHERE account_id = ? AND username = ? "
        "AND (due_date IS NULL OR due_date <= ?)",
        (account_id, username.lower(), db.today_iso()),
    ).fetchone()[0]


def grade_personal(conn: sqlite3.Connection, card_id: int, quality: int) -> int:
    card = db.get_personal_card(conn, card_id)
    if card is None:
        raise ValueError(f"no personal card {card_id}")
    ease, interval, reps, lapses_delta = sm2(
        card["ease"], card["interval_days"], card["reps"], quality
    )
    due = _due_after(quality, interval)
    db.update_personal_card_sr(
        conn, card_id,
        ease=ease, interval_days=interval, reps=reps,
        lapses=card["lapses"] + lapses_delta, due_date=due,
    )
    return interval
