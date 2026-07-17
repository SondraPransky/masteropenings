"""Import du dataset pré-joint puzzles+parties (HF) → table `positions`.

Stratégie (décidée avec l'utilisateur) :
- On ne couvre une PARTIE que si TOUS ses puzzles sont dans le dataset (évite les
  doublons de positions avec l'API : une partie est soit 100 % dataset, soit 100 %
  API). Comme la plupart des parties n'ont qu'un puzzle, la perte est minime.
- On reconstruit depuis le champ `moves` (SAN) du dataset via un PGN régénéré, en
  réutilisant `store_reconstruction` (rejeu + vérif FEN + index positions).
- Les parties couvertes sont marquées `done` → l'API ne les refait pas.
- Colonnes LEAN seulement (pas movetext ni analysis) ; les évals se reconstituent
  par FEN plus tard (cf. mémoire lichess-evals-db).
"""

from __future__ import annotations

import types
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Iterator

from ..db import Database
from ..logging_setup import get_logger
from ..reconstruct import ReconstructError, store_reconstruction
from ..pgn import ExercisePgnError

logger = get_logger(__name__)

_REPO = "Lichess/chess-puzzles-with-games"
_N_SHARDS = 14
DATASET_URLS = [
    f"https://huggingface.co/datasets/{_REPO}/resolve/main/data/"
    f"train-{i:05d}-of-{_N_SHARDS:05d}.parquet"
    for i in range(_N_SHARDS)
]
LEAN_COLUMNS = [
    "PuzzleId", "moves", "White", "Black", "WhiteElo", "BlackElo",
    "ECO", "Opening", "Result",
]


@dataclass(slots=True)
class DatasetStats:
    coverable_games: int = 0
    reconstructed: int = 0
    positions_indexed: int = 0
    errors: int = 0

    def summary(self) -> str:
        return (
            f"parties couvrables={self.coverable_games} "
            f"reconstruites={self.reconstructed} positions={self.positions_indexed} "
            f"erreurs={self.errors}"
        )


def _san_to_movetext(moves_san: str) -> str:
    toks = moves_san.split()
    out: list[str] = []
    for i, mv in enumerate(toks):
        if i % 2 == 0:
            out.append(f"{i // 2 + 1}.")
        out.append(mv)
    return " ".join(out) + " *"


def _build_pgn(row: dict) -> str:
    """Régénère un PGN minimal depuis une ligne dataset (headers + SAN)."""
    headers: list[str] = []
    for key in ("White", "Black", "WhiteElo", "BlackElo", "ECO", "Opening", "Result"):
        val = row.get(key)
        if val not in (None, ""):
            headers.append(f'[{key} "{val}"]')
    return "\n".join(headers) + "\n\n" + _san_to_movetext(row["moves"])


def ingest_rows(
    db: Database, rows: Iterable[dict], dataset_ids: set[str], *, batch: int = 2000
) -> DatasetStats:
    """Reconstruit les positions des parties entièrement couvertes par le dataset."""
    stats = DatasetStats()

    our: dict[str, tuple] = {}
    game_puzzles: dict[str, list[str]] = defaultdict(list)
    for pid, fen, rating, otags, themes, gid in db.conn.execute(
        "SELECT puzzle_id, fen, rating, opening_tags, themes, game_id FROM puzzles"
    ):
        our[pid] = (fen, rating, otags, themes, gid)
        if gid:
            game_puzzles[gid].append(pid)

    api_done = {
        r[0] for r in db.conn.execute(
            "SELECT game_id FROM downloads WHERE status = 'done'"
        )
    }
    coverable = {
        gid for gid, pids in game_puzzles.items()
        if gid not in api_done and all(p in dataset_ids for p in pids)
    }
    stats.coverable_games = len(coverable)
    logger.info("Parties entièrement couvrables par le dataset : %d", len(coverable))

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for row in rows:
        od = our.get(row["PuzzleId"])
        if od is None:
            continue
        fen, rating, otags, themes, gid = od
        if gid not in coverable or not row.get("moves"):
            continue
        puzzle = types.SimpleNamespace(
            puzzle_id=row["PuzzleId"], fen=fen, rating=rating,
            opening_tags=otags, themes=themes,
        )
        try:
            n = store_reconstruction(db, gid, _build_pgn(row), puzzle, commit=False)
            stats.positions_indexed += n
            stats.reconstructed += 1
            # marqué done AVEC ses positions (même transaction) -> reprenable
            db.conn.execute(
                "UPDATE downloads SET status='done', updated_at=? WHERE game_id=?",
                (now, gid),
            )
        except (ReconstructError, ExercisePgnError, ValueError) as exc:
            stats.errors += 1
            logger.debug("Puzzle %s ignoré : %s", row["PuzzleId"], exc)
        if stats.reconstructed % batch == 0 and stats.reconstructed:
            db.commit()

    db.commit()
    logger.info("Import dataset terminé : %s", stats.summary())
    return stats


# --- lecture parquet distante (polars) -------------------------------------
def _read_ids(urls: list[str]) -> set[str]:
    import polars as pl
    return set(pl.scan_parquet(urls).select("PuzzleId").collect()["PuzzleId"].to_list())


def _iter_rows(urls: list[str]) -> Iterator[dict]:
    import polars as pl
    df = pl.scan_parquet(urls).select(LEAN_COLUMNS).collect()
    yield from df.iter_rows(named=True)


def ingest_from_dataset(
    db: Database, urls: list[str] | None = None, *, batch: int = 2000
) -> DatasetStats:
    """Point d'entrée réel : lit le parquet HF et ingère (nécessite polars)."""
    urls = urls or DATASET_URLS
    logger.info("Lecture des PuzzleId du dataset…")
    dataset_ids = _read_ids(urls)
    logger.info("Dataset : %d puzzles. Lecture des colonnes utiles…", len(dataset_ids))
    return ingest_rows(db, _iter_rows(urls), dataset_ids, batch=batch)
