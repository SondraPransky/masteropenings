"""Pipeline d'ingestion passe 1 (points 2→5).

2. Filtrer : OpeningTags ≠ ∅ ET fullmove(FEN) < seuil.
3. Normaliser : FEN 4 champs, fullmove, side, parser tags/themes.
4. Insérer : puzzles + dimensions + jonctions (idempotent).
5. Post-pass global : recompute_families().

Zéro réseau. Interruptible/reprenable (INSERT OR IGNORE + commits par lot).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..db import Database
from ..fen import InvalidFenError, parse_fen
from ..logging_setup import get_logger
from ..models import PuzzleRow
from ..ids import game_id_from_url
from ..openings import parse_opening_tags
from .reader import iter_raw_puzzles
from .themes_asset import apply_themes_asset

logger = get_logger(__name__)


@dataclass(slots=True)
class IngestStats:
    read: int = 0          # lignes lues
    kept: int = 0          # puzzles retenus (insérés)
    skipped_no_tags: int = 0
    skipped_deep: int = 0  # fullmove >= seuil
    errors: int = 0        # lignes invalides (FEN...)

    def summary(self) -> str:
        return (
            f"lues={self.read} gardées={self.kept} "
            f"(sans_tags={self.skipped_no_tags} trop_profond={self.skipped_deep} "
            f"erreurs={self.errors})"
        )


def _to_int(value: str) -> int | None:
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def ingest_csv(
    db: Database,
    csv_path: Path | str,
    fullmove_max: int,
    limit: int | None = None,
    batch_size: int = 5000,
    log_every: int = 100_000,
) -> IngestStats:
    """Ingère le CSV dans `db` selon le filtre passe 1. Renvoie les stats."""
    stats = IngestStats()

    # PRAGMA d'accélération pour le chargement de masse (base = cache dérivé).
    db.conn.execute("PRAGMA synchronous = OFF")
    db.conn.execute("PRAGMA journal_mode = MEMORY")
    db.conn.execute("PRAGMA temp_store = MEMORY")

    for raw in iter_raw_puzzles(csv_path):
        stats.read += 1

        if not raw.opening_tags:
            stats.skipped_no_tags += 1
        else:
            try:
                info = parse_fen(raw.fen)
            except InvalidFenError:
                stats.errors += 1
            else:
                if info.fullmove >= fullmove_max:
                    stats.skipped_deep += 1
                else:
                    puzzle = PuzzleRow(
                        puzzle_id=raw.puzzle_id,
                        fen=raw.fen,
                        normalized_fen=info.normalized,
                        fullmove=info.fullmove,
                        side_to_move=info.side_to_move,
                        moves=raw.moves,
                        rating=_to_int(raw.rating),
                        rating_deviation=_to_int(raw.rating_deviation),
                        popularity=_to_int(raw.popularity),
                        nb_plays=_to_int(raw.nb_plays),
                        game_url=raw.game_url or None,
                        game_id=game_id_from_url(raw.game_url),
                        opening_tags=raw.opening_tags,
                        themes=raw.themes or None,
                    )
                    db.insert_puzzle(
                        puzzle,
                        parse_opening_tags(raw.opening_tags),
                        raw.themes.split(),
                    )
                    stats.kept += 1
                    if stats.kept % batch_size == 0:
                        db.commit()

        if stats.read % log_every == 0:
            logger.info("… %s", stats.summary())
        if limit is not None and stats.read >= limit:
            break

    db.commit()
    logger.info("Ingestion terminée : %s", stats.summary())

    # Point 5 : post-pass global des familles.
    db.recompute_families()
    # Point 6 : enrichir les thèmes (is_motif / label_fr) depuis l'asset.
    apply_themes_asset(db)
    return stats
