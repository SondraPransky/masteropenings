-- Opening Tactical Knowledge Base — schéma SQLite
-- Source de vérité : SPEC.md §E. Modèle HYBRIDE (brut + jonctions normalisées).
-- Convention : snake_case minuscule. Même schéma pour l'usine ET l'artefact web (sql.js).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Réglages (clé/valeur). Contient le seuil de filtre, chemins, version.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- ---------------------------------------------------------------------------
-- puzzles (passe 1). Conserve les champs BRUTS du CSV pour traçabilité,
-- + colonnes dérivées calculées à l'ingestion (normalized_fen, fullmove...).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS puzzles (
    puzzle_id        TEXT PRIMARY KEY,
    fen              TEXT NOT NULL,          -- FEN brut du CSV (6 champs)
    normalized_fen   TEXT NOT NULL,          -- placement + trait + roque + e.p. (clé de jointure)
    fullmove         INTEGER NOT NULL,       -- numéro de coup extrait du FEN (borne de filtre)
    side_to_move     TEXT NOT NULL,          -- 'w' | 'b'
    moves            TEXT NOT NULL,          -- solution, coups UCI espace-séparés
    rating           INTEGER,
    rating_deviation INTEGER,
    popularity       INTEGER,
    nb_plays         INTEGER,
    game_url         TEXT,
    game_id          TEXT,                   -- id extrait de game_url (jointure indexée passe 2)
    opening_tags     TEXT,                   -- brut, espace-séparé (non vide en passe 1)
    themes           TEXT                    -- brut, espace-séparé
);
CREATE INDEX IF NOT EXISTS idx_puzzles_normfen  ON puzzles(normalized_fen);
CREATE INDEX IF NOT EXISTS idx_puzzles_fullmove ON puzzles(fullmove);
CREATE INDEX IF NOT EXISTS idx_puzzles_rating   ON puzzles(rating);

-- ---------------------------------------------------------------------------
-- Dimension ouvertures. Une ligne par tag Lichess distinct.
-- family/variation résolus par un post-pass global (préfixe), cf. openings.py.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openings (
    opening_id INTEGER PRIMARY KEY,
    tag        TEXT NOT NULL UNIQUE,         -- ex. French_Defense_Advance_Variation
    family     TEXT NOT NULL,                -- tag famille (préfixe), ex. French_Defense
    variation  TEXT,                         -- portion variante lisible, NULL si == famille
    name       TEXT NOT NULL,               -- lisible : underscores -> espaces
    eco        TEXT                          -- NULL en v1 (enrichissement ultérieur)
);
CREATE INDEX IF NOT EXISTS idx_openings_family ON openings(family);

-- ---------------------------------------------------------------------------
-- Dimension thèmes tactiques.
-- is_motif / label_fr renseignés depuis l'asset statique de mapping (grill #5).
-- NULL tant que le thème n'est pas dans l'asset (thème inconnu).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS themes (
    theme_id INTEGER PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,     -- slug brut Lichess (ex. fork)
    is_motif INTEGER,                  -- 1 = vrai motif tactique, 0 = tag méta
    label_fr TEXT                      -- libellé français (ex. Fourchette)
);
CREATE INDEX IF NOT EXISTS idx_themes_motif ON themes(is_motif);

-- ---------------------------------------------------------------------------
-- Jonctions puzzle <-> dimensions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS puzzle_openings (
    puzzle_id  TEXT NOT NULL REFERENCES puzzles(puzzle_id)  ON DELETE CASCADE,
    opening_id INTEGER NOT NULL REFERENCES openings(opening_id) ON DELETE CASCADE,
    PRIMARY KEY (puzzle_id, opening_id)
);
CREATE INDEX IF NOT EXISTS idx_po_opening ON puzzle_openings(opening_id);

CREATE TABLE IF NOT EXISTS puzzle_themes (
    puzzle_id TEXT NOT NULL REFERENCES puzzles(puzzle_id) ON DELETE CASCADE,
    theme_id  INTEGER NOT NULL REFERENCES themes(theme_id) ON DELETE CASCADE,
    PRIMARY KEY (puzzle_id, theme_id)
);
CREATE INDEX IF NOT EXISTS idx_pt_theme ON puzzle_themes(theme_id);

-- ---------------------------------------------------------------------------
-- statistics : cache d'agrégation reconstructible (fiche ADN pré-calculée).
-- scope ∈ {opening_family, opening_tag, theme, opening_theme}
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statistics (
    scope        TEXT NOT NULL,
    key          TEXT NOT NULL,              -- famille/tag/thème (ou "tag|theme")
    puzzle_count INTEGER NOT NULL,
    avg_rating   REAL,
    avg_fullmove REAL,
    min_rating   INTEGER,
    max_rating   INTEGER,
    PRIMARY KEY (scope, key)
);

-- ---------------------------------------------------------------------------
-- family_motifs : cache des motifs dominants par famille (reconstructible).
-- Peuplé en une passe séquentielle (build_family_dna_cache) pour une comparaison
-- d'ouvertures instantanée (évite l'I/O aléatoire live sur une grosse base).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_motifs (
    family    TEXT NOT NULL,
    slug      TEXT NOT NULL,           -- nom Lichess du thème (ex. fork)
    label_fr  TEXT,                    -- libellé français
    count     INTEGER NOT NULL,        -- puzzles distincts de la famille portant ce motif
    PRIMARY KEY (family, slug)
);

-- ---------------------------------------------------------------------------
-- family_top_puzzles : top-N puzzles par famille (par popularité), reconstructible.
-- Précalculé (build_family_top_puzzles) pour l'onglet « Meilleurs puzzles »
-- (le tri live sur une grosse famille est lent : I/O aléatoire + tri).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_top_puzzles (
    family     TEXT NOT NULL,
    rank       INTEGER NOT NULL,        -- 1 = plus populaire
    puzzle_id  TEXT NOT NULL,
    rating     INTEGER,
    popularity INTEGER,
    themes     TEXT,
    PRIMARY KEY (family, rank)
);

-- ---------------------------------------------------------------------------
-- puzzle_analysis : signaux dérivés de la SOLUTION (tranche 2-bis, python-chess
-- OFFLINE). Cases critiques + sacrifices (pièce@case). Reconstructible.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS puzzle_analysis (
    puzzle_id        TEXT PRIMARY KEY REFERENCES puzzles(puzzle_id) ON DELETE CASCADE,
    critical_squares TEXT,   -- cases d'action du solutionneur, espace-séparé (ex. "e6 c3")
    sacrifices       TEXT    -- "PIECE@case" espace-séparé (ex. "N@e6 R@c3"), '' si aucun
);

-- ===========================================================================
-- Tables PASSE 2 (schéma créé maintenant, peuplées plus tard). SPEC §D.
-- ===========================================================================

-- Parties reconstruites (téléchargement + cache/reprise).
CREATE TABLE IF NOT EXISTS games (
    game_id       TEXT PRIMARY KEY,          -- id Lichess extrait de GameUrl
    pgn           TEXT,
    white         TEXT,
    black         TEXT,
    white_elo     INTEGER,
    black_elo     INTEGER,
    eco           TEXT,
    opening       TEXT,
    downloaded_at TEXT
);

-- Index de positions coup-par-coup (le cœur, passe 2). §E.
CREATE TABLE IF NOT EXISTS positions (
    position_id    INTEGER PRIMARY KEY,
    normalized_fen TEXT NOT NULL,
    game_id        TEXT REFERENCES games(game_id)   ON DELETE CASCADE,
    puzzle_id      TEXT REFERENCES puzzles(puzzle_id) ON DELETE CASCADE,
    ply            INTEGER,
    opening_id     INTEGER REFERENCES openings(opening_id),
    eco            TEXT,
    opening_tags   TEXT,
    white_elo      INTEGER,
    black_elo      INTEGER,
    -- ⚠️ CONTRAT D'ÉCRITURE : `puzzle_rating` recopie `puzzles.rating` et doit
    -- TOUJOURS être renseigné (vérifié : 0 NULL sur 34,6 M). Tout le filtrage par
    -- difficulté l'interroge ICI plutôt que de joindre `puzzles` (14,3 s → 0,001 s
    -- sur un dossier) : une ligne à NULL serait donc silencieusement exclue des
    -- dossiers et des compteurs filtrés. La colonne ne peut pas devenir NOT NULL
    -- (il faudrait reconstruire 34,6 M lignes) → le contrat est tenu par le
    -- trigger `trg_positions_rating_not_null` juste après cette table.
    puzzle_rating  INTEGER,
    themes         TEXT
);
-- Fait respecter le contrat d'écriture de `puzzle_rating` (cf. la table ci-dessus).
-- Un NOT NULL sur la colonne imposerait de reconstruire 34,6 M lignes ; ce trigger
-- donne la même garantie pour les écritures FUTURES, sans scan à la création.
-- Il vaut mieux qu'un run de reconstruction échoue bruyamment que de découvrir des
-- mois plus tard des dossiers amputés en silence : la ligne serait acceptée, puis
-- invisible pour tout filtre par difficulté.
-- COÛT (mesuré, ne pas re-découvrir) : +90 % sur l'INSERT brut (0,43 s → 0,82 s par
-- 200 k lignes) — mais l'insertion ne borne rien ici. Sur une reconstruction
-- complète des 34,6 M lignes cela fait +67 s, quand la passe 2 réelle demande des
-- HEURES (réseau + rejeu python-chess) : ~0,7 % du total. D'où le choix.
-- Seul le chemin INSERT est gardé — rien ne fait d'UPDATE sur `positions`.
CREATE TRIGGER IF NOT EXISTS trg_positions_rating_not_null
BEFORE INSERT ON positions
WHEN NEW.puzzle_rating IS NULL
BEGIN
    SELECT RAISE(ABORT, 'positions.puzzle_rating NULL : le filtre de difficulte exclurait ce puzzle des dossiers en silence (cf. schema.sql)');
END;

-- `idx_positions_normfen` (normalized_fen seul) a été SUPPRIMÉ le 17/07 : préfixe
-- strict des deux index composites ci-dessous, donc redondant (~1 Go). Vérifié sur
-- la base réelle (EXPLAIN QUERY PLAN) : aucun chemin interactif ne l'utilisait ;
-- seule la sous-requête de `build_position_children` (offline) scanne désormais
-- l'index 2-colonnes, un peu plus large. Ne pas le recréer.
-- Index COUVRANT (normalized_fen, puzzle_id) : la recherche « puzzles passant par
-- une position » (COUNT DISTINCT + liste des ids) se répond entièrement dans
-- l'index, sans toucher la table (23 M lignes). Mesuré ~500× : 3,5 s → 0,007 s.
CREATE INDEX IF NOT EXISTS idx_positions_normfen_puzzle ON positions(normalized_fen, puzzle_id);
-- (normalized_fen, puzzle_rating, puzzle_id) : le dossier enseignant filtre par
-- DIFFICULTÉ. Sans cet index il fallait joindre `puzzles` pour lire le rating, soit
-- des centaines de milliers de lookups aléatoires (mesuré 13,9 s pour « 1.e4 »
-- filtré 1500-2000). Ici les ratings sont triés à l'intérieur de chaque position :
-- le filtre devient une simple recherche par intervalle, répondue dans l'index.
CREATE INDEX IF NOT EXISTS idx_positions_normfen_rating
    ON positions(normalized_fen, puzzle_rating, puzzle_id);
CREATE INDEX IF NOT EXISTS idx_positions_puzzle  ON positions(puzzle_id);
-- (game_id, ply) : self-join enfant->parent des suites de coups (explorer).
CREATE INDEX IF NOT EXISTS idx_positions_game_ply ON positions(game_id, ply);

-- position_counts : cache reconstructible du compteur « puzzles à travers ».
-- L'index couvrant ci-dessus répond en ~0,007 s sur une position RARE, mais une
-- position d'OUVERTURE oblige à parcourir des centaines de milliers d'entrées
-- d'index : mesuré 0,26 s à chaud et jusqu'à 4,4 s à froid pour « 1.e4 » (779 k),
-- 3,7 s pour la position de départ (1,2 M) — or c'est exactement là que l'on
-- travaille. On précalcule donc les positions FRÉQUENTES (≥ POSITION_COUNTS_MIN) ;
-- les rares restent comptées à la volée (peu de lignes = instantané).
-- Reconstruire avec : python -m otkb build-counts
CREATE TABLE IF NOT EXISTS position_counts (
    normalized_fen TEXT PRIMARY KEY,
    through_count  INTEGER NOT NULL
);

-- position_children : cache reconstructible des SUITES les plus jouées (opening
-- explorer). Le self-join enfant→parent coûte ~10 s à 23 k parties et imposait un
-- plafond (25 k) qui rendait la carte muette sur TOUTES les positions d'ouverture
-- — précisément la zone de travail. On précalcule les enfants des positions
-- FRÉQUENTES (les mêmes que position_counts : ≥ POSITION_COUNTS_MIN occurrences) ;
-- les rares restent jointes à la volée (peu de lignes = instantané), le plafond
-- ne sert plus que de garde-fou si ce cache n'est pas construit.
-- Reconstruire avec : python -m otkb build-counts
CREATE TABLE IF NOT EXISTS position_children (
    parent_fen  TEXT NOT NULL,
    child_fen   TEXT NOT NULL,
    game_count  INTEGER NOT NULL,
    PRIMARY KEY (parent_fen, child_fen)
);

-- position_popularity : cache reconstructible du TRI PAR POPULARITÉ des puzzles
-- « à travers » (17/07). `popularity` n'existe pas dans `positions` : trier par
-- popularité imposait de joindre `puzzles` sur tout l'ensemble filtré (~2,1 s sur
-- une position d'ouverture, jointure de ~200 k lignes). Comme pour
-- `position_counts`, seules les positions FRÉQUENTES (celles de `position_counts`)
-- sont coûteuses : on précalcule pour elles le triplet trié. Table WITHOUT ROWID =
-- la table EST l'index couvrant (scan arrière → popularity DESC, puzzle_id DESC) ;
-- `puzzle_rating` embarqué pour le filtre de difficulté. ~12 M lignes ≈ 1 Go.
-- Les positions rares gardent la jointure à la volée (peu de lignes = instantané).
-- ⚠️ Tri popularité départagé par `puzzle_id` (comme TOUS les tris à travers),
-- plus par `nb_plays` : ce départage-là n'est pas poussable (cf. _ThroughSort).
-- Reconstruire avec : python -m otkb build-counts
CREATE TABLE IF NOT EXISTS position_popularity (
    normalized_fen TEXT    NOT NULL,
    popularity     INTEGER NOT NULL,
    puzzle_id      TEXT    NOT NULL,
    puzzle_rating  INTEGER NOT NULL,
    PRIMARY KEY (normalized_fen, popularity, puzzle_id)
) WITHOUT ROWID;

-- File de téléchargement (reprise). status ∈ {pending, done, error, skipped}
CREATE TABLE IF NOT EXISTS downloads (
    game_id     TEXT PRIMARY KEY,
    game_url    TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);

-- Journal de l'updater (détection de nouvelle base Lichess). §F.
CREATE TABLE IF NOT EXISTS updates (
    update_id     INTEGER PRIMARY KEY,
    source_label  TEXT,                      -- ex. date/version de la base Lichess
    applied_at    TEXT,
    puzzles_added INTEGER,
    status        TEXT
);
