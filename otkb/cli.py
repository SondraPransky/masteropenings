"""Point d'entrée en ligne de commande (SPEC §6, module UI minimal).

Tranche 1 : `init-db` construit une base vide au schéma OTKB et y grave les
réglages. Les commandes d'ingestion (passe 1) viendront dans la tranche 2.
"""

from __future__ import annotations

import argparse
import types
from pathlib import Path

from . import __version__
from .adn import compute_dna, dna_to_dict, render_html, render_text
from .config import Config
from .db import Database
from .ingest import ingest_csv
from .logging_setup import force_safe_stdio, get_logger, setup_logging

# Les imports lourds (python-chess via analysis/pgn/explorer/reconstruct, httpx via
# downloader) sont PARESSEUX, faits dans les commandes qui les utilisent : la
# phase 1 (init-db, ingest, adn) reste ainsi stdlib seule, sans python-chess.

logger = get_logger("otkb.cli")


def cmd_init_db(cfg: Config) -> None:
    with Database(cfg.db_path) as db:
        db.init_schema()
        db.set_settings(cfg.persisted_settings())
        db.set_setting("csv_path", str(cfg.csv_path))
        logger.info(
            "Base initialisée : %s (fullmove_max=%s, N=%s)",
            cfg.db_path, cfg.opening_fullmove_max, cfg.publish_threshold_n,
        )


def cmd_ingest(cfg: Config, csv_path: Path, limit: int | None) -> None:
    with Database(cfg.db_path) as db:
        db.init_schema()  # idempotent : garantit le schéma avant ingestion
        db.set_settings(cfg.persisted_settings())
        stats = ingest_csv(
            db, csv_path, fullmove_max=cfg.opening_fullmove_max, limit=limit
        )
        logger.info(
            "Base : %d puzzles, %d ouvertures, %d thèmes",
            db.count("puzzles"), db.count("openings"), db.count("themes"),
        )
        print(stats.summary())


def cmd_update(cfg: Config, csv_path: Path, source_label: str | None, no_rebuild_caches: bool) -> None:
    """Applique un CSV Lichess plus récent en incrémental (offline)."""
    from .ingest import update_from_csv
    with Database(cfg.db_path) as db:
        db.init_schema()  # idempotent
        db.set_settings(cfg.persisted_settings())
        stats = update_from_csv(
            db, csv_path, fullmove_max=cfg.opening_fullmove_max,
            source_label=source_label, rebuild_caches=not no_rebuild_caches,
        )
    print(stats.summary())


def cmd_adn(cfg: Config, opening: str, as_json: bool, html: str | None) -> None:
    with Database(cfg.db_path) as db:
        dna = compute_dna(db, opening)
    if html is not None:
        page = render_html(dna)
        if html == "-":
            print(page)
        else:
            out = Path(html)
            out.write_text(page, encoding="utf-8")
            print(f"Fiche HTML écrite : {out}")
    elif as_json:
        import json
        print(json.dumps(dna_to_dict(dna), ensure_ascii=False, indent=2))
    else:
        print(render_text(dna))


def cmd_analyze(cfg: Config, limit: int | None) -> None:
    from .analysis import analyze_all  # python-chess (extra analysis)
    with Database(cfg.db_path) as db:
        db.init_schema()
        n = analyze_all(db, limit=limit)
        print(f"{n} puzzles analysés (2-bis).")


def cmd_build_counts(cfg: Config, min_count: int) -> None:
    """(Re)construit les caches des positions fréquentes : compteurs + suites."""
    import time

    from .explorer.insights import (
        build_position_children,
        build_position_counts,
        build_position_popularity,
        mark_position_caches_fresh,
    )
    with Database(cfg.db_path) as db:
        db.init_schema()
        print("Passe 1/3 — compteurs « à travers » (quelques minutes)…")
        t = time.perf_counter()
        n = build_position_counts(db, min_count=min_count)
        print(f"  {n:,} positions fréquentes (≥ {min_count}) en {time.perf_counter() - t:.0f}s.")
        print("Passe 2/3 — suites les plus jouées (quelques minutes)…")
        t = time.perf_counter()
        m = build_position_children(db, min_count=min_count)
        print(f"  {m:,} arêtes parent→enfant en {time.perf_counter() - t:.0f}s.")
        print("Passe 3/3 — tri par popularité (quelques minutes)…")
        t = time.perf_counter()
        p = build_position_popularity(db)
        print(f"  {p:,} lignes de cache popularité en {time.perf_counter() - t:.0f}s. "
              "Explorateur, suites et tri popularité désormais instantanés.")
        mark_position_caches_fresh(db)


def cmd_exercise(cfg: Config, puzzle_id: str, out: str | None) -> None:
    from .pgn import minimal_exercise  # python-chess (extra analysis)
    with Database(cfg.db_path) as db:
        row = db.conn.execute(
            "SELECT puzzle_id, fen, moves, rating, game_url, opening_tags, themes "
            "FROM puzzles WHERE puzzle_id = ?", (puzzle_id,),
        ).fetchone()
    if row is None:
        raise SystemExit(f"Puzzle introuvable : {puzzle_id}")
    puzzle = types.SimpleNamespace(**dict(row))
    pgn = minimal_exercise(puzzle)
    if out:
        from pathlib import Path
        Path(out).write_text(pgn + "\n", encoding="utf-8")
        print(f"Exercice écrit → {out}")
    else:
        print(pgn)


def cmd_export(cfg: Config, opening: str, out: str, limit: int | None) -> None:
    from .exporters import export_opening  # python-chess (extra analysis)
    with Database(cfg.db_path) as db:
        n = export_opening(db, opening, out, limit=limit)
    print(f"{n} exercices exportés → {out}")


def cmd_export_web(
    cfg: Config, out: str, no_vacuum: bool, no_build_caches: bool, min_popularity: int,
    no_cover: bool,
) -> None:
    """Dérive l'artefact SQLite réduit pour le web (sql.js). Réseau : aucun."""
    from .exporters import export_web, render_cover  # stdlib sqlite3 (import paresseux)
    from .exporters.web_dna import write_family_dna
    if not cfg.db_path.exists():
        raise SystemExit(f"Base introuvable : {cfg.db_path} (lancer d'abord ingest).")
    with Database(cfg.db_path) as db:
        stats = export_web(
            db, out, build_caches=not no_build_caches, vacuum=not no_vacuum,
            min_popularity=min_popularity,
        )
        print(stats.summary())
        # ADN par famille (corpus complet) pour l'accueil/les fiches du site web
        dna_path = stats.path.parent / "family-dna.json"
        n_fam = write_family_dna(db, dna_path)
        print(f"ADN par famille → {dna_path} ({n_fam} familles)")
        if not no_cover:
            # page de garde autonome (index.html) à côté de l'artefact
            cover_path = stats.path.parent / "index.html"
            cover_path.write_text(
                render_cover(db, sqlite_name=stats.path.name), encoding="utf-8"
            )
            print(f"Page de garde → {cover_path}")


def cmd_download_prepare(cfg: Config, opening: str | None) -> None:
    from .downloader import enqueue_opening, enqueue_pending
    with Database(cfg.db_path) as db:
        db.init_schema()
        added = enqueue_opening(db, opening) if opening else enqueue_pending(db)
        scope = f"ouverture {opening}" if opening else "toutes les parties"
        print(f"File download prête ({scope}) : {db.count('downloads')} en file "
              f"({added} nouvelles). Lancer ensuite : otkb download-run.")


def cmd_import_dataset(cfg: Config) -> None:
    """Ingère le dataset pré-joint HF (parties → positions). Nécessite polars+chess."""
    from .explorer.insights import rebuild_position_caches_if_stale
    from .importers import ingest_from_dataset
    with Database(cfg.db_path) as db:
        db.init_schema()
        stats = ingest_from_dataset(db)
        # `positions` vient de grossir : sans ça, compteurs/suites/tri popularité
        # de l'explorateur resteraient silencieusement périmés (décision 17/07).
        if rebuild_position_caches_if_stale(db):
            print("Caches de positions reconstruits (compteurs, suites, popularité).")
    print(stats.summary())


def cmd_download_run(cfg: Config, max_batches: int | None) -> None:
    """RUN réel du download (réseau). Nécessite httpx (extra pass2)."""
    from .downloader import run_download
    from .downloader.client import LichessClient
    if not cfg.has_token():
        logger.warning("Aucun token (LICHESS_TOKEN/config.local.toml) — run anonyme.")
    with Database(cfg.db_path) as db, LichessClient(cfg.lichess_token) as client:
        stats = run_download(db, client.export_ids, max_batches=max_batches)
        # `positions` a pu grossir : reconstruire les caches sinon l'explorateur
        # afficherait des compteurs silencieusement périmés (décision 17/07).
        from .explorer.insights import rebuild_position_caches_if_stale
        if rebuild_position_caches_if_stale(db):
            print("Caches de positions reconstruits (compteurs, suites, popularité).")
    print(stats.summary())


def cmd_ui(cfg: Config, host: str, port: int, no_show: bool) -> None:
    """Démarre l'explorateur interactif NiceGUI (extra ui). Réseau : aucun."""
    from .ui import run_ui
    if not cfg.db_path.exists():
        raise SystemExit(f"Base introuvable : {cfg.db_path} (lancer d'abord ingest).")
    logger.info("Explorateur OTKB sur http://%s:%d — Ctrl+C pour arrêter.", host, port)
    run_ui(cfg.db_path, host=host, port=port, show=not no_show)


def cmd_serve_api(cfg: Config, host: str, port: int) -> None:
    """Démarre le pont HTTP local consommé par EECoach (vue coach). Réseau : aucun
    au-delà de localhost. Sert la logique through-position sur le corpus intégral."""
    from .bridge import serve
    if not cfg.db_path.exists():
        raise SystemExit(f"Base introuvable : {cfg.db_path} (lancer d'abord ingest).")
    with Database(cfg.db_path) as db:
        serve(db, host=host, port=port)


def cmd_explore(
    cfg: Config, moves: str | None, fen: str | None,
    out: str | None, limit: int | None,
    sort: str, min_rating: int | None, max_rating: int | None,
    full: bool,
) -> None:
    from .explorer import count_position, resolve_fen  # python-chess pour --moves
    from .explorer.insights import position_caches_stale
    nfen = resolve_fen(moves=moves, fen=fen)
    with Database(cfg.db_path) as db:
        if position_caches_stale(db):
            print("⚠️  Caches de positions PÉRIMÉS (la base a grossi depuis le "
                  "dernier build) : lancer `python -m otkb build-counts`.")
        counts = count_position(db, nfen)
        print(f"Position : {nfen}")
        print(f"  Puzzles démarrant ici          : {counts.start_count}")
        if counts.positions_indexed:
            print(f"  Puzzles dont la partie passe ici : {counts.through_count}")
        else:
            print("  Puzzles passant par ici          : index `positions` vide "
                  "(lancer download-run pour l'activer)")
        for pid, rating, themes in counts.examples:
            print(f"    {pid}  {rating}  [{themes}]")

        if out is not None:
            from .exporters import export_through_position
            n = export_through_position(
                db, nfen, out, limit=limit, sort=sort,
                rating_min=min_rating, rating_max=max_rating, annotated=full,
            )
            band = ""
            if min_rating is not None or max_rating is not None:
                band = f" [rating {min_rating or '—'}–{max_rating or '—'}]"
            fmt = "partie complète" if full else "minimal"
            print(f"  Dossier PGN : {n} exercices écrits ({fmt}, {sort}{band}) : {out}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="otkb", description=__doc__)
    parser.add_argument("--version", action="version", version=f"otkb {__version__}")
    parser.add_argument("--db", help="chemin de la base (override config)")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init-db", help="créer/mettre à jour la base au schéma OTKB")

    p_ing = sub.add_parser("ingest", help="ingérer le CSV Lichess (passe 1)")
    p_ing.add_argument("--csv", help="chemin du CSV (override config)")
    p_ing.add_argument(
        "--limit", type=int, default=None,
        help="ne lire que les N premières lignes (preuve rapide)",
    )

    p_upd = sub.add_parser("update", help="appliquer un CSV Lichess plus récent en incrémental (offline)")
    p_upd.add_argument("--csv", help="chemin du nouveau CSV (override config)")
    p_upd.add_argument("--source-label", help="étiquette de la source (ex. date/version de la base)")
    p_upd.add_argument("--no-rebuild-caches", action="store_true",
                       help="ne pas reconstruire les caches d'ADN après l'ajout")

    p_adn = sub.add_parser("adn", help="fiche ADN tactique d'une ouverture")
    p_adn.add_argument("opening", help="famille ou tag (ex. Sicilian_Defense)")
    p_adn.add_argument("--json", action="store_true", help="sortie JSON (format pivot)")
    p_adn.add_argument("--html", nargs="?", const="-", default=None, metavar="FICHIER",
                       help="fiche HTML autonome (fichier, ou stdout si aucun chemin)")

    p_an = sub.add_parser("analyze", help="passe 2-bis : cases critiques + sacrifices (offline)")
    p_an.add_argument("--limit", type=int, default=None)

    p_bc = sub.add_parser(
        "build-counts",
        help="cache des compteurs « puzzles à travers » — rend l'explorateur instantané (offline)",
    )
    p_bc.add_argument("--min-count", type=int, default=50,
                      help="ne cacher que les positions vues au moins N fois (défaut 50)")

    p_ex = sub.add_parser("exercise", help="exercice PGN minimal d'un puzzle (offline)")
    p_ex.add_argument("puzzle_id")
    p_ex.add_argument("--out", help="fichier de sortie (défaut : stdout)")

    p_exp = sub.add_parser("export", help="exporter les exercices d'une ouverture en PGN")
    p_exp.add_argument("opening")
    p_exp.add_argument("--out", required=True)
    p_exp.add_argument("--limit", type=int, default=None)

    p_ew = sub.add_parser("export-web", help="dériver l'artefact SQLite réduit pour le web (sql.js, offline)")
    p_ew.add_argument("--out", default=None,
                      help="chemin de l'artefact (défaut : <dossier de la base>/otkb-web.sqlite)")
    p_ew.add_argument("--no-vacuum", action="store_true", help="ne pas compacter (VACUUM) la cible")
    p_ew.add_argument("--no-build-caches", action="store_true",
                      help="ne pas (re)construire les caches d'ADN avant export")
    p_ew.add_argument("--min-popularity", type=int, default=0,
                      help="n'inclure que les puzzles de popularité ≥ N (allège l'artefact ; "
                           "les meilleurs puzzles restent inclus). 0 = tout le corpus")
    p_ew.add_argument("--no-cover", action="store_true",
                      help="ne pas générer la page de garde index.html à côté de l'artefact")

    p_dp = sub.add_parser("download-prepare", help="construire la file de download (offline, sans fetch)")
    p_dp.add_argument("--opening", help="n'enfiler que cette ouverture (download priorisé)")

    sub.add_parser("import-dataset", help="ingérer le dataset pré-joint HF (parties → positions)")

    p_dr = sub.add_parser("download-run", help="RUN réel du download + reconstruction (réseau, v0.4)")
    p_dr.add_argument("--max-batches", type=int, default=None,
                      help="limiter à N lots de 300 (test de débit)")

    p_exp2 = sub.add_parser("explore", help="compter les puzzles à/à travers une position")
    p_exp2.add_argument("--moves", help="séquence UCI (ex. 'e2e4 e7e5 g1f3')")
    p_exp2.add_argument("--fen", help="FEN de la position")
    p_exp2.add_argument("--out", metavar="FICHIER",
                        help="écrire un dossier PGN des puzzles passant par la position")
    p_exp2.add_argument("--limit", type=int, default=None,
                        help="borner le nombre de puzzles exportés (défaut : tous)")
    p_exp2.add_argument("--sort", choices=("popularity", "rating_asc", "rating_desc"),
                        default="popularity", help="tri des puzzles exportés (défaut : popularité)")
    p_exp2.add_argument("--min-rating", type=int, default=None,
                        help="ne garder que les puzzles de rating ≥ N")
    p_exp2.add_argument("--max-rating", type=int, default=None,
                        help="ne garder que les puzzles de rating ≤ N")
    p_exp2.add_argument("--full", action="store_true",
                        help="exercices = partie complète depuis le coup 1 avec [%%start] "
                             "(sinon : à partir de la position du puzzle)")

    p_ui = sub.add_parser("ui", help="explorateur interactif (NiceGUI, extra ui)")
    p_ui.add_argument("--host", default="127.0.0.1")
    p_ui.add_argument("--port", type=int, default=8080)
    p_ui.add_argument("--no-show", action="store_true",
                      help="ne pas ouvrir le navigateur automatiquement")

    p_api = sub.add_parser("serve-api",
                           help="pont HTTP local consommé par EECoach (vue coach)")
    p_api.add_argument("--host", default="127.0.0.1")
    p_api.add_argument("--port", type=int, default=8127)
    return parser


def main(argv: list[str] | None = None) -> int:
    force_safe_stdio()   # sortie redirigée cp1252 : « ≥ »/« → » ne tuent plus la commande
    parser = build_parser()
    args = parser.parse_args(argv)

    cfg = Config.load()
    if args.db:
        cfg.db_path = Path(args.db)
    setup_logging(cfg.log_level)

    if args.command == "init-db":
        cmd_init_db(cfg)
    elif args.command == "ingest":
        csv_path = Path(args.csv) if args.csv else cfg.csv_path
        if not csv_path.exists():
            parser.error(f"CSV introuvable : {csv_path}")
        cmd_ingest(cfg, csv_path, args.limit)
    elif args.command == "update":
        csv_path = Path(args.csv) if args.csv else cfg.csv_path
        if not csv_path.exists():
            parser.error(f"CSV introuvable : {csv_path}")
        cmd_update(cfg, csv_path, args.source_label, args.no_rebuild_caches)
    elif args.command == "adn":
        cmd_adn(cfg, args.opening, args.json, args.html)
    elif args.command == "analyze":
        cmd_analyze(cfg, args.limit)
    elif args.command == "build-counts":
        cmd_build_counts(cfg, args.min_count)
    elif args.command == "exercise":
        cmd_exercise(cfg, args.puzzle_id, args.out)
    elif args.command == "export":
        cmd_export(cfg, args.opening, args.out, args.limit)
    elif args.command == "export-web":
        out = args.out or str(cfg.db_path.parent / "otkb-web.sqlite")
        cmd_export_web(cfg, out, args.no_vacuum, args.no_build_caches, args.min_popularity,
                       args.no_cover)
    elif args.command == "download-prepare":
        cmd_download_prepare(cfg, args.opening)
    elif args.command == "import-dataset":
        cmd_import_dataset(cfg)
    elif args.command == "download-run":
        cmd_download_run(cfg, args.max_batches)
    elif args.command == "explore":
        cmd_explore(cfg, args.moves, args.fen, args.out, args.limit,
                    args.sort, args.min_rating, args.max_rating, args.full)
    elif args.command == "ui":
        cmd_ui(cfg, args.host, args.port, args.no_show)
    elif args.command == "serve-api":
        cmd_serve_api(cfg, args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
