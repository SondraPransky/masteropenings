"""Command-line entry point and pipeline orchestration.

    python -m opening_analytics.cli init-db
    python -m opening_analytics.cli analyze --chapter data/chapters/evans-gambit.pgn \
        --name "Evans Gambit" [--min-games N] [--loss-pawns F] [--limit-positions N] \
        [--no-explorer] [--eval-source cloud|stockfish]

`analyze` runs the full vertical slice: ingest -> (eval + explorer) per position ->
detect -> score -> report. Everything is cached in one SQLite DB, so re-runs are cheap.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

from . import (db, detect, export_pgn, ingest, personal as personal_mod,
               prefetch as prefetch_mod, report, scoring)
from .config import Config
from .evals.resolver import EvalResolver
from .explorer import LichessExplorerClient


def build_config(args: argparse.Namespace) -> Config:
    config = Config()
    if getattr(args, "db_path", None):
        config.db_path = Path(args.db_path)
    if getattr(args, "min_games", None) is not None:
        config.thresholds.min_games = args.min_games
    if getattr(args, "loss_pawns", None) is not None:
        # Flat override of the rating-aware detection bar (same cp for every Elo bucket).
        # mistake_cp is left as the severity/criticality reference so scores stay comparable.
        cp = int(round(args.loss_pawns * 100))
        config.thresholds.error_threshold_cp = {
            b: cp for b in config.thresholds.error_threshold_cp}
    if getattr(args, "eval_source", None):
        config.eval = replace(config.eval, order=(args.eval_source,))
    config.ensure_dirs()
    return config


def cmd_init_db(args: argparse.Namespace) -> int:
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    print(f"Initialised database at {config.db_path}")
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    config = build_config(args)
    chapter_path = Path(args.chapter)
    if not chapter_path.exists():
        print(f"error: chapter file not found: {chapter_path}", file=sys.stderr)
        return 2

    conn = db.connect(config.db_path)
    db.init_db(conn)
    from . import pipeline
    res = pipeline.analyze_chapter(
        conn, config, chapter_path, args.name,
        no_explorer=args.no_explorer, no_deepen=args.no_deepen,
        limit_positions=args.limit_positions,
        on_progress=lambda m: print(m, flush=True),
    )
    print()
    report.print_console_summary(conn, config, res.chapter_id)
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    chapter = conn.execute(
        "SELECT * FROM chapters WHERE name = ?", (args.name,)
    ).fetchone()
    if chapter is None:
        names = [r["name"] for r in conn.execute("SELECT name FROM chapters")]
        print(f"error: no chapter named {args.name!r}. Available: {names}",
              file=sys.stderr)
        return 2

    config.reports_dir.mkdir(parents=True, exist_ok=True)
    slug = report._slug(chapter["name"])
    if args.style == "course":
        text = report.build_course_report(conn, config, chapter["id"], args.min_criticality)
        out = config.reports_dir / f"{slug}-study.md"
    else:
        text = report.build_report(conn, config, chapter["id"])
        out = config.reports_dir / f"{slug}.md"
    out.write_text(text, encoding="utf-8")
    print(f"Report written to {out}")
    report.print_console_summary(conn, config, chapter["id"])
    return 0


def cmd_rescore(args: argparse.Namespace) -> int:
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    chapters = conn.execute("SELECT id, name FROM chapters ORDER BY name").fetchall()
    if args.name:
        chapters = [c for c in chapters if c["name"] == args.name]
        if not chapters:
            print(f"error: no chapter named {args.name!r}", file=sys.stderr)
            return 2
    total = 0
    for ch in chapters:
        n = scoring.score_chapter(conn, config, ch["id"])
        total += n
        print(f"  rescored {n} error(s) in {ch['name']!r}")
    print(f"Rescored {total} error(s) with severity exponent "
          f"{config.thresholds.criticality_severity_exponent}.")
    return 0


def cmd_prefetch(args: argparse.Namespace) -> int:
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    mode = ("counting the tree" if args.count_only
            else "storing positions only (no stats)" if args.positions_only
            else "prefetching stats")
    print(f"Prefetch ({mode}): max_ply={args.max_ply}, "
          f"min_games_follow={args.min_games_follow} ...")
    result = prefetch_mod.prefetch(
        conn, config,
        max_ply=args.max_ply,
        min_games_follow=args.min_games_follow,
        count_only=args.count_only,
        positions_only=args.positions_only,
        max_positions=args.max_positions,
    )
    print(f"\n  positions walked: {result.visited}")
    if args.count_only:
        print(f"  (count-only) that's how many the full crawl would fetch. Re-run "
              "without --count-only to cache them.")
    elif args.positions_only:
        print(f"  positions stored this run: {result.cached} (evals left empty — run "
              "`ingest-evals --dump …` to fill them from the Lichess dump).")
    else:
        print(f"  positions cached this run: {result.cached}")
    if result.capped:
        print(f"  NOTE: hit --max-positions ({args.max_positions}); stopped. Raise the cap "
              "or the --min-games-follow threshold, then re-run to resume.")
    if result.stopped_early:
        print("  NOTE: stopped early (Explorer unavailable) — re-run to resume.")
    return 0


def cmd_ingest_evals(args: argparse.Namespace) -> int:
    from .evals import dump as dump_mod
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    scope = "positions with no eval" if args.only_missing else "all non-dump positions"
    print(f"Ingesting evals from {args.dump}\n  target: {scope} ...")
    stats = dump_mod.ingest_dump(conn, args.dump, only_missing=args.only_missing)
    if stats.targets == 0:
        print("  nothing to fill — every target position already has a dump eval "
              "(use --only-missing to change scope, or add chapters first).")
        return 0
    print(f"\n  target positions:  {stats.targets}")
    print(f"  filled from dump:  {stats.matched}")
    print(f"  lines scanned:     {stats.lines:,}")
    missing = stats.targets - stats.matched
    if missing:
        print(f"  NOTE: {missing} target position(s) were not in the dump — they keep "
              "their existing eval (cloud/Stockfish) or stay unevaluated.")
    return 0


def cmd_redetect(args: argparse.Namespace) -> int:
    from . import pipeline
    config = build_config(args)   # honours --loss-pawns -> thresholds.mistake_cp
    conn = db.connect(config.db_path)
    db.init_db(conn)
    chapters = conn.execute("SELECT id, name FROM chapters ORDER BY name").fetchall()
    if args.name:
        chapters = [c for c in chapters if c["name"] == args.name]
        if not chapters:
            print(f"error: no chapter named {args.name!r}", file=sys.stderr)
            return 2
    table = config.thresholds.error_threshold_cp
    lo, hi = (min(table.values()), max(table.values())) if table else (config.thresholds.mistake_cp,) * 2
    bar = f"{lo} cp" if lo == hi else f"rating-aware {lo}-{hi} cp"
    print(f"Re-detecting at {bar}, from cached evals/stats (offline) ...")
    for ch in chapters:
        total = pipeline.redetect_chapter(conn, config, ch["id"],
                                          on_progress=lambda m: print(f"  {m}", flush=True))
        print(f"  chapter {ch['name']!r}: {total} error(s) now.")
    return 0


def cmd_deepen(args: argparse.Namespace) -> int:
    from . import pipeline
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    chapters = conn.execute("SELECT id, name FROM chapters ORDER BY name").fetchall()
    if args.name:
        chapters = [c for c in chapters if c["name"] == args.name]
        if not chapters:
            print(f"error: no chapter named {args.name!r}", file=sys.stderr)
            return 2
    print("Approfondissement des lignes de réfutation (remplit les PV, moteur local) …")
    for ch in chapters:
        filled = pipeline.deepen_chapter(conn, config, ch["id"],
                                         on_progress=lambda m: print(f"  {m}", flush=True))
        print(f"  chapitre {ch['name']!r}: {filled} PV remplies.")
    return 0


def cmd_export_errors(args: argparse.Namespace) -> int:
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    chapter = conn.execute(
        "SELECT * FROM chapters WHERE name = ?", (args.name,)
    ).fetchone()
    if chapter is None:
        names = [r["name"] for r in conn.execute("SELECT name FROM chapters")]
        print(f"error: no chapter named {args.name!r}. Available: {names}", file=sys.stderr)
        return 2
    out_root = Path(args.out)
    written = export_pgn.export_chapter_errors(
        conn, config, chapter["id"],
        out_root=out_root, top=args.top, min_criticality=args.min_criticality,
    )
    print(f"Wrote {len(written)} PGN file(s) to {out_root / report._slug(chapter['name'])}/")
    for p in written[:5]:
        print(f"  {p.name}")
    if len(written) > 5:
        print(f"  ... and {len(written) - 5} more (see 00_README.md)")
    return 0


def cmd_export_anki(args: argparse.Namespace) -> int:
    from . import anki
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    out_dir = Path(args.out)
    if args.username:
        path, n = anki.export_user(conn, args.username, out_dir)
    elif args.name:
        chapter = conn.execute(
            "SELECT * FROM chapters WHERE name = ?", (args.name,)
        ).fetchone()
        if chapter is None:
            names = [r["name"] for r in conn.execute("SELECT name FROM chapters")]
            print(f"error: no chapter named {args.name!r}. Available: {names}",
                  file=sys.stderr)
            return 2
        path, n = anki.export_chapter(conn, chapter["id"], chapter["name"], out_dir,
                                      min_criticality=args.min_criticality)
    else:
        print("error: pass --name <chapter> or --username <player>.", file=sys.stderr)
        return 2
    if n == 0:
        print("No cards to export (run analyze / import first, or lower --min-criticality).")
        return 0
    print(f"Wrote {n} Anki card(s) to {path}")
    print("  Import into Anki via File → Import (the header sets tab/HTML automatically).")
    return 0


def cmd_retention(args: argparse.Namespace) -> int:
    from . import retention as ret_mod
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)

    def _show(summary, leeches):
        print(f"\n  {summary.label}: {summary.total} cards — "
              f"{summary.new} new · {summary.learning} learning · {summary.mature} mature "
              f"({summary.mature_pct:.0%} of seen) · {summary.due} due · "
              f"{summary.leeches} leeches · avg ease {summary.avg_ease or '—'}")
        for lc in leeches:
            line = (lc.line[:46] + "…") if len(lc.line) > 47 else lc.line
            print(f"    leech: {lc.lapses} lapses, ease {lc.ease:.2f} — {line}")

    if args.username:
        _show(ret_mod.personal_retention(conn, args.username),
              ret_mod.personal_leeches(conn, args.username))
        return 0
    chapters = conn.execute("SELECT id, name FROM chapters ORDER BY name").fetchall()
    if args.name:
        chapters = [c for c in chapters if c["name"] == args.name]
        if not chapters:
            print(f"error: no chapter named {args.name!r}", file=sys.stderr)
            return 2
    if not chapters:
        print("No chapters yet.")
        return 0
    for ch in chapters:
        _show(ret_mod.chapter_retention(conn, ch["id"], ch["name"]),
              ret_mod.chapter_leeches(conn, ch["id"]))
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    config = build_config(args)
    from .webapp import create_app
    app = create_app(config)
    url = f"http://{args.host}:{args.port}/"
    print(f"Opening Analytics UI on {url}  (Ctrl+C to stop)")
    # threaded=True so the upload-status polling still responds while a background
    # analysis thread is running.
    app.run(host=args.host, port=args.port, debug=False, threaded=True)
    return 0


def cmd_import_games(args: argparse.Namespace) -> int:
    config = build_config(args)
    pgn_path = Path(args.pgn)
    if not pgn_path.exists():
        print(f"error: PGN not found: {pgn_path}", file=sys.stderr)
        return 2
    conn = db.connect(config.db_path)
    db.init_db(conn)
    res = personal_mod.import_pgn(conn, pgn_path, args.username)
    print(f"Imported {res.games_imported}/{res.games_seen} games for {args.username!r} "
          f"({res.games_skipped} skipped — player not in them).")
    print(f"  {res.positions_in_territory} player-to-move positions were in analysed "
          f"territory; {res.errors_found} personal error(s) found.")
    if res.deviations_found:
        print(f"  {res.deviations_found} 'left theory' deviation(s) judged from cached "
              "evals (personal-deviations).")
    if res.errors_found:
        print(f"  Run:  personal-report --username {args.username}")
    return 0


def cmd_personal_report(args: argparse.Namespace) -> int:
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    rows = personal_mod.personal_report(conn, args.username)
    if args.min_criticality:
        rows = [r for r in rows if (r["criticality"] or 0) >= args.min_criticality]
    if not rows:
        print(f"No personal errors for {args.username!r} "
              "(import games first, or they played inside analysed territory cleanly).")
        return 0

    lines = [f"# Personal errors — {args.username}", "",
             f"{len(rows)} mistakes within analysed territory, worst first.", "",
             "| Line | Played | Best | Loss | Criticality | Elo | Type |",
             "|------|--------|------|------|-------------|-----|------|"]
    print(f"\n  {len(rows)} personal error(s) for {args.username}, by Criticality:\n")
    print(f"  {'Crit':>6}  {'Played':<7} {'Best':<7} {'Loss':>6}  {'Elo':>5}  Line")
    for r in rows:
        line = personal_mod.line_for_position(conn, r["position_id"])
        crit = "—" if r["criticality"] is None else f"{r['criticality']:.3f}"
        loss = f"{(r['eval_loss_cp'] or 0) / 100:+.2f}"
        lines.append(f"| {line} | {r['played_san'] or r['played_uci']} "
                     f"| {r['best_move_san'] or r['best_move_uci']} | {loss} "
                     f"| {crit} | {r['elo_bucket'] or '—'} | {r['error_type']} |")
        short = (line[:40] + "…") if len(line) > 41 else line
        print(f"  {crit:>6}  {(r['played_san'] or r['played_uci']):<7} "
              f"{(r['best_move_san'] or r['best_move_uci']):<7} {loss:>6}  "
              f"{str(r['elo_bucket'] or '—'):>5}  {short}")

    config.reports_dir.mkdir(parents=True, exist_ok=True)
    out = config.reports_dir / f"personal-{report._slug(args.username)}.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n  report written to {out}")
    return 0


def cmd_fetch_games(args: argparse.Namespace) -> int:
    from . import http, lichess_games
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    print(f"Fetching {args.username!r} games from Lichess "
          f"(max={args.max}, perf={args.perf_type or 'all'}) ...", flush=True)
    try:
        res, dest = lichess_games.fetch_and_import(
            conn, config, args.username,
            max_games=args.max, rated=args.rated, perf_type=args.perf_type,
            since=args.since, until=args.until,
        )
    except http.HttpError as exc:
        print(f"error: Lichess fetch failed: {exc}", file=sys.stderr)
        if getattr(exc, "status", None) in (401, 403):
            print("  (set OA_LICHESS_TOKEN — see the README.)", file=sys.stderr)
        return 1
    if res.games_seen == 0:
        print("  No games returned (check the username / filters).")
        return 0
    print(f"  Saved PGN to {dest}")
    print(f"  Imported {res.games_imported}/{res.games_seen} games; "
          f"{res.positions_in_territory} positions in analysed territory; "
          f"{res.errors_found} personal error(s); "
          f"{res.deviations_found} deviation(s).")
    if res.errors_found:
        print(f"  Run:  personal-report --username {args.username}")
    return 0


def cmd_personal_deviations(args: argparse.Namespace) -> int:
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    rows = personal_mod.deviations(conn, args.username)
    if args.costly_only:
        rows = [r for r in rows if r["costly"]]
    if not rows:
        print(f"No recorded 'left theory' deviations for {args.username!r} "
              "(need games imported with the child positions already in the base).")
        return 0
    print(f"\n  'Left theory' deviations for {args.username} — off-book moves judged from "
          "cached evals:\n")
    print(f"  {'Loss':>6} {'Costly':>6}  {'Played':<7} {'Best':<7}  Line")
    for r in rows:
        line = personal_mod.line_for_position(conn, r["position_id"])
        short = (line[:38] + "…") if len(line) > 39 else line
        loss = f"{(r['eval_loss_cp'] or 0) / 100:+.2f}"
        print(f"  {loss:>6} {('yes' if r['costly'] else 'no'):>6}  "
              f"{(r['played_san'] or r['played_uci']):<7} {(r['best_move_san'] or '—'):<7}  "
              f"{short}")
    return 0


def cmd_import_eecoach(args: argparse.Namespace) -> int:
    from . import eecoach
    config = build_config(args)
    file_path = Path(args.file)
    if not file_path.exists():
        print(f"error: CSV not found: {file_path}", file=sys.stderr)
        return 2
    conn = db.connect(config.db_path)
    db.init_db(conn)
    stats = eecoach.import_csv(conn, file_path)
    print(f"Imported {stats.imported}/{stats.rows_seen} EEcoach recall failures "
          f"({stats.skipped_unparsable} unparsable).")
    print(f"  {stats.matched} landed on analysed positions (criticality inherited); "
          f"the rest are out of analysed territory.")
    if stats.matched:
        students = {r['student']
                    for r in db.eecoach_students(conn, db.ensure_local_account(conn))}
        print(f"  Run:  eecoach-report --student <name>   (students: {sorted(students)})")
    return 0


def cmd_eecoach_report(args: argparse.Namespace) -> int:
    from . import eecoach
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    rows = eecoach.student_report(conn, args.student)
    if not rows:
        students = [r["student"]
                    for r in db.eecoach_students(conn, db.ensure_local_account(conn))]
        print(f"No EEcoach failures for {args.student!r}. Known students: {students}")
        return 0
    print(f"\n  EEcoach recall failures for {args.student}, most critical first:\n")
    print(f"  {'Crit':>6}  {'Elo':>5}  {'Missed':<7} {'Played':<7} Line")
    for r in rows:
        crit = "—" if r["criticality"] is None else f"{r['criticality']:.3f}"
        line = (personal_mod.line_for_position(conn, r["position_id"])
                if r["position_id"] is not None else "(out of analysed territory)")
        short = (line[:40] + "…") if len(line) > 41 else line
        print(f"  {crit:>6}  {str(r['elo_bucket'] or '—'):>5}  "
              f"{(r['expected_move'] or '—'):<7} {(r['played_move'] or '—'):<7} {short}")
    periods = eecoach.failures_over_time(conn, args.student)
    if len(periods) > 1 or (periods and periods[0].period != "unknown"):
        print("\n  Failures over time:")
        for p in periods:
            print(f"    {p.period:<9} {p.failures:>4} failures ({p.matched} on critical positions)")
    return 0


def cmd_eecoach_cohort(args: argparse.Namespace) -> int:
    from . import eecoach
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    spots = eecoach.cohort_hotspots(conn, min_students=args.min_students)
    if not spots:
        print("No cohort hotspots (import EEcoach failures that match analysed positions).")
        return 0
    spots = spots[: args.top] if args.top else spots
    print("\n  EEcoach cohort hotspots — positions the group fails most (curriculum "
          "priority):\n")
    print(f"  {'Students':>8} {'Fails':>6} {'Crit':>6}  {'Best':<7} Line")
    for s in spots:
        line = (s.line[:40] + "…") if len(s.line) > 41 else s.line
        crit = "—" if s.criticality is None else f"{s.criticality:.3f}"
        print(f"  {s.students:>8} {s.failures:>6} {crit:>6}  "
              f"{(s.expected_move or '—'):<7} {line}")
    return 0


def cmd_error_lifetime(args: argparse.Namespace) -> int:
    from . import lifetime as lifetime_mod
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    chapter = conn.execute(
        "SELECT * FROM chapters WHERE name = ?", (args.name,)
    ).fetchone()
    if chapter is None:
        names = [r["name"] for r in conn.execute("SELECT name FROM chapters")]
        print(f"error: no chapter named {args.name!r}. Available: {names}", file=sys.stderr)
        return 2
    lives = lifetime_mod.chapter_error_lifetimes(
        conn, chapter["id"], min_criticality=args.min_criticality)
    if not lives:
        print(f"No errors for {args.name!r} (run analyze first).")
        return 0
    lives = lives[: args.top] if args.top else lives
    print(f"\n  Error lifetime for {args.name} — how high up the Elo ladder each "
          "mistake survives:\n")
    print(f"  {'Elo span':>10}  {'Mistake':<8} {'Best':<8} {'Peak':>6}  Line")
    for lf in lives:
        short = (lf.line[:40] + "…") if len(lf.line) > 41 else lf.line
        print(f"  {lf.span:>10}  {lf.mistake_san:<8} {(lf.best_san or '—'):<8} "
              f"{lf.peak:>6.3f}  {short}")
    return 0


def cmd_confusable(args: argparse.Namespace) -> int:
    from . import confusable as cf_mod
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    chapter = conn.execute("SELECT * FROM chapters WHERE name = ?", (args.name,)).fetchone()
    if chapter is None:
        names = [r["name"] for r in conn.execute("SELECT name FROM chapters")]
        print(f"error: no chapter named {args.name!r}. Available: {names}", file=sys.stderr)
        return 2
    pairs = cf_mod.chapter_confusables(conn, chapter["id"], max_diff=args.max_diff)
    if not pairs:
        print(f"No confusable pairs within {args.max_diff} squares.")
        return 0
    pairs = pairs[: args.top] if args.top else pairs
    print(f"\n  Confusable positions in {args.name} — look alike, play differently "
          f"(<= {args.max_diff} squares apart):\n")
    for p in pairs:
        print(f"  [{p.distance} sq] {p.line_a}  → best {p.best_a}")
        print(f"          {p.line_b}  → best {p.best_b}\n")
    return 0


def cmd_danger_depth(args: argparse.Namespace) -> int:
    from . import danger_depth as dd_mod
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    chapter = conn.execute("SELECT * FROM chapters WHERE name = ?", (args.name,)).fetchone()
    if chapter is None:
        names = [r["name"] for r in conn.execute("SELECT name FROM chapters")]
        print(f"error: no chapter named {args.name!r}. Available: {names}", file=sys.stderr)
        return 2
    lines = dd_mod.chapter_danger_depths(conn, chapter["id"],
                                         min_criticality=args.min_criticality)
    if not lines:
        print("No lines found (run analyze first).")
        return 0
    lines = lines[: args.top] if args.top else lines
    print(f"\n  Danger depth for {args.name} — where each line first gets sharp:\n")
    print(f"  {'First risk':>10}  {'Mistake':<8} {'Crit':>6}  Line")
    for lf in lines:
        short = (lf.line[:42] + "…") if len(lf.line) > 43 else lf.line
        risk = lf.danger_move if lf.danger_ply is not None else "clean"
        print(f"  {risk:>10}  {(lf.first_mistake_san or '—'):<8} "
              f"{lf.peak_criticality:>6.3f}  {short}")
    return 0


def cmd_gaps(args: argparse.Namespace) -> int:
    from . import gaps as gaps_mod
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    chapter = conn.execute("SELECT * FROM chapters WHERE name = ?", (args.name,)).fetchone()
    if chapter is None:
        names = [r["name"] for r in conn.execute("SELECT name FROM chapters")]
        print(f"error: no chapter named {args.name!r}. Available: {names}", file=sys.stderr)
        return 2
    color = args.color or gaps_mod.infer_repertoire_color(conn, chapter["id"])
    rows = gaps_mod.repertoire_gaps(
        conn, chapter["id"], bucket=args.bucket, color=color,
        min_games=args.min_games, min_frequency=args.min_freq,
    )
    side = "Blancs" if color == "w" else "Noirs"
    if not rows:
        print(f"No repertoire gaps for {args.name} ({side}, bucket {args.bucket}). "
              "Either fully covered, or no Explorer stats — run prefetch first.")
        return 0
    rows = rows[: args.top] if args.top else rows
    print(f"\n  Repertoire gaps for {args.name} — frequent {('Black' if color=='w' else 'White')} "
          f"replies you don't answer (bucket {args.bucket}, you play {side}):\n")
    print(f"  {'Freq':>5}  {'Games':>6}  {'Reply':<7}  Line")
    for gp in rows:
        short = (gp.line_san[:40] + "…") if len(gp.line_san) > 41 else gp.line_san
        print(f"  {gp.frequency*100:>4.0f}%  {gp.games:>6}  {gp.opp_move_san:<7}  {short}")
    return 0


def cmd_expected_value(args: argparse.Namespace) -> int:
    from . import expected_value as ev_mod
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    chapter = conn.execute(
        "SELECT * FROM chapters WHERE name = ?", (args.name,)
    ).fetchone()
    if chapter is None:
        names = [r["name"] for r in conn.execute("SELECT name FROM chapters")]
        print(f"error: no chapter named {args.name!r}. Available: {names}", file=sys.stderr)
        return 2
    evs = ev_mod.chapter_expected_values(
        conn, chapter["id"], args.bucket, min_criticality=args.min_criticality)
    if not evs:
        print("No decision points above the threshold.")
        return 0
    evs = evs[: args.top] if args.top else evs
    print(f"\n  What you'll actually face in {args.name} at {args.bucket}+ "
          "(reach probability × Criticality):\n")
    print(f"  {'ExpVal':>8}  {'Reach':>7}  {'Crit':>6}  {'Mistake':<8} Line")
    for e in evs:
        short = (e.line[:38] + "…") if len(e.line) > 39 else e.line
        print(f"  {e.expected_value:>8.4f}  {e.reach_probability:>6.1%}  "
              f"{e.peak_criticality:>6.3f}  {e.mistake_san:<8} {short}")
    return 0


def cmd_personal_progress(args: argparse.Namespace) -> int:
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    periods = personal_mod.progress(conn, args.username, granularity=args.by)
    if not periods:
        print(f"No games imported for {args.username!r}.")
        return 0
    print(f"\n  Progress for {args.username} (catalogued-error rate by {args.by}):\n")
    print(f"  {'Period':<9} {'Games':>6} {'Territory':>10} {'Errors':>7} {'Rate':>8}")
    for p in periods:
        rate = "—" if p.error_rate is None else f"{p.error_rate:.1%}"
        print(f"  {p.period:<9} {p.games:>6} {p.territory:>10} {p.errors:>7} {rate:>8}")
    return 0


def cmd_personal_priority(args: argparse.Namespace) -> int:
    config = build_config(args)
    conn = db.connect(config.db_path)
    db.init_db(conn)
    ranked = personal_mod.ranked_priorities(conn, args.username)
    if not ranked:
        print(f"No personal errors for {args.username!r} (import games first).")
        return 0
    ranked = ranked[: args.top] if args.top else ranked
    print(f"\n  Training priority for {args.username} (M24), highest first:\n")
    print(f"  {'Prio':>7}  {'×seen':>5} {'peer':>5} {'loss':>6} {'idle':>5}  Line")
    for r in ranked:
        line = personal_mod.line_for_position(conn, r["position_id"])
        short = (line[:38] + "…") if len(line) > 39 else line
        print(f"  {r['priority']:>7.3f}  {r['occurrences']:>5} "
              f"{r['peer_frequency']:>5.2f} {r['eval_loss_cp'] / 100:>+6.2f} "
              f"{r['days_since_review']:>5}  {short}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="opening_analytics",
        description="Human Opening Analytics Platform — MVP pipeline.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init-db", help="create the SQLite schema")
    p_init.set_defaults(func=cmd_init_db)

    p_an = sub.add_parser("analyze", help="run the full slice on a PGN chapter")
    p_an.add_argument("--chapter", required=True, help="path to a PGN chapter file")
    p_an.add_argument("--name", default=None, help="chapter name (default: filename)")
    p_an.add_argument("--db-path", default=None, help="SQLite path (default data/cache.sqlite)")
    p_an.add_argument("--min-games", type=int, default=None,
                      help="statistical-validity threshold per cell (D13, default 100)")
    p_an.add_argument("--loss-pawns", type=float, default=None,
                      help="error threshold in pawns (D12, default 1.0)")
    p_an.add_argument("--limit-positions", type=int, default=None,
                      help="cap positions analysed (quick runs)")
    p_an.add_argument("--no-explorer", action="store_true",
                      help="skip Explorer network calls (ingestion only)")
    p_an.add_argument("--no-deepen", action="store_true",
                      help="skip the refutation lines (step 6). Faster, but the trainer will "
                           "not chain a refutation past its first move until you run `deepen`")
    p_an.add_argument("--eval-source", choices=["cloud", "stockfish"], default=None,
                      help="force a single eval backend")
    p_an.set_defaults(func=cmd_analyze)

    p_rep = sub.add_parser("report", help="(re)generate a report from the DB, no network")
    p_rep.add_argument("--name", required=True, help="chapter name")
    p_rep.add_argument("--style", choices=["flat", "course"], default="course",
                       help="'course' = study sheet grouped by decision point (default)")
    p_rep.add_argument("--min-criticality", type=float, default=0.05,
                       help="course style: keep traps with peak Criticality >= this")
    p_rep.add_argument("--db-path", default=None)
    p_rep.set_defaults(func=cmd_report)

    p_rs = sub.add_parser("rescore",
                          help="recompute Criticality (e.g. after a formula change), no network")
    p_rs.add_argument("--name", default=None, help="chapter name (default: all chapters)")
    p_rs.add_argument("--db-path", default=None)
    p_rs.set_defaults(func=cmd_rescore)

    p_rd = sub.add_parser("redetect",
                          help="re-run error detection at a new threshold (--loss-pawns) "
                               "from cached evals/stats, no network")
    p_rd.add_argument("--name", default=None, help="chapter name (default: all chapters)")
    p_rd.add_argument("--loss-pawns", type=float, default=None,
                      help="error threshold in pawns (e.g. 0.5 = flag moves losing >= 50cp; "
                           "good for 1600-2200 players). Default: keep the current 1.0.")
    p_rd.add_argument("--db-path", default=None)
    p_rd.set_defaults(func=cmd_redetect)

    p_dp = sub.add_parser("deepen",
                          help="fill refutation lines (best_pv) for punishment positions so the "
                               "trainer can chain a few moves; local Stockfish, no re-fetch")
    p_dp.add_argument("--name", default=None, help="chapter name (default: all chapters)")
    p_dp.add_argument("--eval-source", choices=("stockfish", "cloud"), default=None,
                      help="force a single eval source (e.g. stockfish for fully-offline)")
    p_dp.add_argument("--db-path", default=None)
    p_dp.set_defaults(func=cmd_deepen)

    p_pf = sub.add_parser("prefetch",
                          help="pre-warm the popular opening tree into the cache")
    p_pf.add_argument("--max-ply", type=int, default=12, help="max depth (default 12)")
    p_pf.add_argument("--min-games-follow", type=int, default=5000,
                      help="only follow moves with >= this many games (default 5000)")
    p_pf.add_argument("--positions-only", action="store_true",
                      help="store popular-tree positions without the 9 per-bucket stat "
                           "calls (~10x fewer Explorer calls); fill evals later with "
                           "ingest-evals. For building a broad opening eval base.")
    p_pf.add_argument("--max-positions", type=int, default=None,
                      help="safety cap: stop after storing this many positions (guards "
                           "against a runaway tree at high --max-ply). Resumable.")
    p_pf.add_argument("--count-only", action="store_true",
                      help="size the crawl (peek only) without caching")
    p_pf.add_argument("--db-path", default=None)
    p_pf.set_defaults(func=cmd_prefetch)

    p_ie = sub.add_parser("ingest-evals",
                          help="fill position evals from the Lichess eval dump (.jsonl.zst, D2)")
    p_ie.add_argument("--dump", required=True,
                      help="path to lichess_db_eval.jsonl.zst")
    p_ie.add_argument("--only-missing", action="store_true",
                      help="only fill positions with no eval yet (default: also upgrade "
                           "cloud/Stockfish positions to the dump)")
    p_ie.add_argument("--db-path", default=None)
    p_ie.set_defaults(func=cmd_ingest_evals)

    p_ex = sub.add_parser("export-errors",
                          help="export detected errors as annotated PGN files (M3/M4)")
    p_ex.add_argument("--name", required=True, help="chapter name")
    p_ex.add_argument("--top", type=int, default=None,
                      help="keep only the top N decision points (default: all above threshold)")
    p_ex.add_argument("--min-criticality", type=float, default=0.05,
                      help="keep decision points with peak Criticality >= this (default 0.05)")
    p_ex.add_argument("--out", default="Errors", help="output root dir (default Errors/)")
    p_ex.add_argument("--db-path", default=None)
    p_ex.set_defaults(func=cmd_export_errors)

    p_ak = sub.add_parser("export-anki",
                          help="export a chapter (M14) or a player's errors as an Anki deck")
    p_ak.add_argument("--name", default=None, help="chapter name")
    p_ak.add_argument("--username", default=None, help="export this player's errors instead")
    p_ak.add_argument("--min-criticality", type=float, default=0.05,
                      help="chapter: keep decision points with peak Criticality >= this")
    p_ak.add_argument("--out", default="anki", help="output dir (default anki/)")
    p_ak.add_argument("--db-path", default=None)
    p_ak.set_defaults(func=cmd_export_anki)

    p_rt = sub.add_parser("retention",
                          help="spaced-repetition deck health + leeches (A5)")
    p_rt.add_argument("--name", default=None, help="a single chapter (default: all)")
    p_rt.add_argument("--username", default=None, help="a player's personal deck instead")
    p_rt.add_argument("--db-path", default=None)
    p_rt.set_defaults(func=cmd_retention)

    p_sv = sub.add_parser("serve", help="launch the local web UI to explore errors")
    p_sv.add_argument("--host", default="127.0.0.1")
    p_sv.add_argument("--port", type=int, default=8000)
    p_sv.add_argument("--db-path", default=None)
    p_sv.set_defaults(func=cmd_serve)

    p_ig = sub.add_parser("import-games",
                          help="import a player's PGN and detect their personal errors (M11)")
    p_ig.add_argument("--pgn", required=True, help="path to the player's PGN")
    p_ig.add_argument("--username", required=True, help="the studied player's name")
    p_ig.add_argument("--db-path", default=None)
    p_ig.set_defaults(func=cmd_import_games)

    p_pr2 = sub.add_parser("personal-report",
                           help="report a player's personal errors, by Criticality (M15)")
    p_pr2.add_argument("--username", required=True)
    p_pr2.add_argument("--min-criticality", type=float, default=0.0)
    p_pr2.add_argument("--db-path", default=None)
    p_pr2.set_defaults(func=cmd_personal_report)

    p_fg = sub.add_parser("fetch-games",
                          help="download a Lichess user's games and import their errors")
    p_fg.add_argument("--username", required=True, help="Lichess username")
    p_fg.add_argument("--max", type=int, default=100, help="max games (default 100)")
    p_fg.add_argument("--perf-type", default=None,
                      help="comma list e.g. 'rapid,classical' (default: all)")
    p_fg.add_argument("--rated", action="store_true", default=None,
                      help="only rated games")
    p_fg.add_argument("--since", type=int, default=None, help="epoch ms lower bound")
    p_fg.add_argument("--until", type=int, default=None, help="epoch ms upper bound")
    p_fg.add_argument("--db-path", default=None)
    p_fg.set_defaults(func=cmd_fetch_games)

    p_dv = sub.add_parser("personal-deviations",
                          help="a player's 'left theory' deviations (partial, no recalc)")
    p_dv.add_argument("--username", required=True)
    p_dv.add_argument("--costly-only", action="store_true",
                      help="only deviations that lost >= the mistake threshold")
    p_dv.add_argument("--db-path", default=None)
    p_dv.set_defaults(func=cmd_personal_deviations)

    p_ec = sub.add_parser("import-eecoach",
                          help="import EEcoach recall failures from a CSV (D18)")
    p_ec.add_argument("--file", required=True, help="path to the EEcoach CSV export")
    p_ec.add_argument("--db-path", default=None)
    p_ec.set_defaults(func=cmd_import_eecoach)

    p_er = sub.add_parser("eecoach-report",
                          help="a student's EEcoach recall failures, by Criticality (D18)")
    p_er.add_argument("--student", required=True)
    p_er.add_argument("--db-path", default=None)
    p_er.set_defaults(func=cmd_eecoach_report)

    p_ecc = sub.add_parser("eecoach-cohort",
                           help="positions the whole student group fails most (A4)")
    p_ecc.add_argument("--min-students", type=int, default=1,
                       help="only positions failed by >= this many distinct students")
    p_ecc.add_argument("--top", type=int, default=None)
    p_ecc.add_argument("--db-path", default=None)
    p_ecc.set_defaults(func=cmd_eecoach_cohort)

    p_cf = sub.add_parser("confusable",
                          help="near-identical positions that need different moves (A6)")
    p_cf.add_argument("--name", required=True, help="chapter name")
    p_cf.add_argument("--max-diff", type=int, default=2,
                      help="max squares two boards may differ by (default 2)")
    p_cf.add_argument("--top", type=int, default=None)
    p_cf.add_argument("--db-path", default=None)
    p_cf.set_defaults(func=cmd_confusable)

    p_dd = sub.add_parser("danger-depth",
                          help="where each line first gets sharp (A3)")
    p_dd.add_argument("--name", required=True, help="chapter name")
    p_dd.add_argument("--min-criticality", type=float, default=0.05,
                      help="ignore first-error points below this peak Criticality")
    p_dd.add_argument("--top", type=int, default=None)
    p_dd.add_argument("--db-path", default=None)
    p_dd.set_defaults(func=cmd_danger_depth)

    p_gp = sub.add_parser("gaps",
        help="repertoire gaps: frequent opponent replies your paths don't cover (M17)")
    p_gp.add_argument("--name", required=True, help="chapter name")
    p_gp.add_argument("--bucket", type=int, default=1600,
        help="Elo bucket to read opponent frequencies at (default 1600)")
    p_gp.add_argument("--color", choices=["w", "b"], default=None,
        help="your colour in this repertoire (default: inferred from the tree)")
    p_gp.add_argument("--min-games", type=int, default=100,
        help="statistical-validity floor per reply (D13, default 100)")
    p_gp.add_argument("--min-freq", type=float, default=0.0,
        help="ignore replies below this frequency (0..1, default 0)")
    p_gp.add_argument("--top", type=int, default=None)
    p_gp.add_argument("--db-path", default=None)
    p_gp.set_defaults(func=cmd_gaps)

    p_ev = sub.add_parser("expected-value",
                          help="decision points by reach probability x Criticality (A2)")
    p_ev.add_argument("--name", required=True, help="chapter name")
    p_ev.add_argument("--bucket", type=int, default=1600,
                      help="Elo bucket to weight reach probability by (default 1600)")
    p_ev.add_argument("--min-criticality", type=float, default=0.05)
    p_ev.add_argument("--top", type=int, default=None)
    p_ev.add_argument("--db-path", default=None)
    p_ev.set_defaults(func=cmd_expected_value)

    p_lt = sub.add_parser("error-lifetime",
                          help="how high up the Elo ladder each mistake survives (M22)")
    p_lt.add_argument("--name", required=True, help="chapter name")
    p_lt.add_argument("--min-criticality", type=float, default=0.05,
                      help="keep mistakes with peak Criticality >= this (default 0.05)")
    p_lt.add_argument("--top", type=int, default=None, help="show only the top N")
    p_lt.add_argument("--db-path", default=None)
    p_lt.set_defaults(func=cmd_error_lifetime)

    p_pg = sub.add_parser("personal-progress",
                          help="a player's catalogued-error rate over time (M21)")
    p_pg.add_argument("--username", required=True)
    p_pg.add_argument("--by", choices=["month", "year"], default="month")
    p_pg.add_argument("--db-path", default=None)
    p_pg.set_defaults(func=cmd_personal_progress)

    p_pp = sub.add_parser("personal-priority",
                          help="a player's errors ranked by training priority (M24)")
    p_pp.add_argument("--username", required=True)
    p_pp.add_argument("--top", type=int, default=None, help="show only the top N")
    p_pp.add_argument("--db-path", default=None)
    p_pp.set_defaults(func=cmd_personal_priority)
    return parser


def main(argv: list[str] | None = None) -> int:
    # Avoid UnicodeEncodeError on legacy Windows consoles (cp1252).
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
