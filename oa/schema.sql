-- Human Opening Analytics Platform — SQLite schema (D8/D10/D11).
-- One base, many views. `positions` is deduplicated by FEN-4 and carries the analysis;
-- `paths` carries repertoire context; a transposition = several paths -> one position.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- positions: deduplicated by FEN-4 (D7). Carries the eval / best move (D2/D5).
-- Includes both repertoire positions and child positions evaluated for detection.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS positions (
    id              INTEGER PRIMARY KEY,
    fen4            TEXT    NOT NULL UNIQUE,
    side_to_move    TEXT    NOT NULL,             -- 'w' | 'b'
    opening_eco     TEXT,                          -- metadata (Lichess), nullable
    opening_name    TEXT,                          -- metadata (Lichess), nullable
    best_move_uci   TEXT,
    best_move_san   TEXT,
    eval_cp         INTEGER,                       -- centipawns, White's point of view
    eval_mate       INTEGER,                       -- mate-in-N (White POV sign), nullable
    eval_depth      INTEGER,
    eval_source     TEXT,                          -- 'cloud' | 'stockfish' | 'dump'
    eval_fetched_at TEXT,
    best_pv         TEXT,                           -- engine principal variation (UCI, space-sep)
    explorer_fetched_at TEXT                        -- set once the 9 buckets are pulled
);

CREATE INDEX IF NOT EXISTS idx_positions_fen4 ON positions (fen4);

-- ---------------------------------------------------------------------------
-- chapters: one row per input PGN file = one opening module (D17).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chapters (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER REFERENCES accounts (id) ON DELETE CASCADE,  -- owner (Stage 1 isolation)
    name        TEXT NOT NULL,                     -- manual name, default = filename
    source_file TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (account_id, name)                       -- names are unique per account, not globally
);
-- Owned-table account_id indexes are created in db._migrate (after the column is guaranteed
-- present on legacy DBs), not here — a CREATE INDEX on account_id in this script would fail
-- against a pre-Stage-1 table that has not been migrated yet.

-- ---------------------------------------------------------------------------
-- paths: the graph of move sequences (D8). A path reaches one position via a
-- concrete move sequence within a chapter. Transpositions = several paths.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paths (
    id             INTEGER PRIMARY KEY,
    chapter_id     INTEGER NOT NULL REFERENCES chapters (id) ON DELETE CASCADE,
    position_id    INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
    ply            INTEGER NOT NULL,               -- distance from the root (0 = start)
    move_sequence  TEXT    NOT NULL,               -- space-separated UCI from the root
    parent_path_id INTEGER REFERENCES paths (id) ON DELETE SET NULL,
    UNIQUE (chapter_id, move_sequence)
);

CREATE INDEX IF NOT EXISTS idx_paths_position ON paths (position_id);
CREATE INDEX IF NOT EXISTS idx_paths_chapter  ON paths (chapter_id);

-- ---------------------------------------------------------------------------
-- position_stats: 9 buckets x moves per position (D11). Win/draw/loss are from
-- the side-to-move perspective. Cadence = rapid+classical merged.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS position_stats (
    id          INTEGER PRIMARY KEY,
    position_id INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
    elo_bucket  INTEGER NOT NULL,                  -- lower bound: 0,1000,...,2500
    move_uci    TEXT    NOT NULL,
    move_san    TEXT,
    games       INTEGER NOT NULL,
    white       INTEGER NOT NULL,                  -- games White won
    draws       INTEGER NOT NULL,
    black       INTEGER NOT NULL,                  -- games Black won
    win_pct     REAL    NOT NULL,                  -- side-to-move POV
    draw_pct    REAL    NOT NULL,
    loss_pct    REAL    NOT NULL,
    avg_rating  INTEGER,
    UNIQUE (position_id, elo_bucket, move_uci)
);

CREATE INDEX IF NOT EXISTS idx_stats_pos_bucket ON position_stats (position_id, elo_bucket);

-- ---------------------------------------------------------------------------
-- errors: detected costly human divergences (D4/D12/D13), scored by Criticality.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS errors (
    id                INTEGER PRIMARY KEY,
    position_id       INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
    chapter_id        INTEGER REFERENCES chapters (id) ON DELETE SET NULL,
    path_id           INTEGER REFERENCES paths (id) ON DELETE SET NULL,
    elo_bucket        INTEGER NOT NULL,
    best_move_uci     TEXT,
    best_move_san     TEXT,
    mistake_move_uci  TEXT NOT NULL,
    mistake_move_san  TEXT,
    mistake_games     INTEGER NOT NULL,
    mistake_frequency REAL    NOT NULL,            -- games / total games in cell
    eval_loss_cp      INTEGER NOT NULL,            -- centipawns lost vs best (stm POV)
    delta_winrate     REAL,                        -- winrate(best) - winrate(mistake)
    criticality       REAL,                        -- freq * dWinrate * log(games)
    error_type        TEXT NOT NULL,               -- 'puzzle' | 'flashcard' (D14)
    created_at        TEXT NOT NULL,
    UNIQUE (position_id, elo_bucket, mistake_move_uci)
);

CREATE INDEX IF NOT EXISTS idx_errors_chapter ON errors (chapter_id);
CREATE INDEX IF NOT EXISTS idx_errors_criticality ON errors (criticality);

-- ---------------------------------------------------------------------------
-- sr_cards: spaced-repetition cards for the trainer. One card per *path* (D15):
-- a position reached by several move orders (a transposition) is drilled as one
-- card per concrete line. SM-2 state lives here; the position it trains is in
-- `positions`, its errors in `errors`. Mode 'puzzle' | 'flashcard' mirrors D14.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sr_cards (
    id            INTEGER PRIMARY KEY,
    position_id   INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
    chapter_id    INTEGER NOT NULL REFERENCES chapters (id) ON DELETE CASCADE,
    path_id       INTEGER REFERENCES paths (id) ON DELETE CASCADE,  -- the concrete line (D15)
    mode          TEXT    NOT NULL,               -- 'puzzle' | 'flashcard'
    ease          REAL    NOT NULL DEFAULT 2.5,   -- SM-2 ease factor (>= 1.3)
    interval_days INTEGER NOT NULL DEFAULT 0,
    reps          INTEGER NOT NULL DEFAULT 0,
    lapses        INTEGER NOT NULL DEFAULT 0,
    due_date      TEXT,                            -- ISO date; NULL = new/never seen
    last_review   TEXT,
    created_at    TEXT NOT NULL,
    UNIQUE (chapter_id, path_id)
);

CREATE INDEX IF NOT EXISTS idx_cards_chapter_due ON sr_cards (chapter_id, due_date);

-- punish_cards: Option B spaced-repetition deck. Unlike sr_cards (one card per position),
-- this schedules each OPPONENT trap independently — one card per (path × opponent mistake) —
-- so a well-punished trap and a shaky one resurface on their own timetables. Parallel to the
-- sr_cards deck (the main trainer keeps position-level scheduling); this is a dedicated deck.
CREATE TABLE IF NOT EXISTS punish_cards (
    id            INTEGER PRIMARY KEY,
    position_id   INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,  -- decision point
    chapter_id    INTEGER NOT NULL REFERENCES chapters (id) ON DELETE CASCADE,
    path_id       INTEGER REFERENCES paths (id) ON DELETE CASCADE,
    mistake_uci   TEXT    NOT NULL,               -- the opponent move this card drills punishing
    mode          TEXT    NOT NULL DEFAULT 'punish',
    ease          REAL    NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    reps          INTEGER NOT NULL DEFAULT 0,
    lapses        INTEGER NOT NULL DEFAULT 0,
    due_date      TEXT,
    last_review   TEXT,
    created_at    TEXT NOT NULL,
    UNIQUE (chapter_id, path_id, mistake_uci)
);
CREATE INDEX IF NOT EXISTS idx_punish_chapter_due ON punish_cards (chapter_id, due_date);

-- ---------------------------------------------------------------------------
-- personal layer (D16): a player's games branched onto the built base. No
-- recalculation — personal_errors reference the already-detected `errors`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personal_games (
    id           INTEGER PRIMARY KEY,
    account_id   INTEGER REFERENCES accounts (id) ON DELETE CASCADE,  -- owner (Stage 1 isolation)
    source       TEXT NOT NULL,                    -- 'pgn' (later: 'lichess', 'chesscom')
    username     TEXT NOT NULL,                    -- the studied player (lowercased)
    player_color TEXT NOT NULL,                    -- 'w' | 'b'
    player_elo   INTEGER,
    white        TEXT,
    black        TEXT,
    result       TEXT,
    date         TEXT,
    event        TEXT,
    territory_positions INTEGER NOT NULL DEFAULT 0,  -- player-to-move positions in analysed territory (M21 denominator)
    imported_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_errors (
    id               INTEGER PRIMARY KEY,
    personal_game_id INTEGER NOT NULL REFERENCES personal_games (id) ON DELETE CASCADE,
    position_id      INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
    error_id         INTEGER REFERENCES errors (id) ON DELETE SET NULL,
    ply              INTEGER NOT NULL,
    played_uci       TEXT NOT NULL,
    played_san       TEXT,
    best_move_uci    TEXT,
    best_move_san    TEXT,
    eval_loss_cp     INTEGER,
    criticality      REAL,
    elo_bucket       INTEGER,
    error_type       TEXT,
    created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_perr_user
    ON personal_errors (personal_game_id);
CREATE INDEX IF NOT EXISTS idx_pgames_user ON personal_games (username);

-- ---------------------------------------------------------------------------
-- personal_cards: spaced-repetition deck of a player's OWN errors (M13). Same
-- SM-2 state shape as sr_cards, but keyed per user across chapters.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personal_cards (
    id            INTEGER PRIMARY KEY,
    account_id    INTEGER REFERENCES accounts (id) ON DELETE CASCADE,  -- owner (Stage 1 isolation)
    username      TEXT    NOT NULL,
    position_id   INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
    mode          TEXT    NOT NULL,               -- 'puzzle' | 'flashcard'
    ease          REAL    NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    reps          INTEGER NOT NULL DEFAULT 0,
    lapses        INTEGER NOT NULL DEFAULT 0,
    due_date      TEXT,
    last_review   TEXT,
    created_at    TEXT NOT NULL,
    UNIQUE (account_id, username, position_id)
);

CREATE INDEX IF NOT EXISTS idx_pcards_user_due ON personal_cards (username, due_date);

-- ---------------------------------------------------------------------------
-- personal_deviations: "left theory" moments. A player move that is neither the
-- engine best move nor a catalogued error = a deviation from what we analysed.
-- We only record it when the child position is ALREADY evaluated in the base, so
-- the eval loss is read from cache — no recalculation (D16, partial coverage).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personal_deviations (
    id               INTEGER PRIMARY KEY,
    personal_game_id INTEGER NOT NULL REFERENCES personal_games (id) ON DELETE CASCADE,
    position_id      INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
    ply              INTEGER NOT NULL,
    played_uci       TEXT NOT NULL,
    played_san       TEXT,
    best_move_san    TEXT,
    eval_loss_cp     INTEGER,                    -- from cached child eval (side-to-move POV)
    costly           INTEGER NOT NULL,           -- 1 if loss >= mistake threshold, else 0
    created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pdev_game ON personal_deviations (personal_game_id);

-- ---------------------------------------------------------------------------
-- eecoach_failures (D18, phase 2): students' recall failures from the coach's
-- EEcoach platform, branched onto the base like the personal layer (no recalc).
-- A failure is matched to a position by FEN-4; if the position is analysed we
-- inherit its criticality at the student's rating bucket. Rating-aware.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eecoach_failures (
    id            INTEGER PRIMARY KEY,
    account_id    INTEGER REFERENCES accounts (id) ON DELETE CASCADE,  -- owner coach (Stage 1)
    student       TEXT    NOT NULL,
    rating        INTEGER,
    reviewed_at   TEXT,                            -- ISO date/datetime from EEcoach
    position_id   INTEGER REFERENCES positions (id) ON DELETE SET NULL,
    fen4          TEXT    NOT NULL,
    expected_move TEXT,                            -- the repertoire move the student missed
    played_move   TEXT,                            -- what they answered (may be empty)
    in_territory  INTEGER NOT NULL,                -- 1 if matched to an analysed position
    elo_bucket    INTEGER,                         -- from rating
    criticality   REAL,                            -- inherited peak criticality, if analysed
    created_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eecoach_student ON eecoach_failures (student);

-- ---------------------------------------------------------------------------
-- accounts (productization foundation): web-app login. Optional — the CLI and
-- the single-user local web mode ignore this table; a hosted deployment turns
-- login on with OA_REQUIRE_LOGIN=1. Passwords are stored as salted PBKDF2 only.
-- Per-account data isolation is the documented next phase (see docs/HOSTING.md).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY,
    username      TEXT    NOT NULL UNIQUE,
    email         TEXT,
    password_hash TEXT    NOT NULL,      -- pbkdf2_sha256$iterations$salt_hex$hash_hex
    created_at    TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- review_log (P4): an APPEND-ONLY journal of every SM-2 review, across all three
-- decks. Unlike sr_cards (which only ever holds current state), this is never
-- overwritten — it answers "am I improving?" and "does this tool work?". Each row
-- is one review: which card, at which level, the grade, and the response time.
-- Rating-aware (elo_bucket = the filter in force when reviewed). An undone note
-- (« Annuler la dernière note ») deletes its matching row, keeping the log honest.
-- The durable decision is this SHAPE; a hosted deployment can mirror it to Supabase.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_log (
    id            INTEGER PRIMARY KEY,
    account_id    INTEGER REFERENCES accounts (id) ON DELETE CASCADE,  -- owner (Stage 1)
    student_id    INTEGER REFERENCES students (id) ON DELETE SET NULL,  -- who trained (NULL = coach's own)
    deck          TEXT    NOT NULL,               -- 'main' | 'punish' | 'personal'
    chapter_id    INTEGER REFERENCES chapters (id) ON DELETE SET NULL,  -- chapter decks
    username      TEXT,                            -- studied player (personal deck)
    card_id       INTEGER,                         -- id within its deck's table
    position_id   INTEGER,
    elo_bucket    INTEGER,                         -- level filter at review time (rating-aware)
    mode          TEXT,                            -- 'puzzle' | 'flashcard' | 'punish'
    grade         TEXT    NOT NULL,                -- 'again' | 'hard' | 'good' | 'easy'
    quality       INTEGER,                         -- SM-2 quality 0..5
    response_ms   INTEGER,                         -- time question shown -> answer (nullable)
    reviewed_at   TEXT    NOT NULL                 -- ISO datetime
);

CREATE INDEX IF NOT EXISTS idx_reviewlog_account ON review_log (account_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_reviewlog_card ON review_log (account_id, deck, card_id);
-- idx_reviewlog_student is created in db._migrate, after the student_id column is guaranteed
-- present (a legacy review_log created this session predates it) — same reason as the
-- account_id indexes below.

-- ---------------------------------------------------------------------------
-- coach → student loop (the second need): the coach assigns exercises to students
-- and follows their progress. A student is a profile the coach manages (no login
-- required in the default solo/local mode); reviews are attributed via
-- review_log.student_id. The assignment is the durable object — it mirrors to
-- EEcoach later regardless of where the student ultimately trains.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER REFERENCES accounts (id) ON DELETE CASCADE,  -- the coach (Stage 1)
    name        TEXT    NOT NULL,
    elo_bucket  INTEGER,                           -- the student's playing level (rating-aware)
    created_at  TEXT    NOT NULL,
    UNIQUE (account_id, name)                       -- names unique per coach
);

CREATE INDEX IF NOT EXISTS idx_students_account ON students (account_id);

CREATE TABLE IF NOT EXISTS assignments (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER REFERENCES accounts (id) ON DELETE CASCADE,  -- the coach
    student_id  INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    chapter_id  INTEGER NOT NULL REFERENCES chapters (id) ON DELETE CASCADE,
    elo_bucket  INTEGER,                            -- level to train at (defaults to student level)
    title       TEXT,                               -- optional label (default = chapter name)
    note        TEXT,                               -- optional coach note to the student
    due_date    TEXT,                               -- ISO date, nullable
    created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assign_student ON assignments (student_id);
CREATE INDEX IF NOT EXISTS idx_assign_account ON assignments (account_id);

-- assignment_items: the specific decision points assigned. NO rows for an assignment means
-- "the whole chapter". With rows, the trainer restricts to these positions and completion is
-- measured against them (real coverage, not a raw review counter).
CREATE TABLE IF NOT EXISTS assignment_items (
    id            INTEGER PRIMARY KEY,
    assignment_id INTEGER NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
    position_id   INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
    UNIQUE (assignment_id, position_id)
);

CREATE INDEX IF NOT EXISTS idx_assignitems_assignment ON assignment_items (assignment_id);
