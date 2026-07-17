"""Normalisation FEN — clé de jointure du projet (SPEC §5).

On conserve UNIQUEMENT : placement des pièces + trait + droits au roque + case
en-passant. On JETTE le compteur de demi-coups et le numéro de coup. Ces deux
mêmes compteurs sont ignorés lors de la comparaison de positions.

Aucune dépendance externe : passe 1 = zéro réseau, stdlib seule.
"""

from __future__ import annotations

from dataclasses import dataclass


class InvalidFenError(ValueError):
    """FEN mal formée (nombre de champs incorrect)."""


@dataclass(frozen=True, slots=True)
class FenInfo:
    """Décomposition utile d'un FEN pour l'ingestion passe 1."""

    normalized: str      # 4 premiers champs : placement trait roque en-passant
    side_to_move: str    # 'w' | 'b'
    fullmove: int        # numéro de coup complet (borne de filtre d'ouverture)


def parse_fen(fen: str) -> FenInfo:
    """Décompose un FEN complet en ses parties utiles.

    Un FEN Lichess complet a 6 champs séparés par des espaces :
        <placement> <trait> <roque> <en-passant> <demi-coups> <coup>

    Tolère un FEN à 4 champs (déjà normalisé) : fullmove vaut alors 0.
    """
    parts = fen.strip().split()
    if len(parts) not in (4, 6):
        raise InvalidFenError(
            f"FEN attendu à 4 ou 6 champs, reçu {len(parts)} : {fen!r}"
        )

    placement, side, castling, en_passant = parts[:4]
    if side not in ("w", "b"):
        raise InvalidFenError(f"Trait invalide {side!r} dans FEN : {fen!r}")

    fullmove = 0
    if len(parts) == 6:
        try:
            fullmove = int(parts[5])
        except ValueError as exc:  # pragma: no cover - défensif
            raise InvalidFenError(f"Numéro de coup invalide dans FEN : {fen!r}") from exc

    normalized = " ".join((placement, side, castling, en_passant))
    return FenInfo(normalized=normalized, side_to_move=side, fullmove=fullmove)


def normalize_fen(fen: str) -> str:
    """Raccourci : renvoie uniquement la FEN normalisée (4 champs)."""
    return parse_fen(fen).normalized


def same_position(fen_a: str, fen_b: str) -> bool:
    """Deux FEN désignent-ils la même position (compteurs ignorés) ?"""
    return normalize_fen(fen_a) == normalize_fen(fen_b)
