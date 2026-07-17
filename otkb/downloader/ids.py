"""Ré-export du parsing d'id (déplacé dans otkb.ids, neutre/stdlib)."""

from ..ids import game_id_from_pgn, game_id_from_url

__all__ = ["game_id_from_pgn", "game_id_from_url"]
