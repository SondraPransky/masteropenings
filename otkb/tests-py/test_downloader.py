from pathlib import Path

import pytest

from otkb.db import Database
from otkb.downloader import (
    enqueue_opening,
    enqueue_pending,
    game_id_from_url,
    iter_id_batches,
    mark,
)
from otkb.downloader.ids import game_id_from_pgn
from otkb.downloader.client import split_pgns
from otkb.ingest import ingest_csv

FIXTURE = Path(__file__).parent / "fixtures" / "sample_puzzles.csv"


@pytest.mark.parametrize("url,expected", [
    ("https://lichess.org/787zsVup/black#48", "787zsVup"),
    ("https://lichess.org/F8M8OS71#53", "F8M8OS71"),
    ("https://lichess.org/MQSyb3KW", "MQSyb3KW"),
    ("https://lichess.org/abcd1234/white", "abcd1234"),
    ("", None),
    (None, None),
    ("https://lichess.org/", None),
])
def test_game_id_extraction(url, expected):
    assert game_id_from_url(url) == expected


def test_enqueue_and_batches(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)  # P1 a un game_url
        added = enqueue_pending(db)
        assert added == 1
        assert db.count("downloads") == 1
        batches = list(iter_id_batches(db, size=300))
        assert batches == [["abcd1234"]]


def test_enqueue_is_idempotent(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)
        enqueue_pending(db)
        assert enqueue_pending(db) == 0        # rien de neuf
        assert db.count("downloads") == 1


def test_mark_removes_from_pending(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)
        enqueue_pending(db)
        mark(db, "abcd1234", "done")
        assert list(iter_id_batches(db)) == []   # plus rien de pending/error


def test_enqueue_opening_only(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)   # P1 = Italian_Game
        assert enqueue_opening(db, "Italian_Game") == 1
        assert enqueue_opening(db, "French_Defense") == 0   # aucun puzzle gardé
        assert db.count("downloads") == 1


def test_game_id_from_pgn():
    pgn = '[Event "x"]\n[Site "https://lichess.org/787zsVup"]\n\n1. e4 *'
    assert game_id_from_pgn(pgn) == "787zsVup"
    assert game_id_from_pgn('[Event "x"]\n\n1. e4 *') is None


def test_split_pgns():
    stream = (
        '[Event "A"]\n[Site "x"]\n\n1. e4 e5 *\n\n'
        '[Event "B"]\n\n1. d4 d5 *\n'
    )
    games = list(split_pgns(stream))
    assert len(games) == 2
    assert games[0].startswith('[Event "A"]')
    assert games[1].startswith('[Event "B"]')
