import chess
import chess.pgn
import pytest

from otkb.db import Database
from otkb.fen import parse_fen
from otkb.models import PuzzleRow
from otkb.reconstruct import ReconstructError, replay_to_puzzle, store_reconstruction

GAME_UCI = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]


def _game_pgn():
    game = chess.pgn.Game()
    game.headers["White"] = "Alice"
    game.headers["Black"] = "Bob"
    game.headers["WhiteElo"] = "2100"
    node = game
    for u in GAME_UCI:
        node = node.add_variation(chess.Move.from_uci(u))
    return str(game)


def _puzzle_at(ply: int) -> PuzzleRow:
    board = chess.Board()
    for u in GAME_UCI[:ply]:
        board.push_uci(u)
    fen = board.fen()
    info = parse_fen(fen)
    return PuzzleRow(
        puzzle_id="G1", fen=fen, normalized_fen=info.normalized,
        fullmove=info.fullmove, side_to_move=info.side_to_move,
        moves="d2d3 g8f6", rating=1500, rating_deviation=80,
        popularity=90, nb_plays=100, game_url="https://lichess.org/gameid01",
        opening_tags="Ruy_Lopez", themes="fork opening",
    )


def test_replay_finds_position_and_lead():
    lead, positions = replay_to_puzzle(_game_pgn(), _puzzle_at(4).fen)
    assert lead == GAME_UCI[:4]
    assert positions[0][0] == 0 and positions[-1][0] == 4
    assert len(positions) == 5


def test_replay_raises_when_absent():
    # position d'une autre partie, absente de celle-ci
    with pytest.raises(ReconstructError):
        replay_to_puzzle(_game_pgn(), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".replace("w", "b"))


def test_positions_rejects_null_puzzle_rating(tmp_path):
    """Un `puzzle_rating` NULL doit ÉCHOUER bruyamment, pas passer en silence.

    Tout le filtrage par difficulté interroge cette colonne dénormalisée : une ligne
    à NULL serait acceptée puis invisible pour tout filtre → dossiers amputés sans
    la moindre erreur. La colonne ne peut pas être NOT NULL (34,6 M lignes à
    reconstruire), d'où le trigger `trg_positions_rating_not_null`.
    """
    import sqlite3

    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        con = db.conn
        con.execute("INSERT INTO games(game_id) VALUES('g')")
        con.execute(
            "INSERT INTO puzzles(puzzle_id, fen, normalized_fen, moves, rating, popularity,"
            " nb_plays, themes, game_url, opening_tags, fullmove, side_to_move)"
            " VALUES('P','f','f','e2e4',1500,50,10,'t','u','X',1,'w')"
        )
        with pytest.raises(sqlite3.IntegrityError, match="puzzle_rating"):
            con.execute(
                "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating)"
                " VALUES('x','g','P',1,NULL)"
            )
        # une écriture renseignée passe normalement
        con.execute(
            "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating)"
            " VALUES('x','g','P',1,1500)"
        )
        assert con.execute("SELECT COUNT(*) FROM positions").fetchone()[0] == 1


def test_store_reconstruction_indexes_positions(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        puzzle = _puzzle_at(4)
        db.insert_puzzle(puzzle, ["Ruy_Lopez"], puzzle.themes.split())
        db.commit()

        n = store_reconstruction(db, "gameid01", _game_pgn(), puzzle)
        assert n == 5
        assert db.count("games") == 1
        assert db.count("positions") == 5
        # la position du puzzle est bien indexée sur sa FEN normalisée
        hit = db.conn.execute(
            "SELECT ply FROM positions WHERE normalized_fen = ?",
            (puzzle.normalized_fen,),
        ).fetchone()
        assert hit["ply"] == 4
        # en-têtes de partie récupérés
        g = db.conn.execute("SELECT white, white_elo FROM games").fetchone()
        assert g["white"] == "Alice" and g["white_elo"] == 2100
