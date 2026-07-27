from pathlib import Path

import chess.pgn
import io

from otkb.db import Database
from otkb.exporters import export_opening, export_through_position
from otkb.ingest import ingest_csv

FIXTURE = Path(__file__).parent / "fixtures" / "sample_puzzles.csv"


def test_export_opening_writes_pgn(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)  # P1 = Italian_Game
        out = tmp_path / "italian.pgn"
        n = export_opening(db, "Italian_Game", out)
        assert n == 1
        text = out.read_text(encoding="utf-8")
        assert "[%start]" in text
        # le PGN exporté est relisible
        game = chess.pgn.read_game(io.StringIO(text))
        assert game is not None
        assert game.headers["Event"].startswith("Puzzle")


def test_export_unknown_opening_is_empty(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)
        out = tmp_path / "none.pgn"
        assert export_opening(db, "Nonexistent_Opening", out) == 0
        assert out.read_text(encoding="utf-8") == ""


def test_export_through_position_bundles_puzzles(tmp_path):
    """Un puzzle dont la partie PASSE PAR une position est exporté en lot."""
    pos_fen = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)  # P1 = Italian_Game
        con = db.conn
        con.execute("INSERT INTO games(game_id) VALUES('g1')")
        # `puzzle_rating` est dénormalisé à l'écriture (cf. reconstruct/replay.py) et
        # TOUJOURS renseigné en base (vérifié : 0 NULL sur 34,6 M). C'est lui que le
        # filtre de difficulté interroge — l'omettre ici simulerait une base
        # impossible, où les puzzles seraient silencieusement exclus des dossiers.
        con.execute(
            "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating) "
            "VALUES(?, 'g1', 'P1', 12, 1500)",
            (pos_fen,),
        )
        con.commit()

        out = tmp_path / "bundle.pgn"
        n = export_through_position(db, pos_fen, out)
        assert n == 1
        text = out.read_text(encoding="utf-8")
        game = chess.pgn.read_game(io.StringIO(text))
        assert game is not None

        # position sans puzzle « à travers » → dossier vide
        empty = tmp_path / "empty.pgn"
        assert export_through_position(db, "8/8/8/8/8/8/8/8 w - -", empty) == 0

        # filtre par difficulté (P1 = rating 1500) : hors plage → dossier vide
        band = tmp_path / "band.pgn"
        assert export_through_position(db, pos_fen, band, rating_max=1000) == 0
        assert export_through_position(
            db, pos_fen, band, sort="rating_asc", rating_min=1400, rating_max=1600
        ) == 1


def test_export_through_position_annotated_full_game(tmp_path):
    """En mode annoté, l'exercice contient la partie complète depuis le coup 1."""
    import chess

    from otkb.fen import normalize_fen
    from otkb.reconstruct import store_reconstruction

    # même montage que test_reconstruct : partie Ruy Lopez, puzzle au coup 4
    game_uci = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]
    g = chess.pgn.Game()
    node = g
    for u in game_uci:
        node = node.add_variation(chess.Move.from_uci(u))
    game_pgn = str(g)

    board = chess.Board()
    for u in game_uci[:4]:
        board.push_uci(u)
    from otkb.fen import parse_fen
    from otkb.models import PuzzleRow

    info = parse_fen(board.fen())
    puzzle = PuzzleRow(
        puzzle_id="G1", fen=board.fen(), normalized_fen=info.normalized,
        fullmove=info.fullmove, side_to_move=info.side_to_move,
        moves="d2d3 g8f6", rating=1500, rating_deviation=80, popularity=90,
        nb_plays=100, game_url="https://lichess.org/gameid01", game_id="gameid01",
        opening_tags="Ruy_Lopez", themes="fork opening",
    )
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        db.insert_puzzle(puzzle, ["Ruy_Lopez"], puzzle.themes.split())
        db.commit()
        store_reconstruction(db, "gameid01", game_pgn, puzzle)  # games + positions

        # position intermédiaire traversée (après 1.e4) → doit retrouver G1
        after_e4 = chess.Board()
        after_e4.push_uci("e2e4")
        nfen = normalize_fen(after_e4.fen())

        out = tmp_path / "full.pgn"
        assert export_through_position(db, nfen, out, annotated=True) == 1
        text = out.read_text(encoding="utf-8")
        # partie depuis le coup 1 (pas de [FEN] = départ standard), coups menant à
        # la position du puzzle, puis la solution avec [%start] où l'élève prend la main
        assert "[FEN" not in text
        assert "1. e4 e5 2. Nf3 Nc6 3. d3" in text
        assert "[%start]" in text

        # sans annotation : exercice minimal (part de la position du puzzle)
        mini = tmp_path / "mini.pgn"
        export_through_position(db, nfen, mini, annotated=False)
        assert "[FEN" in mini.read_text(encoding="utf-8")
