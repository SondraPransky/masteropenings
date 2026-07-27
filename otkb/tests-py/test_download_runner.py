from pathlib import Path

import chess
import chess.pgn

from otkb.db import Database
from otkb.downloader import enqueue_pending, run_download
from otkb.ingest import ingest_csv

FIXTURE = Path(__file__).parent / "fixtures" / "sample_puzzles.csv"

# Partie synthétique atteignant la position de P1 (Italienne après 3.Fc4).
# P1.game_url = https://lichess.org/abcd1234
_GAME_MOVES = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"]


def _fake_game_pgn():
    game = chess.pgn.Game()
    game.headers["Site"] = "https://lichess.org/abcd1234"
    game.headers["White"] = "Alice"
    game.headers["Black"] = "Bob"
    node = game
    for u in _GAME_MOVES:
        node = node.add_variation(chess.Move.from_uci(u))
    return str(game)


def _fake_fetch(ids):
    # ignore ids, renvoie notre partie synthétique (comme le ferait le bulk _ids)
    return _fake_game_pgn()


def test_run_download_reconstructs_and_indexes(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)   # P1 (Italian) a game_url abcd1234
        enqueue_pending(db)

        stats = run_download(db, _fake_fetch)

        assert stats.games_reconstructed == 1
        assert stats.errors == 0
        assert db.count("games") == 1
        assert db.count("positions") >= 1

        # la position d'ouverture de P1 est désormais interrogeable
        p1_fen = db.conn.execute(
            "SELECT normalized_fen FROM puzzles WHERE puzzle_id='P1'"
        ).fetchone()["normalized_fen"]
        hit = db.conn.execute(
            "SELECT COUNT(*) n FROM positions WHERE normalized_fen=?", (p1_fen,)
        ).fetchone()["n"]
        assert hit == 1

        # la file est passée à done
        status = db.conn.execute(
            "SELECT status FROM downloads WHERE game_id='abcd1234'"
        ).fetchone()["status"]
        assert status == "done"


def test_run_download_survives_batch_failure(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)
        enqueue_pending(db)

        def boom(ids):
            raise ConnectionError("réseau coupé")

        stats = run_download(db, boom)          # ne doit PAS lever
        assert stats.errors == 1
        assert db.count("games") == 0
        # la partie est en error -> reprise possible au prochain run
        status = db.conn.execute(
            "SELECT status FROM downloads WHERE game_id='abcd1234'"
        ).fetchone()["status"]
        assert status == "error"


def test_run_download_is_resumable(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)
        enqueue_pending(db)
        run_download(db, _fake_fetch)
        # plus rien de pending -> un second run ne fait rien
        stats2 = run_download(db, _fake_fetch)
        assert stats2.batches == 0
