"""Export PGN des exercices d'une ouverture (offline, exercices minimaux)."""

from __future__ import annotations

import types
from pathlib import Path

from ..db import Database
from ..explorer.insights import popularity_pushable, through_query
from ..logging_setup import get_logger
from ..pgn import ExercisePgnError, annotated_exercise, minimal_exercise

logger = get_logger(__name__)

_SELECT = """
WITH matched AS (
    SELECT DISTINCT po.puzzle_id
    FROM puzzle_openings po JOIN openings o ON o.opening_id = po.opening_id
    WHERE o.family = :q OR o.tag = :q
)
SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.game_url, p.opening_tags, p.themes
FROM matched m JOIN puzzles p ON p.puzzle_id = m.puzzle_id
ORDER BY p.popularity DESC
"""


def _keys(row) -> set[str]:
    """Noms de colonnes disponibles sur une ligne sqlite3.Row."""
    try:
        return set(row.keys())
    except AttributeError:
        return set()


def _one_exercise(r, *, annotated: bool) -> str | None:
    """PGN d'un puzzle : partie complète annotée si demandé et possible, sinon
    exercice minimal (position du puzzle). None si le puzzle est inexploitable."""
    puzzle = types.SimpleNamespace(
        puzzle_id=r["puzzle_id"], fen=r["fen"], moves=r["moves"],
        rating=r["rating"], game_url=r["game_url"],
        opening_tags=r["opening_tags"], themes=r["themes"],
    )
    game_pgn = r["game_pgn"] if "game_pgn" in _keys(r) else None
    if annotated and game_pgn:
        # Import paresseux : python-chess (extra analysis) uniquement si annoté.
        from ..reconstruct import replay_to_puzzle

        try:
            lead, _ = replay_to_puzzle(game_pgn, puzzle.fen)
            return annotated_exercise(puzzle, lead)
        except ExercisePgnError as exc:
            # la partie ne recolle pas à la position → repli sur minimal
            logger.debug("Puzzle %s : repli minimal (%s)", puzzle.puzzle_id, exc)
    try:
        return minimal_exercise(puzzle)
    except ExercisePgnError as exc:
        logger.warning("Puzzle %s ignoré : %s", puzzle.puzzle_id, exc)
        return None


def _write_exercises(rows, out_path: Path | str, *, annotated: bool = False) -> int:
    """Écrit les exercices PGN d'un jeu de lignes. Renvoie le nombre écrit."""
    out = Path(out_path)
    written = 0
    with out.open("w", encoding="utf-8") as fh:
        for r in rows:
            pgn = _one_exercise(r, annotated=annotated)
            if pgn is None:
                continue
            fh.write(pgn)
            fh.write("\n\n")
            written += 1
    return written


def export_opening(
    db: Database, opening: str, out_path: Path | str, limit: int | None = None
) -> int:
    """Écrit les exercices PGN d'une ouverture dans `out_path`. Renvoie le nombre écrit."""
    sql = _SELECT + (f" LIMIT {int(limit)}" if limit else "")
    rows = db.conn.execute(sql, {"q": opening}).fetchall()
    written = _write_exercises(rows, out_path)
    logger.info("Export %s : %d exercices → %s", opening, written, Path(out_path))
    return written


def export_through_position(
    db: Database, normalized_fen: str, out_path: Path | str,
    limit: int | None = None, *, sort: str = "popularity",
    rating_min: int | None = None, rating_max: int | None = None,
    annotated: bool = False,
) -> int:
    """Écrit en lot les exercices PGN des puzzles PASSANT PAR une position.

    Le cas d'usage : depuis une position d'ouverture (p. ex. une Najdorf au coup
    15), rassembler tous les puzzles qui surviennent plus loin dans ces parties,
    dans un seul PGN à donner à un élève. `sort` ∈ {popularity, rating_asc,
    rating_desc} ; `rating_min`/`rating_max` bornent la difficulté (batch calibré
    au niveau de l'élève). Si `annotated`, chaque exercice est la PARTIE COMPLÈTE
    depuis le coup 1 avec `{[%start]}` (repli sur minimal si la partie manque ou
    ne recolle pas) — ces puzzles viennent de la passe 2, donc leur partie est en
    principe disponible dans `games`.
    """
    # La SÉLECTION (filtre, tri, pagination) vient de l'explorateur, qui en est le
    # propriétaire : l'export ne décide que des colonnes à hydrater. Avoir eu ici sa
    # propre requête coûtait 14,3 s par dossier (filtre sur `p.rating` via jointure)
    # et un tri qui divergeait de celui affiché à l'écran.
    game_join = "LEFT JOIN games g ON g.game_id = p.game_id " if annotated else ""
    game_col = ", g.pgn AS game_pgn" if annotated else ""
    sql, params = through_query(
        normalized_fen,
        columns=("p.puzzle_id, p.fen, p.moves, p.rating, p.game_url, "
                 f"p.opening_tags, p.themes{game_col}"),
        extra_join=game_join, sort=sort,
        limit=limit or None,        # 0 comme None = tout le lot (contrat historique)
        rating_min=rating_min, rating_max=rating_max,
        pop_cached=sort == "popularity" and popularity_pushable(db, normalized_fen),
    )
    rows = db.conn.execute(sql, params).fetchall()
    written = _write_exercises(rows, out_path, annotated=annotated)
    logger.info("Export position %s : %d exercices (%s) → %s", normalized_fen,
                written, "annoté" if annotated else "minimal", Path(out_path))
    return written
