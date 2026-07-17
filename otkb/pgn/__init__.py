"""Génération d'exercices PGN (module Générateur PGN, SPEC §E).

- `minimal_exercise` : depuis le FEN du puzzle seul (OFFLINE, marche pour tous).
- `annotated_exercise` : depuis la partie complète (coups menant au puzzle) —
  la fonction est offline-testable ; les coups menant viennent de la passe 2.

Convention Lichess : Moves[0] = coup de l'adversaire qui pose le puzzle ;
Moves[1:] = la solution à trouver. Le marqueur {[%start]} est inséré juste après
Moves[1] (le 1er coup de l'élève), là où l'élève reprend la main pour trouver la
suite de la combinaison. SPEC §E « Génération PGN ».
"""

from .exercise import ExercisePgnError, annotated_exercise, minimal_exercise

__all__ = ["minimal_exercise", "annotated_exercise", "ExercisePgnError"]
