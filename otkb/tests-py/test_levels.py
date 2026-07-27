"""Niveaux élève : fusion des plages d'une sélection multiple (offline)."""

from otkb.ui.levels import LEVELS, level_range, levels_ranges, toggle_level


def test_toggle_level_semantics():
    """Pastilles à bascule : « Tous » exclusif, jamais de sélection vide."""
    assert toggle_level(["all"], "f1200") == ["f1200"]           # cocher un niveau écarte « Tous »
    assert toggle_level(["f1200"], "f1400") == ["f1200", "f1400"]
    assert toggle_level(["f1200", "f1400"], "f1200") == ["f1400"]
    assert toggle_level(["f1200"], "f1200") == ["all"]           # tout décocher → « Tous »
    assert toggle_level(["f1200", "f1400"], "all") == ["all"]    # « Tous » efface le reste
    # l'ordre rendu suit l'ordre de l'échelle, pas l'ordre de cochage
    assert toggle_level(["f1600"], "deb") == ["deb", "f1600"]


def test_all_or_empty_means_everything():
    assert levels_ranges([]) == [(None, None)]
    assert levels_ranges(["all"]) == [(None, None)]
    assert levels_ranges(["all", "f1200"]) == [(None, None)]   # « all » absorbe
    assert levels_ranges(["inconnu"]) == [(None, None)]


def test_single_level_matches_level_range():
    for lv in LEVELS:
        if lv.key == "all":
            continue
        assert levels_ranges([lv.key]) == [level_range(lv.key)]


def test_adjacent_levels_merge_into_one_interval():
    """1200-1400 (900-1400) + 1400-1600 (1100-1650) se recouvrent → UN intervalle.

    C'est le cas courant (groupe de cours sur deux niveaux voisins) : il doit
    rester sur le chemin rapide de l'index, donc UNE seule plage.
    """
    assert levels_ranges(["f1200", "f1400"]) == [(900, 1650)]
    # l'ordre de cochage ne change rien
    assert levels_ranges(["f1400", "f1200"]) == [(900, 1650)]


def test_disjoint_levels_stay_disjoint():
    """Débutant (–1000) + 1600-1800 (1300-1900) : deux intervalles séparés.

    Le trou 1001-1299 ne doit PAS être inclus — une « enveloppe » min..max
    ferait travailler l'élève sur des puzzles d'aucun des niveaux cochés.
    """
    assert levels_ranges(["deb", "f1600"]) == [(None, 1000), (1300, 1900)]


def test_open_ended_bounds_survive_merge():
    # 2000-2300 (1900-2500) + 2300+ (2200-∞) se recouvrent → (1900, None)
    assert levels_ranges(["f2000", "f2300"]) == [(1900, None)]
