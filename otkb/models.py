"""Dataclasses du domaine (SPEC §6 : dataclasses exigées)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class PuzzleRow:
    """Un puzzle prêt à insérer, champs bruts + dérivés (cf. table Puzzles)."""

    puzzle_id: str
    fen: str
    normalized_fen: str
    fullmove: int
    side_to_move: str
    moves: str
    rating: int | None
    rating_deviation: int | None
    popularity: int | None
    nb_plays: int | None
    game_url: str | None
    opening_tags: str | None
    themes: str | None
    game_id: str | None = None   # extrait de game_url à l'ingestion
