"""Assets statiques offline (mappings curated). Chargés en base à l'ingestion."""

from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parent
THEMES_JSON = ASSETS_DIR / "themes.json"
