"""Batch pre-fill of position evals from the Lichess eval dump (D2).

Streams ``lichess_db_eval.jsonl.zst`` once and fills the ``positions`` cache
(``eval_source='dump'``) for the positions our chapters actually need — a *filtered*
one-pass join, so memory stays tiny (only the target FEN-4 set) and no multi-GB table is
built. After a run, the EvalResolver serves those positions straight from cache and never
calls the cloud or Stockfish.

Dump line schema (one JSON object per line, ~395M lines)::

    {"fen": "<4-field FEN>",
     "evals": [{"knodes": N, "depth": D,
                "pvs": [{"cp": X | "mate": M, "line": "<uci ... UCI_Chess960>"}, ...]},
               ...]}

``cp``/``mate`` are taken from **White's POV** to match the cloud source (see
``base.Eval``). The ``line`` field uses UCI_Chess960 (castling encoded king-to-rook); we
normalise the best move to standard UCI + SAN so the trainer's move matching keeps working.

To keep the 395M-line scan fast we pull the FEN out of each line with a string slice and
only run ``json.loads`` on the (few thousand) lines that actually match a target.
"""

from __future__ import annotations

import io
import json
import sqlite3
from dataclasses import dataclass

import chess

from .. import db
from ..fen import _ensure_full_fen, fen4

_FEN_PREFIX = '{"fen":"'


@dataclass
class DumpStats:
    targets: int = 0          # positions we wanted an eval for
    matched: int = 0          # of those, found in the dump
    lines: int = 0            # dump lines scanned


def _load_targets(conn: sqlite3.Connection, only_missing: bool) -> dict[str, int]:
    """``{fen4: position_id}`` for the positions to fill. By default we (re)fill anything
    not already sourced from the dump — so the dump becomes the primary source (D2) and a
    re-run is idempotent. ``only_missing`` restricts to positions with no eval at all."""
    if only_missing:
        where = "eval_source IS NULL OR (eval_cp IS NULL AND eval_mate IS NULL)"
    else:
        where = "eval_source IS NULL OR eval_source <> 'dump'"
    rows = conn.execute(f"SELECT id, fen4 FROM positions WHERE {where}").fetchall()
    return {row["fen4"]: row["id"] for row in rows}


def _deepest_pv(evals: list) -> tuple | None:
    """Pick the deepest eval object (tie-break on knodes) and return its primary pv as
    ``(cp, mate, depth, moves_list)``, or None if there is no usable pv."""
    best_depth = best_knodes = -1
    chosen = None
    for ev in evals:
        pvs = ev.get("pvs") or []
        if not pvs:
            continue
        depth = ev.get("depth") or 0
        knodes = ev.get("knodes") or 0
        if depth > best_depth or (depth == best_depth and knodes > best_knodes):
            best_depth, best_knodes, chosen = depth, knodes, (pvs[0], depth)
    if chosen is None:
        return None
    top, depth = chosen
    return top.get("cp"), top.get("mate"), depth, (top.get("line") or "").split()


def _normalise_best_move(fen4_str: str, uci: str | None) -> tuple[str | None, str | None]:
    """Dump UCI (UCI_Chess960 for castling) -> ``(standard_uci, san)``; ``(None, None)`` if
    unparseable. Tries standard parsing first, then Chess960, so both castling encodings work."""
    if not uci:
        return None, None
    full = _ensure_full_fen(fen4_str)
    for chess960 in (False, True):
        try:
            board = chess.Board(full, chess960=chess960)
            move = board.parse_uci(uci)
            san = board.san(move)
            std = chess.Board(full).parse_san(san)   # re-emit as standard UCI
            return std.uci(), san
        except (ValueError, AssertionError, KeyError):
            continue
    return None, None


def ingest_dump(conn: sqlite3.Connection, dump_path, *, only_missing: bool = False,
                progress_every: int = 5_000_000, log=print) -> DumpStats:
    """Fill position evals from the dump at ``dump_path`` (a ``.jsonl.zst`` file)."""
    try:
        import zstandard
    except ImportError as exc:   # pragma: no cover - environment dependent
        raise RuntimeError(
            "the 'zstandard' package is required for dump ingestion: pip install zstandard"
        ) from exc

    targets = _load_targets(conn, only_missing)
    stats = DumpStats(targets=len(targets))
    if not targets:
        return stats
    remaining = set(targets.values())

    dctx = zstandard.ZstdDecompressor()
    with open(dump_path, "rb") as fh, dctx.stream_reader(fh) as reader:
        text = io.TextIOWrapper(reader, encoding="utf-8")
        for line in text:
            stats.lines += 1
            if progress_every and stats.lines % progress_every == 0:
                log(f"  … {stats.lines:,} lines, {stats.matched}/{stats.targets} matched")

            # Fast path: slice the FEN out without parsing the whole (large) JSON line.
            if line.startswith(_FEN_PREFIX):
                end = line.find('"', len(_FEN_PREFIX))
                if end == -1:
                    continue
                fen = line[len(_FEN_PREFIX):end]
            else:
                try:
                    fen = (json.loads(line) or {}).get("fen")
                except json.JSONDecodeError:
                    continue
                if not fen:
                    continue

            parts = fen.split(" ")
            key = " ".join(parts[:4])
            pid = targets.get(key)
            # The dump's en-passant convention may differ from python-chess's (ep only when
            # capturable). Re-normalise only ambiguous lines (ep set) — cheap, and rare.
            if pid is None and len(parts) >= 4 and parts[3] != "-":
                try:
                    pid = targets.get(fen4(key))
                except (ValueError, AssertionError):
                    pid = None
            if pid is None:
                continue

            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            picked = _deepest_pv(obj.get("evals") or [])
            if picked is None:
                continue
            cp, mate, depth, moves = picked
            best_uci, best_san = _normalise_best_move(key, moves[0] if moves else None)
            db.set_position_eval(
                conn, pid, best_move_uci=best_uci, best_move_san=best_san,
                eval_cp=cp, eval_mate=mate, eval_depth=depth, eval_source="dump",
            )
            stats.matched += 1
            remaining.discard(pid)
            if not remaining:
                log(f"  all {stats.targets} target positions found — stopping early.")
                break

    conn.commit()
    return stats
