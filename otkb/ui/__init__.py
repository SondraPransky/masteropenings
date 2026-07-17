"""Explorateur interactif (v0.2, NiceGUI). Import paresseux de nicegui.

`run_ui` compose la page et démarre le serveur local. Aucune dépendance réseau :
tout sort de la base en banque. nicegui est un extra (`pip install -e .[ui]`).
"""

from __future__ import annotations

from pathlib import Path


def run_ui(
    db_path: str | Path,
    *,
    host: str = "127.0.0.1",
    port: int = 8080,
    show: bool = True,
) -> None:
    """Démarre le serveur NiceGUI (bloquant) après avoir chauffé les caches."""
    from nicegui import ui  # extra ui

    from .app import build
    from .data import UiData

    data = UiData(str(db_path))
    # (plus de ensure_stats : les caches d'ADN par famille ne servaient qu'aux
    # onglets Meilleurs puzzles / Comparaison, supprimés le 16/07 — le CLI
    # `adn` / `export-web` construit les siens)
    build(data)
    ui.run(
        host=host,
        port=port,
        title="OTKB — Explorateur tactique",
        reload=False,
        show=show,
        native=False,
    )


__all__ = ["run_ui"]
