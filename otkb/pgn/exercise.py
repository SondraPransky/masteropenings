"""Construction de l'exercice PGN annoté à partir d'un puzzle."""

from __future__ import annotations

import chess
import chess.pgn

from ..fen import normalize_fen

START_MARKER = "[%start]"


class ExercisePgnError(ValueError):
    """Coup illégal ou position incohérente lors de la génération."""


def _build_game(
    setup_fen: str,
    lead_moves: list[str],
    solution: list[str],
    headers: dict[str, str] | None = None,
) -> chess.pgn.Game:
    """Assemble un Game : setup_fen → lead_moves → solution (avec {[%start]}).

    Convention Lichess : `solution` = Moves du puzzle, où Moves[0] est le coup de
    l'adversaire qui pose le puzzle et Moves[1] est le 1er coup de l'élève. Le
    marqueur {[%start]} est posé **juste après le 1er coup de l'élève** (Moves[1]),
    c.-à-d. là où l'élève reprend la main pour trouver la suite. Repli sur Moves[0]
    si le puzzle n'a qu'un seul coup (cas dégénéré).
    """
    board = chess.Board(setup_fen)
    game = chess.pgn.Game()
    game.setup(board)
    for key, value in (headers or {}).items():
        game.headers[key] = value

    node: chess.pgn.GameNode = game

    def _play(uci: str) -> None:
        nonlocal node
        try:
            move = chess.Move.from_uci(uci)
        except ValueError as exc:
            raise ExercisePgnError(f"UCI invalide : {uci!r}") from exc
        if move not in board.legal_moves:
            raise ExercisePgnError(f"Coup illégal {uci} sur {board.fen()}")
        board.push(move)
        node = node.add_variation(move)

    for uci in lead_moves:
        _play(uci)
    marker_index = 1 if len(solution) > 1 else 0
    for i, uci in enumerate(solution):
        _play(uci)
        if i == marker_index:
            node.comment = START_MARKER
    return game


def _headers_from(puzzle, extra: dict[str, str] | None = None) -> dict[str, str]:
    h = {
        "Event": f"Puzzle {getattr(puzzle, 'puzzle_id', '?')}",
        "Site": getattr(puzzle, "game_url", "") or "https://lichess.org",
    }
    if getattr(puzzle, "rating", None) is not None:
        h["PuzzleRating"] = str(puzzle.rating)
    if getattr(puzzle, "opening_tags", None):
        h["Opening"] = puzzle.opening_tags.split()[0].replace("_", " ")
    if getattr(puzzle, "themes", None):
        h["Themes"] = puzzle.themes
    h.update(extra or {})
    return h


def minimal_exercise(puzzle) -> str:
    """Exercice depuis le FEN du puzzle seul (OFFLINE). PGN string.

    `puzzle` expose .fen, .moves (UCI espace-séparés), + méta optionnelles.
    """
    solution = puzzle.moves.split()
    if not solution:
        raise ExercisePgnError("Puzzle sans coups")
    game = _build_game(puzzle.fen, [], solution, _headers_from(puzzle))
    return str(game)


def annotated_exercise(puzzle, lead_moves_uci: list[str]) -> str:
    """Exercice avec la partie depuis le coup 1 (passe 2).

    `lead_moves_uci` = coups de la partie réelle du coup 1 jusqu'à la position du
    puzzle. On vérifie que la position atteinte == FEN du puzzle (normalisée),
    puis on splice la solution.
    """
    board = chess.Board()
    for uci in lead_moves_uci:
        try:
            board.push(chess.Move.from_uci(uci))
        except (ValueError, AssertionError) as exc:
            raise ExercisePgnError(f"Coup de partie invalide : {uci!r}") from exc

    if normalize_fen(board.fen()) != normalize_fen(puzzle.fen):
        raise ExercisePgnError(
            "La partie rejouée n'atteint pas la position du puzzle "
            f"(attendu {normalize_fen(puzzle.fen)}, obtenu {normalize_fen(board.fen())})"
        )

    solution = puzzle.moves.split()
    game = _build_game(
        chess.STARTING_FEN, lead_moves_uci, solution, _headers_from(puzzle)
    )
    return str(game)
