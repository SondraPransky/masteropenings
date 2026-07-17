"""Importers — reconstruction depuis des bases externes (module Importers).

`games_dataset` : ingère le dataset pré-joint HuggingFace
`Lichess/chess-puzzles-with-games` (parties complètes) pour peupler `positions`
sans passer par l'API, sur les puzzles qu'il couvre. python-chess requis.
"""

from .games_dataset import DatasetStats, ingest_from_dataset, ingest_rows

__all__ = ["ingest_from_dataset", "ingest_rows", "DatasetStats"]
