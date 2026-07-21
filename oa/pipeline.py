"""The chapter analysis pipeline as one reusable function (ingest -> eval -> stats ->
detect -> score -> report -> deepen).

Extracted from the CLI so both `oa.py analyze` and the web upload run the exact same steps.
Progress is reported through an ``on_progress(message)`` callback: the CLI prints it, the
web job stores the latest line for its status endpoint. The caller owns the connection, so a
background thread can pass its own (SQLite connections are not shared across threads).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import chess

from . import db, detect, ingest, report, scoring
from .config import Config
from .evals.resolver import EvalResolver
from .explorer import LichessExplorerClient
from .fen import _ensure_full_fen, fen4

ProgressFn = Callable[[str], None]


@dataclass
class AnalyzeResult:
    chapter_id: int
    chapter_name: str
    positions: int
    errors: int
    pvs_filled: int = 0
    deepen_error: str | None = None


def _noop(_msg: str) -> None:
    pass


def analyze_chapter(
    conn: sqlite3.Connection,
    config: Config,
    pgn_path: Path,
    chapter_name: str,
    *,
    account_id: int | None = None,
    no_explorer: bool = False,
    no_deepen: bool = False,
    limit_positions: int | None = None,
    on_progress: ProgressFn | None = None,
) -> AnalyzeResult:
    """Run the full slice on one PGN chapter. Returns the chapter id + headline counts."""
    progress = on_progress or _noop

    # 1. Ingestion -----------------------------------------------------------
    progress(f"[1/6] Ingestion de {pgn_path.name} …")
    result = ingest.ingest_chapter(conn, pgn_path, chapter_name, account_id=account_id)
    progress(f"      chapitre « {result.chapter_name} » : {result.games} partie(s), "
             f"{result.unique_positions} positions uniques, {result.paths} chemins.")

    positions = ingest.iter_chapter_positions(conn, result.chapter_id)
    if limit_positions:
        positions = positions[:limit_positions]

    resolver = EvalResolver(conn, config)
    explorer = LichessExplorerClient(conn, config)

    # 2. Evals per position --------------------------------------------------
    total = len(positions)
    progress(f"[2/6] Évaluations ({', '.join(config.eval.order)}) — {total} positions …")
    eval_hits = 0
    for i, pos in enumerate(positions, 1):
        if resolver.get(pos["fen4"]) is not None:
            eval_hits += 1
        if i % 10 == 0 or i == total:
            progress(f"      {i}/{total} positions évaluées …")

    # 3. Human stats per Elo bucket -----------------------------------------
    if no_explorer:
        progress("[3/6] Stats humaines ignorées (--no-explorer).")
    else:
        progress(f"[3/6] Stats humaines × {len(config.explorer.ratings)} tranches Elo …")
        for i, pos in enumerate(positions, 1):
            explorer.fetch_position_stats(pos["id"], pos["fen4"])
            if i % 5 == 0 or i == total:
                progress(f"      {i}/{total} positions …")

    positions = ingest.iter_chapter_positions(conn, result.chapter_id)
    if limit_positions:
        positions = positions[:limit_positions]

    # 4. Detection -----------------------------------------------------------
    progress("[4/6] Détection des divergences humaines coûteuses (D12/D13) …")
    dstats = detect.DetectStats()
    for pos in positions:
        path_row = conn.execute(
            "SELECT id FROM paths WHERE chapter_id = ? AND position_id = ? "
            "ORDER BY ply ASC LIMIT 1",
            (result.chapter_id, pos["id"]),
        ).fetchone()
        detect.detect_position(
            conn, resolver, config, db.get_position(conn, pos["id"]),
            chapter_id=result.chapter_id,
            path_id=path_row["id"] if path_row else None,
            stats=dstats,
        )
    progress(f"      {dstats.errors_found} erreur(s) détectée(s).")

    # 5. Scoring + report ----------------------------------------------------
    progress("[5/6] Scoring (Criticité) et écriture du rapport …")
    scoring.score_chapter(conn, config, result.chapter_id)
    report.write_report(conn, config, result.chapter_id)

    errors = conn.execute(
        "SELECT COUNT(*) FROM errors WHERE chapter_id = ?", (result.chapter_id,)
    ).fetchone()[0]

    # 6. Refutation lines ----------------------------------------------------
    # Without the PVs the trainer cannot chain a refutation past its first move, so a chapter
    # analysed without this step is quietly half-usable in "contrer" mode. Failures here are
    # reported but never fatal: the analysis above is already complete and worth keeping, and
    # deepen is idempotent, so `oa.py deepen` can finish the job later.
    pvs_filled, deepen_error = 0, None
    if no_deepen:
        progress("[6/6] Lignes de réfutation ignorées (--no-deepen).")
    else:
        progress("[6/6] Lignes de réfutation (PV des positions de punition) …")
        try:
            pvs_filled = deepen_chapter(conn, config, result.chapter_id,
                                        on_progress=lambda m: progress(f"      {m}"))
            progress(f"      {pvs_filled} PV remplie(s).")
        except Exception as exc:                   # noqa: BLE001 - never lose a good analysis
            deepen_error = str(exc)
            progress(f"      ÉCHEC (analyse conservée) : {exc}")
            progress("      Relance `oa.py deepen` quand le moteur est disponible.")

    progress("Terminé.")
    return AnalyzeResult(
        chapter_id=result.chapter_id, chapter_name=result.chapter_name,
        positions=total, errors=errors, pvs_filled=pvs_filled, deepen_error=deepen_error,
    )


def deepen_chapter(conn: sqlite3.Connection, config: Config, chapter_id: int,
                   *, on_progress: ProgressFn | None = None) -> int:
    """Fill the principal variation (best_pv) of each punishment position in a chapter, so the
    trainer can chain a refutation past the first move. For every opponent mistake we take the
    position AFTER it and re-evaluate it once (bypassing the cache to capture the PV the earlier
    eval discarded). Returns how many PVs were filled. Offline with a local Stockfish; set the
    eval order to stockfish and OA_STOCKFISH_PATH. Idempotent: positions that already have a PV
    are skipped."""
    progress = on_progress or _noop
    resolver = EvalResolver(conn, config)
    errors = conn.execute(
        "SELECT DISTINCT position_id, mistake_move_uci FROM errors "
        "WHERE chapter_id = ? AND mistake_move_uci IS NOT NULL", (chapter_id,)).fetchall()
    targets: set[str] = set()
    for e in errors:
        parent = db.get_position(conn, e["position_id"])
        if parent is None:
            continue
        try:
            board = chess.Board(_ensure_full_fen(parent["fen4"]))
            board.push_uci(e["mistake_move_uci"])
        except (ValueError, AssertionError):
            continue
        targets.add(fen4(board))
    filled = 0
    try:
        for i, target in enumerate(sorted(targets), 1):
            row = db.get_position_by_fen(conn, target)
            if row is not None and (row["best_pv"] if "best_pv" in row.keys() else None):
                continue                               # already has a PV
            ev = resolver.get(target, use_cache=False)  # fresh eval → captures the PV
            if ev is not None and len(ev.pv) > 1:
                filled += 1
            if i % 10 == 0 or i == len(targets):
                progress(f"{i}/{len(targets)} positions · {filled} PV remplies")
    finally:
        resolver.close()
    return filled


def redetect_chapter(conn: sqlite3.Connection, config: Config, chapter_id: int,
                     *, on_progress: ProgressFn | None = None) -> int:
    """Re-run detection + scoring on an already-analysed chapter using the CACHED evals and
    human stats (no network). Lets you change the error threshold (the rating-aware curve or
    --loss-pawns) without re-fetching. Clears the chapter's errors first, so the table reflects
    the CURRENT thresholds exactly rather than accumulating past passes. Returns the count."""
    progress = on_progress or _noop
    resolver = EvalResolver(conn, config)
    conn.execute("DELETE FROM errors WHERE chapter_id = ?", (chapter_id,))
    positions = [pid for (pid,) in conn.execute(
        "SELECT DISTINCT position_id FROM paths WHERE chapter_id = ?", (chapter_id,))]
    table = config.thresholds.error_threshold_cp
    lo, hi = (min(table.values()), max(table.values())) if table else (config.thresholds.mistake_cp,) * 2
    bar = f"{lo} cp" if lo == hi else f"rating-aware {lo}–{hi} cp"
    progress(f"Ré-détection de {len(positions)} positions (seuil {bar}) …")
    dstats = detect.DetectStats()
    for pid in positions:
        path_row = conn.execute(
            "SELECT id FROM paths WHERE chapter_id = ? AND position_id = ? "
            "ORDER BY ply ASC LIMIT 1", (chapter_id, pid)).fetchone()
        detect.detect_position(
            conn, resolver, config, db.get_position(conn, pid),
            chapter_id=chapter_id, path_id=path_row["id"] if path_row else None, stats=dstats)
    scoring.score_chapter(conn, config, chapter_id)
    conn.commit()
    total = conn.execute(
        "SELECT COUNT(*) FROM errors WHERE chapter_id = ?", (chapter_id,)).fetchone()[0]
    progress(f"{dstats.errors_found} erreur(s) à ce passage · {total} au total dans le chapitre.")
    return total
