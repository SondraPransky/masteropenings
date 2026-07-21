"""SQLite access layer — the single base (D10).

`positions` is deduplicated by FEN-4 (D7). Every other table hangs off it. All helpers
here are thin: business logic lives in the pipeline modules.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def today_iso() -> str:
    return date.today().isoformat()


def connect(db_path: "str | Path") -> sqlite3.Connection:
    """Open a connection with foreign keys on and Row access by column name.

    Uses WAL journalling and a busy timeout so concurrent processes (e.g. a second
    analysis, or a read-only inspection) share the cache safely instead of hitting
    "database is locked".
    """
    conn = sqlite3.connect(str(db_path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    try:
        conn.execute("PRAGMA journal_mode = WAL")
    except sqlite3.OperationalError:
        pass  # e.g. :memory: — plain journal is fine
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """Create all tables/indices if they do not exist, and migrate older databases."""
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    _migrate(conn)
    conn.commit()


def _migrate(conn: sqlite3.Connection) -> None:
    """Add columns introduced after a database was first created."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(positions)")}
    if "explorer_fetched_at" not in cols:
        conn.execute("ALTER TABLE positions ADD COLUMN explorer_fetched_at TEXT")
    if "best_pv" not in cols:
        conn.execute("ALTER TABLE positions ADD COLUMN best_pv TEXT")
    pg_cols = {r["name"] for r in conn.execute("PRAGMA table_info(personal_games)")}
    if pg_cols and "territory_positions" not in pg_cols:
        conn.execute(
            "ALTER TABLE personal_games ADD COLUMN territory_positions INTEGER NOT NULL "
            "DEFAULT 0"
        )
    rl_cols = {r["name"] for r in conn.execute("PRAGMA table_info(review_log)")}
    if rl_cols and "student_id" not in rl_cols:      # review_log predates the coach→student loop
        conn.execute("ALTER TABLE review_log ADD COLUMN student_id INTEGER")
    if rl_cols:                                      # index built here (column now guaranteed)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reviewlog_student "
                     "ON review_log (student_id)")
    _migrate_sr_cards_to_per_path(conn)
    _migrate_account_isolation(conn)


# The implicit single-user account. In local mode (OA_REQUIRE_LOGIN off) every request runs
# as this account; a stored hash of "!" can never match a PBKDF2 verification, so it cannot be
# logged into over the web.
# Single source of truth for the implicit account's username: the migration, _resolve_account,
# the CLI, and the web local-mode path all resolve through here, so they never disagree about
# which account owns pre-isolation data. Overridable via OA_LOCAL_ACCOUNT.
LOCAL_ACCOUNT = os.environ.get("OA_LOCAL_ACCOUNT", "local")
_UNUSABLE_PASSWORD_HASH = "!"


def ensure_local_account(conn: sqlite3.Connection, username: str = LOCAL_ACCOUNT) -> int:
    """Return the id of the implicit local account, creating it (login-disabled) if absent."""
    username = username.strip().lower()
    row = conn.execute("SELECT id FROM accounts WHERE username = ?", (username,)).fetchone()
    if row is not None:
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO accounts (username, email, password_hash, created_at) "
        "VALUES (?, ?, ?, ?)",
        (username, None, _UNUSABLE_PASSWORD_HASH, now_iso()),
    )
    return int(cur.lastrowid)


def _resolve_account(conn: sqlite3.Connection, account_id: int | None) -> int:
    """An explicit account id, or the implicit local account for single-user callers."""
    return account_id if account_id is not None else ensure_local_account(conn)


def _migrate_account_isolation(conn: sqlite3.Connection) -> None:
    """Stage 1 (docs/HOSTING.md): scope owned tables per account. Add ``account_id`` to the
    root owned tables, assign every legacy row to the implicit local account, and tighten
    uniqueness to be per-account. Idempotent — safe to run on an already-migrated DB."""
    local_id = ensure_local_account(conn)
    for table in ("chapters", "personal_games", "personal_cards", "eecoach_failures"):
        info = list(conn.execute(f"PRAGMA table_info({table})"))
        if not info:
            continue
        if "account_id" not in {r["name"] for r in info}:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN account_id INTEGER")
            conn.execute(
                f"UPDATE {table} SET account_id = ? WHERE account_id IS NULL", (local_id,)
            )
    _rebuild_unique(conn, "chapters", "UNIQUE (account_id, name)", """
        CREATE TABLE chapters_new (
            id          INTEGER PRIMARY KEY,
            account_id  INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            source_file TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            UNIQUE (account_id, name)
        );
        INSERT INTO chapters_new (id, account_id, name, source_file, created_at)
            SELECT id, account_id, name, source_file, created_at FROM chapters;
        DROP TABLE chapters;
        ALTER TABLE chapters_new RENAME TO chapters;
        CREATE INDEX IF NOT EXISTS idx_chapters_account ON chapters (account_id);
    """)
    _rebuild_unique(conn, "personal_cards", "UNIQUE (account_id, username, position_id)", """
        CREATE TABLE personal_cards_new (
            id            INTEGER PRIMARY KEY,
            account_id    INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
            username      TEXT    NOT NULL,
            position_id   INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
            mode          TEXT    NOT NULL,
            ease          REAL    NOT NULL DEFAULT 2.5,
            interval_days INTEGER NOT NULL DEFAULT 0,
            reps          INTEGER NOT NULL DEFAULT 0,
            lapses        INTEGER NOT NULL DEFAULT 0,
            due_date      TEXT,
            last_review   TEXT,
            created_at    TEXT NOT NULL,
            UNIQUE (account_id, username, position_id)
        );
        INSERT INTO personal_cards_new
            (id, account_id, username, position_id, mode, ease, interval_days, reps,
             lapses, due_date, last_review, created_at)
            SELECT id, account_id, username, position_id, mode, ease, interval_days, reps,
                   lapses, due_date, last_review, created_at FROM personal_cards;
        DROP TABLE personal_cards;
        ALTER TABLE personal_cards_new RENAME TO personal_cards;
        CREATE INDEX IF NOT EXISTS idx_pcards_user_due ON personal_cards (username, due_date);
    """)
    # account_id indexes live here (not in schema.sql): the column is now guaranteed present
    # on both fresh and migrated DBs, so these run safely for both.
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chapters_account ON chapters (account_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pgames_account "
                 "ON personal_games (account_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_eecoach_account "
                 "ON eecoach_failures (account_id)")


def _rebuild_unique(
    conn: sqlite3.Connection, table: str, marker: str, script: str
) -> None:
    """Rebuild ``table`` via ``script`` unless its CREATE SQL already carries ``marker`` (the
    new per-account UNIQUE). Same swap dance as the sr_cards rebuild — FKs off, ids preserved."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    if not row or marker in (row["sql"] or ""):
        return
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.executescript(script)
    conn.execute("PRAGMA foreign_keys = ON")


def _migrate_sr_cards_to_per_path(conn: sqlite3.Connection) -> None:
    """Rebuild sr_cards to be keyed per path (D15). Existing cards keep their SM-2 state,
    backfilling path_id with the shortest path reaching their position in the chapter."""
    sr_cols = {r["name"] for r in conn.execute("PRAGMA table_info(sr_cards)")}
    if not sr_cols or "path_id" in sr_cols:
        return
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.executescript(
        """
        CREATE TABLE sr_cards_new (
            id            INTEGER PRIMARY KEY,
            position_id   INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
            chapter_id    INTEGER NOT NULL REFERENCES chapters (id) ON DELETE CASCADE,
            path_id       INTEGER REFERENCES paths (id) ON DELETE CASCADE,
            mode          TEXT    NOT NULL,
            ease          REAL    NOT NULL DEFAULT 2.5,
            interval_days INTEGER NOT NULL DEFAULT 0,
            reps          INTEGER NOT NULL DEFAULT 0,
            lapses        INTEGER NOT NULL DEFAULT 0,
            due_date      TEXT,
            last_review   TEXT,
            created_at    TEXT NOT NULL,
            UNIQUE (chapter_id, path_id)
        );
        INSERT INTO sr_cards_new
            (id, position_id, chapter_id, path_id, mode, ease, interval_days, reps,
             lapses, due_date, last_review, created_at)
        SELECT c.id, c.position_id, c.chapter_id,
               (SELECT p.id FROM paths p
                 WHERE p.chapter_id = c.chapter_id AND p.position_id = c.position_id
                 ORDER BY p.ply ASC LIMIT 1),
               c.mode, c.ease, c.interval_days, c.reps, c.lapses, c.due_date,
               c.last_review, c.created_at
          FROM sr_cards c;
        DROP TABLE sr_cards;
        ALTER TABLE sr_cards_new RENAME TO sr_cards;
        CREATE INDEX IF NOT EXISTS idx_cards_chapter_due ON sr_cards (chapter_id, due_date);
        """
    )
    conn.execute("PRAGMA foreign_keys = ON")


# ---------------------------------------------------------------------------
# positions
# ---------------------------------------------------------------------------
def upsert_position(conn: sqlite3.Connection, fen4: str, side_to_move: str) -> int:
    """Insert a position if new (dedup by FEN-4); return its id either way."""
    row = conn.execute("SELECT id FROM positions WHERE fen4 = ?", (fen4,)).fetchone()
    if row is not None:
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO positions (fen4, side_to_move) VALUES (?, ?)",
        (fen4, side_to_move),
    )
    return int(cur.lastrowid)


def get_position_by_fen(conn: sqlite3.Connection, fen4: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM positions WHERE fen4 = ?", (fen4,)).fetchone()


def get_position(conn: sqlite3.Connection, position_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM positions WHERE id = ?", (position_id,)).fetchone()


def set_position_eval(
    conn: sqlite3.Connection,
    position_id: int,
    *,
    best_move_uci: str | None,
    best_move_san: str | None,
    eval_cp: int | None,
    eval_mate: int | None,
    eval_depth: int | None,
    eval_source: str | None,
    best_pv: str | None = None,
) -> None:
    # COALESCE keeps any previously stored PV when a caller re-evals without one.
    conn.execute(
        """
        UPDATE positions
           SET best_move_uci = ?, best_move_san = ?, eval_cp = ?, eval_mate = ?,
               eval_depth = ?, eval_source = ?, eval_fetched_at = ?,
               best_pv = COALESCE(?, best_pv)
         WHERE id = ?
        """,
        (
            best_move_uci, best_move_san, eval_cp, eval_mate,
            eval_depth, eval_source, now_iso(), best_pv, position_id,
        ),
    )


def mark_explorer_fetched(conn: sqlite3.Connection, position_id: int) -> None:
    conn.execute(
        "UPDATE positions SET explorer_fetched_at = ? WHERE id = ?",
        (now_iso(), position_id),
    )


def explorer_done(conn: sqlite3.Connection, position_id: int) -> bool:
    row = conn.execute(
        "SELECT explorer_fetched_at FROM positions WHERE id = ?", (position_id,)
    ).fetchone()
    return row is not None and row["explorer_fetched_at"] is not None


def set_position_opening(
    conn: sqlite3.Connection, position_id: int, eco: str | None, name: str | None
) -> None:
    conn.execute(
        "UPDATE positions SET opening_eco = COALESCE(?, opening_eco), "
        "opening_name = COALESCE(?, opening_name) WHERE id = ?",
        (eco, name, position_id),
    )


# ---------------------------------------------------------------------------
# chapters
# ---------------------------------------------------------------------------
def upsert_chapter(
    conn: sqlite3.Connection, name: str, source_file: str, account_id: int | None = None
) -> int:
    """Insert a chapter for this account if new (names are unique per account); return its id.
    ``account_id`` defaults to the implicit local account (single-user callers)."""
    account_id = _resolve_account(conn, account_id)
    row = conn.execute(
        "SELECT id FROM chapters WHERE account_id = ? AND name = ?", (account_id, name)
    ).fetchone()
    if row is not None:
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO chapters (account_id, name, source_file, created_at) VALUES (?, ?, ?, ?)",
        (account_id, name, source_file, now_iso()),
    )
    return int(cur.lastrowid)


def get_chapter(
    conn: sqlite3.Connection, chapter_id: int, account_id: int | None = None
) -> sqlite3.Row | None:
    """A chapter by id, but only if it belongs to ``account_id`` (the ownership gate)."""
    account_id = _resolve_account(conn, account_id)
    return conn.execute(
        "SELECT * FROM chapters WHERE id = ? AND account_id = ?", (chapter_id, account_id)
    ).fetchone()


def chapters_for_account(
    conn: sqlite3.Connection, account_id: int | None = None
) -> list[sqlite3.Row]:
    account_id = _resolve_account(conn, account_id)
    return conn.execute(
        "SELECT * FROM chapters WHERE account_id = ? ORDER BY name ASC", (account_id,)
    ).fetchall()


# ---------------------------------------------------------------------------
# paths
# ---------------------------------------------------------------------------
def upsert_path(
    conn: sqlite3.Connection,
    chapter_id: int,
    position_id: int,
    ply: int,
    move_sequence: str,
    parent_path_id: int | None,
) -> int:
    row = conn.execute(
        "SELECT id FROM paths WHERE chapter_id = ? AND move_sequence = ?",
        (chapter_id, move_sequence),
    ).fetchone()
    if row is not None:
        return int(row["id"])
    cur = conn.execute(
        """
        INSERT INTO paths (chapter_id, position_id, ply, move_sequence, parent_path_id)
        VALUES (?, ?, ?, ?, ?)
        """,
        (chapter_id, position_id, ply, move_sequence, parent_path_id),
    )
    return int(cur.lastrowid)


# ---------------------------------------------------------------------------
# position_stats
# ---------------------------------------------------------------------------
def replace_stats_for_bucket(
    conn: sqlite3.Connection, position_id: int, elo_bucket: int, rows: list[dict]
) -> None:
    """Replace all stat rows for a (position, bucket) with a fresh set."""
    conn.execute(
        "DELETE FROM position_stats WHERE position_id = ? AND elo_bucket = ?",
        (position_id, elo_bucket),
    )
    conn.executemany(
        """
        INSERT INTO position_stats
            (position_id, elo_bucket, move_uci, move_san, games, white, draws, black,
             win_pct, draw_pct, loss_pct, avg_rating)
        VALUES
            (:position_id, :elo_bucket, :move_uci, :move_san, :games, :white, :draws,
             :black, :win_pct, :draw_pct, :loss_pct, :avg_rating)
        """,
        [{"position_id": position_id, "elo_bucket": elo_bucket, **r} for r in rows],
    )


def get_stats(
    conn: sqlite3.Connection, position_id: int, elo_bucket: int
) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM position_stats WHERE position_id = ? AND elo_bucket = ? "
        "ORDER BY games DESC",
        (position_id, elo_bucket),
    ).fetchall()


def followable_moves(
    conn: sqlite3.Connection, position_id: int, min_games: int
) -> list[str]:
    """UCI moves whose total games (summed over buckets) reach ``min_games``.

    Lets a resumed prefetch decide which children to follow from the cache, without a
    network call.
    """
    rows = conn.execute(
        "SELECT move_uci, SUM(games) AS g FROM position_stats "
        "WHERE position_id = ? GROUP BY move_uci HAVING g >= ? ORDER BY g DESC",
        (position_id, min_games),
    ).fetchall()
    return [r["move_uci"] for r in rows]


def has_stats(conn: sqlite3.Connection, position_id: int, elo_bucket: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM position_stats WHERE position_id = ? AND elo_bucket = ? LIMIT 1",
        (position_id, elo_bucket),
    ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# errors
# ---------------------------------------------------------------------------
def upsert_error(conn: sqlite3.Connection, error: dict) -> int:
    """Insert or replace one error row (unique per position × bucket × mistake move)."""
    cur = conn.execute(
        """
        INSERT INTO errors
            (position_id, chapter_id, path_id, elo_bucket, best_move_uci, best_move_san,
             mistake_move_uci, mistake_move_san, mistake_games, mistake_frequency,
             eval_loss_cp, delta_winrate, criticality, error_type, created_at)
        VALUES
            (:position_id, :chapter_id, :path_id, :elo_bucket, :best_move_uci,
             :best_move_san, :mistake_move_uci, :mistake_move_san, :mistake_games,
             :mistake_frequency, :eval_loss_cp, :delta_winrate, :criticality,
             :error_type, :created_at)
        ON CONFLICT (position_id, elo_bucket, mistake_move_uci) DO UPDATE SET
             chapter_id        = excluded.chapter_id,
             path_id           = excluded.path_id,
             best_move_uci     = excluded.best_move_uci,
             best_move_san     = excluded.best_move_san,
             mistake_move_san  = excluded.mistake_move_san,
             mistake_games     = excluded.mistake_games,
             mistake_frequency = excluded.mistake_frequency,
             eval_loss_cp      = excluded.eval_loss_cp,
             delta_winrate     = excluded.delta_winrate,
             criticality       = excluded.criticality,
             error_type        = excluded.error_type,
             created_at        = excluded.created_at
        """,
        {"created_at": now_iso(), **error},
    )
    return int(cur.lastrowid)


# ---------------------------------------------------------------------------
# sr_cards (spaced-repetition trainer)
# ---------------------------------------------------------------------------
def upsert_card(
    conn: sqlite3.Connection, position_id: int, chapter_id: int, path_id: int, mode: str
) -> int:
    """Insert a card for a (chapter, path) if absent; return its id (D15: one per path)."""
    row = conn.execute(
        "SELECT id FROM sr_cards WHERE chapter_id = ? AND path_id = ?",
        (chapter_id, path_id),
    ).fetchone()
    if row is not None:
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO sr_cards (position_id, chapter_id, path_id, mode, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (position_id, chapter_id, path_id, mode, now_iso()),
    )
    return int(cur.lastrowid)


def paths_for_position(
    conn: sqlite3.Connection, chapter_id: int, position_id: int
) -> list[sqlite3.Row]:
    """All paths in a chapter that reach a position (a transposition has several), by ply."""
    return conn.execute(
        "SELECT id, move_sequence, ply FROM paths WHERE chapter_id = ? AND position_id = ? "
        "ORDER BY ply ASC, id ASC",
        (chapter_id, position_id),
    ).fetchall()


def get_card(conn: sqlite3.Connection, card_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM sr_cards WHERE id = ?", (card_id,)).fetchone()


def count_cards(conn: sqlite3.Connection, chapter_id: int) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM sr_cards WHERE chapter_id = ?", (chapter_id,)
    ).fetchone()[0]


def update_card_sr(
    conn: sqlite3.Connection,
    card_id: int,
    *,
    ease: float,
    interval_days: int,
    reps: int,
    lapses: int,
    due_date: str,
) -> None:
    conn.execute(
        "UPDATE sr_cards SET ease = ?, interval_days = ?, reps = ?, lapses = ?, "
        "due_date = ?, last_review = ? WHERE id = ?",
        (ease, interval_days, reps, lapses, due_date, today_iso(), card_id),
    )
    conn.commit()


# --- Option B: per-mistake punish deck (mirrors the sr_cards helpers) -----------
def upsert_punish_card(
    conn: sqlite3.Connection, position_id: int, chapter_id: int, path_id: int, mistake_uci: str
) -> int:
    """Insert a punish card for a (chapter, path, opponent-mistake) if absent; return its id."""
    row = conn.execute(
        "SELECT id FROM punish_cards WHERE chapter_id = ? AND path_id = ? AND mistake_uci = ?",
        (chapter_id, path_id, mistake_uci),
    ).fetchone()
    if row is not None:
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO punish_cards (position_id, chapter_id, path_id, mistake_uci, mode, created_at) "
        "VALUES (?, ?, ?, ?, 'punish', ?)",
        (position_id, chapter_id, path_id, mistake_uci, now_iso()),
    )
    return int(cur.lastrowid)


def get_punish_card(conn: sqlite3.Connection, card_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM punish_cards WHERE id = ?", (card_id,)).fetchone()


def count_punish_cards(conn: sqlite3.Connection, chapter_id: int) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM punish_cards WHERE chapter_id = ?", (chapter_id,)
    ).fetchone()[0]


_SR_TABLES = {"sr_cards", "punish_cards", "personal_cards"}


def restore_card_sr(
    conn: sqlite3.Connection, table: str, card_id: int, *,
    ease: float, interval_days: int, reps: int, lapses: int,
    due_date: str | None, last_review: str | None,
) -> None:
    """Undo one SM-2 review: put a card's scheduling fields back to a snapshot captured
    before the grade (« Annuler la note »). ``table`` is a code constant, whitelisted."""
    if table not in _SR_TABLES:
        raise ValueError(table)
    conn.execute(
        f"UPDATE {table} SET ease = ?, interval_days = ?, reps = ?, lapses = ?, "
        "due_date = ?, last_review = ? WHERE id = ?",
        (ease, interval_days, reps, lapses, due_date, last_review, card_id),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# review_log (P4): append-only journal of every SM-2 review.
# ---------------------------------------------------------------------------
def log_review(conn: sqlite3.Connection, row: dict) -> int:
    """Append one review to the journal. ``row`` carries account_id, deck, grade,
    reviewed_at (required) plus optional chapter_id/username/card_id/position_id/
    elo_bucket/mode/quality/response_ms. Never overwrites — this is history."""
    cur = conn.execute(
        """
        INSERT INTO review_log
            (account_id, student_id, deck, chapter_id, username, card_id, position_id,
             elo_bucket, mode, grade, quality, response_ms, reviewed_at)
        VALUES
            (:account_id, :student_id, :deck, :chapter_id, :username, :card_id, :position_id,
             :elo_bucket, :mode, :grade, :quality, :response_ms, :reviewed_at)
        """,
        {"student_id": None, "chapter_id": None, "username": None, "card_id": None,
         "position_id": None, "elo_bucket": None, "mode": None, "quality": None,
         "response_ms": None, **row},
    )
    conn.commit()
    return int(cur.lastrowid)


def delete_last_review(
    conn: sqlite3.Connection, account_id: int, deck: str, card_id: int
) -> None:
    """Remove the most recent journal row for a card (the symmetric pardon of « Annuler la
    dernière note » — an undone grade must not leave a ghost review in the history)."""
    conn.execute(
        "DELETE FROM review_log WHERE id = (SELECT id FROM review_log "
        "WHERE account_id = ? AND deck = ? AND card_id = ? ORDER BY id DESC LIMIT 1)",
        (account_id, deck, card_id),
    )
    conn.commit()


def account_has_reviews(conn: sqlite3.Connection, account_id: int) -> bool:
    """True if the account has logged at least one of its OWN reviews (student_id NULL) —
    gates the home « Ma progression » link, which shows the coach's own training only."""
    return conn.execute(
        "SELECT 1 FROM review_log WHERE account_id = ? AND student_id IS NULL LIMIT 1",
        (account_id,)
    ).fetchone() is not None


_STUDENT_UNSET = object()   # sentinel: distinguishes "any student" from "student_id IS NULL"


def reviews_for_account(
    conn: sqlite3.Connection, account_id: int, *, chapter_id: int | None = None,
    username: str | None = None, student_id=_STUDENT_UNSET,
) -> list[sqlite3.Row]:
    """All journal rows for an account, oldest first; optionally scoped to a deck target or a
    student. ``student_id=None`` means the coach's own free training (rows with no student);
    omitting it means any student."""
    sql = "SELECT * FROM review_log WHERE account_id = ?"
    params: list = [account_id]
    if chapter_id is not None:
        sql += " AND chapter_id = ?"
        params.append(chapter_id)
    if username is not None:
        sql += " AND username = ?"
        params.append(username)
    if student_id is not _STUDENT_UNSET:
        if student_id is None:
            sql += " AND student_id IS NULL"
        else:
            sql += " AND student_id = ?"
            params.append(student_id)
    sql += " ORDER BY reviewed_at ASC, id ASC"
    return conn.execute(sql, params).fetchall()


# ---------------------------------------------------------------------------
# coach → student loop: roster + assignments.
# ---------------------------------------------------------------------------
def add_student(
    conn: sqlite3.Connection, account_id: int, name: str, elo_bucket: int | None = None
) -> int:
    """Add a student to the coach's roster (names unique per coach); return its id."""
    cur = conn.execute(
        "INSERT INTO students (account_id, name, elo_bucket, created_at) VALUES (?, ?, ?, ?)",
        (account_id, name.strip(), elo_bucket, now_iso()),
    )
    conn.commit()
    return int(cur.lastrowid)


def students_for_account(conn: sqlite3.Connection, account_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM students WHERE account_id = ? ORDER BY name COLLATE NOCASE",
        (account_id,),
    ).fetchall()


def get_student(
    conn: sqlite3.Connection, student_id: int, account_id: int
) -> sqlite3.Row | None:
    """A student by id, only if it belongs to this coach (the ownership gate)."""
    return conn.execute(
        "SELECT * FROM students WHERE id = ? AND account_id = ?", (student_id, account_id)
    ).fetchone()


def add_assignment(
    conn: sqlite3.Connection, row: dict, items: "list[int] | None" = None
) -> int:
    """Create an assignment (coach → student, a chapter to train at a level, optional due).
    ``items`` = the specific decision-point position ids; empty/None means the whole chapter."""
    cur = conn.execute(
        """
        INSERT INTO assignments
            (account_id, student_id, chapter_id, elo_bucket, title, note, due_date, created_at)
        VALUES
            (:account_id, :student_id, :chapter_id, :elo_bucket, :title, :note, :due_date,
             :created_at)
        """,
        {"elo_bucket": None, "title": None, "note": None, "due_date": None,
         "created_at": now_iso(), **row},
    )
    aid = int(cur.lastrowid)
    for pid in items or ():
        conn.execute(
            "INSERT OR IGNORE INTO assignment_items (assignment_id, position_id) VALUES (?, ?)",
            (aid, int(pid)),
        )
    conn.commit()
    return aid


def get_assignment(
    conn: sqlite3.Connection, assignment_id: int, account_id: int
) -> sqlite3.Row | None:
    """An assignment by id, only if it belongs to this coach (ownership gate)."""
    return conn.execute(
        "SELECT * FROM assignments WHERE id = ? AND account_id = ?",
        (assignment_id, account_id),
    ).fetchone()


def assignment_position_ids(conn: sqlite3.Connection, assignment_id: int) -> set[int]:
    """The position ids of an assignment's items (empty set = the whole chapter)."""
    return {int(r["position_id"]) for r in conn.execute(
        "SELECT position_id FROM assignment_items WHERE assignment_id = ?", (assignment_id,)
    )}


def chapter_card_positions(conn: sqlite3.Connection, chapter_id: int) -> set[int]:
    """Distinct decision-point positions that have a training card in this chapter."""
    return {int(r["position_id"]) for r in conn.execute(
        "SELECT DISTINCT position_id FROM sr_cards WHERE chapter_id = ?", (chapter_id,)
    )}


def student_reviewed_positions(
    conn: sqlite3.Connection, account_id: int, student_id: int, chapter_id: int
) -> set[int]:
    """Positions a student has reviewed at least once in a chapter (assignment coverage)."""
    return {int(r["position_id"]) for r in conn.execute(
        "SELECT DISTINCT position_id FROM review_log WHERE account_id = ? AND student_id = ? "
        "AND chapter_id = ? AND position_id IS NOT NULL",
        (account_id, student_id, chapter_id)
    )}


def assignments_for_student(
    conn: sqlite3.Connection, student_id: int
) -> list[sqlite3.Row]:
    """A student's assignments, newest first, with the chapter name joined in."""
    return conn.execute(
        "SELECT a.*, ch.name AS chapter_name FROM assignments a "
        "JOIN chapters ch ON ch.id = a.chapter_id "
        "WHERE a.student_id = ? ORDER BY a.created_at DESC, a.id DESC",
        (student_id,),
    ).fetchall()


def delete_assignment(conn: sqlite3.Connection, assignment_id: int, account_id: int) -> None:
    conn.execute(
        "DELETE FROM assignments WHERE id = ? AND account_id = ?", (assignment_id, account_id)
    )
    conn.commit()


def student_blockers(
    conn: sqlite3.Connection, account_id: int, student_id: int, limit: int = 5
) -> list[sqlite3.Row]:
    """Positions this student misses most (grade 'again'), worst first — what to revisit."""
    return conn.execute(
        "SELECT position_id, COUNT(*) AS lapses FROM review_log "
        "WHERE account_id = ? AND student_id = ? AND grade = 'again' "
        "AND position_id IS NOT NULL GROUP BY position_id "
        "ORDER BY lapses DESC, position_id ASC LIMIT ?",
        (account_id, student_id, limit),
    ).fetchall()


def student_review_count(
    conn: sqlite3.Connection, account_id: int, student_id: int, chapter_id: int
) -> int:
    """How many reviews this student has logged for a chapter (assignment progress signal)."""
    return int(conn.execute(
        "SELECT COUNT(*) FROM review_log WHERE account_id = ? AND student_id = ? "
        "AND chapter_id = ?", (account_id, student_id, chapter_id)).fetchone()[0])


def update_punish_card_sr(
    conn: sqlite3.Connection, card_id: int, *, ease: float, interval_days: int,
    reps: int, lapses: int, due_date: str,
) -> None:
    conn.execute(
        "UPDATE punish_cards SET ease = ?, interval_days = ?, reps = ?, lapses = ?, "
        "due_date = ?, last_review = ? WHERE id = ?",
        (ease, interval_days, reps, lapses, due_date, today_iso(), card_id),
    )
    conn.commit()


def errors_for_chapter(conn: sqlite3.Connection, chapter_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT e.*, p.fen4 AS fen4
          FROM errors e
          JOIN positions p ON p.id = e.position_id
         WHERE e.chapter_id = ?
         ORDER BY e.criticality DESC NULLS LAST, e.eval_loss_cp DESC
        """,
        (chapter_id,),
    ).fetchall()


# ---------------------------------------------------------------------------
# personal layer (D16)
# ---------------------------------------------------------------------------
def find_catalogued_error(
    conn: sqlite3.Connection, position_id: int, mistake_uci: str, bucket: int | None
) -> sqlite3.Row | None:
    """A catalogued error for this (position, move). Prefer the player's Elo bucket, else
    the highest-criticality row at any bucket (so a known-bad move is still caught)."""
    if bucket is not None:
        row = conn.execute(
            "SELECT * FROM errors WHERE position_id = ? AND mistake_move_uci = ? "
            "AND elo_bucket = ?",
            (position_id, mistake_uci, bucket),
        ).fetchone()
        if row is not None:
            return row
    return conn.execute(
        "SELECT * FROM errors WHERE position_id = ? AND mistake_move_uci = ? "
        "ORDER BY criticality DESC NULLS LAST LIMIT 1",
        (position_id, mistake_uci),
    ).fetchone()


def insert_personal_game(conn: sqlite3.Connection, game: dict) -> int:
    game = {**game, "account_id": _resolve_account(conn, game.get("account_id"))}
    cur = conn.execute(
        """
        INSERT INTO personal_games
            (account_id, source, username, player_color, player_elo, white, black, result,
             date, event, imported_at)
        VALUES
            (:account_id, :source, :username, :player_color, :player_elo, :white, :black,
             :result, :date, :event, :imported_at)
        """,
        {"imported_at": now_iso(), **game},
    )
    return int(cur.lastrowid)


def insert_personal_error(conn: sqlite3.Connection, error: dict) -> int:
    cur = conn.execute(
        """
        INSERT INTO personal_errors
            (personal_game_id, position_id, error_id, ply, played_uci, played_san,
             best_move_uci, best_move_san, eval_loss_cp, criticality, elo_bucket,
             error_type, created_at)
        VALUES
            (:personal_game_id, :position_id, :error_id, :ply, :played_uci, :played_san,
             :best_move_uci, :best_move_san, :eval_loss_cp, :criticality, :elo_bucket,
             :error_type, :created_at)
        """,
        {"created_at": now_iso(), **error},
    )
    return int(cur.lastrowid)


def set_personal_game_territory(
    conn: sqlite3.Connection, game_id: int, territory: int
) -> None:
    """Record how many player-to-move positions of this game were in analysed territory."""
    conn.execute(
        "UPDATE personal_games SET territory_positions = ? WHERE id = ?",
        (territory, game_id),
    )


def personal_games_for_user(
    conn: sqlite3.Connection, username: str, account_id: int | None = None
) -> list[sqlite3.Row]:
    account_id = _resolve_account(conn, account_id)
    return conn.execute(
        "SELECT * FROM personal_games WHERE account_id = ? AND username = ? "
        "ORDER BY date ASC, id ASC",
        (account_id, username.lower()),
    ).fetchall()


def personal_priority_rows(
    conn: sqlite3.Connection, username: str, account_id: int | None = None
) -> list[sqlite3.Row]:
    """One row per distinct (position) the user erred at, with the ingredients M24 needs:

    - ``occurrences``: how many times the player made *any* catalogued mistake here;
    - ``peer_frequency``: how often peers play the worst move here (from the linked error);
    - ``eval_loss_cp``: the worst eval loss recorded;
    - ``last_review`` / ``due_date``: SM-2 recency from the personal card (if any).
    """
    account_id = _resolve_account(conn, account_id)
    return conn.execute(
        """
        SELECT pe.position_id                      AS position_id,
               COUNT(pe.id)                         AS occurrences,
               MAX(COALESCE(e.mistake_frequency, 0)) AS peer_frequency,
               MAX(COALESCE(pe.eval_loss_cp, 0))    AS eval_loss_cp,
               MAX(pe.criticality)                  AS peak_criticality,
               MAX(pe.played_san)                   AS played_san,
               MAX(pe.best_move_san)                AS best_move_san,
               MAX(pe.elo_bucket)                   AS elo_bucket,
               pc.last_review                       AS last_review,
               pc.due_date                          AS due_date
          FROM personal_errors pe
          JOIN personal_games pg ON pg.id = pe.personal_game_id
          LEFT JOIN errors e ON e.id = pe.error_id
          LEFT JOIN personal_cards pc
                 ON pc.account_id = pg.account_id AND pc.username = pg.username
                AND pc.position_id = pe.position_id
         WHERE pg.account_id = ? AND pg.username = ?
         GROUP BY pe.position_id
        """,
        (account_id, username.lower()),
    ).fetchall()


def upsert_personal_card(
    conn: sqlite3.Connection, username: str, position_id: int, mode: str,
    account_id: int | None = None,
) -> int:
    account_id = _resolve_account(conn, account_id)
    row = conn.execute(
        "SELECT id FROM personal_cards WHERE account_id = ? AND username = ? "
        "AND position_id = ?",
        (account_id, username.lower(), position_id),
    ).fetchone()
    if row is not None:
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO personal_cards (account_id, username, position_id, mode, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (account_id, username.lower(), position_id, mode, now_iso()),
    )
    return int(cur.lastrowid)


def get_personal_card(conn: sqlite3.Connection, card_id: int) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM personal_cards WHERE id = ?", (card_id,)
    ).fetchone()


def count_personal_cards(
    conn: sqlite3.Connection, username: str, account_id: int | None = None
) -> int:
    account_id = _resolve_account(conn, account_id)
    return conn.execute(
        "SELECT COUNT(*) FROM personal_cards WHERE account_id = ? AND username = ?",
        (account_id, username.lower()),
    ).fetchone()[0]


def update_personal_card_sr(
    conn: sqlite3.Connection,
    card_id: int,
    *,
    ease: float,
    interval_days: int,
    reps: int,
    lapses: int,
    due_date: str,
) -> None:
    conn.execute(
        "UPDATE personal_cards SET ease = ?, interval_days = ?, reps = ?, lapses = ?, "
        "due_date = ?, last_review = ? WHERE id = ?",
        (ease, interval_days, reps, lapses, due_date, today_iso(), card_id),
    )
    conn.commit()


def insert_personal_deviation(conn: sqlite3.Connection, dev: dict) -> int:
    cur = conn.execute(
        """
        INSERT INTO personal_deviations
            (personal_game_id, position_id, ply, played_uci, played_san, best_move_san,
             eval_loss_cp, costly, created_at)
        VALUES
            (:personal_game_id, :position_id, :ply, :played_uci, :played_san,
             :best_move_san, :eval_loss_cp, :costly, :created_at)
        """,
        {"created_at": now_iso(), **dev},
    )
    return int(cur.lastrowid)


def personal_deviations_for_user(
    conn: sqlite3.Connection, username: str, account_id: int | None = None
) -> list[sqlite3.Row]:
    """A player's left-theory deviations, biggest eval loss first."""
    account_id = _resolve_account(conn, account_id)
    return conn.execute(
        """
        SELECT pd.*, p.fen4 AS fen4
          FROM personal_deviations pd
          JOIN personal_games pg ON pg.id = pd.personal_game_id
          JOIN positions p ON p.id = pd.position_id
         WHERE pg.account_id = ? AND pg.username = ?
         ORDER BY pd.costly DESC, pd.eval_loss_cp DESC
        """,
        (account_id, username.lower()),
    ).fetchall()


def insert_account(
    conn: sqlite3.Connection, username: str, password_hash: str, email: str | None
) -> int:
    cur = conn.execute(
        "INSERT INTO accounts (username, email, password_hash, created_at) "
        "VALUES (?, ?, ?, ?)",
        (username, email, password_hash, now_iso()),
    )
    return int(cur.lastrowid)


def get_account(conn: sqlite3.Connection, username: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM accounts WHERE username = ?", (username,)
    ).fetchone()


def peak_criticality_for_position(
    conn: sqlite3.Connection, position_id: int, bucket: int | None
) -> float | None:
    """The highest catalogued criticality at a position — prefer the student's bucket."""
    if bucket is not None:
        row = conn.execute(
            "SELECT MAX(criticality) AS c FROM errors WHERE position_id = ? "
            "AND elo_bucket = ?",
            (position_id, bucket),
        ).fetchone()
        if row and row["c"] is not None:
            return float(row["c"])
    row = conn.execute(
        "SELECT MAX(criticality) AS c FROM errors WHERE position_id = ?",
        (position_id,),
    ).fetchone()
    return float(row["c"]) if row and row["c"] is not None else None


def insert_eecoach_failure(conn: sqlite3.Connection, row: dict) -> int:
    row = {**row, "account_id": _resolve_account(conn, row.get("account_id"))}
    cur = conn.execute(
        """
        INSERT INTO eecoach_failures
            (account_id, student, rating, reviewed_at, position_id, fen4, expected_move,
             played_move, in_territory, elo_bucket, criticality, created_at)
        VALUES
            (:account_id, :student, :rating, :reviewed_at, :position_id, :fen4,
             :expected_move, :played_move, :in_territory, :elo_bucket, :criticality,
             :created_at)
        """,
        {"created_at": now_iso(), **row},
    )
    return int(cur.lastrowid)


def eecoach_students(
    conn: sqlite3.Connection, account_id: int | None = None
) -> list[sqlite3.Row]:
    account_id = _resolve_account(conn, account_id)
    return conn.execute(
        "SELECT student, COUNT(*) AS failures FROM eecoach_failures "
        "WHERE account_id = ? GROUP BY student ORDER BY failures DESC",
        (account_id,),
    ).fetchall()


def eecoach_failures_for_student(
    conn: sqlite3.Connection, student: str, account_id: int | None = None
) -> list[sqlite3.Row]:
    """A student's recall failures, most critical (of the analysed ones) first."""
    account_id = _resolve_account(conn, account_id)
    return conn.execute(
        "SELECT * FROM eecoach_failures WHERE account_id = ? AND student = ? "
        "ORDER BY criticality DESC NULLS LAST, reviewed_at ASC",
        (account_id, student),
    ).fetchall()


def users_with_personal_errors(
    conn: sqlite3.Connection, account_id: int | None = None
) -> list[sqlite3.Row]:
    account_id = _resolve_account(conn, account_id)
    return conn.execute(
        "SELECT pg.username AS username, COUNT(pe.id) AS errors "
        "FROM personal_games pg JOIN personal_errors pe ON pe.personal_game_id = pg.id "
        "WHERE pg.account_id = ? "
        "GROUP BY pg.username ORDER BY errors DESC",
        (account_id,),
    ).fetchall()


def personal_errors_for_user(
    conn: sqlite3.Connection, username: str, account_id: int | None = None
) -> list[sqlite3.Row]:
    account_id = _resolve_account(conn, account_id)
    return conn.execute(
        """
        SELECT pe.*, p.fen4 AS fen4
          FROM personal_errors pe
          JOIN personal_games pg ON pg.id = pe.personal_game_id
          JOIN positions p ON p.id = pe.position_id
         WHERE pg.account_id = ? AND pg.username = ?
         ORDER BY pe.criticality DESC NULLS LAST, pe.eval_loss_cp DESC
        """,
        (account_id, username.lower()),
    ).fetchall()
