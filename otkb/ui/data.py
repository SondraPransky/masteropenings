"""Façade de données pour l'UI : une seule connexion, lectures cachées.

Regroupe les requêtes de `explorer` et `adn` derrière une API simple pour la
couche NiceGUI (l'Explorateur, seule surface depuis le 16/07). Compteurs et
suites lisent les caches `position_counts`/`position_children` (instantanés) ;
le plafond des suites ne subsiste que pour une base sans cache.
"""

from __future__ import annotations

import threading

from ..db import Database
from ..explorer.insights import (
    CONTINUATIONS_MAX_THROUGH,
    Continuation,
    PuzzleSummary,
    continuations,
    count_puzzles_through,
    list_puzzles_at,
    list_puzzles_through,
    position_caches_stale,
    position_counts_ready,
    squares_at_position,
)
from ..explorer.query import PositionCounts, PuzzleData, count_position, get_puzzle
from .board import BoardState

CONTINUATIONS_CAP = CONTINUATIONS_MAX_THROUGH


class UiData:
    """Accès données partagé par toute la session UI (une connexion SQLite)."""

    def __init__(self, db_path: str) -> None:
        self.db = Database(db_path, check_same_thread=False)
        self._children_cached: bool | None = None   # cache `position_children` peuplé ?
        # une connexion sqlite unique, appelée depuis le threadpool de NiceGUI
        # (run.io_bound) : sérialiser sinon « bad parameter / API misuse ».
        self._lock = threading.Lock()

    # -- préparation -------------------------------------------------------

    def position_counts_missing(self) -> bool:
        """Le cache des compteurs « à travers » manque-t-il ?

        Contrairement aux caches d'ADN ci-dessus, on ne le construit PAS à la volée :
        c'est une passe séquentielle de ~145 s sur 34,6 M lignes, inacceptable au
        chargement d'une page. On se contente de le signaler — sans cache
        l'explorateur reste utilisable, mais compte en direct (~4 s par coup au lieu
        de 0,005 s), ce qui ressemble à un bug plutôt qu'à un cache absent.
        """
        with self._lock:
            return not position_counts_ready(self.db)

    def position_caches_stale(self) -> bool:
        """Caches présents mais périmés (base grossie depuis le dernier build) ?

        Deux lectures O(1) (MAX sur PK + settings) : affichable au chargement sans
        coût. Filet du mécanisme décidé le 17/07 — le rattrapage nominal est la
        reconstruction auto en fin de download-run/import-dataset.
        """
        with self._lock:
            return position_caches_stale(self.db)

    # -- comparaison d'ouvertures -----------------------------------------

    # -- explorateur (accès DB sérialisé : threadpool NiceGUI) -------------
    def counts(self, normalized_fen: str) -> PositionCounts:
        with self._lock:
            return count_position(self.db, normalized_fen, examples=6)

    def position_squares(self, normalized_fen: str, limit: int = 8) -> dict[str, dict[str, int]]:
        with self._lock:
            return squares_at_position(self.db, normalized_fen, limit=limit)

    def puzzle(self, puzzle_id: str) -> PuzzleData | None:
        with self._lock:
            return get_puzzle(self.db, puzzle_id)

    def puzzles_at(
        self, normalized_fen: str, *, sort: str = "popularity", limit: int = 10, offset: int = 0
    ) -> list[PuzzleSummary]:
        with self._lock:
            return list_puzzles_at(
                self.db, normalized_fen, sort=sort, limit=limit, offset=offset
            )

    # -- puzzles « à travers » une position (dossier à donner à un élève) --
    def puzzles_through(
        self, normalized_fen: str, *, sort: str = "popularity",
        limit: int | None = 8, offset: int = 0,
        rating_min: int | None = None, rating_max: int | None = None,
    ) -> list[PuzzleSummary]:
        with self._lock:
            return list_puzzles_through(
                self.db, normalized_fen, sort=sort, limit=limit, offset=offset,
                rating_min=rating_min, rating_max=rating_max,
            )

    def count_through(
        self, normalized_fen: str, *,
        rating_min: int | None = None, rating_max: int | None = None,
    ) -> int:
        with self._lock:
            return count_puzzles_through(
                self.db, normalized_fen, rating_min=rating_min, rating_max=rating_max
            )

    # -- multi-plages : union de NIVEAUX élève cochés ensemble --------------
    # Les plages arrivent FUSIONNÉES et donc DISJOINTES (levels.levels_ranges) ;
    # chaque puzzle n'a qu'un rating → les comptes par plage s'ADDITIONNENT
    # exactement, et un tri par difficulté sur l'union = la concaténation des
    # plages dans l'ordre (asc) ou l'ordre inverse (desc). Chaque plage garde
    # ainsi le chemin rapide de l'index — pas de OR dans la requête.

    def count_through_multi(
        self, normalized_fen: str, ranges: list[tuple[int | None, int | None]],
    ) -> int:
        return sum(
            self.count_through(normalized_fen, rating_min=lo, rating_max=hi)
            for lo, hi in ranges
        )

    def _walk_ranges(
        self, normalized_fen: str, ranges: list[tuple[int | None, int | None]],
        sort: str, limit: int, offset: int,
    ) -> list[tuple[int | None, int | None, int, int]]:
        """Plan de pagination sur l'union : [(lo, hi, offset, limit), …] par plage.

        Parcourt les plages dans l'ordre du tri (desc = ordre inverse) en
        consommant `offset` puis `limit` sur les effectifs de chaque plage.
        """
        ordered = ranges if sort != "rating_desc" else list(reversed(ranges))
        plan = []
        for lo, hi in ordered:
            if limit <= 0:
                break
            n = self.count_through(normalized_fen, rating_min=lo, rating_max=hi)
            if offset >= n:
                offset -= n
                continue
            take = min(limit, n - offset)
            plan.append((lo, hi, offset, take))
            offset, limit = 0, limit - take
        return plan

    def puzzles_through_multi(
        self, normalized_fen: str, ranges: list[tuple[int | None, int | None]],
        *, sort: str = "rating_asc", limit: int = 8, offset: int = 0,
    ) -> list[PuzzleSummary]:
        if len(ranges) == 1:                      # cas courant : plage unique
            lo, hi = ranges[0]
            return self.puzzles_through(
                normalized_fen, sort=sort, limit=limit, offset=offset,
                rating_min=lo, rating_max=hi,
            )
        rows: list[PuzzleSummary] = []
        for lo, hi, off, take in self._walk_ranges(
                normalized_fen, ranges, sort, limit, offset):
            rows += self.puzzles_through(
                normalized_fen, sort=sort, limit=take, offset=off,
                rating_min=lo, rating_max=hi,
            )
        return rows

    def through_pgn_multi(
        self, normalized_fen: str, ranges: list[tuple[int | None, int | None]],
        *, sort: str = "rating_asc", limit: int | None = None,
        annotated: bool = False,
    ) -> str:
        """Dossier PGN sur l'union de plages — concaténation valide de PGN."""
        if len(ranges) == 1:
            lo, hi = ranges[0]
            return self.through_pgn(
                normalized_fen, sort=sort, limit=limit,
                rating_min=lo, rating_max=hi, annotated=annotated,
            )
        parts = []
        plan = self._walk_ranges(normalized_fen, ranges, sort,
                                 limit if limit is not None else 10**9, 0)
        for lo, hi, _off, take in plan:
            parts.append(self.through_pgn(
                normalized_fen, sort=sort, limit=take,
                rating_min=lo, rating_max=hi, annotated=annotated,
            ))
        return "\n".join(p for p in parts if p.strip())

    def through_pgn(
        self, normalized_fen: str, *, sort: str = "popularity", limit: int | None = None,
        rating_min: int | None = None, rating_max: int | None = None,
        annotated: bool = False,
    ) -> str:
        """Rend le dossier PGN en lot (texte) des puzzles passant par la position.

        `annotated` : partie complète depuis le coup 1 (repli minimal sinon).
        """
        import tempfile
        from pathlib import Path

        from ..exporters import export_through_position

        with self._lock:
            tmp = Path(tempfile.gettempdir()) / "otkb_through_bundle.pgn"
            export_through_position(
                self.db, normalized_fen, tmp, limit=limit, sort=sort,
                rating_min=rating_min, rating_max=rating_max, annotated=annotated,
            )
            text = tmp.read_text(encoding="utf-8")
            tmp.unlink(missing_ok=True)
            return text

    def continuations(
        self, state: BoardState, through_count: int, limit: int = 12
    ) -> list[Continuation] | None:
        """Suites de coups depuis la position, via le cache `position_children`.

        Le plafond (None = « position trop fréquente ») ne subsiste QUE comme
        garde-fou d'une base sans cache : sans lui, le self-join direct coûtait
        ~10 s à 23 k parties et gelait tout l'écran. Cache construit → aucune
        limite, les suites s'affichent partout, position de départ comprise.
        """
        if through_count <= 0:
            return None
        with self._lock:
            if self._children_cached is None:
                self._children_cached = self.db.conn.execute(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
                    "AND name='position_children'"
                ).fetchone()[0] == 1 and self.db.conn.execute(
                    "SELECT 1 FROM position_children LIMIT 1"
                ).fetchone() is not None
            if not self._children_cached and through_count > CONTINUATIONS_CAP:
                return None
            return continuations(self.db, state.board, limit=limit)
