"""Analyse de coups OFFLINE (tranche 2-bis) — cases critiques & sacrifices.

Rejoue la solution du puzzle avec python-chess (aucun réseau) pour en extraire
des signaux tactiques agrégeables dans l'ADN. python-chess est une dépendance
d'extra (`analysis`), pas requise pour la phase 1.
"""

from .moves import Sacrifice, SolutionAnalysis, analyze_solution
from .pass2bis import analyze_all

__all__ = ["analyze_solution", "SolutionAnalysis", "Sacrifice", "analyze_all"]
