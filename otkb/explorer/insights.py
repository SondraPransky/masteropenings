"""Agrégations par position et par famille pour l'explorateur interactif.

Toutes ces requêtes tournent sur les données EN BANQUE (phase 1 + import parties) :
  - thèmes / ouvertures d'une position  → puzzles qui DÉMARRENT là (100 % dispo) ;
  - suites de coups (continuations)      → index `positions` (couverture partielle,
    53,6 % des puzzles aujourd'hui) ; renvoie [] tant que l'index est vide.

Séparé de `query.py` (qui ne fait que les comptes bruts) pour garder chaque
module sur une responsabilité. python-chess n'est utilisé que pour relier deux
FEN successives à un coup lisible (offline, aucun réseau).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

import chess

from ..db import Database
from ..fen import normalize_fen
from ..logging_setup import get_logger

logger = get_logger(__name__)


@dataclass(slots=True)
class FamilyRow:
    family: str          # tag famille (ex. Sicilian_Defense)
    name: str            # lisible (underscores -> espaces)
    puzzle_count: int


@dataclass(slots=True)
class Share:
    label: str
    slug: str
    count: int
    pct: float           # part des puzzles de la position portant l'item


@dataclass(slots=True)
class Continuation:
    san: str             # coup en notation algébrique (ex. Nf3)
    uci: str             # coup UCI (ex. g1f3)
    game_count: int      # parties passant par la position enfant


# Au-delà de ce nombre de parties passant par la position, le self-join des
# suites devient trop lent (dizaines de secondes) pour un usage interactif :
# on renonce et l'UI invite à jouer quelques coups de plus. Les toutes premières
# positions (théorie ultra-connue) sont justement celles qu'on plafonne.
CONTINUATIONS_MAX_THROUGH = 25_000


# ---------------------------------------------------------------------------
# Familles (pour les sélecteurs de la comparaison d'ouvertures)
# ---------------------------------------------------------------------------
_FAMILY_SCOPE = "opening_family"


def list_families(db: Database, limit: int | None = None, min_count: int = 1) -> list[FamilyRow]:
    """Familles d'ouverture par volume (recompte LIVE, coûteux ~30 s).

    Réservé au (re)calcul du cache `statistics` : préférer `families_cached`
    dans les chemins interactifs. La distinction DISTINCT est nécessaire (un
    puzzle peut porter famille + variante de la même famille).
    """
    sql = """
        SELECT o.family AS family,
               COUNT(DISTINCT po.puzzle_id) AS c
        FROM openings o
        JOIN puzzle_openings po ON po.opening_id = o.opening_id
        GROUP BY o.family
        HAVING c >= :min_count
        ORDER BY c DESC, o.family ASC
    """
    if limit is not None:
        sql += "\nLIMIT :limit"
    rows = db.conn.execute(sql, {"min_count": min_count, "limit": limit})
    return [
        FamilyRow(family=r["family"], name=r["family"].replace("_", " "), puzzle_count=r["c"])
        for r in rows
    ]


def build_family_stats(db: Database) -> int:
    """Pré-calcule le cache `statistics` (scope opening_family). Idempotent.

    Une seule passe lourde (COUNT DISTINCT + AVG/MIN/MAX par famille), persistée :
    les lectures suivantes (`families_cached`) sont instantanées. À relancer après
    une ré-ingestion.
    """
    con = db.conn
    con.execute("DELETE FROM statistics WHERE scope = ?", (_FAMILY_SCOPE,))
    con.execute(
        """
        INSERT INTO statistics
            (scope, key, puzzle_count, avg_rating, avg_fullmove, min_rating, max_rating)
        SELECT :scope, o.family,
               COUNT(DISTINCT p.puzzle_id),
               AVG(p.rating), AVG(p.fullmove), MIN(p.rating), MAX(p.rating)
        FROM openings o
        JOIN puzzle_openings po ON po.opening_id = o.opening_id
        JOIN puzzles p ON p.puzzle_id = po.puzzle_id
        GROUP BY o.family
        """,
        {"scope": _FAMILY_SCOPE},
    )
    con.commit()
    return con.execute(
        "SELECT COUNT(*) n FROM statistics WHERE scope = ?", (_FAMILY_SCOPE,)
    ).fetchone()["n"]


def build_family_motifs(db: Database) -> int:
    """Pré-calcule les motifs dominants par famille (cache `family_motifs`).

    Une passe séquentielle groupée (~20 s) plutôt qu'un compute_dna par famille
    (I/O aléatoire, ~min chacun sur une grosse base). Idempotent.
    """
    con = db.conn
    con.execute("DELETE FROM family_motifs")
    con.execute(
        """
        INSERT INTO family_motifs (family, slug, label_fr, count)
        SELECT o.family, t.name, t.label_fr, COUNT(DISTINCT po.puzzle_id)
        FROM openings o
        JOIN puzzle_openings po ON po.opening_id = o.opening_id
        JOIN puzzle_themes pt ON pt.puzzle_id = po.puzzle_id
        JOIN themes t ON t.theme_id = pt.theme_id AND t.is_motif = 1
        GROUP BY o.family, t.theme_id
        """
    )
    con.commit()
    return con.execute("SELECT COUNT(*) n FROM family_motifs").fetchone()["n"]


_TOP_PUZZLES_DDL = """
CREATE TABLE IF NOT EXISTS family_top_puzzles (
    family     TEXT NOT NULL,
    rank       INTEGER NOT NULL,
    puzzle_id  TEXT NOT NULL,
    rating     INTEGER,
    popularity INTEGER,
    themes     TEXT,
    PRIMARY KEY (family, rank)
)
"""


def build_family_top_puzzles(db: Database, per_family: int = 60) -> int:
    """Pré-calcule le top-N puzzles par famille (par popularité). Idempotent."""
    con = db.conn
    con.execute(_TOP_PUZZLES_DDL)
    con.execute("DELETE FROM family_top_puzzles")
    con.execute(
        """
        INSERT INTO family_top_puzzles (family, rank, puzzle_id, rating, popularity, themes)
        SELECT family, rnk, puzzle_id, rating, popularity, themes FROM (
            SELECT family, puzzle_id, rating, popularity, themes,
                   ROW_NUMBER() OVER (
                       PARTITION BY family
                       ORDER BY popularity DESC, nb_plays DESC, puzzle_id
                   ) AS rnk
            FROM (
                SELECT o.family AS family, p.puzzle_id, p.rating,
                       p.popularity, p.nb_plays, p.themes
                FROM openings o
                JOIN puzzle_openings po ON po.opening_id = o.opening_id
                JOIN puzzles p ON p.puzzle_id = po.puzzle_id
                GROUP BY o.family, p.puzzle_id
            )
        ) WHERE rnk <= :n
        """,
        {"n": per_family},
    )
    con.commit()
    return con.execute("SELECT COUNT(*) n FROM family_top_puzzles").fetchone()["n"]


def family_top_ready(db: Database) -> bool:
    """Le cache des meilleurs puzzles par famille est-il calculé ?"""
    row = db.conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='family_top_puzzles'"
    ).fetchone()
    if row is None:
        return False
    return db.conn.execute(
        "SELECT EXISTS(SELECT 1 FROM family_top_puzzles) e"
    ).fetchone()["e"] == 1


@dataclass(slots=True)
class PuzzleSummary:
    puzzle_id: str
    rating: int | None
    popularity: int | None
    themes: str


def top_puzzles_for_family(
    db: Database, family: str, *, sort: str = "popularity", limit: int = 12, offset: int = 0
) -> list[PuzzleSummary]:
    """Meilleurs puzzles d'une famille depuis le cache (tri secondaire en SQL).

    `rank` fait ici le travail que `puzzle_id` fait ailleurs : il est UNIQUE par
    famille (PRIMARY KEY (family, rank)) et déjà calculé départagé — cf.
    `build_family_top_puzzles`, ROW_NUMBER() ORDER BY popularity DESC, nb_plays DESC,
    puzzle_id. Les trois tris sont donc déjà déterministes, et « popularité » ne se
    lit pas sur une colonne mais sur cet ordinal précalculé : rien à mutualiser avec
    les autres tables, dont les colonnes diffèrent.
    """
    order = {
        "popularity": "rank ASC",
        "rating_desc": "rating DESC, rank ASC",
        "rating_asc": "rating ASC, rank ASC",
    }.get(sort, "rank ASC")
    rows = db.conn.execute(
        f"""
        SELECT puzzle_id, rating, popularity, themes
        FROM family_top_puzzles WHERE family = :fam
        ORDER BY {order} LIMIT :limit OFFSET :offset
        """,
        {"fam": family, "limit": limit, "offset": offset},
    )
    return [
        PuzzleSummary(r["puzzle_id"], r["rating"], r["popularity"], r["themes"] or "")
        for r in rows
    ]


def top_puzzles_count(db: Database, family: str) -> int:
    return db.conn.execute(
        "SELECT COUNT(*) n FROM family_top_puzzles WHERE family = ?", (family,)
    ).fetchone()["n"]


def list_puzzles_at(
    db: Database, normalized_fen: str, *, sort: str = "popularity",
    limit: int = 10, offset: int = 0,
) -> list[PuzzleSummary]:
    """Puzzles démarrant à une position, triés et paginés (index normalized_fen).

    Tris définis ici et NON via `_THROUGH_SORTS` : ce dernier arbitre une sélection
    à deux tables (`positions`→`puzzles`) et n'existe que pour pousser tri et filtre
    dans l'index sur des centaines de milliers de lignes. Ici la requête est mono-table
    et minuscule — la position de DÉPART la plus chargée de la base porte 10 puzzles
    (chaque puzzle démarre à sa propre FEN). Les partager imposerait de paramétrer
    préfixe de table et colonnes pour ne rien gagner.

    `puzzle_id` départage néanmoins tous les tris : sans lui l'ordre des ex æquo est
    celui des `rowid`, c'est-à-dire un accident du plan plutôt qu'un choix. Coût
    mesuré : nul (0,141 → 0,153 ms, le tri a lieu de toute façon).
    """
    order = {
        "popularity": "popularity DESC, nb_plays DESC, puzzle_id ASC",
        "rating_desc": "rating DESC, puzzle_id DESC",
        "rating_asc": "rating ASC, puzzle_id ASC",
    }.get(sort, "popularity DESC, nb_plays DESC, puzzle_id ASC")
    rows = db.conn.execute(
        f"""
        SELECT puzzle_id, rating, popularity, themes
        FROM puzzles WHERE normalized_fen = :fen
        ORDER BY {order} LIMIT :limit OFFSET :offset
        """,
        {"fen": normalized_fen, "limit": limit, "offset": offset},
    )
    return [
        PuzzleSummary(r["puzzle_id"], r["rating"], r["popularity"], r["themes"] or "")
        for r in rows
    ]


THROUGH_SORTS = ("popularity", "rating_asc", "rating_desc")


@dataclass(frozen=True)
class _ThroughSort:
    """Un tri de la liste « à travers », défini UNE seule fois.

    `outer` ordonne le résultat joint à `puzzles`. `inner` est le MÊME ordre
    exprimé dans la relation `inner_table` — `positions` (colonne dénormalisée
    `puzzle_rating`) ou le cache `position_popularity` — quand un index sait le
    rendre, auquel cas on peut trier et paginer AVANT de joindre.

    ⚠️ Invariant : `inner` et `outer` doivent être équivalents. C'est ce qui
    garantit qu'une page paginée est bien la tranche correspondante de la liste
    complète. Les avoir laissés diverger (`inner` sur le seul rating, `outer`
    départagé par popularité) faisait que la tranche retenue et l'ordre affiché
    obéissaient à deux critères différents : la page 1 d'un tri par difficulté
    croissante renvoyait les puzzles les MOINS populaires parmi les ex æquo, et
    l'export (`limit=None`, non poussé) contredisait la liste à l'écran.
    """

    outer: str
    inner: str | None = None
    inner_table: str = "positions"


# Tous les tris sont départagés par `puzzle_id` : les ratings (et les popularités,
# bornées à [-100, 100]) sont des entiers et une position d'ouverture porte ~200 k
# puzzles, donc les ex æquo sont la norme, pas le cas limite. `puzzle_id` est le
# départage GRATUIT — dernière colonne de l'index servant (sens avant pour ASC,
# arrière pour DESC). Le tri popularité n'est plus sous-départagé par `nb_plays`
# (17/07) : ce départage-là n'était pas poussable, et l'invariant inner == outer
# prime (cf. docstring). Il est poussé dans le cache `position_popularity` quand
# la position y est (= position fréquente, cf. `popularity_pushable`) ; sinon la
# jointure complète reste le repli — instantanée sur une position rare.
_THROUGH_SORTS: dict[str, _ThroughSort] = {
    "popularity": _ThroughSort(
        outer="p.popularity DESC, p.puzzle_id DESC",
        inner="popularity DESC, puzzle_id DESC",       # scan arrière du cache
        inner_table="position_popularity",
    ),
    "rating_asc": _ThroughSort(
        outer="p.rating ASC, p.puzzle_id ASC",
        inner="puzzle_rating ASC, puzzle_id ASC",      # scan avant de l'index
    ),
    "rating_desc": _ThroughSort(
        outer="p.rating DESC, p.puzzle_id DESC",
        inner="puzzle_rating DESC, puzzle_id DESC",    # scan arrière de l'index
    ),
}


def _through_filter(rating_min: int | None, rating_max: int | None) -> tuple[str, dict]:
    """Filtre de difficulté, appliqué DANS `positions` (colonne dénormalisée).

    `positions.puzzle_rating` duplique `puzzles.rating` (vérifié cohérent). Filtrer
    ici plutôt que via une jointure sur `puzzles` évite des centaines de milliers de
    lookups aléatoires (mesuré : 13,9 s → instantané) et laisse l'index
    `idx_positions_normfen_rating` répondre par simple intervalle.
    """
    clause, params = "", {}
    if rating_min is not None:
        clause += " AND puzzle_rating >= :rmin"
        params["rmin"] = rating_min
    if rating_max is not None:
        clause += " AND puzzle_rating <= :rmax"
        params["rmax"] = rating_max
    return clause, params


def count_puzzles_through(
    db: Database, normalized_fen: str, *,
    rating_min: int | None = None, rating_max: int | None = None,
) -> int:
    """Nombre de puzzles distincts PASSANT PAR la position (filtre difficulté)."""
    where, params = _through_filter(rating_min, rating_max)
    if not where:
        # sans filtre : le cache des positions fréquentes répond en O(1)
        return through_count(db, normalized_fen)
    # Dédoublonnage EN FLUX plutôt que COUNT(DISTINCT) : ce dernier construit une
    # table de hachage de ~200 k valeurs (95 % du temps — mesuré 0,54 s contre
    # 0,10 s). Comme un puzzle a UN seul rating (`puzzle_rating` recopié de
    # `puzzles.rating`, vérifié), grouper par (puzzle_rating, puzzle_id) revient à
    # grouper par puzzle_id — mais suit l'ordre de l'index
    # `idx_positions_normfen_rating`, donc SQLite regroupe à mémoire constante.
    # Les doublons (même position répétée dans une partie : 3 540, soit 0,01 %)
    # sont adjacents et donc bien fusionnés — un COUNT(*) nu, lui, surcompterait.
    return db.conn.execute(
        f"SELECT COUNT(*) n FROM (SELECT puzzle_rating, puzzle_id FROM positions "
        f"WHERE normalized_fen = :fen{where} GROUP BY puzzle_rating, puzzle_id)",
        {"fen": normalized_fen, **params},
    ).fetchone()["n"]


def popularity_pushable(db: Database, normalized_fen: str) -> bool:
    """Le tri popularité est-il poussable dans `position_popularity` pour ce FEN ?

    Le cache couvre EXACTEMENT les positions de `position_counts` (mêmes parents,
    construits dans la même passe `build-counts`) : l'appartenance s'y teste en
    O(1). Position absente = rare → la jointure à la volée est instantanée, le
    repli ne coûte rien. Table absente (base antérieure au cache) → repli aussi.
    """
    try:
        return db.conn.execute(
            "SELECT 1 FROM position_popularity WHERE normalized_fen = ? LIMIT 1",
            (normalized_fen,),
        ).fetchone() is not None
    except sqlite3.OperationalError:
        return False


def through_query(
    normalized_fen: str, *, columns: str, extra_join: str = "",
    sort: str = "popularity", limit: int | None = None, offset: int = 0,
    rating_min: int | None = None, rating_max: int | None = None,
    pop_cached: bool = False,
) -> tuple[str, dict]:
    """Requête canonique « les puzzles dont la partie PASSE PAR cette position ».

    Point unique de vérité de la SÉLECTION : filtre de difficulté, tri, pagination,
    et la décision de les pousser ou non dans l'index. Ses deux consommateurs — la
    liste de l'explorateur et l'export PGN — ne diffèrent que par ce qu'ils
    HYDRATENT (`columns`, et `extra_join` pour ramener la partie complète). Chacun
    ayant sa propre requête, l'export est resté sur le vieux filtre par jointure
    (mesuré 14,3 s contre 0,001 s) et sur un tri divergent : d'où ce regroupement.

    Le filtre porte sur `positions.puzzle_rating` (colonne dénormalisée, cohérence
    vérifiée) et non sur `puzzles.rating` : l'index `idx_positions_normfen_rating`
    y répond par simple intervalle, au lieu de centaines de milliers de lookups
    aléatoires. `sort` ∈ THROUGH_SORTS ; `limit=None` → tout (export en lot).
    `pop_cached` (cf. `popularity_pushable`) : la position est dans le cache
    `position_popularity` → le tri popularité y est poussé comme les tris rating
    le sont dans l'index (jointure de ~200 k lignes évitée, 2,1 s → instantané).
    """
    spec = _THROUGH_SORTS.get(sort, _THROUGH_SORTS["popularity"])
    where, params = _through_filter(rating_min, rating_max)
    args = {"fen": normalized_fen, "limit": limit, "offset": offset, **params}

    pushable = spec.inner is not None and (
        spec.inner_table != "position_popularity" or pop_cached)
    if pushable and spec.inner_table == "position_popularity":
        # Tri poussé dans le cache : la table WITHOUT ROWID rend les lignes déjà
        # triées (scan arrière), dédoublonnées par construction (PK), et porte
        # `puzzle_rating` pour le filtre. Poussé même sans limite : évite le
        # DISTINCT en table de hachage sur ~200 k lignes.
        page = "" if limit is None else " LIMIT :limit OFFSET :offset"
        inner = (f"SELECT puzzle_id FROM position_popularity "
                 f"WHERE normalized_fen = :fen{where} "
                 f"ORDER BY {spec.inner}{page}")
        tail = ""
    elif pushable and limit is not None:
        # Tri poussé dans l'index : (normalized_fen, puzzle_rating, puzzle_id) rend
        # déjà les lignes dans l'ordre voulu, donc on trie et on pagine DANS l'index
        # et on ne joint `puzzles` que sur la page demandée. Sinon il fallait joindre
        # les ~200 k puzzles de la position avant d'en garder 45 (14 s → 0,03 s).
        inner = (f"SELECT DISTINCT puzzle_id, puzzle_rating FROM positions "
                 f"WHERE normalized_fen = :fen{where} "
                 f"ORDER BY {spec.inner} LIMIT :limit OFFSET :offset")
        tail = ""
    else:
        # Tri non poussable (popularité sur une position HORS cache — donc rare,
        # peu de lignes) ou export intégral (limit=None) d'un tri rating : la
        # jointure sur tout l'ensemble filtré est inévitable.
        inner = f"SELECT DISTINCT puzzle_id FROM positions WHERE normalized_fen = :fen{where}"
        tail = "" if limit is None else " LIMIT :limit OFFSET :offset"
    sql = (f"SELECT {columns} FROM ({inner}) t "
           f"JOIN puzzles p ON p.puzzle_id = t.puzzle_id "
           f"{extra_join}ORDER BY {spec.outer}{tail}")
    return sql, args


def list_puzzles_through(
    db: Database, normalized_fen: str, *, sort: str = "popularity",
    limit: int | None = 10, offset: int = 0,
    rating_min: int | None = None, rating_max: int | None = None,
) -> list[PuzzleSummary]:
    """Puzzles dont la partie PASSE PAR la position (pas seulement y démarre).

    Hydrate la sélection canonique (`through_query`) de quoi afficher une liste.
    `sort` ∈ THROUGH_SORTS ; `limit=None` → tous (usage export en lot).
    """
    sql, args = through_query(
        normalized_fen, columns="p.puzzle_id, p.rating, p.popularity, p.themes",
        sort=sort, limit=limit, offset=offset,
        rating_min=rating_min, rating_max=rating_max,
        pop_cached=sort == "popularity" and popularity_pushable(db, normalized_fen),
    )
    return [
        PuzzleSummary(r["puzzle_id"], r["rating"], r["popularity"], r["themes"] or "")
        for r in db.conn.execute(sql, args)
    ]


def build_family_dna_cache(db: Database) -> tuple[int, int, int]:
    """Construit tout le cache d'ADN par famille. Idempotent.

    Renvoie (nb familles, nb lignes motifs, nb top-puzzles). À relancer après
    ré-ingestion.
    """
    fams = build_family_stats(db)
    motifs = build_family_motifs(db)
    top = build_family_top_puzzles(db)
    return fams, motifs, top


@dataclass(slots=True)
class FamilyDNA:
    """Fiche ADN condensée d'une famille, lue depuis le cache (instantané)."""
    family: str
    name: str
    puzzle_count: int
    avg_rating: float | None
    avg_fullmove: float | None
    rating_min: int | None
    rating_max: int | None
    top_motifs: list[Share]


def family_dna_cached(db: Database, family: str, *, top_motifs: int = 12) -> FamilyDNA | None:
    """Lit l'ADN d'une famille depuis le cache. None si famille inconnue/non calculée."""
    con = db.conn
    row = con.execute(
        """
        SELECT puzzle_count, avg_rating, avg_fullmove, min_rating, max_rating
        FROM statistics WHERE scope = ? AND key = ?
        """,
        (_FAMILY_SCOPE, family),
    ).fetchone()
    if row is None:
        return None
    total = row["puzzle_count"]
    motifs = [
        Share(
            label=r["label_fr"] or r["slug"], slug=r["slug"],
            count=r["count"], pct=100.0 * r["count"] / total if total else 0.0,
        )
        for r in con.execute(
            "SELECT slug, label_fr, count FROM family_motifs "
            "WHERE family = ? ORDER BY count DESC LIMIT ?",
            (family, top_motifs),
        )
    ]
    return FamilyDNA(
        family=family, name=family.replace("_", " "), puzzle_count=total,
        avg_rating=row["avg_rating"], avg_fullmove=row["avg_fullmove"],
        rating_min=row["min_rating"], rating_max=row["max_rating"],
        top_motifs=motifs,
    )


def families_cached(db: Database, min_count: int = 1) -> list[FamilyRow]:
    """Familles depuis le cache `statistics` (instantané). [] si non calculé."""
    rows = db.conn.execute(
        """
        SELECT key AS family, puzzle_count AS c
        FROM statistics
        WHERE scope = :scope AND puzzle_count >= :min_count
        ORDER BY c DESC, key ASC
        """,
        {"scope": _FAMILY_SCOPE, "min_count": min_count},
    )
    return [
        FamilyRow(family=r["family"], name=r["family"].replace("_", " "), puzzle_count=r["c"])
        for r in rows
    ]


def family_stats_ready(db: Database) -> bool:
    """Le cache des familles est-il déjà calculé ?"""
    return db.conn.execute(
        "SELECT EXISTS(SELECT 1 FROM statistics WHERE scope = ?) e", (_FAMILY_SCOPE,)
    ).fetchone()["e"] == 1


# ---------------------------------------------------------------------------
# Vue « thèmes par position » et « ouvertures par position »
# (puzzles qui DÉMARRENT exactement à cette position normalisée)
# ---------------------------------------------------------------------------
def themes_at_position(
    db: Database, normalized_fen: str, *, motifs_only: bool = True, limit: int = 15
) -> list[Share]:
    """Motifs tactiques portés par les puzzles démarrant à cette position."""
    total = db.conn.execute(
        "SELECT COUNT(*) n FROM puzzles WHERE normalized_fen = ?", (normalized_fen,)
    ).fetchone()["n"]
    if not total:
        return []
    # `pt.puzzle_id IN (sous-requête)` force SQLite à partir des (rares) puzzles de
    # la position puis à sonder puzzle_themes par sa PK. La forme en jointure
    # directe laissait le planificateur démarrer de l'index is_motif et scanner
    # tout puzzle_themes (~20 s dès qu'un puzzle démarre là).
    motif_cond = "AND t.is_motif = 1" if motifs_only else ""
    rows = db.conn.execute(
        f"""
        SELECT t.label_fr AS label, t.name AS slug, COUNT(*) AS c
        FROM puzzle_themes pt
        JOIN themes t ON t.theme_id = pt.theme_id {motif_cond}
        WHERE pt.puzzle_id IN (
            SELECT puzzle_id FROM puzzles WHERE normalized_fen = :fen
        )
        GROUP BY t.theme_id
        ORDER BY c DESC
        LIMIT :limit
        """,
        {"fen": normalized_fen, "limit": limit},
    )
    return [
        Share(label=r["label"] or r["slug"], slug=r["slug"], count=r["c"], pct=100.0 * r["c"] / total)
        for r in rows
    ]


POSITION_COUNTS_MIN = 50


def build_position_counts(db: Database, min_count: int = POSITION_COUNTS_MIN) -> int:
    """(Re)construit `position_counts` — cache du compteur « puzzles à travers ».

    Une passe séquentielle sur l'index couvrant. Ne garde que les positions
    FRÉQUENTES (≥ `min_count`) : ce sont les seules coûteuses à compter à la volée
    (une position d'ouverture = des centaines de milliers de lignes). Les positions
    rares restent comptées en direct, c'est instantané. Renvoie le nombre de lignes.
    """
    con = db.conn
    con.execute("DELETE FROM position_counts")
    con.execute(
        "INSERT INTO position_counts(normalized_fen, through_count) "
        "SELECT normalized_fen, COUNT(DISTINCT puzzle_id) AS n FROM positions "
        "GROUP BY normalized_fen HAVING n >= ?",
        (min_count,),
    )
    con.commit()
    return con.execute("SELECT COUNT(*) FROM position_counts").fetchone()[0]


def build_position_popularity(db: Database) -> int:
    """(Re)construit `position_popularity` — cache du TRI PAR POPULARITÉ à travers.

    Mêmes parents que `position_counts` (à lancer APRÈS `build_position_counts`,
    dont la table sert de liste de parents) : ce sont exactement les positions où
    la jointure de tri coûtait ~2,1 s. Une ligne par (position, puzzle) avec
    popularité et rating embarqués ; la PK WITHOUT ROWID dédoublonne et trie.
    Renvoie le nombre de lignes (~12 M ≈ 1 Go sur le corpus complet).
    """
    con = db.conn
    con.execute("DELETE FROM position_popularity")
    con.execute(
        """
        INSERT OR IGNORE INTO position_popularity
            (normalized_fen, popularity, puzzle_id, puzzle_rating)
        SELECT pos.normalized_fen, pz.popularity, pos.puzzle_id, pos.puzzle_rating
        FROM positions pos
        JOIN puzzles pz ON pz.puzzle_id = pos.puzzle_id
        WHERE pos.normalized_fen IN (SELECT normalized_fen FROM position_counts)
        """
    )
    con.commit()
    return con.execute("SELECT COUNT(*) FROM position_popularity").fetchone()[0]


# Marqueur de fraîcheur des caches de positions (`position_counts`,
# `position_children`, `position_popularity`) : `positions` est append-only
# (INSERT seulement, jamais d'UPDATE/DELETE en pratique), donc MAX(position_id)
# — O(1) sur la PK — suffit à détecter tout ajout depuis le dernier build.
# Sans marqueur (base d'avant le 17/07) on ne sait pas → pas de fausse alarme.
_CACHES_MAXID_KEY = "position_caches_maxid"


def _positions_maxid(db: Database) -> int:
    row = db.conn.execute("SELECT MAX(position_id) FROM positions").fetchone()
    return row[0] or 0


def mark_position_caches_fresh(db: Database) -> None:
    """À appeler en fin de `build-counts` : grave l'état de `positions` couvert."""
    db.set_setting(_CACHES_MAXID_KEY, str(_positions_maxid(db)))
    db.conn.commit()


def position_caches_stale(db: Database) -> bool:
    """`positions` a-t-elle grossi depuis le dernier `build-counts` ?

    Vrai = les compteurs/suites/tri popularité affichés sont PÉRIMÉS (ils
    ignorent les positions ajoutées depuis). Faux si marqueur absent (base
    antérieure au marqueur : on ne sait pas, on ne crie pas au loup).
    """
    marked = db.get_setting(_CACHES_MAXID_KEY)
    if marked is None:
        return False
    return _positions_maxid(db) != int(marked)


def rebuild_position_caches_if_stale(
    db: Database, min_count: int = POSITION_COUNTS_MIN
) -> bool:
    """Reconstruit les caches de positions s'ils existent ET sont périmés.

    Le filet « auto » du mécanisme décidé le 17/07 (wayfinder, ticket 004) : les
    commandes qui ÉCRIVENT `positions` (download-run, import-dataset) l'appellent
    en fin de course, pour que les compteurs de l'explorateur ne deviennent jamais
    silencieusement faux. Ne construit RIEN sur une base qui n'a jamais eu de
    cache (le premier build reste un choix explicite : `otkb build-counts`).
    Renvoie True si une reconstruction a eu lieu.
    """
    if not position_counts_ready(db) or not position_caches_stale(db):
        return False
    logger.info("Caches de positions périmés → reconstruction (quelques minutes)…")
    build_position_counts(db, min_count=min_count)
    build_position_children(db, min_count=min_count)
    build_position_popularity(db)
    mark_position_caches_fresh(db)
    return True


def position_counts_ready(db: Database) -> bool:
    """Le cache de compteurs est-il peuplé ? (table absente = base ancienne).

    L'UI ouvre la base SANS appliquer le schéma (lecture seule) : sur une base
    antérieure au cache, la table manque vraiment. Sans ce garde-fou l'explorateur
    retombe SILENCIEUSEMENT au comptage direct (~4 s par coup) — exactement ce que
    le cache existe pour éviter. Cf. `UiData.position_counts_missing`.
    """
    try:
        return db.conn.execute("SELECT 1 FROM position_counts LIMIT 1").fetchone() is not None
    except sqlite3.OperationalError:
        return False


def through_count(db: Database, normalized_fen: str) -> int:
    """Compteur « puzzles à travers » (sans filtre), via le cache si disponible.

    Compter en direct coûte jusqu'à ~4 s sur une position d'ouverture (des
    centaines de milliers d'entrées d'index). `position_counts` précalcule ces
    positions-là ; en cas d'absence (position rare, ou cache pas encore construit)
    on retombe sur le comptage direct, peu coûteux pour une position rare.
    """
    try:
        row = db.conn.execute(
            "SELECT through_count FROM position_counts WHERE normalized_fen = ?",
            (normalized_fen,),
        ).fetchone()
        if row is not None:
            return row["through_count"]
    except sqlite3.OperationalError:
        pass  # table absente (base antérieure au cache) → comptage direct
    return db.conn.execute(
        "SELECT COUNT(DISTINCT puzzle_id) n FROM positions WHERE normalized_fen = ?",
        (normalized_fen,),
    ).fetchone()["n"]


def squares_at_position(
    db: Database, normalized_fen: str, *, limit: int = 8
) -> dict[str, dict[str, int]]:
    """Cases critiques / de sacrifice agrégées sur les puzzles démarrant ici.

    Renvoie ``{"critical": {case: n, …}, "sacrifice": {case: n, …}}`` (les N cases
    les plus fréquentes de chaque type), pour dessiner la carte thermique de la
    position. Vide si aucun puzzle n'a d'analyse 2-bis ici.
    """
    from collections import Counter

    rows = db.conn.execute(
        """
        SELECT a.critical_squares AS crit, a.sacrifices AS sac
        FROM puzzle_analysis a
        WHERE a.puzzle_id IN (
            SELECT puzzle_id FROM puzzles WHERE normalized_fen = :fen
        )
        """,
        {"fen": normalized_fen},
    ).fetchall()
    crit, sac = Counter(), Counter()
    for r in rows:
        for sq in (r["crit"] or "").split():
            crit[sq] += 1
        for token in (r["sac"] or "").split():          # "N@e6"
            _, _, sq = token.partition("@")
            if sq:
                sac[sq] += 1
    return {
        "critical": dict(crit.most_common(limit)),
        "sacrifice": dict(sac.most_common(limit)),
    }


def openings_at_position(db: Database, normalized_fen: str, *, limit: int = 8) -> list[Share]:
    """Ouvertures (tags) des puzzles démarrant à cette position, par volume."""
    total = db.conn.execute(
        "SELECT COUNT(*) n FROM puzzles WHERE normalized_fen = ?", (normalized_fen,)
    ).fetchone()["n"]
    if not total:
        return []
    rows = db.conn.execute(
        """
        WITH m AS (SELECT puzzle_id FROM puzzles WHERE normalized_fen = :fen)
        SELECT o.tag AS tag, o.name AS name, COUNT(*) AS c
        FROM m
        JOIN puzzle_openings po ON po.puzzle_id = m.puzzle_id
        JOIN openings o ON o.opening_id = po.opening_id
        GROUP BY o.opening_id
        ORDER BY c DESC
        LIMIT :limit
        """,
        {"fen": normalized_fen, "limit": limit},
    )
    return [
        Share(label=r["name"], slug=r["tag"], count=r["c"], pct=100.0 * r["c"] / total)
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Suites de coups (opening explorer) — à travers l'index `positions`
# ---------------------------------------------------------------------------
def _link_children(board: chess.Board, child_counts: dict[str, int],
                   limit: int, min_games: int) -> list[Continuation]:
    """Relie des FEN-enfants comptées aux coups légaux du plateau (offline)."""
    out: list[Continuation] = []
    for move in board.legal_moves:
        board.push(move)
        child_fen = normalize_fen(board.fen())
        board.pop()
        g = child_counts.get(child_fen)
        if g and g >= min_games:
            out.append(
                Continuation(san=board.san(move), uci=move.uci(), game_count=g)
            )
    out.sort(key=lambda c: c.game_count, reverse=True)
    return out[:limit]


def continuations(
    db: Database, board: chess.Board, *, limit: int = 12, min_games: int = 1
) -> list[Continuation]:
    """Coups les plus joués depuis cette position, comptés sur les parties indexées.

    Lit d'abord le cache `position_children` (peuplé pour les positions FRÉQUENTES
    par `build_position_children` — le self-join direct coûtait ~10 s à 23 k
    parties, et le plafond qui l'endiguait rendait la carte muette sur toutes les
    positions d'ouverture). Une position absente du cache est RARE : le self-join
    direct y est instantané. Renvoie [] si l'index est vide pour cette position.
    """
    parent_fen = normalize_fen(board.fen())
    try:
        cached = db.conn.execute(
            "SELECT child_fen, game_count FROM position_children WHERE parent_fen = ?",
            (parent_fen,),
        ).fetchall()
    except sqlite3.OperationalError:      # base antérieure au cache
        cached = []
    if cached:
        return _link_children(
            board, {r["child_fen"]: r["game_count"] for r in cached}, limit, min_games
        )

    rows = db.conn.execute(
        """
        SELECT c.normalized_fen AS child, COUNT(DISTINCT c.game_id) AS g
        FROM positions p
        JOIN positions c
          ON c.game_id = p.game_id AND c.ply = p.ply + 1
        WHERE p.normalized_fen = :fen
        GROUP BY c.normalized_fen
        """,
        {"fen": parent_fen},
    )
    child_counts = {r["child"]: r["g"] for r in rows}
    if not child_counts:
        return []
    return _link_children(board, child_counts, limit, min_games)


def build_position_children(db: Database, min_count: int = POSITION_COUNTS_MIN) -> int:
    """(Re)construit `position_children` — cache des suites des positions fréquentes.

    Mêmes parents que `position_counts` (≥ `min_count` occurrences) : ce sont
    exactement ceux où le self-join à la volée est lent. Une passe jointe sur
    l'index (game_id, ply). Renvoie le nombre de lignes (arêtes parent→enfant).
    """
    con = db.conn
    con.execute("DELETE FROM position_children")
    con.execute(
        """
        INSERT INTO position_children(parent_fen, child_fen, game_count)
        SELECT p.normalized_fen, c.normalized_fen, COUNT(DISTINCT c.game_id)
        FROM positions p
        JOIN positions c ON c.game_id = p.game_id AND c.ply = p.ply + 1
        WHERE p.normalized_fen IN (
            SELECT normalized_fen FROM positions
            GROUP BY normalized_fen HAVING COUNT(*) >= ?
        )
        GROUP BY p.normalized_fen, c.normalized_fen
        """,
        (min_count,),
    )
    con.commit()
    return con.execute("SELECT COUNT(*) FROM position_children").fetchone()[0]
