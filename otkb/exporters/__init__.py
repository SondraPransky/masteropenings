"""Exporters (module Exporters).

- `export_opening` : PGN des exercices d'une ouverture (exercices MINIMAUX depuis
  le FEN, offline — marche pour tout le corpus sans download).
- `export_through_position` : PGN en lot des puzzles PASSANT PAR une position
  (index `positions`) — un dossier d'exercices à donner à un élève.
- `export_web` : artefact SQLite RÉDUIT pour le web (sql.js), dérivé de otkb.db —
  le seul pont usine → web (SPEC §G/H).
"""

from .pgn_export import export_opening, export_through_position
from .web_cover import render_cover
from .web_export import WebExportStats, export_web

__all__ = [
    "export_opening", "export_through_position", "export_web", "WebExportStats",
    "render_cover",
]
