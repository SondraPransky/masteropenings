"""Downloader de parties (points 8-9, passe 2 / v0.4).

Stratégie (SPEC §D-ter) : adressage direct par `game_id`, endpoint bulk `_ids`
(≤300/req), SÉQUENTIEL + backoff sur 429 (jamais parallèle). Token optionnel.

Découpage :
  - ids.py    : extraction game_id depuis GameUrl (offline, testé)
  - queue.py  : file `downloads` (enqueue, lots de 300, reprise) (offline, testé)
  - client.py : appels réseau httpx (import paresseux) — exécuté seulement en v0.4
"""

from .ids import game_id_from_pgn, game_id_from_url
from .queue import enqueue_opening, enqueue_pending, iter_id_batches, mark
from .runner import DownloadStats, run_download

__all__ = [
    "game_id_from_url", "game_id_from_pgn", "enqueue_pending", "enqueue_opening",
    "iter_id_batches", "mark", "run_download", "DownloadStats",
]
