"""Sorted error report (views M2/M5/M6/M7).

Renders the `errors` of a chapter, sorted by Criticality and grouped by Elo bucket, as
both a Markdown file (`reports/<chapter>.md`) and a compact console table. This single
query is simultaneously:

* M2 — difficult positions (sorted by criticality),
* M5 — critical moves (where humans leave theory),
* M6 — human vs engine (best move vs the frequent human mistake),
* M7 — frequency analysis (mistake frequency per bucket).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import chess

from . import db
from .config import Config
from .fen import _ensure_full_fen


def _san_line(chapter_id: int, conn: sqlite3.Connection, position_id: int) -> str:
    """Human-readable SAN line reaching a position (shortest path in the chapter)."""
    row = conn.execute(
        """
        SELECT move_sequence FROM paths
         WHERE chapter_id = ? AND position_id = ?
         ORDER BY ply ASC LIMIT 1
        """,
        (chapter_id, position_id),
    ).fetchone()
    if row is None or not row["move_sequence"]:
        return "(start)"
    board = chess.Board()
    moves = [chess.Move.from_uci(u) for u in row["move_sequence"].split()]
    try:
        return board.variation_san(moves)
    except (ValueError, AssertionError):
        return row["move_sequence"]


def _pawns(cp: int) -> str:
    return f"{cp / 100:+.2f}"


def build_report(conn: sqlite3.Connection, config: Config, chapter_id: int) -> str:
    """Return the Markdown report for a chapter."""
    chapter = conn.execute(
        "SELECT * FROM chapters WHERE id = ?", (chapter_id,)
    ).fetchone()
    errors = db.errors_for_chapter(conn, chapter_id)

    lines: list[str] = []
    lines.append(f"# Error report — {chapter['name']}")
    lines.append("")
    lines.append(f"_Source: `{chapter['source_file']}`_  ")
    lines.append(
        f"_Thresholds: mistake ≥ {_pawns(config.thresholds.mistake_cp)} pawn, "
        f"min games {config.thresholds.min_games} per cell (D12/D13)._"
    )
    lines.append("")

    if not errors:
        lines.append(
            "No errors detected. Either every frequent human move is sound, or the "
            "cells lacked enough games / evals (run with the live Lichess endpoints)."
        )
        return "\n".join(lines) + "\n"

    lines.append(f"**{len(errors)} error rows** across all Elo buckets, "
                 "sorted by Criticality.\n")

    # Group by bucket, preserving criticality order within each group.
    by_bucket: dict[int, list[sqlite3.Row]] = {}
    for err in errors:
        by_bucket.setdefault(err["elo_bucket"], []).append(err)

    for bucket in sorted(by_bucket):
        group = sorted(
            by_bucket[bucket],
            key=lambda e: (e["criticality"] or 0.0),
            reverse=True,
        )
        lines.append(f"## Elo bucket {bucket}+")
        lines.append("")
        lines.append(
            "| Line | Best move | Human mistake | Freq | Eval loss | ΔWinrate | "
            "Criticality | Type |"
        )
        lines.append("|------|-----------|---------------|------|-----------|"
                     "----------|-------------|------|")
        for e in group:
            line = _san_line(chapter_id, conn, e["position_id"])
            freq = f"{100 * e['mistake_frequency']:.0f}%"
            dwr = "—" if e["delta_winrate"] is None else f"{100 * e['delta_winrate']:+.1f}%"
            crit = "—" if e["criticality"] is None else f"{e['criticality']:.3f}"
            lines.append(
                f"| {line} | {e['best_move_san'] or e['best_move_uci'] or '—'} "
                f"| {e['mistake_move_san'] or e['mistake_move_uci']} "
                f"| {freq} | {_pawns(e['eval_loss_cp'])} | {dwr} | {crit} "
                f"| {e['error_type']} |"
            )
        lines.append("")

    return "\n".join(lines) + "\n"


def build_course_report(
    conn: sqlite3.Connection,
    config: Config,
    chapter_id: int,
    min_criticality: float = 0.05,
) -> str:
    """A study-sheet view: one entry per decision point (position + human mistake),
    sorted by peak Criticality, showing at which Elo levels players fall for it.

    Only traps whose peak Criticality across buckets reaches ``min_criticality`` are kept,
    so the coach sees the moves worth teaching, not the long tail.
    """
    chapter = conn.execute(
        "SELECT * FROM chapters WHERE id = ?", (chapter_id,)
    ).fetchone()
    errors = db.errors_for_chapter(conn, chapter_id)

    # Group by (position, mistake move); a trap can recur across several buckets.
    groups: dict[tuple[int, str], dict] = {}
    for e in errors:
        key = (e["position_id"], e["mistake_move_uci"])
        g = groups.setdefault(key, {
            "position_id": e["position_id"],
            "best": e["best_move_san"] or e["best_move_uci"],
            "mistake": e["mistake_move_san"] or e["mistake_move_uci"],
            "eval_loss_cp": e["eval_loss_cp"],
            "error_type": e["error_type"],
            "buckets": [],
            "peak": 0.0,
        })
        crit = e["criticality"] or 0.0
        g["buckets"].append({
            "bucket": e["elo_bucket"],
            "freq": e["mistake_frequency"],
            "dwr": e["delta_winrate"],
            "crit": crit,
        })
        g["peak"] = max(g["peak"], crit)

    kept = [g for g in groups.values() if g["peak"] >= min_criticality]
    kept.sort(key=lambda g: g["peak"], reverse=True)

    lines: list[str] = []
    lines.append(f"# Study sheet — {chapter['name']}")
    lines.append("")
    lines.append(f"_The {len(kept)} costliest human mistakes (Criticality ≥ "
                 f"{min_criticality:g}), each shown with the Elo levels where players "
                 "fall for it._")
    lines.append("")

    for i, g in enumerate(kept, 1):
        line = _san_line(chapter_id, conn, g["position_id"])
        badge = "🧩 puzzle" if g["error_type"] == "puzzle" else "📇 flashcard"
        lines.append(f"## {i}. {line}")
        lines.append("")
        lines.append(f"- **Best move:** {g['best']}  ·  engine loss of the mistake: "
                     f"**{_pawns(g['eval_loss_cp'])}**  ·  {badge}")
        lines.append(f"- **Human mistake:** {g['mistake']}")
        lines.append("")
        lines.append("| Elo | Freq | ΔWinrate | Criticality |")
        lines.append("|-----|------|----------|-------------|")
        for b in sorted(g["buckets"], key=lambda x: x["bucket"]):
            dwr = "—" if b["dwr"] is None else f"{100 * b['dwr']:+.1f}%"
            lines.append(
                f"| {b['bucket']}+ | {100 * b['freq']:.0f}% | {dwr} | {b['crit']:.3f} |"
            )
        lines.append("")

    if not kept:
        lines.append("_No mistake reached the Criticality threshold. Lower "
                     "`--min-criticality` to see more._")
    return "\n".join(lines) + "\n"


def write_report(conn: sqlite3.Connection, config: Config, chapter_id: int) -> Path:
    """Write the Markdown report to reports/<chapter>.md and return the path."""
    chapter = conn.execute(
        "SELECT name FROM chapters WHERE id = ?", (chapter_id,)
    ).fetchone()
    config.reports_dir.mkdir(parents=True, exist_ok=True)
    slug = _slug(chapter["name"])
    out_path = config.reports_dir / f"{slug}.md"
    out_path.write_text(build_report(conn, config, chapter_id), encoding="utf-8")
    return out_path


def print_console_summary(
    conn: sqlite3.Connection, config: Config, chapter_id: int, top: int = 15
) -> None:
    """Print the top-N errors of a chapter to stdout."""
    errors = db.errors_for_chapter(conn, chapter_id)
    if not errors:
        print("  No errors detected (see report for why).")
        return
    print(f"  Top {min(top, len(errors))} of {len(errors)} error rows by Criticality:\n")
    header = (
        f"  {'Elo':>5}  {'Line':<34}  {'Best':<6}  {'Mistake':<7}  "
        f"{'Freq':>5}  {'Loss':>6}  {'Crit':>7}  Type"
    )
    print(header)
    print("  " + "-" * (len(header) - 2))
    for e in errors[:top]:
        line = _san_line(chapter_id, conn, e["position_id"])
        line = (line[:31] + "...") if len(line) > 34 else line
        crit = "-" if e["criticality"] is None else f"{e['criticality']:.3f}"
        print(
            f"  {e['elo_bucket']:>5}  {line:<34}  "
            f"{(e['best_move_san'] or e['best_move_uci'] or '-'):<6}  "
            f"{(e['mistake_move_san'] or e['mistake_move_uci']):<7}  "
            f"{100 * e['mistake_frequency']:>4.0f}%  {_pawns(e['eval_loss_cp']):>6}  "
            f"{crit:>7}  {e['error_type']}"
        )


def _slug(name: str) -> str:
    keep = [c.lower() if c.isalnum() else "-" for c in name]
    slug = "".join(keep)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-") or "chapter"
