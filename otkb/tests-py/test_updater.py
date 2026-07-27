"""Tests de l'updater incrémental (sans réseau)."""

from pathlib import Path

from otkb.db import Database
from otkb.explorer.insights import build_family_dna_cache, family_stats_ready
from otkb.ingest import ingest_csv, update_from_csv

BASE = Path(__file__).parent / "fixtures" / "sample_puzzles.csv"
NEWER = Path(__file__).parent / "fixtures" / "update_puzzles.csv"  # P1 (doublon) + P5 (nouveau)


def _base_db(tmp_path):
    db = Database(tmp_path / "t.db")
    db.init_schema()
    ingest_csv(db, BASE, fullmove_max=25)  # corpus = Italian_Game (P1)
    return db


def test_update_adds_only_new_puzzles(tmp_path):
    with _base_db(tmp_path) as db:
        before = db.count("puzzles")
        stats = update_from_csv(db, NEWER, fullmove_max=25, source_label="2026-07")
        # P1 déjà présent (ignoré), P5 nouveau → +1
        assert stats.puzzles_added == 1
        assert db.count("puzzles") == before + 1
        assert stats.puzzles_before == before


def test_update_journals_into_updates(tmp_path):
    with _base_db(tmp_path) as db:
        update_from_csv(db, NEWER, fullmove_max=25, source_label="2026-07")
        rows = db.conn.execute(
            "SELECT source_label, puzzles_added, status FROM updates"
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["source_label"] == "2026-07"
        assert rows[0]["puzzles_added"] == 1
        assert rows[0]["status"] == "applied"


def test_update_registers_new_opening(tmp_path):
    with _base_db(tmp_path) as db:
        update_from_csv(db, NEWER, fullmove_max=25)
        tags = {r["tag"] for r in db.conn.execute("SELECT tag FROM openings")}
        assert "Ruy_Lopez" in tags


def test_reapplying_same_csv_adds_nothing(tmp_path):
    with _base_db(tmp_path) as db:
        update_from_csv(db, NEWER, fullmove_max=25)
        stats2 = update_from_csv(db, NEWER, fullmove_max=25)
        assert stats2.puzzles_added == 0
        assert db.conn.execute("SELECT COUNT(*) n FROM updates").fetchone()["n"] == 2


def test_update_rebuilds_caches_when_present(tmp_path):
    with _base_db(tmp_path) as db:
        build_family_dna_cache(db)  # caches présents avant la MAJ
        assert family_stats_ready(db)
        stats = update_from_csv(db, NEWER, fullmove_max=25)
        assert stats.caches_rebuilt is True
        # la nouvelle famille apparaît dans le cache reconstruit
        fams = {
            r["key"] for r in db.conn.execute(
                "SELECT key FROM statistics WHERE scope = 'opening_family'"
            )
        }
        assert "Ruy_Lopez" in fams


def test_update_skips_cache_build_when_absent(tmp_path):
    with _base_db(tmp_path) as db:
        assert not family_stats_ready(db)
        stats = update_from_csv(db, NEWER, fullmove_max=25)
        assert stats.caches_rebuilt is False
        assert not family_stats_ready(db)  # non créés inutilement
