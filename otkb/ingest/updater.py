"""Updater incrémental (SPEC §F) : ré-ingérer un CSV Lichess plus récent.

Aucune reconstruction complète : l'ingestion passe 1 est idempotente
(`INSERT OR IGNORE` par `puzzle_id`), donc réappliquer un CSV plus récent
n'ajoute QUE les nouveaux puzzles et les nouveaux tags/thèmes. On mesure l'ajout
réel (avant/après), on le journalise dans `updates`, et on rafraîchit les caches
d'ADN s'ils avaient été construits (sinon ils seraient périmés). Zéro réseau.

Note : les nouveaux puzzles ne sont pas enfilés pour la passe 2 ici — lancer
`otkb download-prepare` puis `download-run` si l'on veut leurs positions.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from ..db import Database
from ..logging_setup import get_logger
from .pipeline import IngestStats, ingest_csv

logger = get_logger(__name__)


@dataclass(slots=True)
class UpdateStats:
    source_label: str | None
    puzzles_before: int
    puzzles_added: int
    openings_after: int
    caches_rebuilt: bool
    ingest: IngestStats

    def summary(self) -> str:
        label = self.source_label or "(sans label)"
        caches = "oui" if self.caches_rebuilt else "non"
        return (
            f"Mise à jour {label} : +{self.puzzles_added:,} puzzles "
            f"(base {self.puzzles_before:,} -> {self.puzzles_before + self.puzzles_added:,}, "
            f"{self.openings_after:,} ouvertures ; caches ADN reconstruits : {caches})\n"
            f"  ingestion : {self.ingest.summary()}"
        )


def update_from_csv(
    db: Database,
    csv_path: Path | str,
    fullmove_max: int,
    *,
    source_label: str | None = None,
    rebuild_caches: bool = True,
    limit: int | None = None,
) -> UpdateStats:
    """Applique un CSV plus récent en incrémental. Renvoie le bilan.

    `rebuild_caches` : ne reconstruit les caches d'ADN que s'ils existaient déjà
    (évite de les créer inutilement lors d'un simple ajout de données brutes).
    """
    before = db.count("puzzles")

    # ingest_csv est idempotent + fait déjà recompute_families() et l'asset thèmes.
    ingest = ingest_csv(db, csv_path, fullmove_max=fullmove_max, limit=limit)
    added = db.count("puzzles") - before

    caches_rebuilt = False
    if rebuild_caches and added:
        # Import paresseux (insights.py importe python-chess en tête).
        from ..explorer.insights import build_family_dna_cache, family_stats_ready

        if family_stats_ready(db):
            logger.info("Reconstruction des caches d'ADN après mise à jour…")
            build_family_dna_cache(db)
            caches_rebuilt = True

    applied_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    db.conn.execute(
        "INSERT INTO updates(source_label, applied_at, puzzles_added, status) "
        "VALUES(?,?,?,?)",
        (source_label, applied_at, added, "applied"),
    )
    db.commit()

    stats = UpdateStats(
        source_label=source_label,
        puzzles_before=before,
        puzzles_added=added,
        openings_after=db.count("openings"),
        caches_rebuilt=caches_rebuilt,
        ingest=ingest,
    )
    logger.info("Updater : %s", stats.summary().splitlines()[0])
    return stats
