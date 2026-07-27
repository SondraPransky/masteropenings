from otkb.openings import compute_family, humanize, parse_opening_tags


def test_parse_dedup_and_order():
    assert parse_opening_tags("") == []
    assert parse_opening_tags(None) == []
    assert parse_opening_tags("Italian_Game Italian_Game") == ["Italian_Game"]
    assert parse_opening_tags("A B A") == ["A", "B"]


def test_humanize():
    assert humanize("French_Defense_Advance_Variation") == "French Defense Advance Variation"


def test_family_from_global_prefix():
    known = {"French_Defense", "French_Defense_Advance_Variation"}
    fam, var = compute_family("French_Defense_Advance_Variation", known)
    assert fam == "French_Defense"
    assert var == "Advance Variation"

    fam, var = compute_family("French_Defense", known)
    assert fam == "French_Defense"
    assert var is None


def test_longest_prefix_wins():
    known = {
        "Sicilian_Defense",
        "Sicilian_Defense_Najdorf",
        "Sicilian_Defense_Najdorf_English_Attack",
    }
    fam, var = compute_family("Sicilian_Defense_Najdorf_English_Attack", known)
    assert fam == "Sicilian_Defense_Najdorf"
    assert var == "English Attack"


def test_global_pass_rescues_lone_deep_tag():
    # Le tag profond apparaît SEUL, mais la famille existe ailleurs dans le corpus.
    known = {"Sicilian_Defense", "Sicilian_Defense_Najdorf_Variation"}
    fam, _ = compute_family("Sicilian_Defense_Najdorf_Variation", known)
    assert fam == "Sicilian_Defense"


def test_no_prefix_is_own_family():
    fam, var = compute_family("Italian_Game", {"Italian_Game", "Ruy_Lopez"})
    assert fam == "Italian_Game"
    assert var is None
