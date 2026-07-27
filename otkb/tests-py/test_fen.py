import pytest

from otkb.fen import (
    FenInfo,
    InvalidFenError,
    normalize_fen,
    parse_fen,
    same_position,
)

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def test_normalize_drops_counters():
    assert normalize_fen(START) == "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"


def test_parse_extracts_fields():
    info = parse_fen(START)
    assert isinstance(info, FenInfo)
    assert info.side_to_move == "w"
    assert info.fullmove == 1


def test_same_position_ignores_counters():
    a = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
    b = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 9 42"
    assert same_position(a, b)


def test_different_side_not_same():
    w = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    b = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"
    assert not same_position(w, b)


def test_four_field_fen_accepted():
    info = parse_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -")
    assert info.fullmove == 0


@pytest.mark.parametrize("bad", ["", "too few fields", "a b c d e f g"])
def test_invalid_fen_raises(bad):
    with pytest.raises(InvalidFenError):
        parse_fen(bad)
