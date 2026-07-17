"""Passe 2-bis : calcule et stocke les signaux de tous les puzzles (offline).

Reprenable : ne recalcule que les puzzles absents de `puzzle_analysis`.
"""

from __future__ import annotations

from ..db import Database
from ..logging_setup import get_logger
from .moves import analyze_solution

logger = get_logger(__name__)


def analyze_all(
    db: Database, limit: int | None = None, batch_size: int = 5000
) -> int:
    """Analyse les puzzles pas encore traités. Renvoie le nombre analysé."""
    db.conn.execute("PRAGMA synchronous = OFF")
    rows = db.conn.execute(
        """
        SELECT p.puzzle_id, p.fen, p.moves
        FROM puzzles p
        LEFT JOIN puzzle_analysis a ON a.puzzle_id = p.puzzle_id
        WHERE a.puzzle_id IS NULL
        """
        + (f" LIMIT {int(limit)}" if limit else "")
    ).fetchall()

    done = 0
    for r in rows:
        analysis = analyze_solution(r["fen"], r["moves"].split())
        db.conn.execute(
            "INSERT OR REPLACE INTO puzzle_analysis"
            "(puzzle_id, critical_squares, sacrifices) VALUES(?,?,?)",
            (
                r["puzzle_id"],
                " ".join(analysis.critical_squares),
                " ".join(s.token() for s in analysis.sacrifices),
            ),
        )
        done += 1
        if done % batch_size == 0:
            db.commit()
            logger.info("… %d puzzles analysés", done)
    db.commit()
    logger.info("Passe 2-bis terminée : %d puzzles analysés", done)
    return done
