import types

import chess
import chess.pgn
import io
import pytest

from otkb.pgn import annotated_exercise, minimal_exercise, ExercisePgnError


def _make_case():
    """Construit un puzzle auto-cohérent : lead (partie) + solution légale."""
    board = chess.Board()
    lead = ["e2e4", "e7e5", "g1f3"]
    for m in lead:
        board.push_uci(m)
    puzzle_fen = board.fen()

    b2 = chess.Board(puzzle_fen)
    solution = ["b8c6", "f1b5", "a7a6"]
    for m in solution:
        b2.push_uci(m)

    puzzle = types.SimpleNamespace(
        puzzle_id="TEST1", fen=puzzle_fen, moves=" ".join(solution),
        rating=1600, game_url="https://lichess.org/xxxx1234#5",
        opening_tags="Ruy_Lopez", themes="fork opening",
    )
    return puzzle, lead


def _parse(pgn_str):
    return chess.pgn.read_game(io.StringIO(pgn_str))


def test_minimal_exercise_has_marker_and_parses():
    puzzle, _ = _make_case()
    pgn = minimal_exercise(puzzle)
    assert "[%start]" in pgn
    game = _parse(pgn)
    assert game is not None
    assert game.headers["FEN"].startswith(puzzle.fen.split()[0])
    # marqueur posé après le 1er coup de l'élève = Moves[1] (2e demi-coup)
    student_first = game.next().next()
    assert "[%start]" in (student_first.comment or "")
    # …et PAS après Moves[0] (le coup de l'adversaire)
    assert "[%start]" not in (game.next().comment or "")


def test_minimal_exercise_moves_roundtrip():
    puzzle, _ = _make_case()
    game = _parse(minimal_exercise(puzzle))
    ucis = [n.move.uci() for n in game.mainline()]
    assert ucis == puzzle.moves.split()


def test_annotated_exercise_full_game():
    puzzle, lead = _make_case()
    pgn = annotated_exercise(puzzle, lead)
    game = _parse(pgn)
    ucis = [n.move.uci() for n in game.mainline()]
    # la partie complète = lead + solution
    assert ucis == lead + puzzle.moves.split()
    # le marqueur tombe après le 1er coup de l'élève = Moves[1] (index len(lead)+1)
    node = game
    for _ in range(len(lead) + 2):
        node = node.next()
    assert "[%start]" in (node.comment or "")


def test_annotated_rejects_wrong_lead():
    puzzle, _ = _make_case()
    # lead qui n'atteint PAS la position du puzzle
    with pytest.raises(ExercisePgnError):
        annotated_exercise(puzzle, ["d2d4", "d7d5"])


def test_illegal_solution_raises():
    puzzle = types.SimpleNamespace(
        fen=chess.STARTING_FEN, moves="e2e5", puzzle_id="X",
        game_url="", rating=None, opening_tags="", themes="",
    )
    with pytest.raises(ExercisePgnError):
        minimal_exercise(puzzle)
