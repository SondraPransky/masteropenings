"""Requêtes d'exploration par position (FEN normalisée)."""

from __future__ import annotations

from dataclasses import dataclass, field

import chess

from ..db import Database
from ..fen import normalize_fen
from .insights import through_count


class MoveParseError(ValueError):
    """Séquence de coups illisible."""


def resolve_fen(*, moves: str | None = None, fen: str | None = None) -> str:
    """Calcule la FEN normalisée depuis une séquence de coups UCI OU un FEN."""
    if fen:
        return normalize_fen(fen)
    if moves:
        board = chess.Board()
        for tok in moves.split():
            try:
                board.push_uci(tok)
            except (ValueError, AssertionError) as exc:
                raise MoveParseError(f"Coup UCI invalide : {tok!r}") from exc
        return normalize_fen(board.fen())
    raise MoveParseError("Fournir --moves (UCI) ou --fen")


@dataclass(slots=True)
class PuzzleData:
    """Puzzle complet pour le solveur. `moves` = UCI (moves[0] = coup adverse,
    moves[1:] = solution). `fen` = position AVANT moves[0]."""
    puzzle_id: str
    fen: str
    moves: list[str]
    rating: int | None
    themes: str
    game_url: str


def get_puzzle(db: Database, puzzle_id: str) -> PuzzleData | None:
    """Charge un puzzle par id (None si absent)."""
    row = db.conn.execute(
        "SELECT puzzle_id, fen, moves, rating, themes, game_url "
        "FROM puzzles WHERE puzzle_id = ?",
        (puzzle_id,),
    ).fetchone()
    if row is None:
        return None
    return PuzzleData(
        puzzle_id=row["puzzle_id"], fen=row["fen"], moves=row["moves"].split(),
        rating=row["rating"], themes=row["themes"] or "", game_url=row["game_url"] or "",
    )


@dataclass(slots=True)
class PositionCounts:
    normalized_fen: str
    start_count: int                       # puzzles démarrant exactement ici
    through_count: int                     # puzzles dont la partie passe par ici
    examples: list[tuple[str, int, str]] = field(default_factory=list)  # (id, rating, themes)

    @property
    def positions_indexed(self) -> bool:
        return self.through_count > 0


def count_position(db: Database, normalized_fen: str, examples: int = 5) -> PositionCounts:
    """Compte les puzzles à/à travers une position et renvoie quelques exemples."""
    con = db.conn
    start = con.execute(
        "SELECT COUNT(*) n FROM puzzles WHERE normalized_fen = ?", (normalized_fen,)
    ).fetchone()["n"]
    through = through_count(db, normalized_fen)

    ex: list[tuple[str, int, str]] = []
    if start:
        for r in con.execute(
            "SELECT puzzle_id, rating, themes FROM puzzles "
            "WHERE normalized_fen = ? ORDER BY popularity DESC LIMIT ?",
            (normalized_fen, examples),
        ):
            ex.append((r["puzzle_id"], r["rating"], r["themes"]))

    return PositionCounts(
        normalized_fen=normalized_fen,
        start_count=start,
        through_count=through,
        examples=ex,
    )
