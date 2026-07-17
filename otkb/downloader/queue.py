"""File de téléchargement `downloads` : enqueue, lots de 300, reprise (offline).

status ∈ {pending, done, error, skipped}. La reprise est native : on ne (re)traite
que les `pending`/`error`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterator

from ..db import Database
from ..logging_setup import get_logger
from .ids import game_id_from_url

logger = get_logger(__name__)
BATCH = 300  # limite de l'endpoint Lichess /api/games/export/_ids


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def enqueue_pending(db: Database) -> int:
    """Peuple `downloads` (pending) depuis les game_url des puzzles. Idempotent.

    Renvoie le nombre de nouvelles parties enfilées.
    """
    rows = db.conn.execute(
        "SELECT DISTINCT game_url FROM puzzles WHERE game_url IS NOT NULL"
    ).fetchall()
    added = 0
    for r in rows:
        gid = game_id_from_url(r["game_url"])
        if not gid:
            continue
        cur = db.conn.execute(
            "INSERT OR IGNORE INTO downloads(game_id, game_url, status, updated_at) "
            "VALUES(?,?,'pending',?)",
            (gid, r["game_url"], _now()),
        )
        added += cur.rowcount
    db.commit()
    logger.info("File download : %d parties en attente (%d nouvelles)",
                db.count("downloads"), added)
    return added


def enqueue_opening(db: Database, opening: str) -> int:
    """Enfile SEULEMENT les parties des puzzles d'une ouverture (famille ou tag).

    Permet un download priorisé/à la demande : « je veux les tactiques de
    l'Italienne » → on ne télécharge que ces ~parties, en minutes.
    """
    rows = db.conn.execute(
        """
        SELECT DISTINCT p.game_url
        FROM puzzles p
        JOIN puzzle_openings po ON po.puzzle_id = p.puzzle_id
        JOIN openings o ON o.opening_id = po.opening_id
        WHERE (o.family = :q OR o.tag = :q) AND p.game_url IS NOT NULL
        """,
        {"q": opening},
    ).fetchall()
    added = 0
    for r in rows:
        gid = game_id_from_url(r["game_url"])
        if not gid:
            continue
        added += db.conn.execute(
            "INSERT OR IGNORE INTO downloads(game_id, game_url, status, updated_at) "
            "VALUES(?,?,'pending',?)",
            (gid, r["game_url"], _now()),
        ).rowcount
    db.commit()
    logger.info("File download (%s) : %d parties enfilées", opening, added)
    return added


def iter_id_batches(db: Database, size: int = BATCH) -> Iterator[list[str]]:
    """Itère les game_id encore à télécharger, par lots de `size`."""
    rows = db.conn.execute(
        "SELECT game_id FROM downloads WHERE status IN ('pending','error') "
        "ORDER BY game_id"
    ).fetchall()
    ids = [r["game_id"] for r in rows]
    for i in range(0, len(ids), size):
        yield ids[i:i + size]


def mark(db: Database, game_id: str, status: str, error: str | None = None) -> None:
    """Met à jour le statut d'une partie (done/error/skipped)."""
    db.conn.execute(
        "UPDATE downloads SET status=?, attempts=attempts+1, last_error=?, updated_at=? "
        "WHERE game_id=?",
        (status, error, _now(), game_id),
    )
    db.commit()
