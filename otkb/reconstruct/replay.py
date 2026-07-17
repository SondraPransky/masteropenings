"""Rejeu + vérification FEN + indexation des positions."""

from __future__ import annotations

import io

import chess
import chess.pgn

from ..db import Database
from ..fen import normalize_fen
from ..logging_setup import get_logger

logger = get_logger(__name__)


class ReconstructError(ValueError):
    """PGN illisible ou position du puzzle absente de la partie."""


def replay_to_puzzle(
    game_pgn: str, puzzle_fen: str
) -> tuple[list[str], list[tuple[int, str]]]:
    """Rejoue la partie jusqu'à la position du puzzle.

    Renvoie (lead_uci, positions) où :
      - lead_uci  = coups de la partie du coup 1 jusqu'à la position du puzzle,
      - positions = [(ply, normalized_fen), ...] du coup 0 jusqu'au puzzle inclus.
    Lève ReconstructError si la position n'est jamais atteinte (vérification FEN).
    """
    game = chess.pgn.read_game(io.StringIO(game_pgn))
    if game is None:
        raise ReconstructError("PGN illisible")

    board = game.board()
    target = normalize_fen(puzzle_fen)
    positions: list[tuple[int, str]] = [(0, normalize_fen(board.fen()))]
    lead: list[str] = []

    if positions[0][1] == target:
        return lead, positions

    for ply, move in enumerate(game.mainline_moves(), start=1):
        board.push(move)
        lead.append(move.uci())
        nf = normalize_fen(board.fen())
        positions.append((ply, nf))
        if nf == target:
            return lead, positions

    raise ReconstructError("Position du puzzle absente de la partie (vérif FEN échouée)")


def store_reconstruction(
    db: Database, game_id: str, game_pgn: str, puzzle, *, commit: bool = True
) -> int:
    """Enregistre la partie + indexe ses positions jusqu'au puzzle.

    Renvoie le nombre de positions indexées. Idempotent (INSERT OR IGNORE / REPLACE).
    `commit=False` pour un import de masse (le caller committe par lot).
    """
    lead, positions = replay_to_puzzle(game_pgn, puzzle.fen)

    game = chess.pgn.read_game(io.StringIO(game_pgn))
    h = game.headers
    db.conn.execute(
        "INSERT OR REPLACE INTO games"
        "(game_id, pgn, white, black, white_elo, black_elo, eco, opening, downloaded_at)"
        " VALUES(?,?,?,?,?,?,?,?, datetime('now'))",
        (
            game_id, game_pgn, h.get("White"), h.get("Black"),
            _int(h.get("WhiteElo")), _int(h.get("BlackElo")),
            h.get("ECO"), h.get("Opening"),
        ),
    )
    # `rating` est lu SANS repli : il est dénormalisé dans `positions.puzzle_rating`,
    # sur quoi repose tout le filtrage par difficulté. Un `getattr(..., None)` y
    # transformait une donnée manquante en NULL silencieux — donc en puzzle
    # invisible dans les dossiers filtrés, sans la moindre erreur. Mieux vaut une
    # AttributeError ici. `opening_tags`/`themes` sont, eux, réellement optionnels.
    for ply, nf in positions:
        db.conn.execute(
            "INSERT INTO positions"
            "(normalized_fen, game_id, puzzle_id, ply, opening_tags, puzzle_rating, themes)"
            " VALUES(?,?,?,?,?,?,?)",
            (nf, game_id, puzzle.puzzle_id, ply,
             getattr(puzzle, "opening_tags", None),
             puzzle.rating,
             getattr(puzzle, "themes", None)),
        )
    if commit:
        db.commit()
    return len(positions)


def _int(value) -> int | None:
    try:
        return int(value)
    except (ValueError, TypeError):
        return None
