"""Niveaux ÉLÈVE (Elo FIDE) → plages de rating de puzzle Lichess.

TROIS échelles distinctes sont en jeu, et on ne les confond pas :
1. **Elo FIDE** — ce que le coach connaît de ses élèves.
2. **Elo de parties Lichess** — ≈ FIDE + 250 dans la zone utile (heuristique
   validée dans le projet « Ouvertures - data », cf. son
   `config.py::BUCKET_FIDE_EQUIV`). Elle sert LÀ-BAS, pour les buckets de
   l'Explorer. Elle ne sert PAS ici.
3. **Rating de puzzles Lichess** — sa propre échelle : chaque puzzle est calibré
   par duels Glicko contre le rating DE PUZZLES des joueurs, lequel court
   typiquement 300-500 points au-dessus de leur Elo de parties (on sait qu'il y a
   une tactique, pas de pendule). Aucune conversion fiable ne relie 2 → 3.

Conclusion (corrections utilisateur du 16/07) : la table ci-dessous est une
CORRESPONDANCE EMPIRIQUE DIRECTE FIDE → plage de puzzles, par bande, sans formule.
Les BANDES sont celles du terrain : un premier classement FIDE démarre vers 1200
(l'estimation d'initiation FFE part de 1199), donc pas de bande « 800-1000 » —
c'est Débutant, puis 1200-1400, 1400-1600, 1600-1800, 1800-2000, 2000-2300, 2300+.
Ancrages de l'échelle puzzles : mats en 1 ≈ 400-800 ; mats en 2 simples et
tactiques de base ≈ 800-1400. Bornes pensées ENTRAÎNEMENT (~80 % de réussite),
avec un point clé (2ᵉ correction du 16/07) : l'écart entre rating de puzzles et
force de jeu GRANDIT avec le niveau (~+300 au niveau club, +400-600 chez les
forts joueurs — un 2300 FIDE tourne à ~2800 en puzzles et résout un puzzle 2000
à ~90 %, échauffement). Donc plafond ≈ FIDE en bas d'échelle, puis il s'en
écarte progressivement en montant ; plancher ≈ plafond − 600.

⚠️ C'est un point de départ à AJUSTER avec de vrais élèves (« mes 1100 sèchent
sur ce dossier » → resserrer ICI, nulle part ailleurs). La vérité est terrain.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Level:
    key: str
    label: str                # libellé complet (dialogues, tooltips)
    short: str                # libellé PASTILLE (rangée de filtres, espace compté)
    rating_min: int | None    # plage de rating de puzzle LICHESS (empirique)
    rating_max: int | None


LEVELS: tuple[Level, ...] = (
    Level("all",   "Tous les niveaux",         "Tous",      None, None),
    Level("deb",   "Débutant (avant 1ᵉʳ Elo)", "Débutant",  None, 1000),  # mats en 1-2
    Level("f1200", "FIDE 1200–1400",           "1200–1400",  900, 1400),  # plafond ≈ FIDE
    Level("f1400", "FIDE 1400–1600",           "1400–1600", 1100, 1650),  # l'écart puzzles/jeu
    Level("f1600", "FIDE 1600–1800",           "1600–1800", 1300, 1900),  # …grandit avec le niveau
    Level("f1800", "FIDE 1800–2000",           "1800–2000", 1550, 2150),
    Level("f2000", "FIDE 2000–2300",           "2000–2300", 1900, 2500),
    Level("f2300", "FIDE 2300+",               "2300+",     2200, None),  # puzzle 2000 = échauffement
)

_BY_KEY = {lv.key: lv for lv in LEVELS}


def level_range(key: str) -> tuple[int | None, int | None]:
    """(rating_min, rating_max) Lichess du niveau ; (None, None) si inconnu/« all »."""
    lv = _BY_KEY.get(key)
    return (lv.rating_min, lv.rating_max) if lv else (None, None)


def levels_ranges(keys: list[str]) -> list[tuple[int | None, int | None]]:
    """Plages Lichess d'une SÉLECTION de niveaux — triées, FUSIONNÉES.

    Un coach coche souvent des niveaux voisins (« 1200-1400 » + « 1400-1600ᅟ») :
    leurs plages se recouvrent et fusionnent en UN intervalle → le chemin rapide
    (recherche par intervalle dans l'index) reste celui du cas courant. Des niveaux
    non voisins (Débutant + 1600-1800) donnent des intervalles DISJOINTS : c'est au
    consommateur de les interroger séparément (les comptes s'additionnent alors
    exactement, chaque puzzle n'ayant qu'un rating).

    Sélection vide, inconnue ou contenant « all » → [(None, None)] (tout).
    """
    sel = [k for k in (keys or []) if k in _BY_KEY]
    if not sel or "all" in sel:
        return [(None, None)]
    spans = sorted(
        ((lv.rating_min if lv.rating_min is not None else -10**9,
          lv.rating_max if lv.rating_max is not None else 10**9)
         for lv in (_BY_KEY[k] for k in sel)),
    )
    merged: list[list[int]] = []
    for lo, hi in spans:
        if merged and lo <= merged[-1][1] + 1:      # recouvrement ou contiguïté
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    return [
        (None if lo <= -10**9 else lo, None if hi >= 10**9 else hi)
        for lo, hi in merged
    ]


def toggle_level(selected: list[str], key: str) -> list[str]:
    """Nouvelle sélection après clic sur la pastille `key`.

    « Tous » est exclusif : le choisir efface le reste ; cocher un niveau précis
    l'écarte ; tout décocher revient à « tous ». Toujours au moins une pastille
    active — l'état est lisible en permanence, jamais vide.
    """
    if key == "all":
        return ["all"]
    sel = [k for k in selected if k not in ("all", key)]
    if key not in selected:
        sel.append(key)
    ordered = [lv.key for lv in LEVELS if lv.key in sel]
    return ordered or ["all"]
