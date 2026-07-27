from pathlib import Path

import chess

from otkb.analysis import analyze_all, analyze_solution
from otkb.db import Database
from otkb.ingest import ingest_csv

FIXTURE = Path(__file__).parent / "fixtures" / "sample_puzzles.csv"


def test_detects_sacrifice_and_critical_square():
    # Cavalier noir (solutionneur) va en f3 ; le pion g2 le reprend -> sacrifice.
    fen = "4k3/8/8/4n3/8/8/6P1/4K3 w - - 0 1"
    moves = ["e1e2", "e5f3", "g2f3"]
    a = analyze_solution(fen, moves)
    assert a.critical_squares == ["f3"]
    assert len(a.sacrifices) == 1
    assert a.sacrifices[0].piece == "N"
    assert a.sacrifices[0].square == "f3"
    assert a.sacrifices[0].token() == "N@f3"


def test_favorable_trade_is_not_a_sacrifice():
    # Le solutionneur prend une tour (5) avec un cavalier (3) et se fait reprendre :
    # il GAGNE du matériel -> pas un sacrifice.
    # Trait aux blancs (adversaire). Tour BLANCHE en f3, cavalier noir en e5.
    fen = "4k3/8/8/4n3/8/5R2/6P1/4K3 w - - 0 1"
    # index0 adversaire (Ke2), index1 solutionneur Nxf3 (prend la tour), index2 gxf3
    moves = ["e1e2", "e5f3", "g2f3"]
    a = analyze_solution(fen, moves)
    assert a.sacrifices == []          # gain 5 > perte 3
    assert "f3" in a.critical_squares


def test_analyze_all_populates_table(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)
        n = analyze_all(db)
        assert n == db.count("puzzles") == 1
        row = db.conn.execute(
            "SELECT critical_squares, sacrifices FROM puzzle_analysis"
        ).fetchone()
        assert row is not None
        assert "d3" in row["critical_squares"].split()   # coup solutionneur d2d3


def test_analyze_all_is_resumable(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)
        assert analyze_all(db) == 1
        assert analyze_all(db) == 0   # rien de neuf à analyser
