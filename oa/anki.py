"""Anki export (M14 variant) — decks as Anki's native tab-separated text, no dependency.

Each card is a decision point: the Front shows the line and asks for the best move; the
Back gives the engine's move plus the human mistake to avoid, with the per-Elo frequencies
(D11). Import into Anki via File → Import (the header lines set the format automatically).
A chapter deck (M14) or a player's own-error deck (M13 export) can both be produced.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import chess

from . import db
from .export_pgn import _shortest_path, collect_decisions
from .report import _slug

HEADER = ["#separator:tab", "#html:true", "#columns:Front\tBack"]


def _clean(text: str) -> str:
    return text.replace("\t", " ").replace("\r", "").replace("\n", "<br>")


def _san_line(path_ucis: list[str]) -> str:
    board = chess.Board()
    moves = [chess.Move.from_uci(u) for u in path_ucis]
    try:
        return board.variation_san(moves) if moves else "(start)"
    except (ValueError, AssertionError):
        return " ".join(path_ucis)


def _side_to_move(path_ucis: list[str]) -> str:
    board = chess.Board()
    for u in path_ucis:
        board.push_uci(u)
    return "White" if board.turn == chess.WHITE else "Black"


def _by_elo(mistake) -> str:
    return ", ".join(
        f"{b['bucket']}+: {100 * b['freq']:.0f}%"
        for b in sorted(mistake.buckets, key=lambda x: x["bucket"])
    )


def chapter_cards(
    conn: sqlite3.Connection, chapter_id: int, *, min_criticality: float = 0.05
) -> list[tuple[str, str]]:
    """(Front, Back) pairs for a chapter's decision points, worst first (M14)."""
    decisions = [d for d in collect_decisions(conn, chapter_id) if d.peak >= min_criticality]
    decisions.sort(key=lambda d: d.peak, reverse=True)
    cards: list[tuple[str, str]] = []
    for dec in decisions:
        line = _san_line(dec.path_ucis)
        side = _side_to_move(dec.path_ucis)
        best = dec.best_san or dec.best_uci or "?"
        worst = max(dec.mistakes.values(), key=lambda m: m.peak)
        front = f"{line}<br><b>{side} to move</b> — what is the best move?"
        back = (f"Best: <b>{best}</b>.<br>"
                f"Avoid <b>{worst.san}</b> (engine loss {worst.eval_loss_cp / 100:+.2f}).<br>"
                f"Human frequency — {_by_elo(worst)}.")
        cards.append((front, back))
    return cards


def user_cards(
    conn: sqlite3.Connection, username: str, account_id: int | None = None
) -> list[tuple[str, str]]:
    """(Front, Back) pairs for a player's own catalogued errors (M13 export)."""
    if account_id is None:
        account_id = db.ensure_local_account(conn)
    cards: list[tuple[str, str]] = []
    for r in db.personal_errors_for_user(conn, username, account_id):
        row = conn.execute(
            "SELECT move_sequence FROM paths WHERE position_id = ? ORDER BY ply ASC LIMIT 1",
            (r["position_id"],),
        ).fetchone()
        ucis = row["move_sequence"].split() if row and row["move_sequence"] else []
        line = _san_line(ucis)
        side = _side_to_move(ucis)
        best = r["best_move_san"] or r["best_move_uci"] or "?"
        played = r["played_san"] or r["played_uci"]
        front = f"{line}<br><b>{side} to move</b> — what is the best move?"
        back = (f"Best: <b>{best}</b>.<br>"
                f"You played <b>{played}</b> (loss {(r['eval_loss_cp'] or 0) / 100:+.2f}).")
        cards.append((front, back))
    return cards


def write_deck(cards: list[tuple[str, str]], out_path: "str | Path") -> Path:
    """Write cards as an Anki-importable tab-separated text file. Returns the path."""
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = list(HEADER)
    lines += [f"{_clean(front)}\t{_clean(back)}" for front, back in cards]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out


def export_chapter(
    conn: sqlite3.Connection, chapter_id: int, chapter_name: str, out_dir: "str | Path",
    *, min_criticality: float = 0.05,
) -> tuple[Path, int]:
    cards = chapter_cards(conn, chapter_id, min_criticality=min_criticality)
    out = Path(out_dir) / f"{_slug(chapter_name)}.txt"
    return write_deck(cards, out), len(cards)


def export_user(
    conn: sqlite3.Connection, username: str, out_dir: "str | Path"
) -> tuple[Path, int]:
    cards = user_cards(conn, username)
    out = Path(out_dir) / f"personal-{_slug(username)}.txt"
    return write_deck(cards, out), len(cards)
