import pytest

from otkb.db import Database
from otkb.explorer import count_position, resolve_fen
from otkb.explorer.query import MoveParseError


def test_resolve_fen_from_moves_and_fen_agree():
    from_moves = resolve_fen(moves="e2e4 e7e5 g1f3")
    from_fen = resolve_fen(fen="rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2")
    assert from_moves == from_fen


def test_resolve_fen_requires_input():
    with pytest.raises(MoveParseError):
        resolve_fen()


def test_resolve_fen_rejects_bad_uci():
    with pytest.raises(MoveParseError):
        resolve_fen(moves="e2e4 zzzz")


def test_count_position_empty(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        nfen = resolve_fen(moves="e2e4 e7e5")
        counts = count_position(db, nfen)
        assert counts.start_count == 0
        assert counts.through_count == 0
        assert counts.positions_indexed is False
