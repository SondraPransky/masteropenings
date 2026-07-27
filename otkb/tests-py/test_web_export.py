"""Tests de l'export de l'artefact web réduit (sans réseau)."""

import sqlite3
from pathlib import Path

from otkb.db import Database
from otkb.exporters import export_web, render_cover
from otkb.explorer.insights import build_family_dna_cache
from otkb.ingest import ingest_csv

FIXTURE = Path(__file__).parent / "fixtures" / "sample_puzzles.csv"

# Tables présentes dans l'artefact web (cf. web_export._COPY).
KEPT = [
    "settings", "puzzles", "openings", "themes", "puzzle_openings",
    "puzzle_themes", "statistics", "family_motifs", "family_top_puzzles",
    "puzzle_analysis",
]
# Tables du bloc passe 2, à écarter de l'artefact.
DROPPED = ["positions", "games", "downloads", "updates"]


def _seeded_db(tmp_path):
    db = Database(tmp_path / "src.db")
    db.init_schema()
    ingest_csv(db, FIXTURE, fullmove_max=25)  # corpus = Italian_Game (P1)
    build_family_dna_cache(db)
    return db


def _tables(path: Path) -> set[str]:
    con = sqlite3.connect(path)
    try:
        return {
            r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
    finally:
        con.close()


def test_export_web_copies_kept_tables(tmp_path):
    with _seeded_db(tmp_path) as db:
        out = tmp_path / "web.sqlite"
        stats = export_web(db, out)
        assert out.exists()

        con = sqlite3.connect(out)
        try:
            for table in KEPT:
                dst_n = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                assert stats.rows[table] == dst_n
                if table == "settings":
                    # settings gagne les marqueurs d'artefact (artifact, exported_at…)
                    assert dst_n >= db.count(table)
                else:
                    assert dst_n == db.count(table), f"{table}: {dst_n} != {db.count(table)}"
        finally:
            con.close()

        # caches d'ADN embarqués
        assert stats.rows["statistics"] >= 1
        assert stats.rows["family_top_puzzles"] >= 1
        assert stats.bytes > 0


def test_export_web_page_size_and_integrity(tmp_path):
    """L'artefact utilise le page_size optimisé (8192) et reste intègre."""
    with _seeded_db(tmp_path) as db:
        out = tmp_path / "web.sqlite"
        export_web(db, out)
        con = sqlite3.connect(out)
        try:
            assert con.execute("PRAGMA page_size").fetchone()[0] == 8192
            assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        finally:
            con.close()


def test_export_web_drops_pass2_tables(tmp_path):
    with _seeded_db(tmp_path) as db:
        out = tmp_path / "web.sqlite"
        export_web(db, out)
    tables = _tables(out)
    assert set(KEPT).issubset(tables)
    for name in DROPPED:
        assert name not in tables


def test_export_web_prunes_puzzle_columns(tmp_path):
    with _seeded_db(tmp_path) as db:
        out = tmp_path / "web.sqlite"
        export_web(db, out)
    con = sqlite3.connect(out)
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(puzzles)")}
    finally:
        con.close()
    # colonnes élaguées absentes
    assert "game_url" not in cols
    assert "game_id" not in cols
    assert "rating_deviation" not in cols
    # colonnes redondantes retirées (reconstructibles par jointure, sans perte)
    assert "opening_tags" not in cols
    assert "themes" not in cols
    # colonnes utiles au front présentes
    assert {"fen", "normalized_fen", "moves"}.issubset(cols)


def test_export_web_puzzle_display_view(tmp_path):
    """La vue puzzle_display reconstruit opening_tags/themes depuis les jonctions."""
    with _seeded_db(tmp_path) as db:
        out = tmp_path / "web.sqlite"
        export_web(db, out)
    con = sqlite3.connect(out)
    con.row_factory = sqlite3.Row
    try:
        # la vue existe
        views = {
            r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='view'"
            )
        }
        assert "puzzle_display" in views
        # elle renvoie des chaînes cohérentes avec une jointure directe
        row = con.execute(
            "SELECT puzzle_id, opening_tags, themes FROM puzzle_display "
            "WHERE opening_tags IS NOT NULL LIMIT 1"
        ).fetchone()
        assert row is not None
        pid = row["puzzle_id"]
        ops = " ".join(
            r[0] for r in con.execute(
                "SELECT o.tag FROM puzzle_openings po "
                "JOIN openings o ON o.opening_id = po.opening_id "
                "WHERE po.puzzle_id = ? ORDER BY o.opening_id", (pid,)
            )
        )
        ths = " ".join(
            r[0] for r in con.execute(
                "SELECT t.name FROM puzzle_themes pt "
                "JOIN themes t ON t.theme_id = pt.theme_id "
                "WHERE pt.puzzle_id = ? ORDER BY t.theme_id", (pid,)
            )
        )
        assert row["opening_tags"] == ops
        assert row["themes"] == ths
    finally:
        con.close()


def test_export_web_puzzle_is_playable(tmp_path):
    with _seeded_db(tmp_path) as db:
        out = tmp_path / "web.sqlite"
        export_web(db, out)
    con = sqlite3.connect(out)
    con.row_factory = sqlite3.Row
    try:
        row = con.execute(
            "SELECT fen, moves FROM puzzles LIMIT 1"
        ).fetchone()
    finally:
        con.close()
    assert row is not None
    assert row["fen"] and row["moves"]  # position + solution jouables


def test_export_web_marks_artifact_settings(tmp_path):
    with _seeded_db(tmp_path) as db:
        out = tmp_path / "web.sqlite"
        export_web(db, out)
    con = sqlite3.connect(out)
    try:
        settings = dict(con.execute("SELECT key, value FROM settings"))
    finally:
        con.close()
    assert settings.get("artifact") == "web"
    assert settings.get("exported_at")
    assert settings.get("source_schema_version")


def test_family_dna_payload(tmp_path):
    from otkb.exporters.web_dna import corpus_totals, family_dna_payload
    with _seeded_db(tmp_path) as db:
        fams = family_dna_payload(db, min_count=1)
        totals = corpus_totals(db)
    # corpus fixture = 1 puzzle Italian_Game
    tags = {f["tag"] for f in fams}
    assert "Italian_Game" in tags
    it = next(f for f in fams if f["tag"] == "Italian_Game")
    assert it["name"] == "Italian Game" and it["n"] >= 1
    assert isinstance(it["crit"], dict) and isinstance(it["motifs"], list)
    assert totals["puzzles"] >= 1 and totals["families"] >= 1


def test_render_cover_standalone_page(tmp_path):
    with _seeded_db(tmp_path) as db:
        html = render_cover(db, sqlite_name="otkb-web.sqlite")
    # page HTML autonome, offline (aucune ressource externe)
    assert html.startswith("<!doctype html>")
    assert html.rstrip().endswith("</html>")
    assert "http://" not in html and "https://" not in html
    assert "src=" not in html  # rien à charger
    # contient les chiffres du corpus (fixture = 1 puzzle Italian_Game)
    assert "Puzzles" in html and "Familles" in html
    # au moins une famille en donnée JSON pour les mini-échiquiers
    assert '"crit"' in html and "Italian Game" in html


def test_render_cover_escapes_data(tmp_path):
    # les données injectées dans le <script> JSON ne doivent pas fermer la balise
    with _seeded_db(tmp_path) as db:
        html = render_cover(db)
    assert "</script>" in html            # la vraie balise fermante existe
    assert html.count("<script") == html.count("</script>")  # balises équilibrées


def test_export_web_has_fen_index(tmp_path):
    with _seeded_db(tmp_path) as db:
        out = tmp_path / "web.sqlite"
        export_web(db, out)
    con = sqlite3.connect(out)
    try:
        idx = {
            r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            )
        }
    finally:
        con.close()
    assert "idx_puzzles_normfen" in idx


def test_export_web_is_idempotent(tmp_path):
    with _seeded_db(tmp_path) as db:
        out = tmp_path / "web.sqlite"
        export_web(db, out)
        stats = export_web(db, out)  # ré-export : écrase sans erreur
    assert out.exists()
    assert stats.rows["puzzles"] == db_count_after(out, "puzzles")


def db_count_after(path: Path, table: str) -> int:
    con = sqlite3.connect(path)
    try:
        return con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        con.close()


NEWER = Path(__file__).parent / "fixtures" / "update_puzzles.csv"  # P5 (pop 85)


def test_min_popularity_prunes_low_popularity_puzzles(tmp_path):
    # P1 (pop 90) + P5 (pop 85) ; seuil 88 → ne garde que P1, sans les caches.
    db = Database(tmp_path / "src.db")
    db.init_schema()
    ingest_csv(db, FIXTURE, fullmove_max=25)  # P1
    ingest_csv(db, NEWER, fullmove_max=25)    # + P5
    try:
        out = tmp_path / "web.sqlite"
        stats = export_web(db, out, build_caches=False, min_popularity=88)
        assert stats.rows["puzzles"] == 1
        con = sqlite3.connect(out)
        try:
            kept = con.execute("SELECT puzzle_id FROM puzzles").fetchall()
            assert kept == [("P1",)]
            # les jonctions de P5 (Ruy_Lopez) sont écartées aussi
            p5_links = con.execute(
                "SELECT COUNT(*) FROM puzzle_openings WHERE puzzle_id = 'P5'"
            ).fetchone()[0]
            assert p5_links == 0
            assert dict(con.execute("SELECT key, value FROM settings"))["min_popularity"] == "88"
        finally:
            con.close()
    finally:
        db.close()


def test_min_popularity_keeps_top_puzzles_even_below_threshold(tmp_path):
    # P1 (pop 90) est le meilleur puzzle d'Italian_Game : un seuil très haut ne
    # doit PAS l'exclure (union avec family_top_puzzles → toujours jouable).
    with _seeded_db(tmp_path) as db:  # caches construits → P1 dans family_top_puzzles
        out = tmp_path / "web.sqlite"
        stats = export_web(db, out, min_popularity=10_000)
        assert stats.rows["puzzles"] == 1
        con = sqlite3.connect(out)
        try:
            assert con.execute("SELECT puzzle_id FROM puzzles").fetchone()[0] == "P1"
        finally:
            con.close()


def test_export_web_no_build_caches_leaves_stats_empty(tmp_path):
    # sans build_caches et sans caches pré-existants → statistics vide dans l'artefact
    db = Database(tmp_path / "src.db")
    db.init_schema()
    ingest_csv(db, FIXTURE, fullmove_max=25)
    try:
        out = tmp_path / "web.sqlite"
        stats = export_web(db, out, build_caches=False)
        assert stats.rows["statistics"] == 0
    finally:
        db.close()
