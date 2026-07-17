-- Opening Tactical Knowledge Base — schéma de l'ARTEFACT WEB RÉDUIT (sql.js).
-- Sous-ensemble de db/schema.sql : mêmes noms de tables/colonnes (exigence
-- « SQLite réduit, même schéma », SPEC §H), amputé du bloc PASSE 2 (positions,
-- games, downloads, updates) qui pèse l'essentiel des 8,6 Go.
--
-- Convention : snake_case minuscule.
-- Les CREATE INDEX sont volontairement ABSENTS ici : on les applique APRÈS la
-- copie de masse (cf. web_export._INDEXES) pour ne pas ralentir les insertions.
-- Pas de PRAGMA foreign_keys : artefact dérivé, copie parent→enfant ordonnée.

-- Réglages (clé/valeur) : version de schéma, seuils, marqueur d'artefact.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- puzzles : corpus passe 1, COLONNES ÉLAGUÉES pour le web.
-- Retiré vs schéma usine : rating_deviation, game_url, game_id (provenance /
-- jointures passe 2 inutiles au front ADN + FEN-lookup + solveur), ainsi que
-- opening_tags et themes : REDONDANTS (reconstructibles SANS PERTE par jointure
-- puzzle_openings→openings et puzzle_themes→themes). ⚠️ Contrat EECoach : lire
-- les ouvertures/thèmes d'un puzzle via ces jonctions, plus via colonnes.
CREATE TABLE IF NOT EXISTS puzzles (
    puzzle_id      TEXT PRIMARY KEY,
    fen            TEXT NOT NULL,          -- FEN complet (montage du plateau)
    normalized_fen TEXT NOT NULL,          -- clé FEN-lookup (placement+trait+roque+e.p.)
    fullmove       INTEGER NOT NULL,
    side_to_move   TEXT NOT NULL,          -- 'w' | 'b'
    moves          TEXT NOT NULL,          -- solution UCI espace-séparée
    rating         INTEGER,
    popularity     INTEGER,
    nb_plays       INTEGER
);

-- Dimension ouvertures.
CREATE TABLE IF NOT EXISTS openings (
    opening_id INTEGER PRIMARY KEY,
    tag        TEXT NOT NULL UNIQUE,
    family     TEXT NOT NULL,
    variation  TEXT,
    name       TEXT NOT NULL,
    eco        TEXT
);

-- Dimension thèmes tactiques.
CREATE TABLE IF NOT EXISTS themes (
    theme_id INTEGER PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,
    is_motif INTEGER,
    label_fr TEXT
);

-- Jonctions puzzle <-> dimensions.
CREATE TABLE IF NOT EXISTS puzzle_openings (
    puzzle_id  TEXT NOT NULL,
    opening_id INTEGER NOT NULL,
    PRIMARY KEY (puzzle_id, opening_id)
);

CREATE TABLE IF NOT EXISTS puzzle_themes (
    puzzle_id TEXT NOT NULL,
    theme_id  INTEGER NOT NULL,
    PRIMARY KEY (puzzle_id, theme_id)
);

-- statistics : fiche ADN pré-calculée (scope opening_family en v1).
CREATE TABLE IF NOT EXISTS statistics (
    scope        TEXT NOT NULL,
    key          TEXT NOT NULL,
    puzzle_count INTEGER NOT NULL,
    avg_rating   REAL,
    avg_fullmove REAL,
    min_rating   INTEGER,
    max_rating   INTEGER,
    PRIMARY KEY (scope, key)
);

-- family_motifs : motifs dominants par famille.
CREATE TABLE IF NOT EXISTS family_motifs (
    family    TEXT NOT NULL,
    slug      TEXT NOT NULL,
    label_fr  TEXT,
    count     INTEGER NOT NULL,
    PRIMARY KEY (family, slug)
);

-- family_top_puzzles : meilleurs puzzles par famille (par popularité).
CREATE TABLE IF NOT EXISTS family_top_puzzles (
    family     TEXT NOT NULL,
    rank       INTEGER NOT NULL,
    puzzle_id  TEXT NOT NULL,
    rating     INTEGER,
    popularity INTEGER,
    themes     TEXT,
    PRIMARY KEY (family, rank)
);

-- puzzle_analysis : signaux 2-bis (cases critiques + sacrifices).
CREATE TABLE IF NOT EXISTS puzzle_analysis (
    puzzle_id        TEXT PRIMARY KEY,
    critical_squares TEXT,
    sacrifices       TEXT
);

-- puzzle_display : VUE de commodité qui reconstruit les colonnes texte
-- `opening_tags` et `themes` (retirées de `puzzles` pour la taille) à la volée
-- depuis les jonctions. Coût disque ≈ 0. Pour l'affichage EECoach :
--   SELECT opening_tags, themes FROM puzzle_display WHERE puzzle_id = ?;
-- Ordre stable via sous-requête triée (group_concat suit l'ordre d'arrivée des
-- lignes ; on n'utilise PAS `group_concat(... ORDER BY ...)`, absent des SQLite
-- anciens que sql.js peut embarquer).
CREATE VIEW IF NOT EXISTS puzzle_display AS
SELECT
    p.puzzle_id,
    (SELECT group_concat(tag, ' ') FROM (
        SELECT o.tag
        FROM puzzle_openings po JOIN openings o ON o.opening_id = po.opening_id
        WHERE po.puzzle_id = p.puzzle_id
        ORDER BY o.opening_id
    )) AS opening_tags,
    (SELECT group_concat(name, ' ') FROM (
        SELECT t.name
        FROM puzzle_themes pt JOIN themes t ON t.theme_id = pt.theme_id
        WHERE pt.puzzle_id = p.puzzle_id
        ORDER BY t.theme_id
    )) AS themes
FROM puzzles p;
