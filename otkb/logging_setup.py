"""Configuration du logging (SPEC §6 : logging exigé partout)."""

from __future__ import annotations

import logging
import sys

_CONFIGURED = False


def force_safe_stdio() -> None:
    """Rend stdout/stderr insensibles aux caractères non encodables.

    Sous Windows, une sortie REDIRIGÉE (fichier, pipe) est encodée en cp1252 :
    le moindre « ≥ », « → » ou « … » d'un print lève UnicodeEncodeError et tue la
    commande — vécu le 17/07, `build-counts` crashé APRÈS sa passe 1 (128 s
    perdues), alors que la même commande passait en console interactive (UTF-8).
    `errors="replace"` garde l'encodage du flux (l'affichage interactif ne change
    pas d'un pixel) et remplace l'inencodable par « ? » au lieu de planter :
    pour un outil local, une sortie légèrement dégradée vaut toujours mieux
    qu'un pipeline mort. À appeler en tête du CLI, avant tout print.
    """
    for stream in (sys.stdout, sys.stderr):
        # hasattr : flux remplacés (pytest capsys, io.StringIO…) sans reconfigure.
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")


def setup_logging(level: str = "INFO") -> None:
    """Configure le logging racine une seule fois."""
    global _CONFIGURED
    if _CONFIGURED:
        return
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
