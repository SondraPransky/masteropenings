"""Central configuration (D10/D11/D12/D13).

All tunables live here so the pipeline has a single source of truth. CLI flags override
these defaults at runtime (see cli.py).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Racine du repo EECoach = UN niveau au-dessus de ce fichier (oa/config.py).
# ⚠ La source disait parents[2] (juste pour son layout src/opening_analytics/) ;
# recopie telle quelle dans le vendoring, elle remontait jusqu'a Desktop —
# `python -m oa.cli` aurait ecrit Desktop\data et Desktop\reports. Le projet
# source « Ouvertures - data » est supprime (23/07) : cette copie est la seule
# et doit etre autonome. Tout ce qui est local a oa vit sous data-oa/
# (gitignore), la MEME convention que eecoach_worker.py → CLI et worker
# partagent le meme cache au lieu d'en creer deux.
ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data-oa"
REPORTS_DIR = DATA_DIR / "reports"

# The 9 Lichess Opening Explorer rating buckets (lower bounds), D11.
# Each value is the minimum Elo of a band; the API groups games accordingly.
ELO_BUCKETS: tuple[int, ...] = (0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500)

# Approx FIDE equivalent of each Lichess bucket lower bound (rapid+classical blend, from the
# standard Lichess↔FIDE conversion). The Explorer buckets are *Lichess* ratings, ~250 above
# FIDE in this range, so the UI shows the FIDE equivalent so a FIDE-rated player reads the
# right band. Below 1600 the FIDE scale bottoms out, so no equivalent is shown.
BUCKET_FIDE_EQUIV: dict[int, int] = {1600: 1400, 1800: 1560, 2000: 1755, 2200: 2000, 2500: 2375}


def fide_equiv(bucket: int) -> int | None:
    """The approximate FIDE rating matching a Lichess Explorer bucket, or None if too low."""
    return BUCKET_FIDE_EQUIV.get(bucket)

# Cadence profile: rapid + classical merged into one "thoughtful" profile (D11).
SPEEDS: tuple[str, ...] = ("rapid", "classical")

DEFAULT_USER_AGENT = os.environ.get(
    "OA_USER_AGENT",
    "opening-analytics/0.1 (https://github.com/; mchoisy@echecs.com)",
)


@dataclass
class ExplorerConfig:
    base_url: str = "https://explorer.lichess.ovh/lichess"
    variant: str = "standard"
    speeds: tuple[str, ...] = SPEEDS
    ratings: tuple[int, ...] = ELO_BUCKETS
    moves: int = 12          # max distinct moves returned per position
    request_delay_s: float = 0.4   # throttle between calls (a token raises the limit)
    max_retries: int = 5     # retries on HTTP 429, honouring Retry-After
    timeout_s: float = 30.0


@dataclass
class EvalConfig:
    # Resolver tries these backends in order (D2: dump primary later, Stockfish fallback).
    # MVP default is cloud (live Lichess Stockfish evals, no download).
    order: tuple[str, ...] = ("cloud", "stockfish")
    cloud_base_url: str = "https://lichess.org/api/cloud-eval"
    multi_pv: int = 1
    stockfish_path: str | None = os.environ.get("OA_STOCKFISH_PATH")
    # Search budget. Default = fixed depth 20 (D2): deterministic, same depth on every
    # position, so parent/child eval-loss comparisons are fair and runs are reproducible.
    # Set a per-position time limit (ms) instead for a faster, variable-depth preview
    # (multi-threaded it still reaches ~depth 15-20 in openings).
    stockfish_depth: int = 20   # used when movetime_ms == 0 (the default)
    stockfish_movetime_ms: int = int(os.environ.get("OA_STOCKFISH_MOVETIME_MS", "0"))
    # Threads: 0 = auto. Auto uses 1 thread in fixed-depth mode (deterministic + faster
    # to a given depth) and all-but-one core in time-limit mode (more nodes = deeper).
    stockfish_threads: int = int(os.environ.get("OA_STOCKFISH_THREADS", "0"))
    stockfish_hash_mb: int = int(os.environ.get("OA_STOCKFISH_HASH_MB", "256"))
    timeout_s: float = 30.0
    request_delay_s: float = 1.1


@dataclass
class Thresholds:
    # D13: a (position × bucket) cell is only exploited if it has >= this many games.
    min_games: int = 100
    # D12 (Lichess convention, in centipawns): a move is an *error* if it loses this much
    # or more versus the best move. inaccuracy 0.5 / mistake 1.0 / blunder 3.0 pawns.
    inaccuracy_cp: int = 50
    mistake_cp: int = 100     # the "1 pawn" reference for severity/criticality (below), NOT
                              # the detection bar — that is error_threshold_cp (rating-aware).
    blunder_cp: int = 300     # sharp refutation => puzzle rather than flashcard (D14)
    # Rating-aware DETECTION bar (cp): the loss at which a move counts as an error, per Elo
    # bucket. A slip that barely dents a 1200's score is a real inaccuracy for a 2200, so the
    # bar tightens as strength rises (D18/rating-aware). Calibrated for competition-minded
    # 1600-2200 players (~40 cp mid-range). A flat --loss-pawns overrides every bucket.
    # `mistake_cp` stays the severity reference, so criticality stays comparable across bars.
    # Curve indexed by the Lichess Explorer bucket. NB the buckets are *Lichess* ratings,
    # ~250 above FIDE in this range (Lichess 2200 ≈ FIDE 2000, 2500 ≈ FIDE ~2375). The curve
    # is therefore mapped so the intended FIDE strictness lands on the matching Lichess bucket.
    error_threshold_cp: dict = field(default_factory=lambda: {
        0: 80, 1000: 80, 1200: 80, 1400: 80,   # FIDE < ~1400
        1600: 80,   # FIDE ~1400
        1800: 55,   # FIDE ~1560
        2000: 45,   # FIDE ~1755
        2200: 38,   # FIDE ~2000
        2500: 28,   # FIDE ~2375
    })
    # Winrate rescue (D6, "the cost is human winrate, not centipawns alone"). A move below the
    # cp bar is STILL flagged if it's a frequent human trap that costs real winrate — this is
    # the product's core case (e.g. Be7: only 0.31 pawn, but 79% play it and it drops winrate
    # 29% at 2200). Without it, a purely cp-based bar throws out the highest-value errors.
    winrate_rescue: bool = True
    winrate_rescue_delta: float = 0.12        # Δwinrate (stm POV) the mistake must cost, and…
    winrate_rescue_min_freq: float = 0.40     # …how often humans at this bucket must play it, and…
    winrate_rescue_min_loss_cp: int = 15      # …a small floor so it's still objectively worse.
    # Phase C (D6/D12): fold the engine cost back into Criticality as a co-factor. Severity
    # = (eval_loss / mistake_cp) ** exponent — sub-linear so blunders weigh more than
    # inaccuracies without dominating; = 1.0 exactly at the 1-pawn threshold (scale-preserving).
    # 0 disables it (winrate-only, the pre-Phase-C behaviour).
    criticality_severity_exponent: float = 0.5


@dataclass
class Config:
    user_agent: str = DEFAULT_USER_AGENT
    # Lichess personal API token (https://lichess.org/account/oauth/token). Required for
    # the Opening Explorer since Lichess made it auth-only (anti-DDoS); also raises the
    # cloud-eval rate limit. Read from the OA_LICHESS_TOKEN env var — never hard-coded.
    lichess_token: str | None = os.environ.get("OA_LICHESS_TOKEN")
    db_path: Path = DATA_DIR / "cache.sqlite"
    reports_dir: Path = REPORTS_DIR
    # Trainer refutation chaining: the CAP on how many extra player moves a punishment drills
    # (the "forcing-moves" stop, Option A, ends it earlier when the line goes quiet). The UI
    # can override per session via ?reflen=. See webapp._refutation_followups.
    refutation_max_quizzes: int = int(os.environ.get("OA_REFUTATION_MAX", "3") or "3")
    # Web productization (Piste C). Login is OFF by default so the local single-user tool
    # is unchanged; a hosted deployment sets OA_REQUIRE_LOGIN=1 and a stable OA_SECRET_KEY.
    secret_key: str | None = os.environ.get("OA_SECRET_KEY")
    require_login: bool = os.environ.get("OA_REQUIRE_LOGIN", "").lower() in ("1", "true", "yes")
    # Number of trusted reverse-proxy hops in front of the app (OA_TRUST_PROXY). When > 0 the
    # app reads the client IP from the last N entries of X-Forwarded-For (via Werkzeug's
    # ProxyFix) so the login rate-limiter keys on the real caller, not the proxy. Leave 0
    # (default) when the app faces clients directly — trusting XFF then lets any client spoof
    # its IP and dodge the limiter. See docs/HOSTING.md.
    trust_proxy: int = int(os.environ.get("OA_TRUST_PROXY", "0") or "0")
    # Send session cookies only over HTTPS (Secure flag). Defaults ON in hosted mode
    # (require_login) since a real deployment terminates TLS; override with OA_SECURE_COOKIES=0
    # for a plaintext-HTTP hosted test. HttpOnly + SameSite=Lax are always set.
    secure_cookies: bool = os.environ.get(
        "OA_SECURE_COOKIES",
        "1" if os.environ.get("OA_REQUIRE_LOGIN", "").lower() in ("1", "true", "yes") else "0",
    ).lower() in ("1", "true", "yes")
    # The implicit single-user account's username (Stage 1 isolation) lives in db.LOCAL_ACCOUNT,
    # read from OA_LOCAL_ACCOUNT — a single source so migration, CLI and web never disagree.
    explorer: ExplorerConfig = field(default_factory=ExplorerConfig)
    eval: EvalConfig = field(default_factory=EvalConfig)
    thresholds: Thresholds = field(default_factory=Thresholds)

    def ensure_dirs(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)
