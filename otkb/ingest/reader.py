"""Lecture streaming du CSV Lichess (point 1 du pipeline).

Le module `csv` de la stdlib lit ligne à ligne : mémoire plate quel que soit le
volume (1,1 Go / ~6 M lignes). Aucune dépendance.

Colonnes (ordre officiel Lichess) :
    0 PuzzleId · 1 FEN · 2 Moves · 3 Rating · 4 RatingDeviation
    5 Popularity · 6 NbPlays · 7 Themes · 8 GameUrl · 9 OpeningTags
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

EXPECTED_HEADER = [
    "PuzzleId", "FEN", "Moves", "Rating", "RatingDeviation",
    "Popularity", "NbPlays", "Themes", "GameUrl", "OpeningTags",
]


class CsvFormatError(ValueError):
    """En-tête CSV inattendu (format Lichess changé ?)."""


@dataclass(frozen=True, slots=True)
class RawPuzzle:
    """Une ligne brute du CSV, champs nommés (pas encore normalisée)."""

    puzzle_id: str
    fen: str
    moves: str
    rating: str
    rating_deviation: str
    popularity: str
    nb_plays: str
    themes: str
    game_url: str
    opening_tags: str


def iter_raw_puzzles(csv_path: Path | str) -> Iterator[RawPuzzle]:
    """Itère les lignes du CSV en streaming, après contrôle de l'en-tête."""
    path = Path(csv_path)
    with path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header != EXPECTED_HEADER:
            raise CsvFormatError(
                f"En-tête inattendu.\n  attendu : {EXPECTED_HEADER}\n  reçu    : {header}"
            )
        for row in reader:
            if len(row) != 10:  # ligne corrompue -> on saute
                continue
            yield RawPuzzle(
                puzzle_id=row[0], fen=row[1], moves=row[2], rating=row[3],
                rating_deviation=row[4], popularity=row[5], nb_plays=row[6],
                themes=row[7], game_url=row[8], opening_tags=row[9],
            )
