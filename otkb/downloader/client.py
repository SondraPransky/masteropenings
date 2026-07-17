"""Client réseau Lichess (passe 2 / v0.4). httpx en import PARESSEUX.

N'est exécuté qu'au moment du download réel. La phase 1 n'importe jamais httpx.
Respecte la doc Lichess : séquentiel, backoff 60 s sur 429. Token optionnel.
"""

from __future__ import annotations

import time
from typing import Iterator

from ..logging_setup import get_logger

logger = get_logger(__name__)

EXPORT_IDS_URL = "https://lichess.org/api/games/export/_ids"
# on n'a besoin que des coups + en-têtes pour rejouer jusqu'au puzzle
_PARAMS = {"moves": "true", "tags": "true", "clocks": "false", "evals": "false"}


class LichessClient:
    """Enveloppe minimale autour de l'endpoint bulk `_ids`."""

    def __init__(self, token: str | None = None, timeout: float = 60.0) -> None:
        try:
            import httpx  # import paresseux : extra `pass2`
        except ImportError as exc:  # pragma: no cover - dépend de l'install
            raise RuntimeError(
                "httpx requis pour le download (pip install '.[pass2]')"
            ) from exc
        headers = {"Accept": "application/x-chess-pgn"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._httpx = httpx
        self._client = httpx.Client(timeout=timeout, headers=headers)

    def export_ids(self, game_ids: list[str], max_retries: int = 8) -> str:
        """Récupère le PGN concaténé d'un lot d'IDs (≤300).

        Robuste pour un run de longue durée : réessaie sur 429 (pause 60 s),
        erreurs serveur 5xx, et erreurs réseau transitoires (timeout/coupure).
        """
        body = ",".join(game_ids)
        httpx = self._httpx
        for attempt in range(max_retries):
            try:
                resp = self._client.post(EXPORT_IDS_URL, params=_PARAMS, content=body)
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                wait = min(60, 5 * (attempt + 1))
                logger.warning("Réseau (%s) — pause %ds (tentative %d)",
                               type(exc).__name__, wait, attempt + 1)
                time.sleep(wait)
                continue

            if resp.status_code == 429:
                logger.warning("429 — pause 60s (tentative %d)", attempt + 1)
                time.sleep(60)
                continue
            if resp.status_code >= 500:
                wait = min(60, 5 * (attempt + 1))
                logger.warning("Serveur %d — pause %ds", resp.status_code, wait)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.text
        raise RuntimeError("Lot abandonné après trop de réessais")

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "LichessClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def split_pgns(concatenated: str) -> Iterator[str]:
    """Découpe un flux de PGN concaténés en PGN individuels (séparés par ligne vide
    puis un nouvel en-tête [Event ...])."""
    current: list[str] = []
    for line in concatenated.splitlines():
        if line.startswith("[Event ") and current:
            yield "\n".join(current).strip()
            current = [line]
        else:
            current.append(line)
    if current and "".join(current).strip():
        yield "\n".join(current).strip()
