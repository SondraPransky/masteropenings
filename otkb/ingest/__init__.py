"""Ingestion CSV passe 1 (v0.1, zéro réseau) — module Builder/Ingestion.

Inclut l'updater incrémental (`update_from_csv`, SPEC §F) : ré-appliquer un CSV
Lichess plus récent sans reconstruction complète.
"""

from .pipeline import IngestStats, ingest_csv
from .themes_asset import apply_themes_asset, load_theme_mapping
from .updater import UpdateStats, update_from_csv

__all__ = [
    "ingest_csv", "IngestStats", "apply_themes_asset", "load_theme_mapping",
    "update_from_csv", "UpdateStats",
]
