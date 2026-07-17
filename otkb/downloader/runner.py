"""Runner de la passe 2 (point 14) : fetch par lots → reconstruction → positions.

Le `fetch` est INJECTÉ (callable ids->PGN concaténé) : offline-testable avec un
faux fetch ; en réel, on branche LichessClient.export_ids. Reprenable : chaque
partie traitée est marquée dans `downloads`, un run relancé reprend les pending.
"""

from __future__ import annotations

import types
from dataclasses import dataclass
from typing import Callable

from ..db import Database
from ..logging_setup import get_logger
from ..reconstruct import ReconstructError, store_reconstruction
from .client import split_pgns
from .ids import game_id_from_pgn
from .queue import iter_id_batches, mark

logger = get_logger(__name__)

Fetch = Callable[[list[str]], str]


@dataclass(slots=True)
class DownloadStats:
    batches: int = 0
    games_fetched: int = 0
    games_reconstructed: int = 0
    positions_indexed: int = 0
    errors: int = 0

    def summary(self) -> str:
        return (
            f"lots={self.batches} parties={self.games_fetched} "
            f"reconstruites={self.games_reconstructed} "
            f"positions={self.positions_indexed} erreurs={self.errors}"
        )


def _puzzles_for_game(db: Database, game_id: str) -> list:
    # jointure indexée (idx_puzzles_gameid), pas de LIKE '%...%' (scan complet)
    return db.conn.execute(
        "SELECT puzzle_id, fen, moves, rating, opening_tags, themes "
        "FROM puzzles WHERE game_id = ?",
        (game_id,),
    ).fetchall()


def run_download(
    db: Database, fetch: Fetch, *, batch_size: int = 300, max_batches: int | None = None
) -> DownloadStats:
    """Traite la file `downloads` par lots. Renvoie les stats."""
    stats = DownloadStats()
    for i, batch in enumerate(iter_id_batches(db, batch_size)):
        if max_batches is not None and i >= max_batches:
            break
        stats.batches += 1
        # un lot qui échoue (réseau, abandon, PGN illisible) ne doit pas tuer un
        # run de 20 h : on marque ses parties en error (reprises au prochain run)
        # et on continue. On englobe fetch ET le découpage des PGN reçus.
        try:
            stream = fetch(batch)
            by_id: dict[str, str] = {}
            for pgn in split_pgns(stream):
                gid = game_id_from_pgn(pgn)
                if gid:
                    by_id[gid] = pgn
        except Exception as exc:  # noqa: BLE001 - robustesse run longue durée
            logger.error("Lot %d échoué (%s) — marqué error, on continue", i, exc)
            for gid in batch:
                mark(db, gid, "error", str(exc)[:200])
            stats.errors += len(batch)
            continue

        for gid in batch:
            pgn = by_id.get(gid)
            if pgn is None:
                mark(db, gid, "error", "absente de la réponse Lichess")
                stats.errors += 1
                continue
            stats.games_fetched += 1

            # filet large : AUCUNE exception d'une partie (rejeu, verrou DB, PGN
            # exotique…) ne doit tuer un run de plusieurs heures. Marquée error →
            # reprise au prochain run (iter_id_batches ré-inclut les 'error').
            try:
                ok, err = False, None
                for pr in _puzzles_for_game(db, gid):
                    puzzle = types.SimpleNamespace(**dict(pr))
                    try:
                        stats.positions_indexed += store_reconstruction(db, gid, pgn, puzzle)
                        ok = True
                    except ReconstructError as exc:
                        err = str(exc)
                if ok:
                    mark(db, gid, "done")
                    stats.games_reconstructed += 1
                else:
                    mark(db, gid, "error", err or "aucun puzzle reconstruit")
                    stats.errors += 1
            except Exception as exc:  # noqa: BLE001 - robustesse run longue durée
                logger.error("Partie %s échouée (%s) — marquée error, on continue",
                             gid, exc)
                try:
                    mark(db, gid, "error", str(exc)[:200])
                except Exception:  # noqa: BLE001 - même le mark peut échouer
                    pass
                stats.errors += 1

        if stats.batches % 20 == 0:
            logger.info("… %s", stats.summary())

    logger.info("Run download terminé : %s", stats.summary())
    return stats
