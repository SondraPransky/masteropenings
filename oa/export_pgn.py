"""Export detected errors as annotated PGN files (M3 + M4).

M3 — one PGN per decision point (the top errors of a chapter by Criticality): the line to
the position, the engine's best move as the mainline, and each frequent human mistake as
an annotated variation (NAG + a per-Elo comment).

M4 — the files are written under ``Errors/<chapter>/`` mirroring the input chapter (D17),
with an index, so the whole error database is browsable and importable into a GUI, a
Lichess study, or Chessable.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

import chess
import chess.pgn

from . import db
from .config import Config
from .report import _slug

NAG_MISTAKE = 2
NAG_BLUNDER = 4
NAG_GOOD_MOVE = 1


@dataclass
class _Mistake:
    uci: str
    san: str
    eval_loss_cp: int
    error_type: str
    peak: float = 0.0
    buckets: list[dict] = field(default_factory=list)


@dataclass
class _Decision:
    position_id: int
    best_uci: str | None
    best_san: str | None
    eco: str | None
    opening: str | None
    path_ucis: list[str]
    mistakes: dict[str, _Mistake] = field(default_factory=dict)
    peak: float = 0.0


def collect_decisions(conn: sqlite3.Connection, chapter_id: int) -> list[_Decision]:
    """Group a chapter's errors by decision point (position), aggregating buckets."""
    errors = db.errors_for_chapter(conn, chapter_id)
    decisions: dict[int, _Decision] = {}
    for e in errors:
        pid = e["position_id"]
        dec = decisions.get(pid)
        if dec is None:
            pos = db.get_position(conn, pid)
            dec = _Decision(
                position_id=pid,
                best_uci=e["best_move_uci"],
                best_san=e["best_move_san"],
                eco=pos["opening_eco"] if pos else None,
                opening=pos["opening_name"] if pos else None,
                path_ucis=_shortest_path(conn, chapter_id, pid),
            )
            decisions[pid] = dec
        mis = dec.mistakes.get(e["mistake_move_uci"])
        if mis is None:
            mis = _Mistake(
                uci=e["mistake_move_uci"],
                san=e["mistake_move_san"] or e["mistake_move_uci"],
                eval_loss_cp=e["eval_loss_cp"],
                error_type=e["error_type"],
            )
            dec.mistakes[e["mistake_move_uci"]] = mis
        crit = e["criticality"] or 0.0
        mis.buckets.append({
            "bucket": e["elo_bucket"], "freq": e["mistake_frequency"],
            "dwr": e["delta_winrate"], "crit": crit, "games": e["mistake_games"],
        })
        mis.peak = max(mis.peak, crit)
        dec.peak = max(dec.peak, crit)
    return list(decisions.values())


def _shortest_path(conn: sqlite3.Connection, chapter_id: int, position_id: int) -> list[str]:
    row = conn.execute(
        "SELECT move_sequence FROM paths WHERE chapter_id = ? AND position_id = ? "
        "ORDER BY ply ASC LIMIT 1",
        (chapter_id, position_id),
    ).fetchone()
    if row is None or not row["move_sequence"]:
        return []
    return row["move_sequence"].split()


def _mistake_comment(mis: _Mistake) -> str:
    by_elo = ", ".join(
        f"{b['bucket']}+: {100 * b['freq']:.0f}%"
        + (f"/{100 * b['dwr']:+.0f}% wr" if b["dwr"] is not None else "")
        for b in sorted(mis.buckets, key=lambda x: x["bucket"])
    )
    return (f"Human mistake ({mis.error_type}). Engine loss {mis.eval_loss_cp / 100:+.2f}. "
            f"Peak criticality {mis.peak:.3f}. By Elo — {by_elo}.")


def build_error_game(conn: sqlite3.Connection, chapter_name: str, dec: _Decision) -> "chess.pgn.Game":
    """Build one annotated PGN game for a decision point."""
    game = chess.pgn.Game()
    game.headers["Event"] = f"{chapter_name} — error"
    game.headers["Site"] = "Opening Analytics"
    game.headers["White"] = "Best move"
    game.headers["Black"] = "Human mistakes"
    game.headers["Result"] = "*"
    if dec.eco:
        game.headers["ECO"] = dec.eco
    if dec.opening:
        game.headers["Opening"] = dec.opening

    board = chess.Board()
    node: chess.pgn.GameNode = game
    for uci in dec.path_ucis:
        move = chess.Move.from_uci(uci)
        node = node.add_main_variation(move)
        board.push(move)

    side = "White" if board.turn == chess.WHITE else "Black"
    node.comment = f"{side} to move. Decision point (peak criticality {dec.peak:.3f})."

    # Best move as the mainline continuation.
    if dec.best_uci:
        try:
            best_move = chess.Move.from_uci(dec.best_uci)
            if best_move in board.legal_moves:
                best_node = node.add_main_variation(best_move)
                best_node.nags.add(NAG_GOOD_MOVE)
                best_node.comment = "Best move (engine)."
        except ValueError:
            pass

    # Each human mistake as an annotated variation, worst first.
    for mis in sorted(dec.mistakes.values(), key=lambda m: m.peak, reverse=True):
        try:
            move = chess.Move.from_uci(mis.uci)
        except ValueError:
            continue
        if move not in board.legal_moves:
            continue
        var = node.add_variation(move)
        var.nags.add(NAG_BLUNDER if mis.error_type == "puzzle" else NAG_MISTAKE)
        var.comment = _mistake_comment(mis)
    return game


def export_chapter_errors(
    conn: sqlite3.Connection,
    config: Config,
    chapter_id: int,
    *,
    out_root: Path,
    top: int | None = None,
    min_criticality: float = 0.05,
) -> list[Path]:
    """Write one PGN per top decision point under out_root/<chapter>/. Returns the paths."""
    chapter = conn.execute(
        "SELECT * FROM chapters WHERE id = ?", (chapter_id,)
    ).fetchone()
    decisions = [d for d in collect_decisions(conn, chapter_id) if d.peak >= min_criticality]
    decisions.sort(key=lambda d: d.peak, reverse=True)
    if top:
        decisions = decisions[:top]

    chapter_dir = out_root / _slug(chapter["name"])
    chapter_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    index_lines = [f"# Errors — {chapter['name']}", "",
                   f"{len(decisions)} decision points (Criticality ≥ {min_criticality:g}), "
                   "worst first.", ""]

    for i, dec in enumerate(decisions, 1):
        game = build_error_game(conn, chapter["name"], dec)
        san_line = _game_san_line(game)
        fname = f"{i:02d}_{_line_slug(san_line)}.pgn"
        path = chapter_dir / fname
        path.write_text(str(game) + "\n", encoding="utf-8")
        written.append(path)
        best = dec.best_san or dec.best_uci or "—"
        worst = max(dec.mistakes.values(), key=lambda m: m.peak)
        index_lines.append(f"{i}. `{fname}` — best **{best}**, mistake **{worst.san}** "
                           f"(peak {dec.peak:.3f})")

    (chapter_dir / "00_README.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")
    return written


def _game_san_line(game: "chess.pgn.Game") -> str:
    board = game.board()
    moves = list(game.mainline_moves())
    try:
        return board.variation_san(moves)
    except (ValueError, AssertionError):
        return ""


def _line_slug(san_line: str) -> str:
    keep = [c if c.isalnum() else "-" for c in san_line]
    slug = "".join(keep)
    while "--" in slug:
        slug = slug.replace("--", "-")
    slug = slug.strip("-")
    return (slug[:60] or "line")
