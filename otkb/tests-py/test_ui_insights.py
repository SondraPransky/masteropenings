"""Tests des agrégations de l'explorateur/comparaison (sans réseau)."""

from pathlib import Path

import chess
import pytest

from otkb.db import Database
from otkb.explorer.insights import (
    build_family_dna_cache,
    continuations,
    families_cached,
    family_dna_cached,
    family_stats_ready,
    openings_at_position,
    themes_at_position,
)
from otkb.fen import normalize_fen
from otkb.ingest import ingest_csv

FIXTURE = Path(__file__).parent / "fixtures" / "sample_puzzles.csv"

# P1 : Italian_Game, thèmes "fork middlegame", trait aux Noirs.
P1_FEN = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 10"


def _db(tmp_path):
    db = Database(tmp_path / "t.db")
    db.init_schema()
    ingest_csv(db, FIXTURE, fullmove_max=25)
    return db


# --- cache d'ADN par famille (comparaison) ---------------------------------
def test_family_dna_cache_build_and_read(tmp_path):
    with _db(tmp_path) as db:
        assert family_stats_ready(db) is False
        fams, motifs, top = build_family_dna_cache(db)
        assert fams >= 1 and motifs >= 1 and top >= 1
        assert family_stats_ready(db) is True

        names = {f.family for f in families_cached(db)}
        assert "Italian_Game" in names

        dna = family_dna_cached(db, "Italian_Game")
        assert dna is not None
        assert dna.puzzle_count == 1
        assert dna.avg_rating == 1500
        # motif "fork" (is_motif) présent, "middlegame" (méta) exclu
        labels = {m.slug for m in dna.top_motifs}
        assert "fork" in labels
        assert "middlegame" not in labels


def test_family_dna_cached_unknown(tmp_path):
    with _db(tmp_path) as db:
        build_family_dna_cache(db)
        assert family_dna_cached(db, "Nonexistent") is None


# --- agrégations par position (explorateur) --------------------------------
def test_themes_and_openings_at_position(tmp_path):
    with _db(tmp_path) as db:
        nfen = normalize_fen(P1_FEN)
        themes = themes_at_position(db, nfen)
        slugs = {s.slug for s in themes}
        assert "fork" in slugs
        assert "middlegame" not in slugs  # motifs uniquement
        assert themes[0].pct == 100.0     # 1 puzzle sur 1

        openings = openings_at_position(db, nfen)
        tags = {s.slug for s in openings}
        assert "Italian_Game" in tags


def test_themes_at_empty_position(tmp_path):
    with _db(tmp_path) as db:
        assert themes_at_position(db, normalize_fen(chess.Board().fen())) == []


def test_squares_at_position_aggregates(tmp_path):
    from otkb.explorer.insights import squares_at_position

    with _db(tmp_path) as db:
        nfen = normalize_fen(P1_FEN)
        pid = db.conn.execute(
            "SELECT puzzle_id FROM puzzles WHERE normalized_fen = ?", (nfen,)
        ).fetchone()[0]
        # analyse 2-bis simulée : cases critiques (avec doublon) + sacrifices "P@sq"
        db.conn.execute(
            "INSERT INTO puzzle_analysis(puzzle_id, critical_squares, sacrifices) "
            "VALUES(?, ?, ?)",
            (pid, "f7 e6 f7", "B@f7 N@e6"),
        )
        db.conn.commit()
        sq = squares_at_position(db, nfen)
        assert sq["critical"]["f7"] == 2 and sq["critical"]["e6"] == 1  # doublon compté
        assert sq["sacrifice"]["f7"] == 1 and sq["sacrifice"]["e6"] == 1
        # position sans puzzle → maps vides (pas d'erreur)
        empty = squares_at_position(db, normalize_fen(chess.Board().fen()))
        assert empty == {"critical": {}, "sacrifice": {}}


# --- cache des compteurs « à travers » (perf) -------------------------------
THROUGH_FEN = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"


def _seed_through(db):
    """La partie de P1 passe par THROUGH_FEN (FK : games + puzzle existants).

    `puzzle_rating` est obligatoire (trigger `trg_positions_rating_not_null`) : en
    base il est toujours recopié de `puzzles.rating`, et tout le filtre de
    difficulté l'interroge. P1 = 1500 dans la fixture CSV.
    """
    con = db.conn
    con.execute("INSERT INTO games(game_id) VALUES('g1')")
    con.execute(
        "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating)"
        " VALUES(?, 'g1', 'P1', 6, 1500)",
        (THROUGH_FEN,),
    )
    con.commit()


def test_build_position_counts_and_read(tmp_path):
    from otkb.explorer.insights import build_position_counts, position_counts_ready
    from otkb.explorer.query import count_position

    with _db(tmp_path) as db:
        _seed_through(db)
        assert position_counts_ready(db) is False        # pas encore construit
        assert build_position_counts(db, min_count=1) == 1
        assert position_counts_ready(db) is True
        assert count_position(db, THROUGH_FEN).through_count == 1


def test_count_position_reads_the_cache(tmp_path):
    """Preuve que le chemin cache est bien emprunté (valeur trafiquée)."""
    from otkb.explorer.insights import build_position_counts
    from otkb.explorer.query import count_position

    with _db(tmp_path) as db:
        _seed_through(db)
        build_position_counts(db, min_count=1)
        db.conn.execute(
            "UPDATE position_counts SET through_count = 999 WHERE normalized_fen = ?",
            (THROUGH_FEN,),
        )
        db.conn.commit()
        assert count_position(db, THROUGH_FEN).through_count == 999  # lu du cache, pas compté


def test_count_position_falls_back_for_rare_positions(tmp_path):
    """Position non cachée (rare) → comptage direct, résultat correct."""
    from otkb.explorer.insights import build_position_counts
    from otkb.explorer.query import count_position

    with _db(tmp_path) as db:
        _seed_through(db)
        build_position_counts(db, min_count=1000)        # seuil haut → rien en cache
        assert db.conn.execute("SELECT COUNT(*) FROM position_counts").fetchone()[0] == 0
        assert count_position(db, THROUGH_FEN).through_count == 1  # repli direct


# --- suites de coups (index positions) -------------------------------------
def test_continuations_maps_child_to_move(tmp_path):
    with _db(tmp_path) as db:
        con = db.conn
        parent = normalize_fen(chess.Board().fen())
        after_e4 = chess.Board()
        after_e4.push_uci("e2e4")
        child = normalize_fen(after_e4.fen())
        con.execute("INSERT INTO games(game_id) VALUES('g1')")
        # Lignes complètes (puzzle_id + puzzle_rating) : en base, `positions` est
        # écrite par `store_reconstruction`, qui renseigne toujours les deux — une
        # ligne « nue » n'existe pas, et le trigger la refuse désormais.
        for nf, ply in ((parent, 0), (child, 1)):
            con.execute(
                "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating)"
                " VALUES(?,?,'P1',?,1500)",
                (nf, "g1", ply),
            )
        con.commit()

        conts = continuations(db, chess.Board())
        assert len(conts) == 1
        assert conts[0].san == "e4"
        assert conts[0].uci == "e2e4"
        assert conts[0].game_count == 1


def test_continuations_empty_when_no_positions(tmp_path):
    with _db(tmp_path) as db:
        assert continuations(db, chess.Board()) == []


def test_top_puzzles_and_list_at_position(tmp_path):
    from otkb.explorer.insights import (
        build_family_top_puzzles, family_top_ready,
        list_puzzles_at, top_puzzles_count, top_puzzles_for_family,
    )

    with _db(tmp_path) as db:
        assert family_top_ready(db) is False
        build_family_top_puzzles(db)
        assert family_top_ready(db) is True

        top = top_puzzles_for_family(db, "Italian_Game")
        assert [t.puzzle_id for t in top] == ["P1"]
        assert top_puzzles_count(db, "Italian_Game") == 1

        # tri difficulté croissante/décroissante ne casse pas (1 seul puzzle)
        assert top_puzzles_for_family(db, "Italian_Game", sort="rating_asc")[0].rating == 1500

        at = list_puzzles_at(db, normalize_fen(P1_FEN))
        assert [p.puzzle_id for p in at] == ["P1"]
        assert list_puzzles_at(db, normalize_fen(chess.Board().fen())) == []


def test_list_puzzles_through_position(tmp_path):
    """Un puzzle dont la partie passe par une position est listé « à travers »."""
    from otkb.explorer.insights import list_puzzles_through

    pos_fen = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
    with _db(tmp_path) as db:
        assert list_puzzles_through(db, pos_fen) == []  # positions vide
        con = db.conn
        con.execute("INSERT INTO games(game_id) VALUES('g1')")
        con.execute(
            "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating) "
            "VALUES(?, 'g1', 'P1', 12, 1500)",
            (pos_fen,),
        )
        con.commit()
        through = list_puzzles_through(db, pos_fen)
        assert [p.puzzle_id for p in through] == ["P1"]
        # limit=None renvoie tout sans erreur de pagination
        assert len(list_puzzles_through(db, pos_fen, limit=None)) == 1


def test_list_puzzles_at_tie_order_is_explicit(tmp_path):
    """À rating égal, `list_puzzles_at` ordonne par puzzle_id — pas par hasard.

    Sans départage l'ordre des ex æquo était celui des `rowid` : cohérent en
    pratique, mais accident du plan plutôt que contrat. Cas rare ici (la position de
    DÉPART la plus chargée de la base porte 10 puzzles, chaque puzzle démarrant à sa
    propre FEN) — contrairement aux puzzles « à travers », massivement ex æquo.
    """
    from otkb.explorer.insights import list_puzzles_at

    fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
    with _db(tmp_path) as db:
        con = db.conn
        for i in (3, 1, 2, 0):                       # insérés dans le désordre
            con.execute(
                "INSERT INTO puzzles(puzzle_id, fen, normalized_fen, moves, rating,"
                " popularity, nb_plays, themes, game_url, opening_tags, fullmove, side_to_move)"
                " VALUES(?,?,?,'e2e4',1500,50,100,'fork','u','X',1,'w')",
                (f"A{i}", fen, fen),
            )
        con.commit()
        ids = [p.puzzle_id for p in list_puzzles_at(db, fen, sort="rating_asc", limit=10)]
        assert ids == ["A0", "A1", "A2", "A3"]       # puzzle_id, pas l'ordre d'insertion
        # popularité aussi ex æquo (50) → même départage
        pop = [p.puzzle_id for p in list_puzzles_at(db, fen, sort="popularity", limit=10)]
        assert pop == ["A0", "A1", "A2", "A3"]


def _add_tied_puzzles(con, fen: str, n: int = 6, rating: int = 1500) -> None:
    """n puzzles au MÊME rating, de popularités croissantes (10, 20, …)."""
    con.execute("INSERT INTO games(game_id) VALUES('gt')")
    for i in range(n):
        pid = f"T{i}"
        con.execute(
            "INSERT INTO puzzles(puzzle_id, fen, normalized_fen, moves, rating, popularity,"
            " nb_plays, themes, game_url, opening_tags, fullmove, side_to_move)"
            " VALUES(?,?,?,'e2e4',?,?,100,'fork','u','X',1,'w')",
            (pid, fen, fen, rating, (i + 1) * 10),
        )
        con.execute(
            "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating)"
            " VALUES(?, 'gt', ?, ?, ?)",
            (fen, pid, i, rating),
        )
    con.commit()


@pytest.mark.parametrize("sort", ["rating_asc", "rating_desc", "popularity"])
def test_through_pagination_matches_full_list_on_rating_ties(tmp_path, sort):
    """Paginer doit découper EXACTEMENT la liste renvoyée sans pagination.

    Régression (passe perf) : le tri poussé dans l'index (`puzzle_rating` seul) et
    le tri d'affichage (départagé par `popularity`) divergeaient — la tranche
    retenue et l'ordre affiché obéissaient donc à deux critères différents. Sur une
    position d'ouverture les ratings sont massivement ex æquo (entiers, ~200 k
    puzzles), donc c'est la norme et non le cas limite : la page 1 d'un tri par
    difficulté croissante renvoyait les puzzles les MOINS populaires, et l'export
    (`limit=None`, non poussé) contredisait la liste affichée.
    """
    from otkb.explorer.insights import list_puzzles_through

    fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
    with _db(tmp_path) as db:
        _add_tied_puzzles(db.conn, fen)
        page1 = list_puzzles_through(db, fen, sort=sort, limit=3, offset=0)
        page2 = list_puzzles_through(db, fen, sort=sort, limit=3, offset=3)
        entier = list_puzzles_through(db, fen, sort=sort, limit=None)

        ids = lambda rows: [p.puzzle_id for p in rows]        # noqa: E731
        assert ids(page1) + ids(page2) == ids(entier)
        assert len(set(ids(entier))) == 6                     # aucun doublon/perte


def test_through_rating_sort_keeps_tie_order_deterministic(tmp_path):
    """À rating égal, l'ordre est stable et identique d'un appel à l'autre."""
    from otkb.explorer.insights import list_puzzles_through

    fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
    with _db(tmp_path) as db:
        _add_tied_puzzles(db.conn, fen)
        first = [p.puzzle_id for p in list_puzzles_through(db, fen, sort="rating_asc", limit=4)]
        again = [p.puzzle_id for p in list_puzzles_through(db, fen, sort="rating_asc", limit=4)]
        assert first == again
        # départage par puzzle_id (colonne de l'index) : ordre lisible et prévisible
        assert first == ["T0", "T1", "T2", "T3"]


def test_build_position_children_and_cached_read(tmp_path):
    """Le cache des suites : construit pour les positions fréquentes, lu en priorité.

    On vérifie aussi que la lecture CACHÉE donne le même résultat que le self-join
    direct — c'est le contrat (le cache n'est qu'une mémoïsation).
    """
    import chess as _chess

    from otkb.explorer.insights import build_position_children, continuations
    from otkb.fen import normalize_fen as _nf

    with _db(tmp_path) as db:
        con = db.conn
        parent = _chess.Board()
        child = _chess.Board(); child.push_uci("e2e4")
        con.execute("INSERT INTO games(game_id) VALUES('g1')")
        for nf, ply in ((_nf(parent.fen()), 0), (_nf(child.fen()), 1)):
            con.execute(
                "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating)"
                " VALUES(?,'g1','P1',?,1500)", (nf, ply),
            )
        con.commit()

        direct = continuations(db, _chess.Board())          # cache vide → self-join
        assert [(c.san, c.game_count) for c in direct] == [("e4", 1)]

        assert build_position_children(db, min_count=1) == 1  # 1 arête parent→enfant
        cached = continuations(db, _chess.Board())            # servi par le cache
        assert [(c.san, c.game_count) for c in cached] == [("e4", 1)]


def test_through_count_and_rating_filter(tmp_path):
    """count_puzzles_through respecte la plage de difficulté (P1 = rating 1500)."""
    from otkb.explorer.insights import count_puzzles_through, list_puzzles_through

    pos_fen = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
    with _db(tmp_path) as db:
        con = db.conn
        con.execute("INSERT INTO games(game_id) VALUES('g1')")
        # puzzle_rating est dénormalisé à l'écriture (cf. reconstruct/replay.py) :
        # c'est cette colonne que le filtre de difficulté interroge.
        con.execute(
            "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating) "
            "VALUES(?, 'g1', 'P1', 12, 1500)",
            (pos_fen,),
        )
        con.commit()
        assert count_puzzles_through(db, pos_fen) == 1
        # filtre par difficulté : 1500 inclus / exclu
        assert count_puzzles_through(db, pos_fen, rating_min=1400, rating_max=1600) == 1
        assert count_puzzles_through(db, pos_fen, rating_min=1600) == 0
        assert list_puzzles_through(db, pos_fen, rating_max=1000) == []


def test_through_count_dedupes_repeated_position(tmp_path):
    """Une partie qui REPASSE par la position ne doit compter le puzzle qu'une fois.

    Cas réel (0,01 % des lignes) : perpétuel / manœuvre → deux lignes `positions`
    pour le même (fen, puzzle). Le comptage filtré dédoublonne en flux via
    GROUP BY (puzzle_rating, puzzle_id) ; un COUNT(*) nu surcompterait ici.
    """
    from otkb.explorer.insights import count_puzzles_through

    pos_fen = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
    with _db(tmp_path) as db:
        con = db.conn
        con.execute("INSERT INTO games(game_id) VALUES('g1')")
        for ply in (6, 14):                      # la partie repasse par la position
            con.execute(
                "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating)"
                " VALUES(?, 'g1', 'P1', ?, 1500)",
                (pos_fen, ply),
            )
        con.commit()
        assert count_puzzles_through(db, pos_fen, rating_min=1400, rating_max=1600) == 1
        assert count_puzzles_through(db, pos_fen) == 1   # chemin sans filtre aussi


# --- cache du tri par popularité (17/07, wayfinder ticket 003) ---------------
def test_build_position_popularity_and_pushed_sort(tmp_path):
    """Le tri popularité poussé dans le cache = même liste que la jointure.

    Avant le cache, trier « à travers » par popularité imposait de joindre
    `puzzles` sur tout l'ensemble filtré (~2,1 s sur une position d'ouverture).
    Le cache ne doit être qu'une mémoïsation : ordre (popularity DESC, puzzle_id
    DESC — plus de sous-départage nb_plays), pagination et filtre identiques.
    """
    from otkb.explorer.insights import (
        build_position_counts,
        build_position_popularity,
        list_puzzles_through,
        popularity_pushable,
    )

    fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
    with _db(tmp_path) as db:
        _add_tied_puzzles(db.conn, fen)              # popularités 10, 20, …, 60
        before = [p.puzzle_id for p in list_puzzles_through(db, fen, sort="popularity", limit=None)]

        assert popularity_pushable(db, fen) is False  # cache pas construit → repli
        build_position_counts(db, min_count=1)        # parents du cache popularité
        assert build_position_popularity(db) == 6
        assert popularity_pushable(db, fen) is True

        entier = [p.puzzle_id for p in list_puzzles_through(db, fen, sort="popularity", limit=None)]
        assert entier == before == ["T5", "T4", "T3", "T2", "T1", "T0"]  # pop DESC
        # pagination poussée dans le cache = tranches exactes de la liste complète
        page1 = [p.puzzle_id for p in list_puzzles_through(db, fen, sort="popularity", limit=3)]
        page2 = [p.puzzle_id for p in list_puzzles_through(db, fen, sort="popularity", limit=3, offset=3)]
        assert page1 + page2 == entier
        # le filtre de difficulté traverse le cache (puzzle_rating embarqué)
        assert list_puzzles_through(db, fen, sort="popularity", rating_min=1600) == []
        assert len(list_puzzles_through(db, fen, sort="popularity",
                                        rating_min=1400, rating_max=1600, limit=None)) == 6


def test_position_popularity_dedupes_repeated_position(tmp_path):
    """Une partie qui repasse par la position → UNE ligne de cache par puzzle."""
    from otkb.explorer.insights import (
        build_position_counts,
        build_position_popularity,
        list_puzzles_through,
    )

    fen = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
    with _db(tmp_path) as db:
        con = db.conn
        con.execute("INSERT INTO games(game_id) VALUES('g1')")
        for ply in (6, 14):                          # même (fen, puzzle), deux plys
            con.execute(
                "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating)"
                " VALUES(?, 'g1', 'P1', ?, 1500)", (fen, ply),
            )
        con.commit()
        build_position_counts(db, min_count=1)
        assert build_position_popularity(db) == 1    # dédoublonné par la PK
        ids = [p.puzzle_id for p in list_puzzles_through(db, fen, sort="popularity", limit=None)]
        assert ids == ["P1"]


# --- fraîcheur des caches de positions (17/07, wayfinder ticket 004) ---------
def test_position_caches_staleness_marker_and_auto_rebuild(tmp_path):
    from otkb.explorer.insights import (
        build_position_counts,
        mark_position_caches_fresh,
        position_caches_stale,
        rebuild_position_caches_if_stale,
    )

    with _db(tmp_path) as db:
        _seed_through(db)
        assert position_caches_stale(db) is False    # pas de marqueur → pas d'alarme
        build_position_counts(db, min_count=1)
        mark_position_caches_fresh(db)
        assert position_caches_stale(db) is False    # frais

        db.conn.execute(                             # la base grossit
            "INSERT INTO positions(normalized_fen, game_id, puzzle_id, ply, puzzle_rating)"
            " VALUES('autre/fen', 'g1', 'P1', 7, 1500)"
        )
        db.conn.commit()
        assert position_caches_stale(db) is True     # périmé, détecté en O(1)

        assert rebuild_position_caches_if_stale(db, min_count=1) is True
        assert position_caches_stale(db) is False    # reconstruit + re-marqué
        assert rebuild_position_caches_if_stale(db, min_count=1) is False  # no-op


def test_rebuild_skips_bases_without_cache(tmp_path):
    """Jamais de premier build implicite : `build-counts` reste un choix explicite."""
    from otkb.explorer.insights import rebuild_position_caches_if_stale

    with _db(tmp_path) as db:
        _seed_through(db)
        assert rebuild_position_caches_if_stale(db) is False
        assert db.conn.execute("SELECT COUNT(*) FROM position_counts").fetchone()[0] == 0


def test_get_puzzle(tmp_path):
    from otkb.explorer.query import get_puzzle

    with _db(tmp_path) as db:
        p = get_puzzle(db, "P1")
        assert p is not None
        assert p.moves == ["g8f6", "d2d3", "f8c5"]   # UCI, coup adverse + solution
        assert p.rating == 1500
        assert "fork" in p.themes
        assert get_puzzle(db, "ZZZ") is None


# --- saisie de position (échiquier) ----------------------------------------
def test_board_set_position_fen_and_moves():
    from otkb.ui.board import BoardState, PositionParseError

    st = BoardState()
    st.set_position("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2")
    assert st.board.turn is chess.WHITE
    assert st.normalized_fen == normalize_fen(
        "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
    )

    st.set_position("e2e4 e7e5 g1f3")
    assert st.moves_line() == "1. e4 e5 2. Nf3"

    st.set_position("")           # vide → position de départ
    assert st.ply == 0

    with pytest.raises(PositionParseError):
        st.set_position("not/a/fen at all")


def test_board_img_tag_is_data_uri():
    from otkb.ui.board import BoardState

    tag = BoardState().img_tag()
    assert tag.startswith('<img src="data:image/svg+xml;base64,')


def test_moves_between_promotion_and_normal():
    from otkb.ui.board import BoardState

    st = BoardState()
    # coup normal : un seul candidat, sans promotion
    normal = st.moves_between(chess.E2, chess.E4)
    assert len(normal) == 1 and normal[0].promotion is None

    # pion blanc en a7 : promotion → 4 candidats (D/T/F/C)
    st.set_position("7k/P7/8/8/8/8/8/7K w - - 0 1")
    promo = st.moves_between(chess.A7, chess.A8)
    assert {m.promotion for m in promo} == {
        chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT
    }


def test_to_figurine():
    from otkb.ui.board import to_figurine

    assert to_figurine("Bg5") == "♝g5"      # ♝g5
    assert to_figurine("Nf3") == "♞f3"      # ♞f3
    assert to_figurine("e8=Q") == "e8=♛"    # e8=♛
    assert to_figurine("O-O") == "O-O"           # roque inchangé
    assert to_figurine("exd5") == "exd5"         # pion inchangé
