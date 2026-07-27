from otkb.db import Database
from otkb.models import PuzzleRow
from otkb.openings import parse_opening_tags


def _puzzle(pid="abc12", norm="k7/8/8/8/8/8/8/K7 w - -"):
    return PuzzleRow(
        puzzle_id=pid, fen=norm + " 0 1", normalized_fen=norm, fullmove=1,
        side_to_move="w", moves="e2e4 e7e5", rating=1500, rating_deviation=80,
        popularity=90, nb_plays=1000, game_url="https://lichess.org/abcd1234",
        opening_tags="French_Defense French_Defense_Advance_Variation",
        themes="fork middlegame",
    )


def test_init_schema_creates_tables(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        for table in ("puzzles", "openings", "themes", "puzzle_openings",
                      "puzzle_themes", "statistics", "games",
                      "positions", "downloads", "updates"):
            assert db.count(table) == 0
        # Settings contient déjà schema_version après init
        assert db.get_setting("schema_version") == "3"


def test_insert_puzzle_and_junctions(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        p = _puzzle()
        db.insert_puzzle(
            p,
            parse_opening_tags(p.opening_tags),
            p.themes.split(),
        )
        db.recompute_families()
        db.commit()

        assert db.count("puzzles") == 1
        assert db.count("openings") == 2      # famille + variante
        assert db.count("themes") == 2
        assert db.count("puzzle_openings") == 2
        assert db.count("puzzle_themes") == 2

        # le post-pass global a bien remonté la variante à sa famille
        fam = db.conn.execute(
            "SELECT family FROM openings WHERE tag = ?",
            ("French_Defense_Advance_Variation",),
        ).fetchone()["family"]
        assert fam == "French_Defense"


def test_insert_is_idempotent(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        p = _puzzle()
        for _ in range(3):
            db.insert_puzzle(p, parse_opening_tags(p.opening_tags), p.themes.split())
        db.commit()
        assert db.count("puzzles") == 1
        assert db.count("puzzle_openings") == 2


def test_settings_roundtrip(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        db.set_settings({"opening_fullmove_max": "18", "publish_threshold_n": "5"})
        assert db.get_setting("opening_fullmove_max") == "18"
        assert db.get_setting("missing", "def") == "def"


def test_init_schema_warns_before_creating_heavy_index(tmp_path, caplog):
    """Base peuplée à qui manque un index lourd → init_schema PRÉVIENT (17/07).

    Créer un composite sur 34,6 M lignes prend ~8 min sans aucun signe de vie :
    indiscernable d'un gel. On ne bloque pas (init_schema reste idempotent et non
    interactif), on loggue AVANT. Volumétrie via MAX(position_id) (append-only),
    donc simulable sans insérer un million de lignes.
    """
    import logging

    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        db.conn.execute("DROP INDEX idx_positions_normfen_rating")
        db.conn.execute(
            "INSERT INTO positions(position_id, normalized_fen, ply, puzzle_rating)"
            " VALUES(2000000, 'k7/8/8/8/8/8/8/K7 w - -', 0, 1500)"
        )
        db.conn.commit()
        with caplog.at_level(logging.WARNING):
            db.init_schema()                      # recrée l'index (1 ligne : instantané)
        assert any("idx_positions_normfen_rating" in r.message for r in caplog.records)
        # petite base ou index tous présents → silence
        caplog.clear()
        with caplog.at_level(logging.WARNING):
            db.init_schema()
        assert not caplog.records
