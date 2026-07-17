"""Reconstruction de partie (points 10-12, passe 2 / v0.4).

Rejoue la partie téléchargée avec python-chess jusqu'à la position du puzzle,
VÉRIFIE que le FEN reconstruit correspond (compteurs ignorés), et indexe toutes
les positions intermédiaires. Fonctions offline-testables (entrée = PGN + puzzle).
"""

from .replay import ReconstructError, replay_to_puzzle, store_reconstruction

__all__ = ["replay_to_puzzle", "store_reconstruction", "ReconstructError"]
