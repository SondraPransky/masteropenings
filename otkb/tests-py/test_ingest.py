from pathlib import Path

from otkb.db import Database
from otkb.ingest import ingest_csv, load_theme_mapping

FIXTURE = Path(__file__).parent / "fixtures" / "sample_puzzles.csv"


def test_ingest_filters_and_counts(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        stats = ingest_csv(db, FIXTURE, fullmove_max=25)

        assert stats.read == 4
        assert stats.kept == 1               # seul P1 passe
        assert stats.skipped_no_tags == 1    # P2
        assert stats.skipped_deep == 1       # P3 (fullmove 30 >= 25)
        assert stats.errors == 1             # P4 (FEN invalide)
        assert db.count("puzzles") == 1


def test_ingest_family_rollup(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)
        row = db.conn.execute(
            "SELECT family, variation FROM openings WHERE tag = ?",
            ("Italian_Game_Classical_Variation",),
        ).fetchone()
        assert row["family"] == "Italian_Game"
        assert row["variation"] == "Classical Variation"


def test_ingest_applies_themes_asset(tmp_path):
    with Database(tmp_path / "t.db") as db:
        db.init_schema()
        ingest_csv(db, FIXTURE, fullmove_max=25)
        rows = {
            r["name"]: r
            for r in db.conn.execute("SELECT name, is_motif, label_fr FROM themes")
        }
        # P1 porte 'fork' (motif) et 'middlegame' (méta)
        assert rows["fork"]["is_motif"] == 1
        assert rows["fork"]["label_fr"] == "Fourchette"
        assert rows["middlegame"]["is_motif"] == 0


def test_theme_mapping_is_wellformed():
    mapping = load_theme_mapping()
    assert "fork" in mapping
    for name, meta in mapping.items():
        assert meta["is_motif"] in (0, 1), name
        assert isinstance(meta["label_fr"], str) and meta["label_fr"], name
