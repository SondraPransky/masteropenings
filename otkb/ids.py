"""Extraction du game_id (offline, STDLIB seule — utilisable en phase 1).

Module neutre partagé par l'ingestion (phase 1) et le downloader (phase 2) :
n'importe aucune dépendance lourde (python-chess/httpx), pour préserver
« phase 1 = stdlib seule ».


Formats rencontrés dans le CSV :
    https://lichess.org/787zsVup/black#48
    https://lichess.org/F8M8OS71#53
    https://lichess.org/MQSyb3KW
Le game_id est le 1er segment de chemin (8 caractères), sans /couleur ni #ply.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

_GAME_ID_LEN = 8
_SITE_RE = re.compile(r'\[Site\s+"[^"]*lichess\.org/([A-Za-z0-9]{8})', re.IGNORECASE)


def game_id_from_url(url: str | None) -> str | None:
    """Renvoie le game_id (8 car.) ou None si l'URL est vide/inexploitable."""
    if not url:
        return None
    segment = urlparse(url).path.lstrip("/").split("/", 1)[0]
    segment = segment.split("#", 1)[0]
    if len(segment) < _GAME_ID_LEN:
        return None
    return segment[:_GAME_ID_LEN]


def game_id_from_pgn(pgn: str) -> str | None:
    """Extrait le game_id depuis l'en-tête [Site "...lichess.org/xxxxxxxx"]."""
    m = _SITE_RE.search(pgn)
    return m.group(1) if m else None
