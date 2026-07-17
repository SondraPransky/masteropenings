"""Requêtes d'agrégation ADN (phase 1, pur SQL sur les métadonnées CSV).

Contenu v1 (6 lignes, toutes depuis le CSV) :
  - nombre de puzzles
  - rating moyen
  - coup moyen d'apparition (AVG fullmove)
  - motifs dominants % (thèmes is_motif=1)
  - variantes les plus tactiques (sous-ouvertures par volume)

L'agrégation se fait par FAMILLE (rollup) ou par TAG exact : l'argument matche
`openings.family` OU `openings.tag`. Comptage en DISTINCT puzzle_id (un puzzle
portant famille + variante n'est compté qu'une fois).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from ..db import Database

_PIECE_FR = {"P": "Pion", "N": "Cavalier", "B": "Fou", "R": "Tour", "Q": "Dame", "K": "Roi"}


@dataclass(slots=True)
class MotifShare:
    label: str          # label_fr
    slug: str           # nom Lichess
    count: int
    pct: float          # part des puzzles de l'ouverture portant ce motif


@dataclass(slots=True)
class VariationStat:
    tag: str
    name: str
    variation: str | None
    count: int


@dataclass(slots=True)
class Ranked:
    label: str
    count: int


_RATING_BANDS = [
    ("< 1200 (débutant)", "p.rating < 1200"),
    ("1200-1600 (interm.)", "p.rating >= 1200 AND p.rating < 1600"),
    ("1600-2000 (avancé)", "p.rating >= 1600 AND p.rating < 2000"),
    ("2000-2400 (expert)", "p.rating >= 2000 AND p.rating < 2400"),
    ("2400+ (maître)", "p.rating >= 2400"),
]


@dataclass(slots=True)
class OpeningDNA:
    query: str
    puzzle_count: int
    avg_rating: float | None
    avg_fullmove: float | None
    top_motifs: list[MotifShare]
    top_variations: list[VariationStat]
    rating_min: int | None = None
    rating_max: int | None = None
    rating_bands: list[Ranked] = field(default_factory=list)
    # signaux 2-bis (vides si la passe d'analyse n'a pas tourné)
    sacrificed_pieces: list[Ranked] = field(default_factory=list)
    sacrifice_squares: list[Ranked] = field(default_factory=list)
    critical_squares: list[Ranked] = field(default_factory=list)


# puzzles distincts rattachés à l'ouverture (famille OU tag exact)
_PUZZLES_CTE = """
WITH matched AS (
    SELECT DISTINCT po.puzzle_id
    FROM puzzle_openings po
    JOIN openings o ON o.opening_id = po.opening_id
    WHERE o.family = :q OR o.tag = :q
)
"""


def compute_dna(
    db: Database, query: str, top_motifs: int = 12, top_variations: int = 10
) -> OpeningDNA:
    """Calcule la fiche ADN d'une ouverture (famille ou tag)."""
    con = db.conn

    bands_sql = ",\n".join(
        f"SUM(CASE WHEN {cond} THEN 1 ELSE 0 END) AS band{i}"
        for i, (_, cond) in enumerate(_RATING_BANDS)
    )
    head = con.execute(
        _PUZZLES_CTE
        + f"""
        SELECT COUNT(*) AS n,
               AVG(p.rating)   AS avg_rating,
               AVG(p.fullmove) AS avg_fullmove,
               MIN(p.rating)   AS rating_min,
               MAX(p.rating)   AS rating_max,
               {bands_sql}
        FROM matched m JOIN puzzles p ON p.puzzle_id = m.puzzle_id
        """,
        {"q": query},
    ).fetchone()
    total = head["n"]

    rating_bands = [
        Ranked(label, head[f"band{i}"] or 0)
        for i, (label, _) in enumerate(_RATING_BANDS)
    ] if total else []

    motifs: list[MotifShare] = []
    variations: list[VariationStat] = []
    if total:
        for r in con.execute(
            _PUZZLES_CTE
            + """
            SELECT t.label_fr AS label, t.name AS slug, COUNT(*) AS c
            FROM matched m
            JOIN puzzle_themes pt ON pt.puzzle_id = m.puzzle_id
            JOIN themes t ON t.theme_id = pt.theme_id
            WHERE t.is_motif = 1
            GROUP BY t.theme_id
            ORDER BY c DESC
            LIMIT :lim
            """,
            {"q": query, "lim": top_motifs},
        ):
            motifs.append(
                MotifShare(
                    label=r["label"] or r["slug"], slug=r["slug"],
                    count=r["c"], pct=100.0 * r["c"] / total,
                )
            )

        # variantes = sous-ouvertures de la famille (variation non nulle), par volume
        for r in con.execute(
            """
            SELECT o.tag, o.name, o.variation, COUNT(DISTINCT po.puzzle_id) AS c
            FROM openings o
            JOIN puzzle_openings po ON po.opening_id = o.opening_id
            WHERE o.family = :q AND o.variation IS NOT NULL
            GROUP BY o.opening_id
            ORDER BY c DESC
            LIMIT :lim
            """,
            {"q": query, "lim": top_variations},
        ):
            variations.append(
                VariationStat(
                    tag=r["tag"], name=r["name"],
                    variation=r["variation"], count=r["c"],
                )
            )

    sac_pieces: list[Ranked] = []
    sac_squares: list[Ranked] = []
    crit_squares: list[Ranked] = []
    if total:
        rows = con.execute(
            _PUZZLES_CTE
            + """
            SELECT a.critical_squares AS crit, a.sacrifices AS sac
            FROM matched m JOIN puzzle_analysis a ON a.puzzle_id = m.puzzle_id
            """,
            {"q": query},
        ).fetchall()
        pieces, sacsq, crit = Counter(), Counter(), Counter()
        for r in rows:
            for token in (r["sac"] or "").split():          # "N@e6"
                piece, _, sq = token.partition("@")
                pieces[_PIECE_FR.get(piece, piece)] += 1
                if sq:
                    sacsq[sq] += 1
            for sq in (r["crit"] or "").split():
                crit[sq] += 1
        sac_pieces = [Ranked(l, c) for l, c in pieces.most_common(6)]
        sac_squares = [Ranked(l, c) for l, c in sacsq.most_common(8)]
        crit_squares = [Ranked(l, c) for l, c in crit.most_common(8)]

    return OpeningDNA(
        query=query,
        puzzle_count=total,
        avg_rating=head["avg_rating"],
        avg_fullmove=head["avg_fullmove"],
        top_motifs=motifs,
        top_variations=variations,
        rating_min=head["rating_min"],
        rating_max=head["rating_max"],
        rating_bands=rating_bands,
        sacrificed_pieces=sac_pieces,
        sacrifice_squares=sac_squares,
        critical_squares=crit_squares,
    )
