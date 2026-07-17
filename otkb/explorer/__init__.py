"""Explorateur de positions (requête). Le cœur de l'opening explorer.

Deux comptes pour une position :
  - `start_count`   : puzzles qui DÉMARRENT exactement là (phase 1, sans réseau).
  - `through_count` : puzzles dont la PARTIE passe par là (index `positions`,
    peuplé par le run download / passe 2).

La version interactive (NiceGUI) viendra en v0.2 par-dessus cette couche.
"""

from .insights import (
    CONTINUATIONS_MAX_THROUGH,
    Continuation,
    FamilyDNA,
    FamilyRow,
    PuzzleSummary,
    Share,
    build_family_dna_cache,
    build_family_top_puzzles,
    continuations,
    families_cached,
    family_dna_cached,
    family_stats_ready,
    family_top_ready,
    list_puzzles_at,
    openings_at_position,
    themes_at_position,
    top_puzzles_count,
    top_puzzles_for_family,
)
from .query import PositionCounts, PuzzleData, count_position, get_puzzle, resolve_fen

__all__ = [
    "count_position", "resolve_fen", "PositionCounts",
    "PuzzleData", "get_puzzle",
    "Continuation", "FamilyDNA", "FamilyRow", "PuzzleSummary", "Share",
    "CONTINUATIONS_MAX_THROUGH",
    "build_family_dna_cache", "build_family_top_puzzles",
    "continuations", "families_cached",
    "family_dna_cached", "family_stats_ready", "family_top_ready",
    "list_puzzles_at", "openings_at_position", "themes_at_position",
    "top_puzzles_count", "top_puzzles_for_family",
]
