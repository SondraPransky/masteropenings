"""Minimal HTTP-GET-JSON helper over the standard library (no `requests` dependency).

Handles the two Lichess concerns we care about: a descriptive User-Agent and 429
rate-limit backoff (honouring ``Retry-After``). A 404 is returned as ``None`` (position
simply has no data), other HTTP errors propagate.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# 404 (cloud-eval: position not in the cloud) is signalled by returning None.
NOT_FOUND = object()


class HttpError(RuntimeError):
    def __init__(self, status: int, url: str, body: str = ""):
        super().__init__(f"HTTP {status} for {url}: {body[:200]}")
        self.status = status
        self.url = url


def get_json(
    base_url: str,
    params: dict[str, Any],
    *,
    user_agent: str,
    token: str | None = None,
    timeout: float = 30.0,
    max_retries: int = 5,
    retry_delay: float = 1.1,
) -> dict | None:
    """GET ``base_url?params`` and parse JSON.

    Returns the parsed dict, or ``None`` on 404. Retries on 429 up to ``max_retries``,
    waiting for ``Retry-After`` (or ``retry_delay``) between attempts. A Lichess API
    ``token`` (if given) is sent as a Bearer credential.
    """
    query = urllib.parse.urlencode(params, safe=",")
    url = f"{base_url}?{query}"
    headers = {"User-Agent": user_agent, "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    attempt = 0
    while True:
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read().decode("utf-8")
            if not body.strip():
                return None
            return json.loads(body)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            if exc.code == 429 and attempt < max_retries:
                retry_after = exc.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else retry_delay * (attempt + 1)
                time.sleep(max(wait, retry_delay))
                attempt += 1
                continue
            body = exc.read().decode("utf-8", "replace") if exc.fp else ""
            raise HttpError(exc.code, url, body) from exc
        except urllib.error.URLError as exc:
            # Transient network hiccup: retry a couple of times, then give up.
            if attempt < max_retries:
                time.sleep(retry_delay * (attempt + 1))
                attempt += 1
                continue
            raise HttpError(0, url, str(exc.reason)) from exc


def get_text(
    base_url: str,
    params: dict[str, Any],
    *,
    user_agent: str,
    accept: str = "text/plain",
    token: str | None = None,
    timeout: float = 120.0,
    max_retries: int = 5,
    retry_delay: float = 1.1,
) -> str:
    """GET ``base_url?params`` and return the raw response body as text.

    Same retry/backoff policy as :func:`get_json`, but for non-JSON payloads (the Lichess
    games export streams ``application/x-chess-pgn``). A 404 returns an empty string
    (the player simply has no games); other HTTP errors propagate as :class:`HttpError`.
    """
    query = urllib.parse.urlencode(params, safe=",")
    url = f"{base_url}?{query}" if params else base_url
    headers = {"User-Agent": user_agent, "Accept": accept}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    attempt = 0
    while True:
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return ""
            if exc.code == 429 and attempt < max_retries:
                retry_after = exc.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else retry_delay * (attempt + 1)
                time.sleep(max(wait, retry_delay))
                attempt += 1
                continue
            body = exc.read().decode("utf-8", "replace") if exc.fp else ""
            raise HttpError(exc.code, url, body) from exc
        except urllib.error.URLError as exc:
            if attempt < max_retries:
                time.sleep(retry_delay * (attempt + 1))
                attempt += 1
                continue
            raise HttpError(0, url, str(exc.reason)) from exc
