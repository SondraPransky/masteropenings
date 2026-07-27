from pathlib import Path

from otkb.db import Database
from otkb.downloader import enqueue_pending
from otkb.importers import ingest_rows
from otkb.importers.games_dataset import _build_pgn, _san_to_movetext
from otkb.ingest import ingest_csv

FIXTURE = Path(__file__).parent / "fixtures" / "sample_puzzles.csv"

# ligne dataset synthétique : P1 (Italienne), partie SAN atteignant sa position
_ROW = {
    "PuzzleId": "P1",
    "moves": "e4 e5 Nf3 Nc6 Bc4 Nf6",
    "White": "Alice", "Black": "Bob", "WhiteElo": 2100, "BlackElo": 2200,
    "ECO": "C50", "Opening": "Italian Game", "Result": "1-0",
}


def test_san_to_movetext():
    assert _san_to_movetext("e4 e5 Nf3") == "1. e4 e5 2. Nf3 *"


def test_build_pgn_has_headers_and_moves():
    pgn = _build_pgn(_ROW)
    assert '[WhiteElo "2100"]' in pgn
    assert '[ECO "C50"]' in pgn
    assert "1. e4 e5" in pgn


def _prepared(tmp_path):
    db = Database(tmp_path / "t.db")
    db.init_schema()
    ingest_csv(db, FIXTURE, fullmove_max=25)  # P1, game_id abcd1234
    enqueue_pending(db)
    return db


def test_ingest_covers_game_and_marks_done(tmp_path):
    with _prepared(tmp_path) as db:
        stats = ingest_rows(db, [_ROW], dataset_ids={"P1"})
        assert stats.coverable_games == 1
        assert stats.reconstructed == 1
        assert stats.errors == 0
        assert db.count("positions") >= 1

        # position de P1 indexée + Elo/ECO récupérés du dataset
        p1 = db.conn.execute(
            "SELECT normalized_fen FROM puzzles WHERE puzzle_id='P1'"
        ).fetchone()["normalized_fen"]
        assert db.conn.execute(
            "SELECT COUNT(*) n FROM positions WHERE normalized_fen=?", (p1,)
        ).fetchone()["n"] == 1
        g = db.conn.execute("SELECT white_elo, eco FROM games").fetchone()
        assert g["white_elo"] == 2100 and g["eco"] == "C50"

        # la partie est marquée done -> l'API la saute
        assert db.conn.execute(
            "SELECT status FROM downloads WHERE game_id='abcd1234'"
        ).fetchone()["status"] == "done"


def test_game_not_fully_covered_is_skipped(tmp_path):
    with _prepared(tmp_path) as db:
        # dataset ne couvre PAS P1 -> partie non couvrable -> rien fait
        stats = ingest_rows(db, [_ROW], dataset_ids=set())
        assert stats.coverable_games == 0
        assert stats.reconstructed == 0
        assert db.count("positions") == 0
        assert db.conn.execute(
            "SELECT status FROM downloads WHERE game_id='abcd1234'"
        ).fetchone()["status"] == "pending"
