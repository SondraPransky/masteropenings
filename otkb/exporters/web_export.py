"""Export de l'ARTEFACT WEB RÉDUIT (SPEC §G/H).

Dérive de `data/otkb.db` une petite base SQLite consommable par sql.js (WASM
local, offline) : le seul pont usine → web. On garde le corpus de puzzles
(colonnes élaguées), les jonctions, les dimensions et les caches d'ADN ; on
écarte le bloc PASSE 2 (`positions` 22 M lignes, `games` + blobs PGN,
`downloads`, `updates`) qui pèse l'essentiel de la base.

Stratégie : base cible neuve → PRAGMA d'accélération (cible jetable, aucune
durabilité requise) → schéma réduit (tables) → ATTACH source en lecture seule →
`INSERT ... SELECT` table par table → index → VACUUM. Stdlib `sqlite3` seule,
aucun réseau. Les PRAGMA (`synchronous=OFF`, `journal_mode=MEMORY`, `page_size`
8192) accélèrent l'export d'environ 2,2× sans changer le contenu.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .. import SCHEMA_VERSION
from ..db import Database
from ..logging_setup import get_logger

logger = get_logger(__name__)

_SCHEMA_PATH = Path(__file__).with_name("web_schema.sql")

# Tables copiées : nom → colonnes (listes explicites = robustesse si le schéma
# source gagne des colonnes ; pour `puzzles` c'est le cœur de l'élagage).
_COPY: dict[str, tuple[str, ...]] = {
    "settings": ("key", "value"),
    "puzzles": (
        "puzzle_id", "fen", "normalized_fen", "fullmove", "side_to_move",
        "moves", "rating", "popularity", "nb_plays",
    ),
    "openings": ("opening_id", "tag", "family", "variation", "name", "eco"),
    "themes": ("theme_id", "name", "is_motif", "label_fr"),
    "puzzle_openings": ("puzzle_id", "opening_id"),
    "puzzle_themes": ("puzzle_id", "theme_id"),
    "statistics": (
        "scope", "key", "puzzle_count", "avg_rating", "avg_fullmove",
        "min_rating", "max_rating",
    ),
    "family_motifs": ("family", "slug", "label_fr", "count"),
    "family_top_puzzles": (
        "family", "rank", "puzzle_id", "rating", "popularity", "themes",
    ),
    "puzzle_analysis": ("puzzle_id", "critical_squares", "sacrifices"),
}

# Index reconstruits APRÈS la copie de masse (mêmes noms que db/schema.sql).
_INDEXES: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_puzzles_normfen  ON puzzles(normalized_fen)",
    "CREATE INDEX IF NOT EXISTS idx_puzzles_fullmove ON puzzles(fullmove)",
    "CREATE INDEX IF NOT EXISTS idx_puzzles_rating   ON puzzles(rating)",
    "CREATE INDEX IF NOT EXISTS idx_openings_family  ON openings(family)",
    "CREATE INDEX IF NOT EXISTS idx_themes_motif     ON themes(is_motif)",
    "CREATE INDEX IF NOT EXISTS idx_po_opening       ON puzzle_openings(opening_id)",
    "CREATE INDEX IF NOT EXISTS idx_pt_theme         ON puzzle_themes(theme_id)",
)


@dataclass(slots=True)
class WebExportStats:
    """Bilan d'un export web : lignes par table, taille finale, chemin."""

    path: Path
    rows: dict[str, int] = field(default_factory=dict)
    bytes: int = 0

    def summary(self) -> str:
        total = sum(self.rows.values())
        mib = self.bytes / (1024 * 1024)
        lines = [f"Artefact web -> {self.path} ({mib:.1f} Mio, {total:,} lignes)"]
        for name, n in self.rows.items():
            lines.append(f"  {name:20} {n:>12,}")
        return "\n".join(lines)


# Jonctions filtrées sur l'ensemble des puzzles conservés (quand min_popularity>0).
# `puzzles` étant copié en premier, on borne par `puzzle_id IN (main.puzzles)`.
_PUZZLE_FILTERED = ("puzzle_openings", "puzzle_themes", "puzzle_analysis")


def _copy_where(table: str, min_popularity: int) -> str:
    """Clause WHERE de copie d'une table (allègement optionnel par popularité)."""
    if min_popularity <= 0:
        return ""
    if table == "puzzles":
        # popularité suffisante OU référencé par « meilleurs puzzles » (jouables).
        return (
            " WHERE COALESCE(popularity, 0) >= :n "
            "OR puzzle_id IN (SELECT puzzle_id FROM src.family_top_puzzles)"
        )
    if table in _PUZZLE_FILTERED:
        return " WHERE puzzle_id IN (SELECT puzzle_id FROM puzzles)"
    return ""


def export_web(
    source: Database,
    out_path: Path | str,
    *,
    build_caches: bool = True,
    vacuum: bool = True,
    min_popularity: int = 0,
) -> WebExportStats:
    """Construit l'artefact web réduit depuis `source`. Idempotent (écrase la cible).

    - `build_caches` : (re)calcule les caches d'ADN dans la source s'ils sont
      absents, pour que l'artefact les embarque toujours.
    - `vacuum` : compacte la cible (recommandé ; réduit sensiblement la taille).
    - `min_popularity` : si >0, ne garde que les puzzles de popularité ≥ ce seuil
      (plus ceux des « meilleurs puzzles », toujours jouables) et les jonctions
      associées — pour un artefact allégé. Les caches d'ADN (statistics /
      family_motifs) restent calculés sur le corpus COMPLET.
    """
    if build_caches:
        # Import paresseux : les caches sont du pur SQL, mais insights.py importe
        # python-chess en tête — on garde ce chemin « stdlib seule » à l'import.
        from ..explorer.insights import build_family_dna_cache, family_stats_ready

        if not family_stats_ready(source):
            logger.info("Caches d'ADN absents — construction avant export…")
            build_family_dna_cache(source)

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)  # base cible neuve

    # uri=True : requis pour ATTACH avec un URI file: (source en lecture seule).
    con = sqlite3.connect(out.resolve().as_uri(), uri=True)
    try:
        # PRAGMA d'accélération : la cible est un artefact JETABLE reconstructible,
        # donc aucune garantie de durabilité n'est requise (on rebuild en cas de
        # crash). Mesuré ~2,2× plus rapide. `page_size` DOIT précéder toute écriture
        # (base neuve, encore sans page) ; 8192 = moins de pages, VACUUM plus rapide
        # et fichier légèrement plus compact.
        con.execute("PRAGMA page_size = 8192")
        con.execute("PRAGMA journal_mode = MEMORY")
        con.execute("PRAGMA synchronous = OFF")
        con.execute("PRAGMA temp_store = MEMORY")
        con.execute("PRAGMA cache_size = -262144")  # ~256 Mio de cache page
        con.executescript(_SCHEMA_PATH.read_text(encoding="utf-8"))

        # Source en LECTURE SEULE : aucun risque pour la base de production.
        src_uri = source.path.resolve().as_uri() + "?mode=ro"
        con.execute("ATTACH DATABASE ? AS src", (src_uri,))
        params = {"n": min_popularity} if min_popularity > 0 else {}
        for table, cols in _COPY.items():
            collist = ", ".join(cols)
            where = _copy_where(table, min_popularity)
            con.execute(
                f"INSERT INTO {table} ({collist}) "
                f"SELECT {collist} FROM src.{table}{where}",
                params,
            )
        con.commit()  # clôt la transaction avant DETACH (sinon « database is locked »)
        con.execute("DETACH DATABASE src")

        # Marqueurs d'artefact (écrasent les valeurs copiées si présentes).
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        src_version = source.get_setting("schema_version", str(SCHEMA_VERSION))
        for key, value in (
            ("artifact", "web"),
            ("exported_at", now),
            ("source_schema_version", src_version),
            ("min_popularity", str(min_popularity)),
        ):
            con.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

        for ddl in _INDEXES:
            con.execute(ddl)
        con.commit()

        if vacuum:
            con.execute("VACUUM")

        rows = {
            table: con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in _COPY
        }
    finally:
        con.close()

    stats = WebExportStats(path=out, rows=rows, bytes=out.stat().st_size)
    logger.info(
        "Artefact web écrit : %s (%.1f Mio)", out, stats.bytes / (1024 * 1024)
    )
    return stats
