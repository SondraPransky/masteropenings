"""Génère `openings_moves.json` : tag d'ouverture → coups UCI.

Outil de BUILD (réseau, ponctuel — hors des règles « zéro réseau » du pipeline).
Source = dataset officiel Lichess `chess-openings` (le même qui étiquette les
puzzles), converti SAN→UCI (python-chess) et restreint aux tags présents en base
pour n'offrir que des ouvertures réellement jouables.

    python -m otkb.assets.build_openings_moves            # → otkb/assets/openings_moves.json

Régénérer seulement si le dataset amont change ou si de nouveaux tags apparaissent.
"""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

import chess

from ..db import Database

_BASE = "https://raw.githubusercontent.com/lichess-org/chess-openings/master/{}.tsv"
_OUT = Path(__file__).with_name("openings_moves.json")


def _name_to_tag(name: str) -> str:
    """« Sicilian Defense: Najdorf Variation » → « Sicilian_Defense_Najdorf_Variation »."""
    return re.sub(r"\s+", "_", re.sub(r"[^\w\s-]", "", name).strip())


def _san_to_uci(pgn: str) -> str | None:
    board = chess.Board()
    for tok in pgn.split():
        tok = re.sub(r"^\d+\.+", "", tok)
        if not tok or tok == "*":
            continue
        try:
            board.push_san(tok)
        except ValueError:
            return None
    return " ".join(m.uci() for m in board.move_stack)


def build(db_path: str = "data/otkb.db") -> int:
    data_tags = {
        r[0] for r in Database(db_path).conn.execute(
            "SELECT DISTINCT tag FROM openings WHERE tag IS NOT NULL"
        )
    }
    moves: dict[str, str] = {}
    for letter in "abcde":
        txt = urllib.request.urlopen(_BASE.format(letter), timeout=30).read().decode("utf-8")
        for line in txt.splitlines()[1:]:
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            uci = _san_to_uci(parts[2])
            if uci is not None:
                moves[_name_to_tag(parts[1])] = uci
    playable = {t: moves[t] for t in data_tags if t in moves}
    _OUT.write_text(json.dumps(playable, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(playable)


if __name__ == "__main__":
    n = build()
    print(f"{n} ouvertures → {_OUT}")
