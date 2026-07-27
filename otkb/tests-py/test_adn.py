from pathlib import Path

from otkb.adn import compute_dna, dna_to_dict, render_html, render_text
from otkb.db import Database
from otkb.ingest import ingest_csv

FIXTURE = Path(__file__).parent / "fixtures" / "sample_puzzles.csv"


def _db(tmp_path):
    db = Database(tmp_path / "t.db")
    db.init_schema()
    ingest_csv(db, FIXTURE, fullmove_max=25)  # P1 : Italian_Game, rating 1500
    return db


def test_dna_basic_metadata(tmp_path):
    with _db(tmp_path) as db:
        dna = compute_dna(db, "Italian_Game")
    assert dna.puzzle_count == 1
    assert dna.avg_rating == 1500
    assert dna.rating_min == 1500 and dna.rating_max == 1500


def test_dna_rating_bands(tmp_path):
    with _db(tmp_path) as db:
        dna = compute_dna(db, "Italian_Game")
    by_label = {r.label: r.count for r in dna.rating_bands}
    # 1500 tombe dans la tranche 1200-1600
    assert by_label["1200-1600 (interm.)"] == 1
    assert by_label["< 1200 (débutant)"] == 0
    assert sum(r.count for r in dna.rating_bands) == dna.puzzle_count


def test_dna_render_and_json(tmp_path):
    with _db(tmp_path) as db:
        dna = compute_dna(db, "Italian_Game")
    txt = render_text(dna)
    assert "Niveau des puzzles" in txt
    d = dna_to_dict(dna)
    assert d["rating_min"] == 1500
    assert len(d["rating_bands"]) == 5


def test_dna_unknown_opening(tmp_path):
    with _db(tmp_path) as db:
        dna = compute_dna(db, "Nonexistent")
    assert dna.puzzle_count == 0
    assert dna.rating_bands == []


def test_dna_render_html(tmp_path):
    with _db(tmp_path) as db:
        dna = compute_dna(db, "Italian_Game")
    html = render_html(dna)
    assert html.startswith("<!doctype html>")
    assert html.rstrip().endswith("</html>")
    assert "Italian Game" in html          # tag humanisé, échappé
    assert "Niveau des puzzles" in html
    assert "1500" in html                  # rating moyen


def test_dna_render_html_empty(tmp_path):
    """Ouverture inconnue : page valide mais message « aucun puzzle »."""
    with _db(tmp_path) as db:
        dna = compute_dna(db, "Nonexistent")
    html = render_html(dna)
    assert html.startswith("<!doctype html>")
    assert "Aucun puzzle" in html
    assert "Niveau des puzzles" not in html


def test_dna_render_html_escapes(tmp_path):
    """Le rendu échappe le HTML des libellés (défense injection)."""
    with _db(tmp_path) as db:
        dna = compute_dna(db, "Italian_Game")
    dna.query = "<script>alert(1)</script>"
    html = render_html(dna)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
