"""Chargement de l'asset thèmes (point 6) : enrichit `themes` en is_motif/label_fr.

Lit le mapping curated (assets/themes.json) et met à jour les lignes `themes`
déjà présentes en base. Les thèmes absents de l'asset restent NULL ; les entrées
d'asset sans thème correspondant en base sont ignorées. Idempotent.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..assets import THEMES_JSON
from ..db import Database
from ..logging_setup import get_logger

logger = get_logger(__name__)


def load_theme_mapping(path: Path | str = THEMES_JSON) -> dict[str, dict]:
    """Charge le mapping, en ignorant les clés de méta (préfixe '_')."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


def apply_themes_asset(db: Database, path: Path | str = THEMES_JSON) -> int:
    """Renseigne is_motif/label_fr sur les thèmes en base. Renvoie le nb mis à jour."""
    mapping = load_theme_mapping(path)
    updated = 0
    for name, meta in mapping.items():
        cur = db.conn.execute(
            "UPDATE themes SET is_motif = ?, label_fr = ? WHERE name = ?",
            (int(meta["is_motif"]), meta["label_fr"], name),
        )
        updated += cur.rowcount
    db.commit()

    unmapped = db.conn.execute(
        "SELECT COUNT(*) AS n FROM themes WHERE is_motif IS NULL"
    ).fetchone()["n"]
    logger.info("Asset thèmes appliqué : %d renseignés, %d non mappés", updated, unmapped)
    if unmapped:
        rows = db.conn.execute(
            "SELECT name FROM themes WHERE is_motif IS NULL ORDER BY name"
        ).fetchall()
        logger.warning("Thèmes hors asset : %s", ", ".join(r["name"] for r in rows))
    return updated
