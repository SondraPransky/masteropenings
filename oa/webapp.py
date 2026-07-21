"""Local web UI to explore the detected errors (phase 2, step 1 — read-only).

A small Flask app that reads the same SQLite base and renders, for each chapter, the
decision points ranked by Criticality, and per position an SVG board (best move in green,
top human mistake in red) with the per-Elo statistics. No external assets — python-chess
draws the board server-side — so it runs fully offline on localhost.

The interactive trainer (puzzles / flashcards + spaced repetition) is step 2 and will be
built on top of this same app.
"""

from __future__ import annotations

import hmac
import random
import secrets
import sqlite3
import threading
import time
import traceback
import uuid
from dataclasses import replace
from pathlib import Path

import chess
from flask import (Flask, abort, g, jsonify, redirect, render_template_string,
                   request, session)

from . import auth, db, export_pgn, personal, pipeline, sr
from .config import Config, fide_equiv
from .fen import _ensure_full_fen, fen4, side_to_move

# Belt-and-suspenders: browsers refuse to execute an ES module (`<script type=module>`)
# unless it is served with a JavaScript MIME type. Flask derives that from Python's
# `mimetypes`, which on Windows reads the registry — sometimes misconfigured to text/plain,
# which silently breaks the trainer's Chessground import. Pin the correct types here.
import mimetypes
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")

# Figurine algebraic notation: swap the SAN piece letters for chess glyphs at *display*
# time only (data, PGN export and matching stay ASCII SAN). We use the outline (U+2654–2658)
# set because those render as monochrome text glyphs that inherit the CSS `color` — so the
# figures keep the green "best" / red "mistake" colouring and stay legible in light and dark.
# Only K/Q/R/B/N are uppercase in SAN (files are lowercase, ranks are digits); castling's "O"
# is deliberately left untouched, and promotions (e.g. e8=Q → e8=♕) convert for free.
_FIGURINES = str.maketrans({"K": "♔", "Q": "♕", "R": "♖", "B": "♗", "N": "♘"})


def figurine(san: str | None) -> str | None:
    """Render a SAN move or move-sequence with figurines instead of piece letters."""
    return san.translate(_FIGURINES) if san else san


# French display label for a card/error type. The raw value ("puzzle" / "flashcard") is also
# used as a CSS class, so templates keep the value for `class=` and use this only for the text.
_TYPE_FR = {"puzzle": "tactique", "flashcard": "carte"}


def type_fr(t: str | None) -> str:
    return _TYPE_FR.get(t, t or "")


def fmt_loss(cp: int | float | None) -> str:
    """An eval loss in pawns, French style and unsigned: 123 → « 1,23 ». The word next to it
    already says « perd »/« perte » — a « + » sign there read as a gain to students."""
    return f"{(cp or 0) / 100:.2f}".replace(".", ",")


CSS = """
:root {
  /* Identité « instrument de diagnostic » (validée sur la landing, design/landing-concept.html) :
     sombre par défaut, display mono, accents sémantiques ambre (l'humain) / teal (le moteur). */
  color-scheme: dark light;
  --bg:#0A0E16; --panel:#121826; --raise:#182032; --ink:#E9EDF4; --muted:#8794A8;
  --line:#232E40; --line-soft:#1a2233;
  --accent:#45D4BE; --accent-ink:#63d6c4; --accent-soft:rgba(69,212,190,.14);
  --danger:#e07b68; --info:#8fb0e6; --gold:#F2A33C;
  --radius:12px; --radius-sm:8px;
  --img-outline:rgba(255,255,255,.1);
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 30px rgba(0,0,0,.35);
  --display:ui-monospace,"SF Mono","Cascadia Code","Cascadia Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,"Cascadia Mono",Consolas,monospace;
}
@media (prefers-color-scheme: light) {
  :root { --bg:#EEF1F6; --panel:#ffffff; --raise:#f4f6fa; --ink:#101725; --muted:#586377;
          --line:#d7dde8; --line-soft:#e4e9f1;
          --accent:#0f9e8c; --accent-ink:#0c7568; --accent-soft:rgba(15,158,140,.12);
          --danger:#992a1d; --info:#2d5aa8; --gold:#96590A;
          --img-outline:rgba(0,0,0,.1);
          --shadow:0 1px 2px rgba(30,40,60,.08), 0 10px 30px rgba(30,40,60,.10); }
}
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { font:16px/1.65 var(--sans); margin:0; color:var(--ink);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; text-wrap:pretty;
  /* fond : la grille d'échiquier fantôme de la landing, fondue vers le bas par un radial */
  background:
    radial-gradient(120% 90% at 70% 0%, transparent 0%, var(--bg) 72%),
    linear-gradient(color-mix(in srgb, var(--line-soft) 55%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--line-soft) 55%, transparent) 1px, transparent 1px),
    var(--bg);
  background-size:auto, 64px 64px, 64px 64px, auto;
  background-attachment:fixed; }
a { color:var(--accent-ink); text-decoration:none; }
a:hover { text-decoration:underline; text-underline-offset:2px; }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:3px; }
::selection { background:var(--accent-soft); }

.topbar { position:sticky; top:0; z-index:20; border-bottom:1px solid var(--line);
  background:color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter:saturate(1.4) blur(10px); }
.topbar .inner { max-width:1080px; margin:0 auto; padding:15px 24px; display:flex;
  align-items:baseline; justify-content:space-between; gap:16px; }
.topbar .inner .muted a { color:var(--accent-ink); }
.brand { font-family:var(--display); font-weight:600; font-size:19px; color:var(--ink) !important;
  letter-spacing:.01em; }
.brand:hover { text-decoration:none; color:var(--accent-ink) !important; }
.brand .mark { color:var(--gold); margin-right:6px; }

.wrap { max-width:1080px; margin:0 auto; padding:34px 24px 96px; }
h1 { font-family:var(--display); font-size:31px; line-height:1.12; margin:0 0 6px;
  font-weight:700; letter-spacing:-.025em; text-wrap:balance; }
h2 { font-family:var(--display); font-size:20px; margin:34px 0 12px; font-weight:700;
  letter-spacing:-.02em; text-wrap:balance; }
.sub { color:var(--muted); font-size:15px; margin:0 0 6px; max-width:64ch; }
h1.line { font-family:var(--mono); font-size:20px; font-weight:600; letter-spacing:-.01em;
  line-height:1.4; word-break:break-word; }
h2 .muted, h1 .muted { font-family:var(--sans); font-weight:400; }
.eyebrow { font-family:var(--sans); font-size:12px; font-weight:650; letter-spacing:.09em;
  text-transform:uppercase; color:var(--gold); margin:30px 0 8px; }
.muted { color:var(--muted); font-size:14px; }
.rule { height:1px; background:var(--line); border:0; margin:22px 0; }

.tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(128px,1fr)); gap:14px;
  margin:22px 0 8px; }
.tile { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
  padding:16px 18px; box-shadow:var(--shadow); }
.tile .n { font-family:var(--display); font-size:32px; font-weight:600; line-height:1;
  letter-spacing:-.01em; font-variant-numeric:tabular-nums; }
.tile .k { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.07em;
  margin-top:7px; font-weight:600; }

.row { display:block; position:relative; padding:14px 17px; margin:10px 0; background:var(--panel);
  border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow);
  transition:border-color .14s ease, transform .14s ease, box-shadow .14s ease; }
a.row { }
a.row::before { content:""; position:absolute; left:0; top:12px; bottom:12px; width:3px;
  border-radius:3px; background:var(--accent); opacity:0; transition:opacity .14s ease; }
a.row:hover { border-color:color-mix(in srgb,var(--accent) 40%, var(--line));
  transform:translateY(-1px); text-decoration:none;
  box-shadow:0 2px 4px rgba(0,0,0,.16), 0 10px 26px rgba(0,0,0,.20); }
a.row:hover::before { opacity:1; }
.row strong { font-weight:650; }
.line { font-family:var(--mono); font-size:13px; letter-spacing:-.01em; }

.pill { display:inline-block; padding:2px 9px; border-radius:20px; font-size:10.5px; font-weight:700;
  text-transform:uppercase; letter-spacing:.05em; vertical-align:1px; }
.puzzle { background:color-mix(in srgb,var(--danger) 14%, transparent); color:var(--danger); }
.flashcard { background:color-mix(in srgb,var(--info) 15%, transparent); color:var(--info); }
.crit { font-weight:700; font-variant-numeric:tabular-nums; }
.best { color:var(--accent-ink); font-weight:700; } .bad { color:var(--danger); font-weight:700; }

table { border-collapse:collapse; margin:10px 0 2px; font-size:14px; width:auto;
  font-variant-numeric:tabular-nums; }
th, td { border:0; border-bottom:1px solid var(--line-soft); padding:7px 16px 7px 0; text-align:right; }
th { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);
  font-weight:650; border-bottom:1px solid var(--line); }
td:first-child, th:first-child { text-align:left; padding-left:0; }
tr:last-child td { border-bottom:0; }

.grid { display:grid; grid-template-columns:404px 1fr; gap:30px; align-items:start; }
/* Trainer : la question précède l'échiquier dans le DOM (lecture d'écran, mobile) ;
   sur desktop l'échiquier reprend la colonne de gauche. */
.train-grid .boardcol { grid-column:1; grid-row:1; }
.train-grid .quizcol { grid-column:2; grid-row:1; }
/* Prise de contrôle plein-panneau (choix du niveau / fin de session) : les cartes viennent
   en tête de la colonne (elles s'alignent sur le haut de l'échiquier), et l'échafaudage vide
   du quiz ne réserve aucun espace résiduel sous elles. On garde .cardops : « Annuler la
   dernière note » reste offert juste après une session. */
.train-grid .quizcol:has(> #levelcard[style*="block"]) :is(#quiz, #sess, #feedback),
.train-grid .quizcol:has(> #endcard[style*="block"]) :is(#quiz, #sess, #feedback) { display:none; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
  padding:18px; box-shadow:var(--shadow); }
.boardwrap { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
  padding:14px; box-shadow:var(--shadow); }
.boardwrap svg { display:block; width:100%; height:auto; border-radius:var(--radius-sm);
  outline:1px solid var(--img-outline); outline-offset:-1px; }

.back { font-size:13px; display:inline-block; margin-bottom:10px; }
.back a { color:var(--muted); } .back a:hover { color:var(--accent-ink); }
.empty { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
  padding:28px; color:var(--muted); box-shadow:var(--shadow); }
.empty strong { color:var(--ink); font-family:var(--display); font-size:19px; }
.empty code { display:inline-block; background:var(--bg); border:1px solid var(--line);
  padding:8px 12px; border-radius:var(--radius-sm); color:var(--ink); font-size:13px;
  font-family:var(--mono); margin-top:10px; }

table.prog, table.life, table.heat { border-collapse:collapse; margin:12px 0; font-size:12.5px;
  font-variant-numeric:tabular-nums; }
table.prog th, table.prog td { border:0; border-bottom:1px solid var(--line-soft);
  padding:6px 14px 6px 0; text-align:right; }
table.prog th { border-bottom:1px solid var(--line); }
table.prog th:first-child, table.prog td:first-child { text-align:left; }
table.life th, table.life td, table.heat th, table.heat td { border:1px solid var(--line-soft);
  padding:4px 7px; text-align:center; white-space:nowrap; }
table.life th, table.heat th { color:var(--muted); font-size:10.5px; text-transform:uppercase;
  letter-spacing:.04em; }
table.life th small, table.heat th small { display:block; text-transform:none; font-size:10px;
  font-weight:400; color:var(--gold); letter-spacing:0; margin-top:1px; }
table.life td.line, table.heat td:first-child { text-align:left; font-family:var(--mono); }
td.cell { width:32px; height:22px; padding:0; }
td.cell.on { background:var(--danger); } td.cell.off { background:transparent; }

.train-btn { display:inline-flex; align-items:center; gap:7px; padding:11px 20px;
  background:var(--accent); color:#04140f !important; border-radius:var(--radius-sm); font-weight:650;
  font-family:var(--mono); font-size:14px;
  box-shadow:var(--shadow); transition:transform .12s ease, filter .12s ease; }
.train-btn:hover { text-decoration:none; filter:brightness(1.05); transform:translateY(-1px); }
.train-btn:active { transform:scale(.96); }
.actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px 18px; margin:14px 0 4px; }
.actions a:not(.train-btn) { font-size:14px; color:var(--muted); }
.actions a:not(.train-btn):hover { color:var(--accent-ink); }
/* Hub de chapitre à deux étages : l'action d'abord, les diagnostics groupés par question. */
.hub { display:flex; flex-direction:column; gap:14px; margin:16px 0 6px; }
.hub-act { display:flex; flex-wrap:wrap; align-items:center; gap:12px 18px;
  padding:15px 17px; border:1px solid var(--accent); border-radius:var(--radius);
  background:color-mix(in srgb, var(--accent) 6%, var(--panel)); box-shadow:var(--shadow); }
.hub-act .contre { font-size:14.5px; color:var(--accent-ink); font-weight:600; }
.hub-act .contre .k { color:var(--muted); font-weight:400; }
.diag { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; }
@media (max-width:680px) { .diag { grid-template-columns:1fr; } }
.diag .g { border:1px solid var(--line); border-radius:var(--radius); background:var(--panel);
  padding:13px 15px; box-shadow:var(--shadow); }
.diag .g .q { display:block; font:650 11px/1.35 var(--display); letter-spacing:.05em;
  text-transform:uppercase; color:var(--muted); margin:0 0 9px; }
.diag .g a { display:block; font-size:14px; color:var(--ink); padding:4px 0; }
.diag .g a:hover { color:var(--accent-ink); text-decoration:none; }
.sens { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px; margin:18px 0 8px;
  font-size:13px; color:var(--muted); }
.listhead { font:650 11px/1.3 var(--display); letter-spacing:.06em; text-transform:uppercase;
  color:var(--muted); margin:16px 0 8px; }
/* Accueil : le geste du jour d'abord (P1). */
.home-cta { display:flex; flex-wrap:wrap; align-items:center; gap:14px 16px; padding:16px 18px;
  margin:20px 0 10px; border:1px solid var(--accent); border-radius:var(--radius);
  box-shadow:var(--shadow); background:color-mix(in srgb, var(--accent) 6%, var(--panel)); }
.home-cta.calm { border-color:var(--line); background:var(--panel); }
.home-cta .txt { font-size:15px; flex:1 1 200px; min-width:0; }
.home-cta .txt b { font-family:var(--display); }
.home-cta .txt span { display:block; color:var(--muted); font-size:13px; margin-top:2px; }
.home-cta .train-btn { white-space:nowrap; }
.rowflex { display:flex; align-items:center; gap:12px; }
.rowflex > .rowmain { flex:1; min-width:0; }
.due-badge { flex-shrink:0; font:650 12px/1 var(--display); color:var(--gold);
  background:color-mix(in srgb, var(--gold) 14%, transparent); border-radius:20px;
  padding:5px 11px; white-space:nowrap; font-variant-numeric:tabular-nums; }
.enginel { color:var(--muted); font-size:12.5px; font-family:var(--mono);
  margin-top:26px; padding-top:13px; border-top:1px solid var(--line); }
.sectlabel { font:650 11px/1.3 var(--display); letter-spacing:.06em; text-transform:uppercase;
  color:var(--muted); margin:26px 0 10px; }
/* Progression (P4) : barre de rappel dans la table d'historique. */
.bartrack { display:inline-block; width:110px; height:8px; border-radius:4px; background:var(--raise);
  border:1px solid var(--line); vertical-align:middle; overflow:hidden; }
.bartrack > i { display:block; height:100%; background:var(--accent); }
.home-cta .progress-link { margin-left:auto; font-size:13px; color:var(--accent-ink);
  white-space:nowrap; align-self:center; }
/* Boucle coach → élève : trombinoscope, exercices assignés, formulaire d'assignation. */
.miniform { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; margin:4px 0; }
.miniform label { display:block; font:650 11px/1.3 var(--display); letter-spacing:.05em;
  text-transform:uppercase; color:var(--muted); margin-bottom:5px; }
.miniform input[type=text], .miniform input[type=date], .miniform select {
  padding:9px 11px; border:1px solid var(--line); border-radius:var(--radius-sm);
  background:var(--raise); color:var(--ink); font:inherit; font-size:14px; }
.miniform .grow { flex:1 1 190px; } .miniform .grow input { width:100%; }
.exrow { display:flex; align-items:center; gap:12px; }
.exrow .meta { flex:1; min-width:0; }
.exrow .meta .muted { font-size:13px; }
.exrow .go { background:var(--accent); color:#04140f; font-family:var(--mono);
  font-weight:700; font-size:13px; padding:8px 14px; border-radius:var(--radius-sm);
  white-space:nowrap; transition:transform .12s ease, filter .12s ease; }
.exrow .go:hover { text-decoration:none; filter:brightness(1.05); }
.exrow .go:active { transform:scale(.96); }
.exrow form { margin:0; }
.late { color:var(--gold); font-weight:700; }
.blk { color:var(--danger); font-weight:700; }
.done { color:var(--accent-ink); font-weight:700; }
.picklist { max-height:280px; overflow-y:auto; border:1px solid var(--line);
  border-radius:var(--radius-sm); padding:6px 10px; margin:4px 0; }
.picklist label, .pickstudents label { display:flex; align-items:baseline; gap:8px;
  padding:5px 2px; font-size:14px; cursor:pointer; }
.picklist .line { flex:1; min-width:0; }
.pickstudents { display:flex; flex-wrap:wrap; gap:6px 18px; margin:4px 0; }
.picklist .crit { color:var(--accent-ink); font-size:12px; font-variant-numeric:tabular-nums; }

#board { width:404px; height:404px; max-width:90vw; border-radius:var(--radius-sm); overflow:hidden;
  outline:1px solid var(--img-outline); outline-offset:-1px; }
/* The vendored chessground.base.css is missing `touch-action`; without it a touchscreen
   drag is swallowed by the browser as a scroll gesture, so pieces can't be moved on touch
   devices. Chessground requires this to own the pointer gesture. Scoped to the *playable*
   trainer board only — a view-only explorer board doesn't drag, so blocking scroll over it
   would just trap the page on touch devices. */
#board.playable, #board.playable cg-board, #board.playable piece { touch-action: none; }
.board-error { width:404px; max-width:90vw; padding:22px; border:1px solid var(--danger);
  border-radius:var(--radius-sm); background:color-mix(in srgb,var(--danger) 8%, transparent);
  color:var(--danger); font-size:14px; line-height:1.5; word-break:break-word; }
.board-error small { color:var(--muted); }
.controls { margin-top:16px; }
button.g { font:inherit; font-size:14px; padding:10px 16px; margin:0 8px 8px 0;
  border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--raise);
  color:var(--ink); cursor:pointer; transition:border-color .1s, background .1s, transform .08s, filter .12s; }
button.g:hover { border-color:var(--accent); }
button.g:active { transform:scale(.96); }
button.g kbd { font:11px var(--mono); opacity:.7; margin-left:7px; border:1px solid var(--line);
  border-radius:4px; padding:0 4px; }
#reveal { background:var(--accent); color:#04140f; border-color:transparent; }
#reveal:hover { filter:brightness(1.06); }
#grades button.g:nth-of-type(1):hover { border-color:var(--danger); }
.feedback { margin:14px 0; font-size:15.5px; min-height:1.5em; line-height:1.5; }
.feedback strong.ok { color:var(--accent-ink); }
.feedback strong.bad { color:var(--danger); }
.feedback .autonote { color:var(--muted); font-size:13.5px; }
.feedback .subnote { display:block; color:var(--muted); font-size:13.5px; margin-top:4px; }
.prompt { font-weight:650; margin:10px 0; font-size:16px; }
.modebadge { display:inline-block; font-weight:700; font-size:12px; letter-spacing:.04em;
  padding:6px 12px; border-radius:20px; margin-bottom:4px; }
.modebadge:empty { display:none; }
.modehelp { color:var(--muted); font-size:13px; line-height:1.5; margin:2px 0 8px; max-width:52ch; }
.modehelp:empty { display:none; }
.endcard .end-missed { font-weight:650; font-size:14px; margin:4px 0 6px; color:var(--ink); }
.endcard ul { margin:0 0 14px; padding-left:18px; }
.endcard li { font-family:var(--mono); font-size:12.5px; color:var(--muted); margin:4px 0;
  letter-spacing:-.01em; }
.modebadge.puzzle { background:color-mix(in srgb,var(--danger) 14%, transparent); color:var(--danger); }
.modebadge.flashcard { background:color-mix(in srgb,var(--info) 16%, transparent); color:var(--info); }
.sess { color:var(--muted); font-size:13px; margin:2px 0 12px; font-variant-numeric:tabular-nums; }
.cardops { display:flex; flex-wrap:wrap; gap:4px 18px; margin:0 0 10px; }
.cardops button.link { font-size:13px; padding:6px 0; }   /* zone tactile ≥ 24px */
.cardops kbd { font:11px var(--mono); opacity:.7; margin-left:5px; border:1px solid var(--line);
  border-radius:4px; padding:0 4px; }
select { font:inherit; font-size:14px; padding:6px 10px; border-radius:var(--radius-sm);
  background:var(--raise); color:var(--ink); border:1px solid var(--line); cursor:pointer; }

/* Trainer : barre de filtres guidée — le niveau seul en tête, le reste replié. */
.filters { display:flex; flex-wrap:wrap; align-items:flex-end; gap:12px 22px; margin:14px 0 18px; }
.filter label, .opt label { display:block; font-size:11px; font-weight:650;
  text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-bottom:5px; }
details.opts summary { cursor:pointer; font-size:14px; color:var(--muted);
  padding:7px 2px; list-style-position:inside; }
details.opts summary:hover { color:var(--accent-ink); }
details.opts[open] summary { color:var(--ink); }
details.opts .opt-list { margin:10px 0 4px; display:grid; gap:14px; max-width:560px; }
.opt .opt-help { display:block; color:var(--muted); font-size:13px; margin-top:5px;
  line-height:1.5; }
.opt-help kbd { font:11px var(--mono); border:1px solid var(--line); border-radius:4px;
  padding:0 4px; }
.grade-hint { color:var(--muted); font-size:13px; margin-bottom:8px; }
.movein { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:12px; }
.movein label { font-size:12px; color:var(--muted); }
.movein input { flex:1; min-width:170px; padding:8px 11px; border:1px solid var(--line);
  border-radius:var(--radius-sm); background:var(--raise); color:var(--ink); font:14px var(--mono); }
/* Le placeholder ENSEIGNE la syntaxe des coups : il doit tenir le AA comme le reste
   (le gris navigateur par défaut tombait à 3,5:1). */
.movein input::placeholder { color:var(--muted); opacity:1; }
.movein button.g { margin:0; }
.endcard { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
  padding:22px 24px; box-shadow:var(--shadow); max-width:48ch; }
.endcard .end-title { font-family:var(--display); font-weight:700; font-size:19px;
  margin-bottom:8px; }
.level-btns { display:flex; flex-wrap:wrap; gap:8px; }
.level-btns button.g { margin:0; }
/* Premier lancement : 4 grandes familles de niveau, en colonne, libellé + repère FIDE. */
.level-btns.families { flex-direction:column; align-items:stretch; }
.level-btns.families button.g { text-align:left; padding:11px 15px; }
.level-btns button.g .lvl-l { display:block; font-weight:650; }
.level-btns button.g .lvl-h { display:block; font-size:12.5px; color:var(--muted); margin-top:2px; }
.endcard details.fine { margin:12px 0 2px; }
.endcard details.fine summary { cursor:pointer; font-size:13.5px; color:var(--muted);
  padding:4px 0; }
.endcard details.fine summary:hover { color:var(--accent-ink); }
.endcard details.fine .level-btns { margin-top:10px; }
button.g.mercy { font-size:13px; padding:8px 13px; margin:2px 0 10px; display:block; }
.endcard p { margin:0 0 14px; color:var(--muted); line-height:1.6; }

form.inline { display:inline; }
button.link { background:none; border:none; padding:0; font:inherit; color:var(--muted);
  cursor:pointer; text-decoration:none; } button.link:hover { color:var(--accent-ink); text-decoration:underline; }
.authbox { max-width:380px; margin:22px auto; background:var(--panel); border:1px solid var(--line);
  border-radius:var(--radius); padding:24px 26px 26px; box-shadow:var(--shadow); }
.authbox label { display:block; font-size:12px; font-weight:600; text-transform:uppercase;
  letter-spacing:.04em; color:var(--muted); margin:14px 0 5px; }
.authbox input, .authbox select { width:100%; padding:11px 13px; border:1px solid var(--line);
  border-radius:var(--radius-sm); background:var(--raise); color:var(--ink); font:inherit; }
.authbox button.g { margin-top:20px; width:100%; background:var(--accent); color:#04140f;
  border-color:transparent; padding:12px; font-weight:650; }
.err { color:var(--danger); font-size:14px; margin:10px 0; }

.pulse { display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--accent);
  margin-right:10px; vertical-align:1px; animation:pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity:.25; } 50% { opacity:1; } }

/* La grille position (échiquier 404px + colonne de stats) manque de place avant 760px :
   la table de stats (~320px min) déborde de sa colonne entre 760 et ~880px. */
@media (max-width:880px) {
  .grid { grid-template-columns:1fr; gap:20px; }
  /* Une seule colonne : l'ordre DOM reprend la main — question au-dessus de l'échiquier. */
  .train-grid .boardcol, .train-grid .quizcol { grid-column:auto; grid-row:auto; }
}
@media (max-width:760px) {
  .wrap { padding:24px 18px 72px; } h1 { font-size:28px; }
  #board { width:100%; height:auto; aspect-ratio:1; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration:.01ms !important; transition-duration:.01ms !important; }
}
"""

# Chessground stylesheets — only linked on pages that render a board (explorer position +
# trainer), not the board-less analytics/auth pages, to avoid three unused CSS requests there.
BOARD_CSS = ("<link rel='stylesheet' href='/static/vendor/chessground.base.css'>"
             "<link rel='stylesheet' href='/static/vendor/chessground.brown.css'>"
             "<link rel='stylesheet' href='/static/vendor/pieces.css'>")


# Pawn favicon (gold on the night background) as an inline data URI — no asset, no 404.
FAVICON = ("<link rel='icon' href=\"data:image/svg+xml,"
           "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>"
           "<rect width='100' height='100' rx='20' fill='%230A0E16'/>"
           "<text x='50' y='76' font-size='72' text-anchor='middle' fill='%23F2A33C'>"
           "%E2%99%9F</text></svg>\">")


def _head(board_css: str = "") -> str:
    return ("<!doctype html><html lang='fr'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<meta name='theme-color' content='#0A0E16' media='(prefers-color-scheme: dark)'>"
            "<meta name='theme-color' content='#EEF1F6' media='(prefers-color-scheme: light)'>"
            + FAVICON +
            "<title>{{ title }}</title>" + board_css +
            "<style>" + CSS + "</style></head><body>"
            "<header class='topbar'><div class='inner'>"
            "<a class='brand' href='/'><span class='mark'>&#9823;</span>Opening Analytics</a>"
            "{% if current_user %}<span class='muted'>{{ current_user }} · "
            "<form class='inline' method='post' action='/logout'>"
            "<input type='hidden' name='_csrf' value='{{ csrf_token }}'>"
            "<button class='link' type='submit'>se déconnecter</button></form></span>"
            "{% elif show_login %}<a href='/login'>Se connecter</a>{% endif %}"
            "</div></header>"
            "<div class='wrap'>")


HEAD = _head()                 # board-less pages
HEAD_BOARD = _head(BOARD_CSS)  # pages that render a Chessground board
FOOT = "</div></body></html>"

INDEX_TMPL = HEAD + """
<h1>Opening Analytics</h1>
<p class="sub">Là où les joueurs de ton niveau se trompent vraiment — et de quoi t'entraîner
  exactement là-dessus.</p>

{% if resume %}
<div class="home-cta">
  <a class="train-btn" href="/train/{{ resume.id }}">▶ Reprendre l'entraînement</a>
  <div class="txt"><b>{{ stats.due|grp }} carte{{ 's' if stats.due != 1 }} à réviser</b> aujourd'hui
    <span>on commence par « {{ resume.name }} » · objectif de session : 10 cartes</span></div>
  {% if has_history %}<a class="progress-link" href="/progress">Ma progression →</a>{% endif %}
</div>
{% elif chapters %}
<div class="home-cta calm">
  <div class="txt"><b>Tout est à jour.</b>
    <span>rien à réviser aujourd'hui — choisis un chapitre ci-dessous pour t'entraîner quand même.</span></div>
  {% if has_history %}<a class="progress-link" href="/progress">Ma progression →</a>{% endif %}
</div>
{% endif %}

{% if chapters %}
<div class="sectlabel">Tes chapitres</div>
{% for c in chapters %}
  <a class="row" href="/chapter/{{ c.id }}">
    <div class="rowflex">
      <div class="rowmain"><strong>{{ c.name }}</strong>
        <span class="muted"> — {{ c.decisions }} point{{ 's' if c.decisions != 1 }} de décision</span></div>
      {% if c.due %}<span class="due-badge">{{ c.due|grp }} à réviser</span>{% endif %}
    </div>
  </a>
{% endfor %}
<p style="margin:14px 0 4px"><a class="train-btn" href="/upload">＋ Analyser un chapitre PGN</a></p>

<div class="sectlabel">Coach</div>
<a class="row" href="/students">
  <div class="rowflex">
    <div class="rowmain"><strong>Mes élèves</strong>
      <span class="muted"> — donne des exercices et suis leur progression</span></div>
    <span class="muted">→</span>
  </div>
</a>
{% else %}
<div class="empty">
  <strong>Aucun chapitre pour l'instant.</strong><br>
  <a href="/upload">Dépose un PGN de répertoire</a> pour commencer — ou en ligne de commande :<br><br>
  <code>py oa.py analyze --chapter ton-fichier.pgn --name "Ton Ouverture"</code>
</div>
{% endif %}

{% if users %}
<div class="sectlabel">Tes joueurs — corriger leurs erreurs</div>
{% for u in users %}
  <a class="row" href="/personal/{{ u.username }}"><strong>{{ u.username }}</strong>
    <span class="muted"> — {{ u.errors }} erreur{{ 's' if u.errors != 1 }}</span></a>
{% endfor %}
{% endif %}

<div class="enginel">Cache d'analyse partagé — {{ stats.positions|grp }} positions ·
  {{ stats.errors|grp }} erreurs détectées · {{ stats.chapters|grp }} chapitre{{ 's' if stats.chapters != 1 }}.</div>
""" + FOOT

PROGRESS_TMPL = HEAD + """
<p class="back"><a href="/">← accueil</a></p>
<h1>Ma progression</h1>
<p class="sub">Ton historique de révision, jour après jour. Le signal qui compte :
  <strong>rappelles-tu davantage</strong> et <strong>hésites-tu moins</strong> avec le temps ?</p>
{% if buckets %}
<div class="sens">
  <form class="inline" method="get">Niveau :
    <select name="bucket" onchange="this.form.submit()">
      <option value="">tous niveaux</option>
      {% for b in buckets %}
      <option value="{{ b }}" {{ 'selected' if b == bucket else '' }}>{{ b }}+{% if b|fide %} (≈{{ b|fide }} FIDE){% endif %}</option>
      {% endfor %}
    </select>
  </form>
</div>
{% endif %}
{% if summ.reviews %}
<div class="tiles">
  <div class="tile"><div class="n">{{ (100 * summ.recall_rate)|round|int }}%</div><div class="k">Rappel global</div></div>
  <div class="tile"><div class="n">{{ summ.reviews|grp }}</div><div class="k">Révisions</div></div>
  <div class="tile"><div class="n">{{ summ.days_active|grp }}</div><div class="k">Jours actifs</div></div>
  <div class="tile"><div class="n">{% if summ.median_ms %}{{ '%.1f'|format(summ.median_ms / 1000) }} s{% else %}—{% endif %}</div><div class="k">Temps médian</div></div>
</div>
<div class="listhead">Jour par jour — le plus récent en bas</div>
<div style="overflow-x:auto">
<table>
<tr><th>Jour</th><th>Révisions</th><th>Rappel</th><th>Temps médian</th></tr>
{% for r in rows %}
<tr>
  <td class="mono">{{ r.day }}</td>
  <td>{{ r.reviews|grp }} <span class="muted">({{ r.recalled }} rappelé{{ 's' if r.recalled != 1 }}, {{ r.lapsed }} raté{{ 's' if r.lapsed != 1 }})</span></td>
  <td>{% if r.rate is not none %}<span class="bartrack"><i style="width:{{ (100 * r.rate)|round|int }}%"></i></span>
      {{ (100 * r.rate)|round|int }}%{% else %}—{% endif %}</td>
  <td>{% if r.ms %}{{ '%.1f'|format(r.ms / 1000) }} s{% else %}—{% endif %}</td>
</tr>
{% endfor %}
</table>
</div>
{% else %}
<div class="empty">
  <strong>Aucune révision pour l'instant.</strong><br>
  Entraîne-toi depuis un chapitre — ton historique se construira ici, révision après révision.
</div>
{% endif %}
""" + FOOT

STUDENTS_TMPL = HEAD + """
<p class="back"><a href="/">← accueil</a></p>
<h1>Mes élèves</h1>
<p class="sub">Le côté <strong>coach</strong> : donne des exercices à tes élèves et suis ce
  qu'ils en font. Un élève est un profil que tu gères ici ; ses révisions sont suivies à part.</p>

<div class="card" style="margin:16px 0">
  <form class="miniform" method="post" action="/students">
    <input type="hidden" name="_csrf" value="{{ csrf_token }}">
    <div class="grow"><label>Nom de l'élève</label><input type="text" name="name" required
      placeholder="Prénom ou pseudo"></div>
    <div><label>Niveau</label>
      <select name="elo_bucket">
        <option value="">à préciser</option>
        {% for b in buckets %}<option value="{{ b }}">{{ b }}+{% if b|fide %} (≈{{ b|fide }} FIDE){% endif %}</option>{% endfor %}
      </select>
    </div>
    <button class="train-btn" type="submit">Ajouter l'élève</button>
  </form>
</div>

{% if students %}
<div class="sectlabel">Le trombinoscope</div>
{% for s in students %}
  <a class="row" href="/students/{{ s.id }}">
    <div class="rowflex">
      <div class="rowmain"><strong>{{ s.name }}</strong>
        <span class="muted"> — {{ s.assignments }} exercice{{ 's' if s.assignments != 1 }} ·
        {% if s.bucket %}niveau {{ s.bucket }}+{% if s.bucket|fide %} (≈{{ s.bucket|fide }} FIDE){% endif %}{% else %}niveau à préciser{% endif %}</span></div>
      {% if s.reviews %}<span class="due-badge">rappel {{ (100 * s.recall)|round|int }}% · {{ s.reviews|grp }} rév.</span>
      {% else %}<span class="muted">pas encore commencé</span>{% endif %}
    </div>
  </a>
{% endfor %}
{% else %}
<div class="empty"><strong>Aucun élève pour l'instant.</strong><br>
  Ajoute un élève ci-dessus, puis assigne-lui un chapitre à travailler.</div>
{% endif %}
""" + FOOT

STUDENT_TMPL = HEAD + """
<p class="back"><a href="/students">← mes élèves</a></p>
<h1>{{ s.name }}</h1>
<p class="sub">{% if s.elo_bucket %}Niveau {{ s.elo_bucket }}+{% if s.elo_bucket|fide %} (≈{{ s.elo_bucket|fide }} FIDE){% endif %} · {% endif %}ses exercices, et comment il progresse.</p>

<div class="sectlabel">Exercices assignés</div>
{% for a in assignments %}
  <div class="row">
    <div class="exrow">
      <div class="meta"><strong>{{ a.chapter_name }}</strong>
        {% if a.subset %}<span class="muted"> — {{ a.total }} point{{ 's' if a.total != 1 }} choisi{{ 's' if a.total != 1 }}</span>{% endif %}
        {% if a.bucket %}<span class="muted"> — niveau {{ a.bucket }}+{% if a.bucket|fide %} (≈{{ a.bucket|fide }} FIDE){% endif %}</span>{% endif %}<br>
        <span class="muted">
        {% if a.done %}<span class="done">✓ terminé</span>{% elif a.covered %}{{ a.covered }}/{{ a.total }} position{{ 's' if a.total != 1 }} travaillée{{ 's' if a.covered != 1 }}{% else %}pas encore commencé ({{ a.total }} position{{ 's' if a.total != 1 }}){% endif %}
        {% if a.due %} · à rendre le {{ a.due }}{% if a.late and not a.done %} <span class="late">(en retard)</span>{% endif %}{% endif %}
        {% if a.note %} · « {{ a.note }} »{% endif %}</span>
      </div>
      <a class="go" href="/train/{{ a.chapter_id }}?assignment={{ a.id }}">▶ Faire</a>
      <form method="post" action="/students/{{ s.id }}/unassign">
        <input type="hidden" name="_csrf" value="{{ csrf_token }}">
        <input type="hidden" name="assignment_id" value="{{ a.id }}">
        <button class="link" type="submit" title="Retirer cet exercice">retirer</button>
      </form>
    </div>
  </div>
{% else %}
  <p class="muted">Aucun exercice assigné. Donne-lui un chapitre à travailler ci-dessous.</p>
{% endfor %}

<div class="card" style="margin:18px 0">
  <div class="sectlabel" style="margin-top:0">Assigner un exercice</div>
  {% if chapters %}
  <form class="miniform" method="post" action="/students/{{ s.id }}/assign">
    <input type="hidden" name="_csrf" value="{{ csrf_token }}">
    <div class="grow"><label>Chapitre</label>
      <select name="chapter_id" required style="width:100%">
        {% for ch in chapters %}<option value="{{ ch.id }}">{{ ch.name }}</option>{% endfor %}
      </select>
    </div>
    <div><label>Niveau</label>
      <select name="elo_bucket">
        <option value="">{% if s.elo_bucket %}niveau de l'élève{% else %}tous{% endif %}</option>
        {% for b in buckets %}<option value="{{ b }}" {{ 'selected' if b == s.elo_bucket else '' }}>{{ b }}+{% if b|fide %} (≈{{ b|fide }} FIDE){% endif %}</option>{% endfor %}
      </select>
    </div>
    <div><label>À rendre (option)</label><input type="date" name="due_date"></div>
    <button class="train-btn" type="submit">Assigner le chapitre entier</button>
  </form>
  <p class="muted" style="margin-top:10px"><a href="/assign?student={{ s.id }}">Assignation avancée →</a>
    — choisir des points précis, ou assigner à plusieurs élèves d'un coup.</p>
  {% else %}
  <p class="muted">Analyse d'abord un chapitre (<a href="/upload">déposer un PGN</a>) pour pouvoir l'assigner.</p>
  {% endif %}
</div>

<div class="sectlabel">Progression</div>
{% if summ.reviews %}
<div class="tiles">
  <div class="tile"><div class="n">{{ (100 * summ.recall_rate)|round|int }}%</div><div class="k">Rappel</div></div>
  <div class="tile"><div class="n">{{ summ.reviews|grp }}</div><div class="k">Révisions</div></div>
  <div class="tile"><div class="n">{{ summ.days_active|grp }}</div><div class="k">Jours actifs</div></div>
  <div class="tile"><div class="n">{% if summ.median_ms %}{{ '%.1f'|format(summ.median_ms / 1000) }} s{% else %}—{% endif %}</div><div class="k">Temps médian</div></div>
</div>
{% if blockers %}
<div class="listhead">Ce qui bloque — à retravailler avec lui</div>
{% for b in blockers %}
  <div class="row"><span class="blk">raté {{ b.lapses }}×</span> · <span class="line">{{ b.line|fig }}</span></div>
{% endfor %}
{% endif %}
{% else %}
<p class="muted">Pas encore de révision. Dès qu'il fait ses exercices (bouton « Faire »),
  sa progression s'affiche ici.</p>
{% endif %}
""" + FOOT

ASSIGN_TMPL = HEAD + """
<p class="back"><a href="/students">← mes élèves</a></p>
<h1>Assigner un exercice</h1>
{% if not chapter %}
<p class="sub">Choisis d'abord le chapitre à travailler.</p>
{% for ch in chapters %}
  <a class="row" href="/assign?chapter={{ ch.id }}{% if preselect %}&student={{ preselect }}{% endif %}">
    <strong>{{ ch.name }}</strong></a>
{% else %}
<div class="empty">Aucun chapitre. <a href="/upload">Dépose un PGN</a> d'abord.</div>
{% endfor %}
{% else %}
<p class="sub">Chapitre <strong>{{ chapter.name }}</strong> — choisis les élèves, le niveau, et
  (au choix) des points précis. <a href="/assign{% if preselect %}?student={{ preselect }}{% endif %}">changer de chapitre</a></p>
<form method="post" action="/assign">
  <input type="hidden" name="_csrf" value="{{ csrf_token }}">
  <input type="hidden" name="chapter_id" value="{{ cid }}">

  <div class="sectlabel">À quels élèves</div>
  {% if students %}
  <div class="pickstudents">
    {% for st in students %}
    <label><input type="checkbox" name="students" value="{{ st.id }}" {{ 'checked' if st.id == preselect else '' }}>
      {{ st.name }}{% if st.elo_bucket %} <span class="muted">({{ st.elo_bucket }}+)</span>{% endif %}</label>
    {% endfor %}
  </div>
  {% else %}<p class="muted">Aucun élève. <a href="/students">Ajoute un élève</a> d'abord.</p>{% endif %}

  <div class="miniform" style="margin-top:12px">
    <div><label>Niveau</label>
      <select name="elo_bucket">
        <option value="">à préciser</option>
        {% for b in buckets %}<option value="{{ b }}">{{ b }}+{% if b|fide %} (≈{{ b|fide }} FIDE){% endif %}</option>{% endfor %}
      </select>
    </div>
    <div><label>À rendre (option)</label><input type="date" name="due_date"></div>
  </div>

  <div class="sectlabel" style="margin-top:16px">Points à travailler
    <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">— rien coché = tout le chapitre</span></div>
  {% if decisions %}
  <div class="picklist">
    {% for d in decisions %}
    <label><input type="checkbox" name="items" value="{{ d.position_id }}">
      <span class="crit">{{ '%.2f'|format(d.peak) }}</span>
      <span class="line">{{ d.line|fig }} <span class="bad">{{ d.worst|fig }}</span></span></label>
    {% endfor %}
  </div>
  {% else %}<p class="muted">Aucun point de décision détecté sur ce chapitre.</p>{% endif %}

  <p style="margin-top:14px"><button class="train-btn" type="submit">Assigner</button></p>
</form>
{% endif %}
""" + FOOT

UPLOAD_TMPL = HEAD + """
<p class="back"><a href="/">← accueil</a></p>
<h1>Analyser un chapitre</h1>
<p class="sub">Dépose un fichier PGN (un répertoire, une leçon, une ou plusieurs lignes).
  L'analyse tourne en arrière-plan : évaluations, statistiques humaines par niveau Elo,
  détection des erreurs coûteuses.</p>
{% if error %}<p class="err">{{ error }}</p>{% endif %}
<form class="authbox" method="post" action="/upload" enctype="multipart/form-data">
  <input type="hidden" name="_csrf" value="{{ csrf_token }}">
  <label>Nom du chapitre</label>
  <input name="name" placeholder="Ex. Gambit du Centre" autofocus required>
  <label>Fichier PGN</label>
  <input name="pgn" type="file" accept=".pgn" required>
  <label>Sensibilité de détection</label>
  <select name="sensitivity">
    <option value="standard" selected>Standard — calibrage FIDE par niveau</option>
    <option value="strict">Strict — détecte aussi les petites imprécisions</option>
    <option value="tolerant">Tolérant — seulement les fautes nettes</option>
  </select>
  <button class="g" type="submit">Analyser</button>
</form>
<p class="muted">L'analyse peut prendre plusieurs minutes selon la taille du répertoire
  (elle interroge Lichess et évalue chaque position). Tu peux laisser la page ouverte.</p>
""" + FOOT

UPLOAD_STATUS_TMPL = HEAD + """
<p class="back"><a href="/">← accueil</a></p>
<h1>Analyse en cours…</h1>
<div class="card">
  <p class="prompt"><span class="pulse" aria-hidden="true"></span><span id="msg">Démarrage…</span></p>
</div>
<p class="muted">Laisse cette page ouverte — elle t'emmènera au chapitre dès que c'est prêt.</p>
<script>
const jid = "{{ job_id }}";
async function poll() {
  try {
    const d = await (await fetch('/api/upload/' + jid)).json();
    document.getElementById('msg').textContent = d.message || '…';
    if (d.status === 'done') { window.location = '/chapter/' + d.chapter_id; return; }
    if (d.status === 'error') {
      document.getElementById('msg').textContent = 'Échec — ' + (d.message || 'analyse interrompue.');
      document.querySelector('.pulse').style.display = 'none'; return;
    }
  } catch (e) { /* transient — keep polling */ }
  setTimeout(poll, 1200);
}
poll();
</script>
""" + FOOT

LOGIN_TMPL = HEAD + """
<h1>Connexion</h1>
{% if error %}<p class="err">{{ error }}</p>{% endif %}
<form class="authbox" method="post" action="/login">
  <input type="hidden" name="_csrf" value="{{ csrf_token }}">
  <label>Identifiant</label><input name="username" autocomplete="username" autofocus required>
  <label>Mot de passe</label><input name="password" type="password"
    autocomplete="current-password" required>
  <button class="g" type="submit">Se connecter</button>
</form>
<p class="muted">Pas de compte ? <a href="/register">Créer un compte</a>.</p>
""" + FOOT

REGISTER_TMPL = HEAD + """
<h1>Créer un compte</h1>
{% if error %}<p class="err">{{ error }}</p>{% endif %}
<form class="authbox" method="post" action="/register">
  <input type="hidden" name="_csrf" value="{{ csrf_token }}">
  <label>Identifiant</label><input name="username" autocomplete="username" autofocus required>
  <label>E-mail <span class="muted">(facultatif)</span></label><input name="email" type="email"
    autocomplete="email">
  <label>Mot de passe</label><input name="password" type="password"
    autocomplete="new-password" required>
  <button class="g" type="submit">Créer le compte</button>
</form>
<p class="muted">Déjà inscrit ? <a href="/login">Se connecter</a>.</p>
""" + FOOT

CHAPTER_TMPL = HEAD + """
<p class="back"><a href="/">← chapitres</a></p>
<h1>{{ name }}</h1>
<p class="sub">Les coups que les joueurs <strong>à ton niveau</strong> ratent le plus dans cette
  ligne — et de quoi les travailler.</p>

<div class="hub">
  <div class="hub-act">
    <a class="train-btn" href="/train/{{ cid }}?min_criticality={{ minc }}">▶ Entraîner ce chapitre</a>
    <a class="contre" href="/train/{{ cid }}/punish">Contrer les pièges
      <span class="k">— répétition par piège adverse</span></a>
  </div>
  <div class="diag">
    <div class="g">
      <span class="q">Où se trompe-t-on ?</span>
      <a href="/chapter/{{ cid }}/lifetime">Durée de vie des erreurs</a>
      <a href="/chapter/{{ cid }}/heatmap">Carte de chaleur</a>
    </div>
    <div class="g">
      <span class="q">Ce qui compte / ce qui manque</span>
      <a href="/chapter/{{ cid }}/gaps">Trous du répertoire</a>
      <a href="/chapter/{{ cid }}/expected">Valeur attendue</a>
    </div>
    <div class="g">
      <span class="q">Aide à la révision</span>
      <a href="/chapter/{{ cid }}/danger">Profondeur de danger</a>
      <a href="/chapter/{{ cid }}/confusables">Positions confusables</a>
      <a href="/chapter/{{ cid }}/retention">Rétention du deck</a>
    </div>
  </div>
</div>

<div class="sens">
  <form class="inline" method="get">Sensibilité :
    <select name="min_criticality" onchange="this.form.submit()">
      <option value="0.05" {{ 'selected' if minc == 0.05 else '' }}>stricte (0,05)</option>
      <option value="0.02" {{ 'selected' if minc == 0.02 else '' }}>normale (0,02)</option>
      <option value="0.01" {{ 'selected' if minc == 0.01 else '' }}>large (0,01)</option>
      <option value="0.001" {{ 'selected' if minc == 0.001 else '' }}>tout (0,001)</option>
    </select>
  </form>
  <span>plus la sensibilité est large, plus on descend vers des coups moins critiques.</span>
</div>

<div class="listhead">{{ decisions|length }} point{{ 's' if decisions|length != 1 else '' }} de
  décision — les plus critiques d'abord</div>
{% for d in decisions %}
  <a class="row" href="/chapter/{{ cid }}/position/{{ d.position_id }}">
    <span class="crit">{{ '%.3f'|format(d.peak) }}</span> ·
    <span class="line">{{ d.line|fig }}</span><br>
    <span class="muted">meilleur <span class="best">{{ d.best|fig }}</span>,
      erreur <span class="bad">{{ d.worst|fig }}</span>
      <span class="pill {{ d.worst_type }}">{{ d.worst_type|typefr }}</span></span>
  </a>
{% else %}
  <p class="muted">Aucun point de décision à cette sensibilité — élargis le réglage ci-dessus.</p>
{% endfor %}
""" + FOOT

POSITION_TMPL = HEAD_BOARD + """
<p class="back"><a href="/chapter/{{ cid }}">← {{ chapter_name }}</a></p>
<h1 class="line">{{ line|fig }}</h1>
<p class="muted">Trait aux {{ turn }} · Criticité de pic {{ '%.3f'|format(peak) }}
  {% if eco %}· {{ eco }} {{ opening }}{% endif %}</p>
<div class="grid">
  <div>
    <div id="board"></div>
    <p class="muted">Vert = meilleur coup ({{ best|fig }}) · Rouge = erreur la plus critique</p>
  </div>
  <div>
    <div class="card"><strong>Meilleur coup :</strong> <span class="best">{{ best|fig }}</span>
      <span class="muted">(moteur)</span></div>
    {% for m in mistakes %}
    <h2><span class="bad">{{ m.san|fig }}</span>
      <span class="pill {{ m.type }}">{{ m.type|typefr }}</span>
      <span class="muted">perte moteur {{ m.loss }}</span></h2>
    <table>
      <tr><th>Elo Lichess</th><th>Parties</th><th>Fréq</th><th>Δ Gain</th><th>Criticité</th></tr>
      {% for b in m.buckets %}
      <tr><td>{{ b.bucket }}+{% if b.bucket|fide %} <span class="muted">≈{{ b.bucket|fide }} FIDE</span>{% endif %}</td>
        <td>{{ b.games }}</td><td>{{ b.freq }}</td><td>{{ b.dwr }}</td>
        <td>{{ '%.3f'|format(b.crit) }}</td></tr>
      {% endfor %}
    </table>
    {% endfor %}
  </div>
</div>
<script type="module">
try {
  const { Chessground } = await import('/static/vendor/chessground.min.js');
  const cg = Chessground(document.getElementById('board'),
    { viewOnly: true, coordinates: true, fen: "{{ fen }}", orientation: "{{ orientation }}" });
  const shapes = [];
  {% if best_uci %}shapes.push({ orig: "{{ best_uci[:2] }}", dest: "{{ best_uci[2:4] }}", brush: 'green' });{% endif %}
  {% if mistake_uci %}shapes.push({ orig: "{{ mistake_uci[:2] }}", dest: "{{ mistake_uci[2:4] }}", brush: 'red' });{% endif %}
  cg.setShapes(shapes);
} catch (err) {
  document.getElementById('board').innerHTML =
    "<div class='board-error'>L'échiquier n'a pas pu se charger. Recharge la page.<br>"
    + "<small>Si le problème persiste, préviens ton coach — détail : "
    + (err && err.message ? err.message : err) + "</small></div>";
}
</script>
""" + FOOT

LIFETIME_TMPL = HEAD + """
<p class="back"><a href="/chapter/{{ cid }}">← {{ name }}</a></p>
<h1>Durée de vie des erreurs — {{ name }}</h1>
<p class="muted">Jusqu'à quel niveau Elo chaque erreur continue de piéger les joueurs. Une case
  pleine signifie que le coup est une erreur fréquente et coûteuse à cette tranche (M22).
  Tranches en <strong>Elo Lichess</strong> ; l'équivalent FIDE est indiqué dessous.</p>
<div style="overflow-x:auto">
<table class="life">
<tr><th>Ligne</th><th>Erreur</th>{% for b in buckets %}<th>{{ b }}{% if b|fide %}<small>≈{{ b|fide }} F</small>{% endif %}</th>{% endfor %}<th>Pic</th></tr>
{% for lf in lives %}
<tr>
  <td class="line">{{ lf.line|fig }}</td>
  <td class="bad">{{ lf.mistake|fig }}</td>
  {% for b in buckets %}<td class="cell {{ 'on' if b in lf.buckets else 'off' }}"></td>{% endfor %}
  <td>{{ '%.3f'|format(lf.peak) }}</td>
</tr>
{% else %}
<tr><td colspan="99">Aucune erreur au-dessus du seuil.</td></tr>
{% endfor %}
</table>
</div>
""" + FOOT

HEATMAP_TMPL = HEAD + """
<p class="back"><a href="/chapter/{{ cid }}">← {{ name }}</a></p>
<h1>Carte de chaleur de criticité — {{ name }}</h1>
<p class="muted">Où se concentrent les erreurs coûteuses : Criticité de pic par numéro de coup
  (profondeur) et par tranche Elo. Plus foncé = plus critique (M10).
  Tranches en <strong>Elo Lichess</strong> ; l'équivalent FIDE est indiqué dessous.</p>
<div style="overflow-x:auto">
<table class="heat">
<tr><th>Coup</th>{% for b in buckets %}<th>{{ b }}{% if b|fide %}<small>≈{{ b|fide }} F</small>{% endif %}</th>{% endfor %}</tr>
{% for row in rows %}
<tr>
  <td>{{ row.label }}</td>
  {% for cell in row.cells %}
  <td class="cell" style="background:{{ cell.color }}" title="{{ cell.title }}">{{ cell.text }}</td>
  {% endfor %}
</tr>
{% else %}
<tr><td colspan="99">Aucune erreur pour l'instant.</td></tr>
{% endfor %}
</table>
</div>
""" + FOOT

EXPECTED_TMPL = HEAD + """
<p class="back"><a href="/chapter/{{ cid }}">← {{ name }}</a></p>
<h1>Valeur attendue — {{ name }}</h1>
<p class="muted">Ce que tu vas <em>vraiment</em> rencontrer : chaque erreur pondérée par la
  fréquence à laquelle la ligne est atteinte à ce niveau × sa Criticité. Un piège brillant que
  personne n'atteint passe derrière une erreur modeste croisée à chaque partie (A2). Rating-aware.</p>
<p class="muted">Niveau Elo Lichess :
  <form class="inline" method="get">
    <select name="bucket" onchange="this.form.submit()">
      {% for b in buckets %}
      <option value="{{ b }}" {{ 'selected' if b == bucket else '' }}>{{ b }}+{% if b|fide %} (≈{{ b|fide }} FIDE){% endif %}</option>
      {% endfor %}
    </select>
  </form>
</p>
<div style="overflow-x:auto">
<table>
<tr><th>Ligne</th><th>Erreur</th><th>Atteinte</th><th>Criticité</th><th>Valeur attendue</th></tr>
{% for e in rows %}
<tr>
  <td class="line">{{ e.line|fig }}</td>
  <td class="bad">{{ e.mistake|fig }}</td>
  <td>{{ '%.1f%%'|format(100 * e.reach) }}</td>
  <td>{{ '%.3f'|format(e.crit) }}</td>
  <td><span class="crit">{{ '%.4f'|format(e.ev) }}</span></td>
</tr>
{% else %}
<tr><td colspan="99">Aucun point de décision au-dessus du seuil.</td></tr>
{% endfor %}
</table>
</div>
""" + FOOT

DANGER_TMPL = HEAD + """
<p class="back"><a href="/chapter/{{ cid }}">← {{ name }}</a></p>
<h1>Profondeur de danger — {{ name }}</h1>
<p class="muted">Combien de temps chaque ligne reste calme avant sa première erreur coûteuse. Les
  lignes tranchantes (danger précoce) d'abord ; celles qui restent saines tombent en bas (A3).</p>
<div style="overflow-x:auto">
<table>
<tr><th>Ligne</th><th>Premier danger</th><th>Erreur</th><th>Criticité de pic</th></tr>
{% for d in rows %}
<tr>
  <td class="line">{{ d.line|fig }}</td>
  <td>{% if d.move == '—' %}<span class="muted">reste saine</span>{% else %}{{ d.move|fig }}{% endif %}</td>
  <td class="bad">{{ d.mistake|fig or '—' }}</td>
  <td>{{ '%.3f'|format(d.peak) if d.peak else '—' }}</td>
</tr>
{% else %}
<tr><td colspan="99">Aucune ligne au-dessus du seuil.</td></tr>
{% endfor %}
</table>
</div>
""" + FOOT

GAPS_TMPL = HEAD + """
<p class="back"><a href="/chapter/{{ cid }}">← {{ name }}</a></p>
<h1>Trous du répertoire — {{ name }}</h1>
<p class="muted">Les réponses fréquentes de l'adversaire que <em>ton</em> répertoire ne couvre
  pas : à ces positions, le coup est joué souvent à ce niveau, et aucune de tes lignes ne
  répond. Classé par fréquence — le trou le plus béant d'abord (M17). Rating-aware.</p>
<p class="muted">
  Tu joues :
  <a href="/chapter/{{ cid }}/gaps?bucket={{ bucket }}&color=w"
     class="{{ 'best' if color == 'w' else '' }}">Blancs</a> ·
  <a href="/chapter/{{ cid }}/gaps?bucket={{ bucket }}&color=b"
     class="{{ 'best' if color == 'b' else '' }}">Noirs</a>
  &nbsp;—&nbsp; Niveau Elo Lichess :
  <form class="inline" method="get" style="display:inline">
    <input type="hidden" name="color" value="{{ color }}">
    <select name="bucket" onchange="this.form.submit()">
      {% for b in buckets %}
      <option value="{{ b }}" {{ 'selected' if b == bucket else '' }}>{{ b }}+{% if b|fide %} (≈{{ b|fide }} FIDE){% endif %}</option>
      {% endfor %}
    </select>
  </form>
</p>
<div style="overflow-x:auto">
<table>
<tr><th>Fréq.</th><th>Parties</th><th>Réponse non couverte</th><th>Ligne (avant la réponse)</th></tr>
{% for g in rows %}
<tr>
  <td><span class="crit">{{ '%.0f%%'|format(100 * g.freq) }}</span></td>
  <td class="muted">{{ '{:,}'.format(g.games).replace(',', ' ') }}</td>
  <td><span class="bad">{{ g.move_no|fig }} {{ g.reply|fig }}</span></td>
  <td class="line"><a href="/chapter/{{ cid }}/position/{{ g.position_id }}">{{ g.line|fig }}</a></td>
</tr>
{% else %}
<tr><td colspan="99">Aucun trou au-dessus du seuil — soit tout est couvert, soit il manque les
  statistiques Explorer (lance le prefetch).</td></tr>
{% endfor %}
</table>
</div>
""" + FOOT

RETENTION_TMPL = HEAD + """
<p class="back"><a href="/chapter/{{ cid }}">← {{ name }}</a></p>
<h1>Rétention du deck — {{ name }}</h1>
<p class="muted">Santé du deck de répétition espacée de ce chapitre, lue directement dans son
  état SM-2 — sans suivi supplémentaire (A5).</p>
<div class="tiles">
  <div class="tile"><div class="n">{{ r.total }}</div><div class="k">Cartes</div></div>
  <div class="tile"><div class="n">{{ r.new }}</div><div class="k">Nouvelles</div></div>
  <div class="tile"><div class="n">{{ r.learning }}</div><div class="k">En cours</div></div>
  <div class="tile"><div class="n">{{ r.mature }}</div><div class="k">Mûres</div></div>
  <div class="tile"><div class="n">{{ r.due }}</div><div class="k">À réviser</div></div>
  <div class="tile"><div class="n">{{ r.leeches }}</div><div class="k">Sangsues</div></div>
  <div class="tile"><div class="n">{{ '%.0f%%'|format(100 * r.mature_pct) }}</div>
    <div class="k">Mûres (des vues)</div></div>
  <div class="tile"><div class="n">{{ r.avg_ease if r.avg_ease is not none else '—' }}</div>
    <div class="k">Facilité moy.</div></div>
</div>
{% if leeches %}
<h2>Sangsues — cartes que tu rates sans cesse</h2>
<div style="overflow-x:auto">
<table>
<tr><th>Ligne</th><th>Échecs</th><th>Facilité</th><th>Répét.</th></tr>
{% for l in leeches %}
<tr><td class="line">{{ l.line|fig }}</td><td>{{ l.lapses }}</td>
  <td>{{ '%.2f'|format(l.ease) }}</td><td>{{ l.reps }}</td></tr>
{% endfor %}
</table>
</div>
{% elif r.total == 0 %}
<p class="muted">Aucune carte — <a href="/train/{{ cid }}">entraîne ce chapitre</a> pour construire le deck.</p>
{% else %}
<p class="muted">Aucune sangsue — le deck est en bonne santé.</p>
{% endif %}
""" + FOOT

CONFUSABLE_TMPL = HEAD + """
<p class="back"><a href="/chapter/{{ cid }}">← {{ name }}</a></p>
<h1>Positions confusables — {{ name }}</h1>
<p class="muted">Des échiquiers quasi identiques qui exigent des meilleurs coups <em>différents</em>
  — un piège de mémoire classique. Les paires les plus similaires d'abord (A6).</p>
{% for p in rows %}
<div class="row">
  <span class="muted">à {{ p.distance }} case{{ 's' if p.distance != 1 else '' }} d'écart</span><br>
  <span class="line">{{ p.line_a|fig }}</span> → <span class="best">{{ p.best_a|fig }}</span><br>
  <span class="line">{{ p.line_b|fig }}</span> → <span class="best">{{ p.best_b|fig }}</span>
</div>
{% else %}
<p class="muted">Aucune paire confusable trouvée dans ce chapitre.</p>
{% endfor %}
""" + FOOT


TRAIN_TMPL = HEAD_BOARD + """
<p class="back"><a href="{{ back_url }}">← {{ back_label }}</a></p>
<h1>{{ heading }}</h1>
{% if punish_deck %}
<p class="sub">Rejoue les pièges adverses de ce chapitre : l'erreur est jouée sur l'échiquier,
  à toi de trouver le contre. Chaque piège est planifié indépendamment par la répétition espacée.</p>
{% else %}
<p class="sub">Révise les erreurs les plus fréquentes de ce chapitre : joue ou récite le
  meilleur coup, la répétition espacée planifie la suite.</p>
{% endif %}
<div class="filters">
  <span class="filter"><label for="bucket">Niveau Elo Lichess</label>
    <select id="bucket" onchange="filterChanged()">
      <option value="">tous les niveaux</option>
      {% for b in buckets %}<option value="{{ b }}">{% if b == 0 %}débutants{% else %}{{ b }}+{% if b|fide %} (≈{{ b|fide }} FIDE){% endif %}{% endif %}</option>{% endfor %}
    </select></span>
  {% if punish_deck %}
  <span class="filter"><label for="side">Je joue</label>
    <select id="side" onchange="filterChanged()">
      <option value="white" selected>les Blancs</option>
      <option value="black">les Noirs</option>
    </select></span>
  {% endif %}
</div>
<details class="opts">
    <summary>Options</summary>
    <div class="opt-list">
      {% if not punish_deck %}
      <div class="opt"><label for="side">Je joue</label>
        <select id="side" onchange="filterChanged()">
          <option value="">les deux couleurs</option>
          <option value="white">les Blancs</option>
          <option value="black">les Noirs</option>
        </select>
        <span class="opt-help">Avec une couleur choisie, les positions où c'est à
          l'adversaire de jouer deviennent des contres : son erreur est jouée, tu réponds.</span></div>
      <div class="opt"><label for="opp">Erreurs adverses</label>
        <select id="opp" onchange="filterChanged()">
          <option value="punish">contrer — tu trouves la réponse</option>
          <option value="review">réviser — la réponse est montrée</option>
        </select>
        <span class="opt-help">Ce que le trainer fait des erreurs de l'adversaire.</span></div>
      {% endif %}
      <div class="opt"><label>Raccourcis clavier</label>
        <span class="opt-help"><kbd>espace</kbd> continuer / Trouvé · <kbd>1</kbd> Raté ·
          <kbd>t</kbd> taper un coup · <kbd>p</kbd> passer la carte · pour le coach :
          <kbd>2</kbd> difficile, <kbd>4</kbd> facile</span></div>
      <div class="opt"><label for="reflen">Réfutation</label>
        <select id="reflen" onchange="filterChanged()">
          {% for n in [1, 2, 3, 4, 5] %}<option value="{{ n }}"{% if n == reflen_default|default(3) %} selected{% endif %}>{{ n }} coup{{ 's' if n > 1 else '' }} max</option>{% endfor %}
        </select>
        <span class="opt-help">Après le contre, on enchaîne la suite tant qu'elle est
          forcée — jusqu'à ce plafond de coups.</span></div>
    </div>
  </details>
<div class="grid train-grid">
  <!-- La colonne question vient AVANT l'échiquier dans le DOM : un lecteur d'écran entend
       la consigne avant « Ou tape ton coup », et sur mobile la question reste au-dessus du
       pli. Sur desktop la grille replace l'échiquier à gauche (grid-column explicites). -->
  <div class="quizcol">
    <!-- Les prises de contrôle plein-panneau (choix du niveau, fin de session) viennent en
         TÊTE de la colonne : montrées seules, elles s'alignent ainsi sur le haut de
         l'échiquier (align-items:start). Masquées, elles ne réservent aucune place. -->
    <div id="levelcard" class="endcard" style="display:none"></div>
    <div id="endcard" class="endcard" style="display:none"></div>
    <div id="quiz" aria-live="polite">
      <div id="mode" class="modebadge"></div>
      <div id="modehelp" class="modehelp"></div>
      <div class="line" id="line"></div>
      <div class="prompt" id="prompt"></div>
    </div>
    <div class="sess" id="sess" aria-live="polite"></div>
    <div class="cardops">
      <button class="link" id="skipbtn" onclick="skipCard()" style="display:none">Passer
        cette carte <kbd>p</kbd></button>
      <button class="link" id="undobtn" onclick="undoGrade()" style="display:none">Annuler
        la dernière note</button>
    </div>
    <button class="g" id="reveal" onclick="reveal()" style="display:none">Révéler le meilleur coup <kbd>espace</kbd></button>
    <div class="controls" id="promo" style="display:none">
      Promotion :
      <button class="g" onclick="promote('q')">Dame</button>
      <button class="g" onclick="promote('r')">Tour</button>
      <button class="g" onclick="promote('b')">Fou</button>
      <button class="g" onclick="promote('n')">Cavalier</button>
    </div>
    <div class="feedback" id="feedback" aria-live="polite"></div>
    <button class="g mercy" id="mercy" onclick="replayStep()" style="display:none">Erreur de
      manipulation ? Rejouer ce coup</button>
    <button class="g" id="retry" onclick="retryNet()" style="display:none">Réessayer</button>
    <button class="g" id="nextdrill" onclick="nextStep()" style="display:none">Continuer</button>
    <div class="controls" id="grades" style="display:none">
      <div class="grade-hint">Tu l'avais en tête ? Sois honnête — ta réponse décide de quand
        cette carte reviendra.</div>
      <button class="g" onclick="grade('again')">Raté <kbd>1</kbd></button>
      <button class="g" id="gfound" onclick="grade('good')">Trouvé <kbd>espace</kbd></button>
    </div>
  </div>
  <div class="boardcol">
    <div id="board" class="playable" role="img"
      aria-label="Échiquier interactif — le champ « Ou tape ton coup » permet de jouer au clavier"></div>
    <form id="moveform" class="movein" style="display:none" onsubmit="return submitMove(event)">
      <label for="movetext">Ou tape ton coup <kbd>t</kbd></label>
      <input id="movetext" autocomplete="off" spellcheck="false"
        placeholder="ex. Cf3, Fxc3 ou g1f3">
      <button class="g" type="submit">Jouer</button>
    </form>
  </div>
</div>
<script type="module">
// Surface a load failure instead of leaving a silent, empty board. A `type=module`
// import that fails (wrong MIME, 404, parse error, missing export) otherwise only logs
// to the console — the user just sees nothing and assumes the trainer is broken.
function boardError(err) {
  document.getElementById('board').innerHTML =
    "<div class='board-error'>L'échiquier n'a pas pu se charger. Recharge la page.<br>"
    + "<small>Si le problème persiste, préviens ton coach — détail : "
    + (err && err.message ? err.message : err) + "</small></div>";
}
let Chessground;
try {
  ({ Chessground } = await import('/static/vendor/chessground.min.js'));
} catch (err) { boardError(err); throw err; }
const apiBase = "{{ api_base }}";
const STUDENT_ID = "{{ student_id|default('') }}";   // set when a student trains an assignment (P: coach loop)
const ASSIGNMENT_ID = "{{ assignment_id|default('') }}";   // restricts /next to the assigned subset
const INITIAL_BUCKET = "{{ initial_bucket|default('') }}";  // pre-set level from the assignment
const CSRF = "{{ csrf_token }}";
const postHeaders = { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF };
const $ = id => document.getElementById(id);
let cur = null;
let cg;
// IMPORTANT: create the board NOT view-only. Chessground binds its mousedown/touchstart
// handlers only when the board is interactive *at creation time* (bindBoard bails on
// `viewOnly` before attaching them, and set()/redraw never re-binds). Starting view-only
// and flipping later left the pieces permanently undraggable. We instead start interactive
// but with no movable colour, so nothing can move until loadNext() configures the card.
try {
  // prefers-reduced-motion : l'animation des pièces est pilotée JS par Chessground,
  // le bloc CSS global ne l'atteint pas — on la coupe ici.
  cg = Chessground($('board'),
    { viewOnly: false, coordinates: true,
      animation: { enabled: !window.matchMedia('(prefers-reduced-motion: reduce)').matches },
      movable: { free: false, color: undefined } });
} catch (err) { boardError(err); throw err; }
const uciLM = u => u ? [u.slice(0, 2), u.slice(2, 4)] : undefined;
const smallScreen = () => window.matchMedia('(max-width:880px)').matches;

const bucketParam = (extraSkip) => {
  const q = [];
  const b = $('bucket').value; if (b) q.push('bucket=' + b);
  const s = $('side') && $('side').value; if (s) q.push('side=' + s);
  const o = $('opp') && $('opp').value; if (o) q.push('opp=' + o);
  const rl = $('reflen') && $('reflen').value; if (rl) q.push('reflen=' + rl);
  const sk = extraSkip ? skipped.concat([extraSkip]) : skipped;
  if (sk.length) q.push('skip=' + sk.join(','));
  if (ASSIGNMENT_ID) q.push('assignment=' + ASSIGNMENT_ID);   // train only the assigned subset
  return q.length ? ('?' + q.join('&')) : '';
};
const setFeedback = (t, cls) => { const f = $('feedback');
  f.textContent = ''; f.className = 'feedback';
  if (!t) return;
  if (typeof t === 'string') { f.textContent = t; return; }
  if (t.verdict) { const s = document.createElement('strong'); s.className = cls || '';
    s.textContent = t.verdict; f.appendChild(s);
    f.appendChild(document.createTextNode(' ')); }
  f.appendChild(document.createTextNode(t.rest || ''));
  // La note secondaire (l'erreur fréquente du niveau) sur sa propre ligne atténuée :
  // elle éclaire sans jamais s'inviter dans la phrase-verdict.
  if (t.note) { const n = document.createElement('span'); n.className = 'subnote';
    n.textContent = t.note; f.appendChild(n); } };
// Le focus suit l'action courante (même règle que showNext) : après « Révéler », un
// utilisateur clavier atterrit sur « Trouvé » au lieu de re-tabuler depuis le haut.
const showGrades = () => { $('grades').style.display = 'block'; $('gfound').focus(); };
const hideGrades = () => { $('grades').style.display = 'none'; };
// The single "continue" button: its label and behaviour depend on what comes next.
let nextAction = null;     // 'followup' | 'drill' | 'card'
const NEXT_LABELS = { followup: 'Continuer la réfutation', drill: 'Erreur suivante',
                      card: 'Carte suivante' };
const showNext = (action) => { nextAction = action;
  const b = $('nextdrill');
  b.innerHTML = ''; b.appendChild(document.createTextNode(NEXT_LABELS[action] + ' '));
  const k = document.createElement('kbd'); k.textContent = 'espace'; b.appendChild(k);
  b.style.display = 'inline-block';
  b.focus(); };   // le focus suit l'action courante (lecteur d'écran + Entrée/espace natifs)
const hideNext = () => { $('nextdrill').style.display = 'none'; nextAction = null; };
const hidePromo = () => { $('promo').style.display = 'none'; };
const showMoveForm = (on) => { $('moveform').style.display = on ? 'flex' : 'none';
  if (!on) $('movetext').value = ''; };
let pending = null;
let reviewed = 0;
let remaining = null;      // today's queue size, from the /next payload
let drills = [], di = 0;   // a card's drills (1, or one per opponent mistake in punish/review)
let fi = -1;               // followup index within a punish drill (-1 = the punishment itself)
let curFen = null;         // full FEN of the board currently being quizzed (drill or followup)
let curFen4 = null;        // 4-field FEN of the same position (for typed-move SAN parsing)
let curDests = null;       // legal-move map of the position currently quizzed (drill or followup)
let wrongCount = 0;        // wrong answers on this card (mercy replay decrements)
let pendingGrade = null;   // verifiable card graded on LEAVING it (mercy can still change it)
let qShownAt = 0;          // when the current card became answerable — feeds response_ms (P4)
const elapsedMs = () => qShownAt ? Math.round(performance.now() - qShownAt) : null;
let mercyUsed = false;     // one manipulation-mistake replay per card
let lastBestSan = null;    // best move of the last verdict (session recap)
let missBest = null;       // best move of the FIRST miss on this card (the recap shows the
                           // move actually failed, not the last drill's answer)
let lastInput = null;      // 'drag' | 'typed' — mercy only makes sense after a mouse slip
let viaFilter = false;     // the current /next was triggered by a filter change
let lastGoodPrefs = null;  // last filter values that returned a card (to offer a revert)
const skipped = [];        // card ids passed this session (« Passer ») — still due, just
                           // excluded from /next so they don't come straight back.
                           // punish-deck ids are prefixed 'p' (the mixed deck serves two tables)
let curDeck = 'main';      // deck of the current card: 'main' (sr_cards) | 'punish' (punish_cards)
let lastNote = null;       // { card_id, prev, missedPushed, remDecr } — last posted grade,
                           // undoable (the symmetric pardon of a reflex « Trouvé »)
let pendingMsg = null;     // one-shot feedback line to show once the next card is loaded
let remSplit = null;       // mixed deck: { main: tes coups, punish: contres } — le compteur
                           // détaille le partage pour que choisir une couleur ne double pas
                           // silencieusement la dette du jour
let justFailed = null;     // carte notée « Raté » à l'instant : exclue de LA prochaine requête
                           // (au moins une autre carte s'intercale — une re-vue immédiate
                           // ferait noter « Trouvé » une réponse lue 10 secondes plus tôt)
const relearn = new Set(); // cartes ratées aujourd'hui, pas encore reprises (annonce + compteur)
const SESSION_GOAL = 10;   // objectif de session : sortie honorable toutes les 10 cartes
const missed = [];         // cards left with 'again' → « À retravailler » in the end panel
const gradesVisible = () => $('grades').style.display === 'block';
const updateSess = () => {
  const parts = [];
  // Le serveur compte encore les cartes passées comme dues (elles le sont) ; le compteur
  // affiché les soustrait pour ne pas mentir sur ce qui reste DANS CETTE session.
  if (remaining != null) {
    let line;
    if (remSplit) {
      // Le total AFFICHÉ = la somme du partage (les deux soustraient les passées de leur
      // deck) — un « 10 (0 + 11) » incohérent minerait la confiance dans le compteur.
      const skM = skipped.filter(x => String(x)[0] !== 'p').length;
      const skP = skipped.length - skM;
      const m = Math.max(0, remSplit.main - skM), p2 = Math.max(0, remSplit.punish - skP);
      line = 'À réviser aujourd’hui : ' + (m + p2) + ' (' + m + ' coup' + (m > 1 ? 's' : '')
        + ' à toi · ' + p2 + ' contre' + (p2 > 1 ? 's' : '') + ')';
    } else {
      line = 'À réviser aujourd’hui : ' + Math.max(0, remaining - skipped.length);
    }
    parts.push(line);
  }
  if (reviewed) parts.push('révisées : ' + reviewed);
  if (relearn.size) parts.push('à revoir : ' + relearn.size);
  if (skipped.length) parts.push('passées : ' + skipped.length);
  $('sess').textContent = parts.join(' · '); };

// Network failures must never leave a frozen board with no message: every fetch funnels
// its retry closure here, and the student gets one clear sentence + a retry button.
let retryFn = null;
function netError(fn) {
  retryFn = fn;
  setFeedback('Connexion perdue — vérifie ta connexion, puis réessaie.');
  hideNext(); hideGrades();
  $('retry').style.display = 'inline-block';
}
function retryNet() {
  $('retry').style.display = 'none';
  const fn = retryFn; retryFn = null;
  if (fn) fn();
}
window.retryNet = retryNet;

// One-line explanation under the badge, the first time each mode appears this session —
// the vocabulary is taught at the point of use, then gets out of the expert's way.
const MODE_HELP = {
  punish: 'L’adversaire vient de jouer une erreur fréquente à ce niveau — trouve le coup qui l’exploite.',
  review: 'On te montre la réponse au coup adverse — mémorise-la.',
  puzzle: 'Une erreur que les joueurs de ce niveau commettent vraiment — joue le bon coup.',
  flashcard: 'Carte de mémoire : récite le coup dans ta tête, puis vérifie.'
};
// Shown for the first 3 exposures of each mode (persisted), not just the first: one
// exposure is not enough to learn a word, and the help must survive a page reload.
function modeHelp(mode) {
  let n = 0;
  try { n = parseInt(localStorage.getItem('oa-help:' + mode) || '0', 10) || 0; } catch (e) {}
  if (n >= 3) { $('modehelp').textContent = ''; return; }
  try { localStorage.setItem('oa-help:' + mode, String(n + 1)); } catch (e) {}
  $('modehelp').textContent = MODE_HELP[mode] || '';
}

// The chosen filters survive reloads (per deck), so a student sets their level once.
const PREFS_KEY = 'oa-train:' + apiBase;
function savePrefs() {
  try {
    const v = {};
    for (const id of ['bucket', 'side', 'opp', 'reflen'])
      if ($(id)) v[id] = $(id).value;
    localStorage.setItem(PREFS_KEY, JSON.stringify(v));
  } catch (e) { /* storage unavailable — filters just reset per visit */ }
}
function loadPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    for (const id of ['bucket', 'side', 'opp', 'reflen'])
      if ($(id) && v[id] != null &&
          [...$(id).options].some(o => o.value === v[id])) $(id).value = v[id];
  } catch (e) { /* ignore malformed storage */ }
}

// A move to the last rank by a pawn needs a promotion piece before we can score it.
function pieceAt(fen, sq) {
  const rows = fen.split(' ')[0].split('/');
  const file = sq.charCodeAt(0) - 97, rank = 8 - parseInt(sq[1]);
  let f = 0;
  for (const ch of rows[rank]) {
    if (/[0-9]/.test(ch)) f += parseInt(ch);
    else { if (f === file) return ch; f++; }
  }
  return null;
}
function isPromotion(orig, dest) {
  const p = pieceAt(curFen || cur.fen, orig);
  return !!p && p.toLowerCase() === 'p' && (dest[1] === '8' || dest[1] === '1');
}
async function promote(letter) {
  hidePromo(); const p = pending; pending = null;
  answer(p.orig + p.dest + letter);
}
window.promote = promote;

// « Passer cette carte » : pas maintenant, sans la noter — elle reste due et reviendra
// (une autre session), mais /next l'exclut pour aujourd'hui. Disparaît dès qu'on a répondu :
// une carte répondue se note honnêtement, elle ne se passe plus.
function skipCard() {
  if (!cur) return;
  skipped.push((curDeck === 'punish' ? 'p' : '') + cur.card_id);
  pendingGrade = null; wrongCount = 0; missBest = null;
  pendingMsg = 'Carte passée — elle reste à faire.';
  loadNext();
}
window.skipCard = skipCard;

// « Annuler la dernière note » : le pardon symétrique du « Trouvé » réflexe. Restaure le
// snapshot SM-2 renvoyé par /grade, défait les compteurs de session, et la carte redevient
// due — elle revient dans la file.
async function undoGrade() {
  if (!lastNote) return;
  const n = lastNote;
  try {
    const r = await fetch(apiBase + '/grade-undo', { method: 'POST', headers: postHeaders,
      body: JSON.stringify({ card_id: n.card_id, prev: n.prev, deck: n.deck }) });
    if (!r.ok) throw new Error(r.status);
  } catch (e) { netError(undoGrade); return; }
  lastNote = null; $('undobtn').style.display = 'none';
  reviewed = Math.max(0, reviewed - 1);
  if (n.remDecr && remaining != null) remaining++;
  const key = (n.deck === 'punish' ? 'p' : '') + n.card_id;
  if (n.missedPushed) { missed.pop(); relearn.delete(key); }
  if (justFailed === key) justFailed = null;
  updateSess();
  pendingMsg = 'Note annulée — la carte reviendra dans la file d’aujourd’hui.';
  loadNext();
}
window.undoGrade = undoGrade;

// The user changed a filter. If an answered card is still waiting for its grade (SM-2
// buttons visible, or a deferred auto-grade), confirm before throwing it away.
function filterChanged() {
  // La garde couvre toute carte ENTAMÉE : raté encaissé, drill ou followup en cours, ou
  // une avance affichée (nextAction — la punition trouvée, réfutation pas encore finie).
  if ((gradesVisible() || pendingGrade || wrongCount > 0 || di > 0 || fi >= 0 || nextAction) &&
      !confirm('La carte en cours n’est pas terminée — changer quand même ?')) {
    // Annulé : remettre les selects sur les valeurs de la session en cours, sinon ils
    // MENTENT — et le prochain /check lirait le nouveau niveau sans consentement.
    if (lastGoodPrefs)
      for (const id of ['bucket', 'side', 'opp', 'reflen'])
        if ($(id) && lastGoodPrefs[id] != null) $(id).value = lastGoodPrefs[id];
    return;
  }
  savePrefs();
  viaFilter = true;   // une file vide ici = « rien à ce niveau », PAS « session terminée »
  loadNext();
}
window.filterChanged = filterChanged;

// First run (no saved prefs): the level is asked BEFORE the first card — rating-awareness
// is the product's core value, it must not hide behind a default of « tous les niveaux ».
function needsLevelChoice() {
  try { if (localStorage.getItem(PREFS_KEY) != null) return false; } catch (e) { return false; }
  const b = $('bucket');
  return !!b && b.options.length > 1;
}
// Quatre grandes familles au lieu des dix tranches brutes : un élève de 12 ans se
// reconnaît dans « joueur de club », pas dans « 1800+ » d'une échelle non nommée.
// Les tranches fines (et « tous les niveaux ») restent accessibles, repliées.
const LEVEL_FAMILIES = [
  { bucket: '0',    label: 'Je débute',        help: 'premières compétitions' },
  { bucket: '1600', label: 'Joueur de club',   help: 'jusqu’à ~1700 FIDE' },
  { bucket: '2000', label: 'Compétition',      help: '~1700 à 2000 FIDE' },
  { bucket: '2200', label: 'Joueur confirmé',  help: '2000 FIDE et plus' },
];
function pickLevel(value) {
  $('bucket').value = value; savePrefs();
  $('levelcard').style.display = 'none'; loadNext();
}
function showLevelChoice() {
  const card = $('levelcard'); card.innerHTML = '';
  const h = document.createElement('div'); h.className = 'end-title';
  h.textContent = 'À quel niveau joues-tu ?';
  card.appendChild(h);
  const p = document.createElement('p');
  p.textContent = 'Tu travailleras les erreurs que les joueurs de ton niveau commettent '
    + 'vraiment. Tu pourras changer à tout moment en haut de la page.';
  card.appendChild(p);
  const have = new Set([...$('bucket').options].map(o => o.value));
  const fams = LEVEL_FAMILIES.filter(f => have.has(f.bucket));
  if (fams.length >= 2) {
    const wrap = document.createElement('div'); wrap.className = 'level-btns families';
    for (const f of fams) {
      const b = document.createElement('button'); b.className = 'g'; b.type = 'button';
      const l = document.createElement('span'); l.className = 'lvl-l'; l.textContent = f.label;
      const s = document.createElement('span'); s.className = 'lvl-h'; s.textContent = f.help;
      b.appendChild(l); b.appendChild(s);
      b.onclick = () => pickLevel(f.bucket);
      wrap.appendChild(b);
    }
    card.appendChild(wrap);
  }
  const fine = document.createElement('details'); fine.className = 'fine';
  const sum = document.createElement('summary');
  sum.textContent = fams.length >= 2
    ? 'Choisir une tranche Elo Lichess précise (≈ FIDE + 250) — ou tous les niveaux'
    : 'Choisis ta tranche (Elo Lichess, ≈ FIDE + 250)';
  fine.appendChild(sum);
  const wrap2 = document.createElement('div'); wrap2.className = 'level-btns';
  const opts = [...$('bucket').options];
  // « tous les niveaux » (value '') passe en DERNIER : c'est l'anti-choix du produit.
  for (const opt of [...opts.filter(o => o.value !== ''), ...opts.filter(o => o.value === '')]) {
    const b = document.createElement('button'); b.className = 'g'; b.type = 'button';
    b.textContent = opt.value === '' ? 'tous les niveaux' : opt.textContent;
    b.onclick = () => pickLevel(opt.value);
    wrap2.appendChild(b);
  }
  fine.appendChild(wrap2);
  if (fams.length < 2) fine.open = true;   // pas assez de tranches pour des familles
  card.appendChild(fine);
  card.style.display = 'block';
}

// Session end / empty queue: a real closing panel instead of a muted one-liner.
// `fromFilter` distinguishes « cette tranche est vide » (simple exploration d'un menu)
// d'une vraie fin de session — un faux « Session terminée ! » sur un changement de
// filtre est un faux signal de complétion.
function endSession(d, fromFilter) {
  $('line').textContent = ''; $('prompt').textContent = '';
  $('mode').textContent = ''; $('mode').className = 'modebadge';
  $('skipbtn').style.display = 'none'; pendingMsg = null;
  // « Annuler la dernière note » reste disponible : une note réflexe juste avant la fin
  // de session doit pouvoir être reprise.
  setFeedback(''); $('reveal').style.display = 'none'; showMoveForm(false);
  // Sur une tranche vide (fromFilter), « À réviser : 0 » serait ambigu (0 à ce niveau,
  // pas 0 au global) : on masque le compteur plutôt que d'afficher un faux zéro.
  cg.set({ viewOnly: true }); cur = null; drills = [];
  remaining = fromFilter ? null : 0; remSplit = null; updateSess();
  const end = $('endcard'); end.innerHTML = '';
  if (fromFilter && !d.message) {
    const h = document.createElement('div'); h.className = 'end-title';
    h.textContent = 'Rien à réviser à ce niveau';
    end.appendChild(h);
    const p = document.createElement('p');
    p.textContent = 'Aucune carte n’est due avec ces filtres pour le moment. '
      + 'Choisis un autre niveau en haut de la page.';
    end.appendChild(p);
    if (lastGoodPrefs) {
      const b = document.createElement('button'); b.className = 'g'; b.type = 'button';
      b.textContent = '← Revenir au filtre précédent';
      b.onclick = () => {
        for (const id of ['bucket', 'side', 'opp', 'reflen'])
          if ($(id) && lastGoodPrefs[id] != null) $(id).value = lastGoodPrefs[id];
        savePrefs(); loadNext();
      };
      end.appendChild(b);
    }
    end.style.display = 'block';
    return;
  }
  // Des cartes passées = la session n'est PAS terminée : le dire, et offrir de les reprendre.
  const nSkip = skipped.length;
  const h = document.createElement('div'); h.className = 'end-title';
  h.textContent = nSkip ? 'Presque fini !'
    : reviewed ? 'Session terminée !' : 'Rien à réviser pour le moment';
  end.appendChild(h);
  const p = document.createElement('p');
  p.textContent = d.message ? d.message
    : nSkip ? ((reviewed ? 'Tu as revu ' + reviewed + ' carte' + (reviewed > 1 ? 's' : '') + ', et ' : 'Tu as ')
               + 'passé ' + nSkip + ' carte' + (nSkip > 1 ? 's' : '') + ' — elle'
               + (nSkip > 1 ? 's restent' : ' reste') + ' à faire.')
    : reviewed ? ('Tu as revu ' + reviewed + ' carte' + (reviewed > 1 ? 's' : '') +
                  '. Les prochaines révisions sont déjà planifiées — reviens demain.')
    : 'Toutes les cartes sont planifiées plus tard. Reviens demain — ou demande à ton '
      + 'coach d’élargir la sélection du chapitre.';
  end.appendChild(p);
  if (nSkip && !d.message) {
    const b = document.createElement('button'); b.className = 'g'; b.type = 'button';
    b.textContent = 'Reprendre les cartes passées';
    b.onclick = () => { skipped.length = 0; loadNext(); };
    end.appendChild(b);
  }
  renderMissed(end);
  const back = document.createElement('a'); back.href = "{{ back_url }}";
  back.textContent = '← Retour : {{ back_label }}';
  end.appendChild(back);
  end.style.display = 'block';
}

function renderMissed(end) {
  if (!missed.length) return;
  const h2 = document.createElement('div'); h2.className = 'end-missed';
  h2.textContent = 'À retravailler :';
  end.appendChild(h2);
  const ul = document.createElement('ul');
  for (const m of missed.slice(0, 6)) {
    const li = document.createElement('li');
    li.textContent = m.line + (m.best ? (' → ' + m.best) : '');
    ul.appendChild(li);
  }
  if (missed.length > 6) {
    const li = document.createElement('li');
    li.textContent = '… et ' + (missed.length - 6) + ' autre' + (missed.length - 6 > 1 ? 's' : '');
    ul.appendChild(li);
  }
  end.appendChild(ul);
}

// Objectif de session atteint (toutes les SESSION_GOAL cartes) : une sortie honorable.
// La dette du jour peut dépasser 30 cartes — sans ce palier, le panneau de fin soigné
// n'est jamais vu et chaque session se termine par une fermeture d'onglet.
function showGoalPanel() {
  $('line').textContent = ''; $('prompt').textContent = '';
  $('mode').textContent = ''; $('mode').className = 'modebadge';
  $('skipbtn').style.display = 'none';
  setFeedback(''); $('reveal').style.display = 'none'; showMoveForm(false);
  hideGrades(); hideNext(); hidePromo();
  cg.set({ viewOnly: true }); cur = null; drills = [];
  const end = $('endcard'); end.innerHTML = '';
  const h = document.createElement('div'); h.className = 'end-title';
  h.textContent = 'Objectif de session atteint !';
  end.appendChild(h);
  const p = document.createElement('p');
  const left = remaining != null ? Math.max(0, remaining - skipped.length) : null;
  p.textContent = 'Tu as revu ' + reviewed + ' cartes. Tu peux t’arrêter là — les prochaines '
    + 'révisions sont déjà planifiées' + (left ? (' — ou continuer (' + left + ' carte'
    + (left > 1 ? 's' : '') + ' encore due' + (left > 1 ? 's' : '') + ' aujourd’hui).') : '.');
  end.appendChild(p);
  const b = document.createElement('button'); b.className = 'g'; b.type = 'button';
  b.textContent = 'Continuer encore';
  b.onclick = () => loadNext();
  end.appendChild(b);
  renderMissed(end);
  const back = document.createElement('a'); back.href = "{{ back_url }}";
  back.textContent = '← Retour : {{ back_label }}';
  end.appendChild(back);
  end.style.display = 'block';
}

async function loadNext() {
  setFeedback(''); hideGrades(); hideNext(); hidePromo(); pending = null; cg.setShapes([]);
  $('endcard').style.display = 'none'; $('levelcard').style.display = 'none';
  $('mercy').style.display = 'none'; $('retry').style.display = 'none';
  $('skipbtn').style.display = 'none';
  wrongCount = 0; pendingGrade = null; mercyUsed = false; missBest = null;
  $('prompt').textContent = 'Chargement…';
  // La carte qui vient d'être ratée est exclue de CETTE requête seulement : une autre
  // carte s'intercale avant la re-vue. Si elle était la seule, on la ressert quand même.
  const jf = justFailed; justFailed = null;
  let d;
  try {
    const r = await fetch(apiBase + '/next' + bucketParam(jf));
    if (!r.ok) throw new Error(r.status);
    d = await r.json();
    if (d.done && jf) {
      const r2 = await fetch(apiBase + '/next' + bucketParam());
      if (!r2.ok) throw new Error(r2.status);
      d = await r2.json();
    }
  } catch (e) { $('prompt').textContent = ''; netError(loadNext); return; }
  const fromFilter = viaFilter; viaFilter = false;
  if (d.done) { endSession(d, fromFilter); return; }
  lastGoodPrefs = {};
  for (const id of ['bucket', 'side', 'opp', 'reflen'])
    if ($(id)) lastGoodPrefs[id] = $(id).value;
  remaining = (typeof d.remaining === 'number') ? d.remaining : null;
  remSplit = (typeof d.remaining_main === 'number' && typeof d.remaining_punish === 'number')
    ? { main: d.remaining_main, punish: d.remaining_punish } : null;
  curDeck = d.deck || 'main';
  // Une carte ratée qui repasse est ANNONCÉE — sinon son retour ressemble à un bug.
  if (relearn.has((curDeck === 'punish' ? 'p' : '') + d.card_id))
    pendingMsg = 'Tu la revois — ratée tout à l’heure.';
  updateSess();
  drills = d.drills || []; di = 0;
  // Carte punish sans drill (position-enfant hors cache, ex. chapitre sans `deepen`) :
  // la passer automatiquement plutôt que geler sur « Chargement… ».
  if (!drills.length) {
    skipped.push((curDeck === 'punish' ? 'p' : '') + d.card_id);
    pendingMsg = 'Une carte indisponible a été passée (position non analysée).';
    loadNext();
    return;
  }
  showDrill();
  // Message transitoire (« Carte passée… », « Note annulée… ») : affiché sur la nouvelle
  // carte puis auto-effacé — il ne doit pas coller à la carte suivante pendant qu'on y joue.
  if (pendingMsg) {
    const msg = pendingMsg; pendingMsg = null;
    setFeedback(msg);
    setTimeout(() => { if ($('feedback').textContent === msg) setFeedback(''); }, 4000);
  }
}

function showDrill() {
  setFeedback(''); hideGrades(); hideNext(); hidePromo(); pending = null; cg.setShapes([]);
  $('mercy').style.display = 'none';
  // « Passer » n'est offert que sur une carte encore intacte (avant le premier drill).
  $('skipbtn').style.display = di === 0 ? '' : 'none';
  cur = drills[di]; fi = -1; curFen = cur.fen; curFen4 = cur.fen4; curDests = cur.dests;
  qShownAt = performance.now();   // chrono de réponse : la question devient répondable ici (P4)
  const step = drills.length > 1 ? (' ' + (di + 1) + '/' + drills.length) : '';
  $('line').textContent = cur.line;
  const side = cur.turn === 'white' ? 'aux blancs' : 'aux noirs';
  const oppSide = cur.turn === 'white' ? 'Les noirs ont joué' : 'Les blancs ont joué';
  const interactive = (cur.mode === 'puzzle' || cur.mode === 'punish');
  modeHelp(cur.mode);
  if (cur.mode === 'punish') {
    $('mode').textContent = 'CONTRER' + step;
    $('mode').className = 'modebadge puzzle';
    $('prompt').textContent = oppSide + ' ' + (cur.opp_san || 'une erreur')
      + ' — trouve la meilleure réponse (trait ' + side + ').';
  } else if (cur.mode === 'review') {
    $('mode').textContent = 'RÉVISION' + step;
    $('mode').className = 'modebadge flashcard';
    $('prompt').textContent = oppSide + ' ' + (cur.opp_san || 'l’erreur') + ' — voici la réponse.';
  } else if (cur.mode === 'puzzle') {
    $('mode').textContent = 'TACTIQUE';
    $('mode').className = 'modebadge puzzle';
    $('prompt').textContent = 'Trait ' + side + ' — joue le meilleur coup sur l’échiquier.';
  } else {
    $('mode').textContent = 'CARTE';
    $('mode').className = 'modebadge flashcard';
    $('prompt').textContent = 'Trait ' + side + ' — quel est le meilleur coup ? Dis-le, puis Révèle.';
  }
  showMoveForm(interactive);
  // Le coup adverse (punish/review) est surligné sur l'échiquier : l'élève VOIT l'erreur
  // au lieu de la localiser en décodant le SAN de la consigne.
  const lm = uciLM(cur.opp_uci);
  if (interactive) {
    $('reveal').style.display = 'none';
    cg.set({ fen: cur.fen, orientation: cur.orientation, turnColor: cur.turn, viewOnly: false,
      lastMove: lm,
      movable: { free: false, color: cur.turn, dests: new Map(Object.entries(cur.dests)),
                 showDests: true, events: { after: onMove } } });
  } else {
    cg.set({ fen: cur.fen, orientation: cur.orientation, viewOnly: true, lastMove: lm,
      movable: { color: undefined } });
    if (cur.mode === 'review') { $('reveal').style.display = 'none'; reveal(); }
    else { $('reveal').style.display = 'inline-block'; }
  }
  // IMPORTANT : le board sort d'un état viewOnly (le verdict précédent) — sans redrawAll,
  // cg.set({lastMove}) pose l'état mais ne PEINT pas les cases surlignées (même pathologie
  // que setShapes, découverte en critique 6 : deux passes ont validé l'état, pas les pixels).
  cg.redrawAll();
  // Sur petit écran, une nouvelle question doit être lue avant de jouer : on la remet en vue.
  if (smallScreen()) $('quiz').scrollIntoView({ block: 'nearest' });
}

// After a drill is answered: next opponent mistake, else close the card. Cards whose answer
// is a verifiable move (puzzle / punish) are graded automatically — the move IS the proof;
// the four SM-2 buttons only appear on recite-then-reveal cards (flashcard / review).
// The auto-grade is only POSTED when the student leaves the card, so a manipulation-mistake
// replay (mercy) can still correct it.
function afterDrill() {
  if (di < drills.length - 1) { showNext('drill'); return; }
  const verifiable = drills.length && drills.every(
    d => d.mode === 'puzzle' || d.mode === 'punish');
  if (verifiable) {
    pendingGrade = wrongCount > 0 ? 'again' : 'good';
    const note = document.createElement('span'); note.className = 'autonote';
    note.textContent = pendingGrade === 'again' ? ' Carte notée : à revoir bientôt.'
                                                : ' Carte notée : acquise.';
    $('feedback').appendChild(note);
    showNext('card');
  } else showGrades();
}
function nextDrill() { di++; showDrill(); }

// Post the deferred auto-grade, then move on. Must complete before /next, otherwise the
// still-due card would just come straight back.
async function finalizeCard() {
  const g = pendingGrade; pendingGrade = null;
  if (g) {
    let resp = null;
    try {
      const r = await fetch(apiBase + '/grade', { method: 'POST', headers: postHeaders,
        body: JSON.stringify({ card_id: cur.card_id, grade: g, deck: curDeck,
          bucket: $('bucket').value || null, response_ms: elapsedMs(),
          student_id: STUDENT_ID || null }) });
      if (!r.ok) throw new Error(r.status);
      resp = await r.json();
    } catch (e) { pendingGrade = g; netError(() => nextStep()); return; }
    reviewed++; const remDecr = remaining != null && remaining > 0; if (remDecr) remaining--;
    // Le récap montre le coup du PREMIER raté de la carte (missBest), pas la réponse
    // du dernier drill — sur une carte multi-pièges les deux divergent.
    const missedPushed = g === 'again';
    if (missedPushed) missed.push({ line: cur.line, best: missBest || lastBestSan });
    noteJustPosted(cur.card_id, resp, missedPushed, remDecr);
    noteBookkeeping((curDeck === 'punish' ? 'p' : '') + cur.card_id, g);
    updateSess();
    if (reviewed % SESSION_GOAL === 0) { showGoalPanel(); return; }
  }
  loadNext();
}

// One free replay per card when a wrong answer was a slip of the hand, not of the head:
// rewind to the quizzed position, forget that wrong answer, take back the pending grade.
function replayStep() {
  mercyUsed = true; wrongCount = Math.max(0, wrongCount - 1); pendingGrade = null;
  if (wrongCount === 0) missBest = null;   // le seul raté était le misdrag pardonné
  $('mercy').style.display = 'none'; hideNext(); setFeedback('');
  const step = fi >= 0 ? cur.followups[fi] : cur;
  curFen = step.fen; curFen4 = step.fen4; curDests = step.dests;
  showMoveForm(true);
  cg.setShapes([]);
  cg.set({ fen: step.fen, orientation: step.orientation, turnColor: step.turn, viewOnly: false,
    lastMove: uciLM(step.opp_uci),
    movable: { free: false, color: step.turn, dests: new Map(Object.entries(step.dests)),
               showDests: true, events: { after: onMove } } });
}
window.replayStep = replayStep;

// The "continue" button: advance to whatever comes next (refutation ply, drill, or card).
function nextStep() {
  if (nextAction === 'followup') advanceFollowup();
  else if (nextAction === 'drill') nextDrill();
  else finalizeCard();
}
window.nextStep = nextStep;

// Score an answer, network-safe: on failure the same answer is retriable as-is.
async function answer(uci) {
  let d;
  try { d = await check(uci); } catch (e) { netError(() => answer(uci)); return; }
  showResult(d, uci);
}

async function onMove(orig, dest) {
  lastInput = 'drag';
  if (isPromotion(orig, dest)) { pending = { orig, dest }; $('promo').style.display = 'block'; return; }
  answer(orig + dest);
}
async function reveal() { $('reveal').style.display = 'none'; answer(null); }

// Typed-move alternative to dragging (keyboard / screen-reader path). Accepts squares
// ("g1f3", optional promotion letter D/T/F/C or Q/R/B/N) directly; anything else — SAN in
// French ("Cf3", "Fxc3") or English ("Nf3") — is parsed server-side against the position.
const PROMO_LETTERS = { d: 'q', t: 'r', f: 'b', c: 'n', q: 'q', r: 'r', b: 'b', n: 'n' };
const badMove = () => setFeedback('Coup illisible ou illégal ici — écris-le comme sur ta '
  + 'feuille de partie (Cf3, Fxc3) ou par cases (g1f3).');
async function submitMove(ev) {
  ev.preventDefault();
  if (!cur || nextAction || gradesVisible()) return false;
  const typed = $('movetext').value.trim();
  if (!typed) return false;
  lastInput = 'typed';   // un coup tapé n'est jamais un misdrag — pas de bouton mercy
  const raw = typed.toLowerCase().replace(/[^a-z0-9]/g, '');
  const m = raw.match(/^([a-h][1-8])([a-h][1-8])([a-z]?)$/);
  if (m && curDests && (curDests[m[1]] || []).includes(m[2])) {
    $('movetext').value = '';
    if (isPromotion(m[1], m[2])) {
      const p = PROMO_LETTERS[m[3]];
      if (!p) { pending = { orig: m[1], dest: m[2] }; $('promo').style.display = 'block'; return false; }
      answer(m[1] + m[2] + p);
      return false;
    }
    answer(m[1] + m[2]);
    return false;
  }
  // Not square-square: let the server read it as SAN against the current position.
  let parsed;
  try {
    const r = await fetch('/api/parse-move', { method: 'POST', headers: postHeaders,
      body: JSON.stringify({ fen4: curFen4, text: typed }) });
    if (!r.ok) throw new Error(r.status);
    parsed = await r.json();
  } catch (e) { netError(() => submitMove(ev)); return false; }
  if (!parsed.uci) { badMove(); return false; }
  $('movetext').value = '';
  answer(parsed.uci);
  return false;
}
window.submitMove = submitMove;

async function check(uci) {
  const body = { card_id: cur.card_id, uci, deck: curDeck,
                 bucket: $('bucket').value || null };   // la note « à ce niveau » filtre CE niveau
  if (fi >= 0 && cur.followups) {           // refutation followup: score against the given answer
    body.fen4 = cur.followups[fi].fen4; body.answer_uci = cur.followups[fi].answer_uci;
  } else {
    body.quiz_position_id = cur.quiz_position_id;
  }
  const r = await fetch(apiBase + '/check', { method: 'POST',
    headers: postHeaders, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

// After a step is answered: if the punish drill has more refutation plies, offer the next one
// behind an explicit button (the student reads the verdict at their own pace — no timer);
// otherwise move on (next opponent mistake, or close the card).
function afterStep() {
  const fups = cur.followups || [];
  if (cur.mode === 'punish' && fi < fups.length - 1) showNext('followup');
  else afterDrill();
}

function advanceFollowup() {
  fi++;
  const f = cur.followups[fi];
  curFen = f.fen; curFen4 = f.fen4; curDests = f.dests;
  $('mercy').style.display = 'none';
  setFeedback('L’adversaire répond ' + f.opp_san + ' — trouve la suite.');
  // Le fil de progression intra-réfutation : le contre initial + les followups.
  $('prompt').textContent = 'Continue la réfutation — coup ' + (fi + 2) + ' sur '
    + (cur.followups.length + 1) + '.';
  hideGrades(); hideNext(); showMoveForm(true); cg.setShapes([]);
  cg.set({ fen: f.fen, orientation: f.orientation, turnColor: f.turn, viewOnly: false,
    lastMove: [f.opp_uci.slice(0, 2), f.opp_uci.slice(2, 4)],
    movable: { free: false, color: f.turn, dests: new Map(Object.entries(f.dests)),
               showDests: true, events: { after: onMove } } });
  cg.redrawAll();   // sortie de viewOnly : sans lui le lastMove n'est pas peint
}

function showResult(d, playedUci) {
  if (d.correct === false) { wrongCount++; if (!missBest) missBest = d.best_san || null; }
  lastBestSan = d.best_san || null;
  // Dernier followup réussi : la réfutation est FINIE — « tu continues » mentirait,
  // aussitôt contredit par « Carte notée : acquise ».
  if (d.correct === true && fi >= 0 && cur.followups && fi === cur.followups.length - 1)
    d.comment = 'La réfutation est complète.';
  // Le serveur compose la phrase-verdict entière (coup joué, perte, meilleur coup nommé une
  // seule fois) + une note secondaire optionnelle — le client n'assemble plus de clauses.
  if (d.correct === true) setFeedback({ verdict: 'Correct !', rest: d.comment, note: d.note }, 'ok');
  else if (d.correct === false) setFeedback({ verdict: 'Pas le meilleur.', rest: d.comment, note: d.note }, 'bad');
  else setFeedback({ rest: d.comment, note: d.note });
  $('skipbtn').style.display = 'none';   // une carte répondue se note, elle ne se passe plus
  // A wrong DRAGGED move may be a slip of the hand: offer one replay of this very step.
  // A typed move never is — offering mercy there would just be an anti-failure button.
  if (d.correct === false && !mercyUsed && lastInput === 'drag' &&
      (cur.mode === 'puzzle' || cur.mode === 'punish'))
    $('mercy').style.display = 'inline-block';
  showMoveForm(false);
  cg.setShapes([]);
  const lm = d.best_uci ? [d.best_uci.slice(0, 2), d.best_uci.slice(2, 4)] : undefined;
  const wrong = d.correct === false && playedUci
    && (!d.best_uci || playedUci.slice(0, 4) !== d.best_uci.slice(0, 4));
  if (wrong) {
    // Wrong move: show the quiz position with the played move in red and the best in
    // green, side by side — the student sees exactly what they did vs what to play.
    cg.set({ fen: curFen, orientation: cur.orientation, viewOnly: true,
             lastMove: undefined, movable: { color: undefined } });
    const shapes = [{ orig: playedUci.slice(0, 2), dest: playedUci.slice(2, 4), brush: 'red' }];
    if (lm) shapes.push({ orig: lm[0], dest: lm[1], brush: 'green' });
    cg.setShapes(shapes);
    cg.redrawAll();   // setShapes alone doesn't repaint the arrow layer after a move
  } else if (d.best_fen) {
    // Correct (or reveal): show the position *after* the best move, piece left in place.
    cg.set({ fen: d.best_fen, orientation: cur.orientation, viewOnly: true,
             lastMove: lm, movable: { color: undefined } });
    cg.redrawAll();   // le lastMove du meilleur coup doit être peint, pas seulement posé
  } else {
    cg.set({ fen: cur.fen, orientation: cur.orientation, viewOnly: true, movable: { color: undefined } });
    if (lm) { cg.setShapes([{ orig: lm[0], dest: lm[1], brush: 'green' }]); cg.redrawAll(); }
  }
  afterStep();
  // Sur petit écran, le verdict vit au-dessus de l'échiquier : on le ramène en vue
  // après la réponse, sinon l'élève joue et ne voit jamais ce qu'on lui répond.
  if (smallScreen()) $('feedback').scrollIntoView({ block: 'nearest' });
}

async function grade(g) {
  if (!gradesVisible()) return;
  let resp = null;
  try {
    const r = await fetch(apiBase + '/grade', { method: 'POST',
      headers: postHeaders,
      body: JSON.stringify({ card_id: cur.card_id, grade: g, deck: curDeck,
        bucket: $('bucket').value || null, response_ms: elapsedMs(),
        student_id: STUDENT_ID || null }) });
    if (!r.ok) throw new Error(r.status);
    resp = await r.json();
  } catch (e) { netError(() => grade(g)); return; }
  reviewed++;
  const missedPushed = g === 'again';
  if (missedPushed) missed.push({ line: cur.line, best: missBest || lastBestSan });
  noteJustPosted(cur.card_id, resp, missedPushed, false);
  noteBookkeeping((curDeck === 'punish' ? 'p' : '') + cur.card_id, g);
  updateSess();
  if (reviewed % SESSION_GOAL === 0) { showGoalPanel(); return; }
  loadNext();
}

// Après chaque note : un « Raté » entre en re-vue (exclu de la requête suivante, annoncé
// à son retour) ; toute autre note sort la carte de la liste des re-vues.
function noteBookkeeping(key, g) {
  if (g === 'again') { relearn.add(key); justFailed = key; }
  else relearn.delete(key);
}

// Une note vient d'être postée : mémorise le snapshot SM-2 d'avant (renvoyé par /grade)
// et offre « Annuler la dernière note » jusqu'à la note suivante.
function noteJustPosted(cardId, resp, missedPushed, remDecr) {
  lastNote = (resp && resp.prev) ? { card_id: cardId, prev: resp.prev, deck: curDeck,
                                     missedPushed: missedPushed, remDecr: remDecr } : null;
  $('undobtn').style.display = lastNote ? 'inline-block' : 'none';
}

// Keyboard: space = continue (reveal → next step → grade Good) ; 1-4 grade when shown ;
// t = jump to the typed-move field. Inert while the focus is in a form control, so typing
// a move or tabbing through the selects never grades a card by accident. When a button is
// focused, space is left to the button itself (avoids a double trigger).
// Grades matched on e.code (physical key), NOT e.key: on the French AZERTY layout the
// digit row types &é"' without Shift, so e.key would never equal '1'…'4' for the very
// audience this UI is written for. Digit2/4 keep the expert hard/easy grades reachable.
const CODE_GRADES = { Digit1: 'again', Numpad1: 'again', Digit2: 'hard', Numpad2: 'hard',
                      Digit3: 'good', Numpad3: 'good', Digit4: 'easy', Numpad4: 'easy' };
document.addEventListener('keydown', (e) => {
  if (!cur) return;
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (tag === 'BUTTON' && e.key === ' ') return;
  if (CODE_GRADES[e.code] && gradesVisible()) { e.preventDefault(); grade(CODE_GRADES[e.code]); return; }
  if (e.key === 't' && $('moveform').style.display !== 'none') {
    e.preventDefault(); $('movetext').focus(); return;
  }
  if (e.key === 'p' && $('skipbtn').style.display !== 'none') {
    e.preventDefault(); skipCard(); return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    if (gradesVisible()) grade('good');
    else if ($('nextdrill').style.display !== 'none') nextStep();
    else if ($('reveal').style.display !== 'none') reveal();
  }
});
window.loadNext = loadNext; window.reveal = reveal; window.grade = grade;
// Un seul dialecte de niveau : les tranches du sélecteur reprennent les libellés des
// familles du premier lancement (« Compétition — 2000+ (≈1755 FIDE) »).
for (const opt of ($('bucket') ? [...$('bucket').options] : [])) {
  // '0' s'affiche déjà « débutants » — le doubler serait redondant.
  const f = LEVEL_FAMILIES.find(x => x.bucket === opt.value && x.bucket !== '0');
  if (f) opt.textContent = f.label + ' — ' + opt.textContent;
}
loadPrefs();
// An assignment carries its own level: it wins over saved prefs and skips the « quel niveau » ask.
if (INITIAL_BUCKET && $('bucket') && [...$('bucket').options].some(o => o.value === INITIAL_BUCKET)) {
  $('bucket').value = INITIAL_BUCKET; savePrefs();
}
if (needsLevelChoice()) showLevelChoice(); else loadNext();
</script>
""" + FOOT


PERSONAL_TMPL = HEAD + """
<p class="back"><a href="/">← accueil</a></p>
<h1>Corrige tes erreurs — {{ username }}</h1>
<p><a class="train-btn" href="/personal/{{ username }}/train">▶ Entraîner mes erreurs</a></p>

{% if priorities %}
<h2>Priorité d'entraînement <span class="muted">(M24)</span></h2>
<p class="muted">occurrences × fréquence chez les pairs × perte d'éval × temps depuis la révision.</p>
{% for p in priorities %}
  <div class="row">
    <span class="crit">{{ '%.3f'|format(p.priority) }}</span> ·
    <span class="line">{{ p.line|fig }}</span><br>
    <span class="muted">vue {{ p.seen }}× · perte {{ p.loss }} · inactive {{ p.idle }} j</span>
  </div>
{% endfor %}
{% endif %}

{% if progress %}
<h2>Progression <span class="muted">(M21)</span></h2>
<table class="prog"><tr><th>Période</th><th>Parties</th><th>Territoire</th><th>Erreurs</th><th>Taux</th></tr>
{% for pr in progress %}
  <tr><td>{{ pr.period }}</td><td>{{ pr.games }}</td><td>{{ pr.territory }}</td>
      <td>{{ pr.errors }}</td>
      <td>{% if pr.error_rate is not none %}{{ '%.0f'|format(pr.error_rate * 100) }}%{% else %}—{% endif %}</td></tr>
{% endfor %}
</table>
{% endif %}

{% if deviations %}
<h2>Sortie de théorie <span class="muted">(hors-livre, jugé sur les évals en cache)</span></h2>
{% for d in deviations %}
  <div class="row">
    <span class="line">{{ d.line|fig }}</span><br>
    <span class="muted">tu as joué <span class="bad">{{ d.played|fig }}</span> au lieu de
      <span class="best">{{ d.best|fig }}</span> · perte {{ d.loss }}
      {% if d.costly %}<span class="pill puzzle">coûteux</span>{% else %}<span class="pill flashcard">anodin</span>{% endif %}</span>
  </div>
{% endfor %}
{% endif %}

<h2>Toutes les erreurs</h2>
<p class="muted">{{ errors|length }} erreur{{ 's' if errors|length != 1 }} dans le territoire
  analysé, les pires d'abord.</p>
{% for e in errors %}
  <div class="row">
    <span class="crit">{{ '%.3f'|format(e.crit) }}</span> ·
    <span class="line">{{ e.line|fig }}</span><br>
    <span class="muted">tu as joué <span class="bad">{{ e.played|fig }}</span>,
      meilleur <span class="best">{{ e.best|fig }}</span> · perte {{ e.loss }}
      {% if e.bucket %} · {{ e.bucket }}+{% if e.bucket|fide %} <span class="muted">≈{{ e.bucket|fide }} FIDE</span>{% endif %}{% endif %}
      <span class="pill {{ e.type }}">{{ e.type|typefr }}</span></span>
  </div>
{% else %}
  <p>Aucune erreur personnelle pour l'instant. Importe des parties :
     <code>import-games --pgn … --username {{ username }}</code></p>
{% endfor %}
""" + FOOT


# --- Login rate limiting (hosted mode) -------------------------------------
# A simple per-process sliding window keyed by client IP, to blunt password
# brute-forcing. A multi-process deployment behind a load balancer wants a shared
# store (Redis) — see docs/HOSTING.md; this covers a single-box gunicorn.
LOGIN_MAX_FAILURES = 10       # failed attempts allowed per window per IP
LOGIN_WINDOW_S = 300          # 5 minutes
_login_failures: dict[str, list[float]] = {}


def _recent_failures(ip: str, *, now: float | None = None) -> int:
    now = time.time() if now is None else now
    window = [t for t in _login_failures.get(ip, []) if now - t < LOGIN_WINDOW_S]
    if window:
        _login_failures[ip] = window
    else:
        _login_failures.pop(ip, None)
    return len(window)


def _record_login_failure(ip: str) -> None:
    _login_failures.setdefault(ip, []).append(time.time())


# --- Web PGN upload → background analysis ----------------------------------
# Analysing a chapter takes minutes (Explorer + evals), so it can't block the request.
# We run it in a background thread and expose an in-memory job the upload page polls. Good
# for the single-box local/hosted app this is; a multi-worker deployment would move this to
# a real queue (docs/HOSTING.md, stage 3).
MAX_UPLOAD_BYTES = 5 * 1024 * 1024      # a repertoire PGN is tiny; cap to blunt abuse
_upload_jobs: dict[str, dict] = {}
_upload_lock = threading.Lock()


def _set_job(job_id: str, **fields) -> None:
    with _upload_lock:
        _upload_jobs.setdefault(job_id, {}).update(fields)


def _get_job(job_id: str) -> dict | None:
    with _upload_lock:
        job = _upload_jobs.get(job_id)
        return dict(job) if job is not None else None


# Detection sensitivity presets for the upload form: a multiplier on the rating-aware cp curve
# (keeps its shape — stricter for stronger players — while shifting overall sensitivity).
_UPLOAD_SENSITIVITY = {"tolerant": 1.5, "standard": 1.0, "strict": 0.65}


def _config_for_upload(base: Config, choice: str) -> Config:
    """A copy of ``base`` whose error-threshold curve is scaled by the chosen sensitivity.
    Never mutates the shared app config. 'standard' returns the default curve unchanged."""
    factor = _UPLOAD_SENSITIVITY.get(choice, 1.0)
    if factor == 1.0:
        return base
    scaled = {b: max(15, int(round(cp * factor / 5)) * 5)
              for b, cp in base.thresholds.error_threshold_cp.items()}
    return replace(base, thresholds=replace(base.thresholds, error_threshold_cp=scaled))


def _run_upload_job(job_id: str, pgn_path: Path, name: str, account_id: int,
                    config: Config) -> None:
    """Runs in a background thread with its OWN connection (SQLite isn't shared threads)."""
    conn = None
    try:
        conn = db.connect(config.db_path)
        db.init_db(conn)
        res = pipeline.analyze_chapter(
            conn, config, pgn_path, name, account_id=account_id,
            on_progress=lambda m: _set_job(job_id, message=m),
        )
        done = (f"« {res.chapter_name} » : {res.positions} positions, "
                f"{res.errors} erreur(s) détectée(s).")
        if res.deepen_error:
            # The analysis is complete and usable; only the chained refutation is missing.
            done += (" Les lignes de réfutation n'ont pas pu être calculées "
                     f"({res.deepen_error}) — relance `oa.py deepen`.")
        _set_job(job_id, status="done", chapter_id=res.chapter_id, message=done)
    except Exception as exc:                       # noqa: BLE001 - surface any failure to the UI
        traceback.print_exc()
        _set_job(job_id, status="error", message=f"Échec de l'analyse : {exc}")
    finally:
        if conn is not None:
            conn.close()


def create_app(config: Config) -> Flask:
    app = Flask(__name__)
    # Sessions need a key. Use the configured one; else an ephemeral key (fine for a local
    # single-user run, but a hosted deployment MUST set a stable OA_SECRET_KEY).
    app.secret_key = config.secret_key or secrets.token_hex(32)
    if config.require_login and not config.secret_key:
        print("WARNING: OA_REQUIRE_LOGIN is on but OA_SECRET_KEY is unset — sessions will "
              "not survive a restart. Set OA_SECRET_KEY for a real deployment.")

    # Session-cookie hardening. HttpOnly (no JS access) + SameSite=Lax (blunts CSRF on
    # top-level navigations) are always safe. Secure (HTTPS-only) is gated on config so a
    # local plaintext-HTTP run still receives its cookie. See docs/HOSTING.md.
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=config.secure_cookies,
        MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,   # reject oversized PGN uploads early
    )

    # Figurine notation in every rendered move / line (display only).
    app.jinja_env.filters["fig"] = figurine
    # French label for puzzle / flashcard type pills (keeps the raw value for the CSS class).
    app.jinja_env.filters["typefr"] = type_fr
    # FIDE equivalent of a Lichess bucket (the Explorer buckets are Lichess ratings, ~+250).
    app.jinja_env.filters["fide"] = fide_equiv
    # French digit grouping (narrow no-break space): 1105 → « 1 105 », like the stats tables.
    app.jinja_env.filters["grp"] = lambda n: f"{n:,}".replace(",", " ")

    # Behind a reverse proxy, request.remote_addr is the proxy's IP — the login rate-limiter
    # would then throttle all clients as one. ProxyFix reads the real client IP from the last
    # OA_TRUST_PROXY entries of X-Forwarded-For. Only enable when a proxy is actually present:
    # trusting XFF on a directly-exposed app lets any caller spoof its IP.
    if config.trust_proxy > 0:
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=config.trust_proxy)

    def conn() -> sqlite3.Connection:
        if "db" not in g:
            g.db = db.connect(config.db_path)
        return g.db

    @app.teardown_appcontext
    def _close_conn(_exc):
        c = g.pop("db", None)
        if c is not None:
            c.close()

    # Ensure the schema exists and is current (creates the DB on a fresh deploy). Idempotent.
    config.db_path.parent.mkdir(parents=True, exist_ok=True)
    boot = db.connect(config.db_path)
    db.init_db(boot)
    boot.close()

    def current_account_id(c: sqlite3.Connection) -> int:
        """The account whose owned data (chapters, personal games, decks, students) this
        request may touch. Logged in → that account; local mode → the implicit local account.
        Sessions predating Stage 1 store only ``user`` — resolve their id by username."""
        if config.require_login:
            acct_id = session.get("account_id")
            if acct_id is None:
                account = db.get_account(c, session.get("user", ""))
                acct_id = int(account["id"]) if account else db.ensure_local_account(c)
                session["account_id"] = acct_id
            return int(acct_id)
        return db.ensure_local_account(c)   # db.LOCAL_ACCOUNT — same source as migration/CLI

    def owned_chapter_or_404(c: sqlite3.Connection, cid: int) -> sqlite3.Row:
        ch = db.get_chapter(c, cid, current_account_id(c))
        if ch is None:
            abort(404)
        return ch

    def _reflen() -> int:
        """Refutation-length cap for this request: ?reflen= (clamped 1..5), else the config default."""
        n = request.args.get("reflen", type=int)
        if n is None:
            return config.refutation_max_quizzes
        return max(1, min(5, n))

    @app.context_processor
    def _inject_user():
        return {"current_user": session.get("user"), "show_login": config.require_login,
                "csrf_token": session.get("_csrf", "")}

    # --- CSRF protection (hosted mode only) --------------------------------
    # A per-session token, required on every state-changing request when login is on.
    # Local single-user mode (require_login off) is exempt — it has no authenticated
    # session to protect and must stay byte-for-byte unchanged.
    _UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

    @app.before_request
    def _csrf_protect():
        if "_csrf" not in session:
            session["_csrf"] = secrets.token_hex(32)
        if not config.require_login or request.method not in _UNSAFE_METHODS:
            return None
        if request.endpoint == "static":
            return None
        sent = request.form.get("_csrf") or request.headers.get("X-CSRF-Token", "")
        if not sent or not hmac.compare_digest(sent, session["_csrf"]):
            abort(400)

    _PUBLIC = {"login", "register", "static"}

    @app.before_request
    def _require_login():
        if not config.require_login or session.get("user"):
            return None
        if request.endpoint in _PUBLIC:
            return None
        return redirect("/login")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "GET":
            return render_template_string(REGISTER_TMPL, title="Créer un compte", error=None)
        try:
            auth.create_account(conn(), request.form.get("username", ""),
                                request.form.get("password", ""),
                                request.form.get("email") or None)
        except (ValueError, auth.AccountExists) as exc:
            return render_template_string(REGISTER_TMPL, title="Créer un compte", error=str(exc))
        username = request.form.get("username", "").strip().lower()
        session["user"] = username
        account = db.get_account(conn(), username)
        session["account_id"] = int(account["id"]) if account else None
        return redirect("/")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "GET":
            return render_template_string(LOGIN_TMPL, title="Connexion", error=None)
        ip = request.remote_addr or "?"
        if _recent_failures(ip) >= LOGIN_MAX_FAILURES:
            return render_template_string(
                LOGIN_TMPL, title="Connexion",
                error="Trop de tentatives. Attends quelques minutes et réessaie."), 429
        account = auth.authenticate(conn(), request.form.get("username", ""),
                                    request.form.get("password", ""))
        if account is None:
            _record_login_failure(ip)
            return render_template_string(LOGIN_TMPL, title="Connexion",
                                          error="Identifiant ou mot de passe invalide.")
        session["user"] = account["username"]
        session["account_id"] = int(account["id"])
        return redirect("/")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.pop("user", None)
        session.pop("account_id", None)
        return redirect("/login" if config.require_login else "/")

    @app.route("/upload", methods=["GET", "POST"])
    def upload():
        if request.method == "GET":
            return render_template_string(UPLOAD_TMPL, title="Analyser un chapitre", error=None)
        name = (request.form.get("name") or "").strip()
        file = request.files.get("pgn")

        def again(msg):
            return render_template_string(UPLOAD_TMPL, title="Analyser un chapitre", error=msg)
        if not name:
            return again("Donne un nom au chapitre.")
        if file is None or not file.filename:
            return again("Choisis un fichier PGN.")
        if not file.filename.lower().endswith(".pgn"):
            return again("Le fichier doit être un .pgn.")

        acct = current_account_id(conn())          # resolve in the request thread
        uploads = config.db_path.parent / "uploads"
        uploads.mkdir(parents=True, exist_ok=True)
        job_id = uuid.uuid4().hex
        pgn_path = uploads / f"{job_id}.pgn"
        file.save(str(pgn_path))

        job_config = _config_for_upload(config, request.form.get("sensitivity", "standard"))
        _set_job(job_id, status="running", message="Démarrage…", chapter_id=None)
        threading.Thread(
            target=_run_upload_job, args=(job_id, pgn_path, name, acct, job_config),
            daemon=True,
        ).start()
        return redirect(f"/upload/{job_id}")

    @app.route("/upload/<job_id>")
    def upload_status(job_id: str):
        if _get_job(job_id) is None:
            abort(404)
        return render_template_string(UPLOAD_STATUS_TMPL, title="Analyse en cours",
                                      job_id=job_id)

    @app.route("/api/upload/<job_id>")
    def api_upload_status(job_id: str):
        job = _get_job(job_id)
        if job is None:
            abort(404)
        return jsonify({"status": job.get("status"), "message": job.get("message"),
                        "chapter_id": job.get("chapter_id")})

    @app.route("/")
    def index():
        c = conn()
        acct = current_account_id(c)
        rows = c.execute(
            "SELECT ch.id, ch.name, "
            "COUNT(DISTINCT e.position_id) AS decisions, COUNT(e.id) AS errors, "
            "(SELECT COUNT(*) FROM sr_cards sc WHERE sc.chapter_id = ch.id "
            " AND sc.due_date IS NOT NULL AND sc.due_date <= ?) AS due "
            "FROM chapters ch LEFT JOIN errors e ON e.chapter_id = ch.id "
            "WHERE ch.account_id = ? "
            "GROUP BY ch.id ORDER BY ch.name",
            (db.today_iso(), acct),
        ).fetchall()
        # The home CTA resumes the chapter with the most cards due today (deterministic).
        resume = max((r for r in rows if r["due"]), key=lambda r: r["due"], default=None)
        users = db.users_with_personal_errors(c, acct)
        # positions/errors are the shared analysis cache (the moat) — reported globally;
        # chapters and students are this account's owned data.
        stats = {
            "chapters": len(rows),
            "positions": c.execute("SELECT COUNT(*) FROM positions").fetchone()[0],
            "errors": c.execute("SELECT COUNT(*) FROM errors").fetchone()[0],
            "due": c.execute(
                "SELECT COUNT(*) FROM sr_cards sc JOIN chapters ch ON ch.id = sc.chapter_id "
                "WHERE ch.account_id = ? AND sc.due_date IS NOT NULL AND sc.due_date <= ?",
                (acct, db.today_iso())).fetchone()[0],
            "students": len(users),
        }
        return render_template_string(INDEX_TMPL, title="Opening Analytics",
                                      chapters=rows, users=users, stats=stats, resume=resume,
                                      has_history=db.account_has_reviews(c, acct))

    @app.route("/progress")
    def progress_view():
        from . import history
        c = conn()
        acct = current_account_id(c)
        bucket = request.args.get("bucket", type=int)
        # "Ma progression" = your OWN training (student_id NULL); each student has their own page.
        days = history.daily_progress(c, acct, elo_bucket=bucket, student_id=None)
        summ = history.summary(c, acct, elo_bucket=bucket, student_id=None)
        buckets = [b for (b,) in c.execute(
            "SELECT DISTINCT elo_bucket FROM review_log WHERE account_id = ? "
            "AND student_id IS NULL AND elo_bucket IS NOT NULL ORDER BY elo_bucket", (acct,))]
        rows = [{"day": d.day, "reviews": d.reviews, "recalled": d.recalled,
                 "lapsed": d.lapsed, "rate": d.recall_rate, "ms": d.median_ms} for d in days]
        return render_template_string(PROGRESS_TMPL, title="Ma progression", rows=rows,
                                      summ=summ, buckets=buckets, bucket=bucket)

    # --- Coach → student loop: roster, assignments, monitoring -------------
    @app.route("/students", methods=["GET", "POST"])
    def students_view():
        from . import history
        from .config import ELO_BUCKETS
        c = conn()
        acct = current_account_id(c)
        if request.method == "POST":
            name = (request.form.get("name") or "").strip()
            if name:
                try:
                    db.add_student(c, acct, name, request.form.get("elo_bucket", type=int))
                except sqlite3.IntegrityError:
                    pass                              # duplicate name for this coach — ignore
            return redirect("/students")
        rows = []
        for s in db.students_for_account(c, acct):
            summ = history.summary(c, acct, student_id=s["id"])
            rows.append({"id": s["id"], "name": s["name"], "bucket": s["elo_bucket"],
                         "reviews": summ.reviews, "recall": summ.recall_rate,
                         "assignments": len(db.assignments_for_student(c, s["id"]))})
        return render_template_string(STUDENTS_TMPL, title="Mes élèves", students=rows,
                                      buckets=list(ELO_BUCKETS))

    @app.route("/students/<int:sid>")
    def student_view(sid: int):
        from . import history
        from .config import ELO_BUCKETS
        c = conn()
        acct = current_account_id(c)
        s = db.get_student(c, sid, acct)
        if s is None:
            abort(404)
        summ = history.summary(c, acct, student_id=sid)
        assignments = []
        for a in db.assignments_for_student(c, sid):
            items = db.assignment_position_ids(c, a["id"])
            target = items or db.chapter_card_positions(c, a["chapter_id"])
            reviewed = db.student_reviewed_positions(c, acct, sid, a["chapter_id"]) & target
            covered, total = len(reviewed), len(target)
            assignments.append({
                "id": a["id"], "chapter_id": a["chapter_id"], "chapter_name": a["chapter_name"],
                "bucket": a["elo_bucket"], "due": a["due_date"], "note": a["note"],
                "covered": covered, "total": total, "subset": bool(items),
                "done": total > 0 and covered >= total,
                "late": bool(a["due_date"] and a["due_date"] < db.today_iso()),
            })
        blockers = [{"line": _san_line(_shortest_path_ucis(c, b["position_id"])),
                     "lapses": b["lapses"]} for b in db.student_blockers(c, acct, sid)]
        return render_template_string(STUDENT_TMPL, title=s["name"], s=s, summ=summ,
                                      assignments=assignments, blockers=blockers,
                                      chapters=db.chapters_for_account(c, acct),
                                      buckets=list(ELO_BUCKETS))

    @app.route("/students/<int:sid>/assign", methods=["POST"])
    def student_assign(sid: int):
        c = conn()
        acct = current_account_id(c)
        if db.get_student(c, sid, acct) is None:
            abort(404)
        cid = request.form.get("chapter_id", type=int)
        ch = db.get_chapter(c, cid, acct) if cid else None
        if ch is not None:
            db.add_assignment(c, {
                "account_id": acct, "student_id": sid, "chapter_id": cid,
                "elo_bucket": request.form.get("elo_bucket", type=int), "title": ch["name"],
                "note": (request.form.get("note") or "").strip() or None,
                "due_date": (request.form.get("due_date") or "").strip() or None})
        return redirect(f"/students/{sid}")

    @app.route("/students/<int:sid>/unassign", methods=["POST"])
    def student_unassign(sid: int):
        c = conn()
        acct = current_account_id(c)
        if db.get_student(c, sid, acct) is None:
            abort(404)
        aid = request.form.get("assignment_id", type=int)
        if aid:
            db.delete_assignment(c, aid, acct)
        return redirect(f"/students/{sid}")

    @app.route("/assign", methods=["GET", "POST"])
    def assign_builder():
        from .config import ELO_BUCKETS
        c = conn()
        acct = current_account_id(c)
        if request.method == "POST":
            cid = request.form.get("chapter_id", type=int)
            ch = db.get_chapter(c, cid, acct) if cid else None
            student_ids = [int(x) for x in request.form.getlist("students") if x.isdigit()]
            items = [int(x) for x in request.form.getlist("items") if x.isdigit()]
            bucket = request.form.get("elo_bucket", type=int)
            due = (request.form.get("due_date") or "").strip() or None
            note = (request.form.get("note") or "").strip() or None
            if ch is not None:
                for sid in student_ids:                    # one assignment per chosen student
                    if db.get_student(c, sid, acct) is not None:
                        db.add_assignment(c, {
                            "account_id": acct, "student_id": sid, "chapter_id": cid,
                            "elo_bucket": bucket, "title": ch["name"], "note": note,
                            "due_date": due}, items=items)
            if len(student_ids) == 1:
                return redirect(f"/students/{student_ids[0]}")
            return redirect("/students")
        cid = request.args.get("chapter", type=int)
        ch = db.get_chapter(c, cid, acct) if cid else None
        decisions = []
        if ch is not None:
            decs = sorted(export_pgn.collect_decisions(c, cid),
                          key=lambda d: d.peak, reverse=True)
            for d in decs:
                worst = max(d.mistakes.values(), key=lambda m: m.peak)
                decisions.append({"position_id": d.position_id, "line": _san_line(d.path_ucis),
                                  "peak": d.peak, "worst": worst.san})
        return render_template_string(
            ASSIGN_TMPL, title="Assigner un exercice",
            chapters=db.chapters_for_account(c, acct),
            students=db.students_for_account(c, acct), chapter=ch, cid=cid,
            decisions=decisions, buckets=list(ELO_BUCKETS),
            preselect=request.args.get("student", type=int))

    @app.route("/chapter/<int:cid>")
    def chapter(cid: int):
        c = conn()
        ch = owned_chapter_or_404(c, cid)
        minc = request.args.get("min_criticality", 0.05, type=float)
        decs = [d for d in export_pgn.collect_decisions(c, cid) if d.peak >= minc]
        decs.sort(key=lambda d: d.peak, reverse=True)
        view = []
        for d in decs:
            worst = max(d.mistakes.values(), key=lambda m: m.peak)
            view.append({
                "position_id": d.position_id, "peak": d.peak,
                "line": _san_line(d.path_ucis),
                "best": d.best_san or d.best_uci or "—",
                "worst": worst.san, "worst_type": worst.error_type,
            })
        return render_template_string(CHAPTER_TMPL, title=ch["name"], name=ch["name"],
                                      cid=cid, decisions=view, minc=minc)

    @app.route("/chapter/<int:cid>/position/<int:pid>")
    def position(cid: int, pid: int):
        c = conn()
        ch = owned_chapter_or_404(c, cid)
        dec = next((d for d in export_pgn.collect_decisions(c, cid)
                    if d.position_id == pid), None)
        if dec is None:
            abort(404)
        board = _board_at(dec.path_ucis)
        worst = max(dec.mistakes.values(), key=lambda m: m.peak)
        mistakes = []
        for m in sorted(dec.mistakes.values(), key=lambda m: m.peak, reverse=True):
            mistakes.append({
                "san": m.san, "type": m.error_type,
                "loss": fmt_loss(m.eval_loss_cp),
                "buckets": [{
                    "bucket": b["bucket"],
                    "games": f"{b['games']:,}".replace(",", " ") if b["games"] else "—",
                    "freq": f"{100 * b['freq']:.0f}%",
                    "dwr": "—" if b["dwr"] is None else f"{100 * b['dwr']:+.1f}%",
                    "crit": b["crit"],
                } for b in sorted(m.buckets, key=lambda x: x["bucket"])],
            })
        return render_template_string(
            POSITION_TMPL, title=f"Position — {ch['name']}", cid=cid, chapter_name=ch["name"],
            line=_san_line(dec.path_ucis),
            turn="blancs" if board.turn == chess.WHITE else "noirs",
            peak=dec.peak, eco=dec.eco, opening=dec.opening,
            best=dec.best_san or dec.best_uci or "—",
            fen=board.board_fen(),
            orientation="white" if board.turn == chess.WHITE else "black",
            best_uci=dec.best_uci, mistake_uci=worst.uci,
            mistakes=mistakes,
        )

    @app.route("/chapter/<int:cid>/lifetime")
    def chapter_lifetime(cid: int):
        from . import lifetime as lifetime_mod
        c = conn()
        ch = owned_chapter_or_404(c, cid)
        minc = request.args.get("min_criticality", 0.05, type=float)
        lives = [{
            "line": lf.line, "mistake": lf.mistake_san, "buckets": lf.buckets, "peak": lf.peak,
        } for lf in lifetime_mod.chapter_error_lifetimes(c, cid, min_criticality=minc)]
        from .config import ELO_BUCKETS
        return render_template_string(LIFETIME_TMPL, title=f"Durée de vie — {ch['name']}",
                                      name=ch["name"], cid=cid, lives=lives,
                                      buckets=list(ELO_BUCKETS))

    @app.route("/chapter/<int:cid>/heatmap")
    def chapter_heatmap_view(cid: int):
        from . import heatmap as heatmap_mod
        c = conn()
        ch = owned_chapter_or_404(c, cid)
        hm = heatmap_mod.chapter_heatmap(c, cid)
        rows = []
        for ply in hm.plies:
            cells = []
            for b in hm.buckets:
                crit = hm.grid.get((ply, b), 0.0)
                alpha = 0.0 if hm.max_crit <= 0 else crit / hm.max_crit
                cells.append({
                    "color": "transparent" if crit <= 0 else f"rgba(176,32,32,{alpha:.3f})",
                    "text": "" if crit <= 0 else f"{crit:.2f}",
                    "title": f"{hm.move_label(ply)} · {b}+ · criticality {crit:.3f}",
                })
            rows.append({"label": hm.move_label(ply), "cells": cells})
        return render_template_string(HEATMAP_TMPL, title=f"Carte de chaleur — {ch['name']}",
                                      name=ch["name"], cid=cid, rows=rows,
                                      buckets=hm.buckets)

    def _chapter_buckets(c: sqlite3.Connection, cid: int) -> list[int]:
        return [b for (b,) in c.execute(
            "SELECT DISTINCT elo_bucket FROM errors WHERE chapter_id = ? ORDER BY elo_bucket",
            (cid,))]

    # --- A-series analytics (A2/A3/A5/A6): views over the same base --------
    @app.route("/chapter/<int:cid>/expected")
    def chapter_expected_view(cid: int):
        from . import expected_value as ev_mod
        c = conn()
        ch = owned_chapter_or_404(c, cid)
        buckets = _chapter_buckets(c, cid)
        bucket = request.args.get("bucket", type=int)
        if bucket not in buckets:
            bucket = buckets[len(buckets) // 2] if buckets else 1600
        minc = request.args.get("min_criticality", 0.05, type=float)
        rows = [{
            "line": e.line, "mistake": e.mistake_san, "reach": e.reach_probability,
            "crit": e.peak_criticality, "ev": e.expected_value,
        } for e in ev_mod.chapter_expected_values(c, cid, bucket, min_criticality=minc)]
        return render_template_string(EXPECTED_TMPL, title=f"Valeur attendue — {ch['name']}",
                                      name=ch["name"], cid=cid, rows=rows,
                                      buckets=buckets, bucket=bucket)

    @app.route("/chapter/<int:cid>/danger")
    def chapter_danger_view(cid: int):
        from . import danger_depth as dd_mod
        c = conn()
        ch = owned_chapter_or_404(c, cid)
        minc = request.args.get("min_criticality", 0.05, type=float)
        rows = [{
            "line": d.line, "move": d.danger_move, "mistake": d.first_mistake_san,
            "peak": d.peak_criticality,
        } for d in dd_mod.chapter_danger_depths(c, cid, min_criticality=minc)]
        return render_template_string(DANGER_TMPL, title=f"Profondeur de danger — {ch['name']}",
                                      name=ch["name"], cid=cid, rows=rows)

    @app.route("/chapter/<int:cid>/retention")
    def chapter_retention_view(cid: int):
        from . import retention as ret_mod
        c = conn()
        ch = owned_chapter_or_404(c, cid)
        r = ret_mod.chapter_retention(c, cid, ch["name"])
        leeches = ret_mod.chapter_leeches(c, cid)
        return render_template_string(RETENTION_TMPL, title=f"Rétention — {ch['name']}",
                                      name=ch["name"], cid=cid, r=r, leeches=leeches)

    @app.route("/chapter/<int:cid>/confusables")
    def chapter_confusables_view(cid: int):
        from . import confusable as conf_mod
        c = conn()
        ch = owned_chapter_or_404(c, cid)
        rows = conf_mod.chapter_confusables(c, cid)
        return render_template_string(CONFUSABLE_TMPL, title=f"Positions confusables — {ch['name']}",
                                      name=ch["name"], cid=cid, rows=rows)

    @app.route("/chapter/<int:cid>/gaps")
    def chapter_gaps_view(cid: int):
        from . import gaps as gaps_mod
        c = conn()
        ch = owned_chapter_or_404(c, cid)
        # Buckets that actually have Explorer stats in this chapter (not just errors).
        buckets = [b for (b,) in c.execute(
            "SELECT DISTINCT s.elo_bucket FROM position_stats s "
            "JOIN paths pa ON pa.position_id = s.position_id "
            "WHERE pa.chapter_id = ? ORDER BY s.elo_bucket", (cid,))]
        bucket = request.args.get("bucket", type=int)
        if bucket not in buckets:
            bucket = buckets[len(buckets) // 2] if buckets else 1600
        color = request.args.get("color")
        if color not in ("w", "b"):
            color = gaps_mod.infer_repertoire_color(c, cid)
        minf = request.args.get("min_freq", 0.05, type=float)
        rows = [{
            "position_id": gp.position_id, "line": gp.line_san, "move_no": gp.move_no,
            "reply": gp.opp_move_san, "freq": gp.frequency, "games": gp.games,
        } for gp in gaps_mod.repertoire_gaps(c, cid, bucket=bucket, color=color,
                                             min_frequency=minf)]
        return render_template_string(GAPS_TMPL, title=f"Trous du répertoire — {ch['name']}",
                                      name=ch["name"], cid=cid, rows=rows, buckets=buckets,
                                      bucket=bucket, color=color, minf=minf)

    # --- Trainer -----------------------------------------------------------
    @app.route("/api/parse-move", methods=["POST"])
    def api_parse_move():
        """Typed-move helper: parse SAN (fr/en) or UCI against a FEN-4. Pure computation on
        the request payload — no card state is read or written."""
        data = request.get_json(force=True, silent=True) or {}
        fen4_str = data.get("fen4") or ""
        try:
            uci = _parse_move_text(fen4_str, data.get("text") or "")
        except (ValueError, AssertionError):
            uci = None
        return jsonify({"uci": uci})

    @app.route("/train/<int:cid>")
    def train(cid: int):
        c = conn()
        ch = owned_chapter_or_404(c, cid)
        # Sync at the requested sensitivity. sync_cards is additive (upsert per path, SR state
        # kept), so lowering the threshold just adds the newly-qualifying decision points.
        minc = request.args.get("min_criticality", 0.05, type=float)
        sr.sync_cards(c, cid, minc)
        buckets = [b for (b,) in c.execute(
            "SELECT DISTINCT elo_bucket FROM errors WHERE chapter_id = ? ORDER BY elo_bucket",
            (cid,))]
        acct = current_account_id(c)
        # Assignment mode: ?assignment=<id> pins the student, level, and (if any) subset.
        assignment = None
        aid = request.args.get("assignment", type=int)
        if aid is not None:
            assignment = db.get_assignment(c, aid, acct)
            if assignment is not None and int(assignment["chapter_id"]) != cid:
                assignment = None
        # Student mode: ?student=<id> (or derived from the assignment) attributes reviews.
        sid = request.args.get("student", type=int)
        if assignment is not None:
            sid = int(assignment["student_id"])
        student = db.get_student(c, sid, acct) if sid is not None else None
        initial_bucket = assignment["elo_bucket"] if (assignment is not None
                                                      and assignment["elo_bucket"]) else ""
        heading = f"Entraînement — {ch['name']}"
        back_url, back_label = f"/chapter/{cid}", ch["name"]
        if student is not None:
            heading = f"{student['name']} — {ch['name']}"
            back_url = f"/students/{student['id']}"
            back_label = student["name"]
        return render_template_string(
            TRAIN_TMPL, title=heading, heading=heading, back_url=back_url,
            back_label=back_label, api_base=f"/api/train/{cid}", buckets=buckets,
            student_id=(student["id"] if student is not None else ""),
            assignment_id=(assignment["id"] if assignment is not None else ""),
            initial_bucket=initial_bucket,
            reflen_default=config.refutation_max_quizzes)

    def _assignment_include(c, cid: int) -> "set[int] | None":
        """The assigned position subset for /next, from ?assignment=<id>. Returns the set of
        assigned position ids, or None (no assignment, not ours, wrong chapter, or whole
        chapter = no items). Restricts card selection to exactly what the coach assigned."""
        aid = request.args.get("assignment", type=int)
        if aid is None:
            return None
        a = db.get_assignment(c, aid, current_account_id(c))
        if a is None or int(a["chapter_id"]) != cid:
            return None
        return db.assignment_position_ids(c, aid) or None      # empty items = whole chapter

    @app.route("/api/train/<int:cid>/next")
    def api_next(cid: int):
        c = conn()
        owned_chapter_or_404(c, cid)
        if db.count_cards(c, cid) == 0:
            sr.sync_cards(c, cid)
        bucket = request.args.get("bucket", type=int)
        side = request.args.get("side")
        opp = request.args.get("opp", "punish")
        include = _assignment_include(c, cid)
        skip_main, skip_punish = _skip_ids()
        if side in ("white", "black"):
            # Une couleur choisie → deck MIXTE : tes points de décision (sr_cards) + les
            # pièges adverses UN PAR UN (punish_cards, granularité Option B) — une carte de
            # 13 pièges n'existe plus, chaque piège a sa propre note SM-2.
            if db.count_punish_cards(c, cid) == 0:
                sr.sync_punish_cards(c, cid)
            deck, card = sr.next_mixed_card(c, cid, side, bucket=bucket,
                                            exclude_main=skip_main,
                                            exclude_punish=skip_punish, include=include)
            if card is None:
                return jsonify({"done": True})
            if deck == "punish":
                payload = _punish_payload(c, card, _reflen(), oppmode=opp)
            else:
                payload = _card_payload(c, card, side, opp, _reflen())
            payload["deck"] = deck
            rm, rp = sr.remaining_mixed_cards(c, cid, side, bucket=bucket, include=include)
            payload["remaining"] = rm + rp
            payload["remaining_main"] = rm       # tes coups
            payload["remaining_punish"] = rp     # contres — le compteur affiche le partage
            return jsonify(payload)
        card = sr.next_card(c, cid, bucket=bucket, exclude=skip_main, include=include)
        if card is None:
            return jsonify({"done": True})
        payload = _card_payload(c, card, side, opp, _reflen())
        payload["deck"] = "main"
        payload["remaining"] = sr.remaining_cards(c, cid, bucket=bucket, include=include)
        return jsonify(payload)

    def _main_deck_card(c, cid: int, data: dict) -> tuple[sqlite3.Row, str]:
        """Resolve a graded/checked card of the mixed main deck: ``deck`` in the payload says
        which table the id lives in (sr_cards vs punish_cards — their ids collide)."""
        if data.get("deck") == "punish":
            pc = db.get_punish_card(c, int(data.get("card_id", 0)))
            if pc is None or int(pc["chapter_id"]) != cid:
                abort(404)
            return pc, "punish"
        card = db.get_card(c, int(data.get("card_id", 0)))
        if card is None or int(card["chapter_id"]) != cid:
            abort(404)
        return card, "main"

    @app.route("/api/train/<int:cid>/check", methods=["POST"])
    def api_check(cid: int):
        c = conn()
        owned_chapter_or_404(c, cid)
        data = request.get_json(force=True, silent=True) or {}
        card, _deck = _main_deck_card(c, cid, data)
        if data.get("answer_uci") and data.get("fen4"):      # refutation followup (no cached pos)
            return jsonify(_freeform_check_payload(data["fen4"], data["answer_uci"], data.get("uci")))
        # quiz_position_id points at the punishment position for "punish" cards; else the card's.
        quiz_pid = int(data.get("quiz_position_id") or card["position_id"])
        return jsonify(_position_check_payload(c, quiz_pid, data.get("uci"),
                                               bucket=_bucket_of(data)))

    @app.route("/api/train/<int:cid>/grade", methods=["POST"])
    def api_grade(cid: int):
        c = conn()
        owned_chapter_or_404(c, cid)
        data = request.get_json(force=True, silent=True) or {}
        card, deck = _main_deck_card(c, cid, data)
        return _grade(c, sr.grade_punish if deck == "punish" else sr.grade, card,
                      deck=deck, account_id=current_account_id(c))

    @app.route("/api/train/<int:cid>/grade-undo", methods=["POST"])
    def api_grade_undo(cid: int):
        c = conn()
        owned_chapter_or_404(c, cid)
        data = request.get_json(force=True, silent=True) or {}
        card, deck = _main_deck_card(c, cid, data)
        return _grade_undo(c, "punish_cards" if deck == "punish" else "sr_cards",
                           int(card["id"]), deck=deck, account_id=current_account_id(c))

    # --- Option B: per-mistake punish deck (each opponent trap scheduled on its own) ---
    @app.route("/train/<int:cid>/punish")
    def train_punish(cid: int):
        c = conn()
        chapter = owned_chapter_or_404(c, cid)
        if db.count_punish_cards(c, cid) == 0:
            sr.sync_punish_cards(c, cid)
        return render_template_string(
            TRAIN_TMPL, title=f"Contres — {chapter['name']}",
            heading=f"Contres — {chapter['name']}", back_url=f"/chapter/{cid}",
            back_label=chapter["name"], api_base=f"/api/train/{cid}/punish",
            buckets=_chapter_buckets(c, cid), punish_deck=True,
            reflen_default=config.refutation_max_quizzes)

    @app.route("/api/train/<int:cid>/punish/next")
    def api_punish_next(cid: int):
        c = conn()
        owned_chapter_or_404(c, cid)
        if db.count_punish_cards(c, cid) == 0:
            sr.sync_punish_cards(c, cid)
        side = request.args.get("side")
        if side not in ("white", "black"):
            return jsonify({"done": True, "message": "Choisis ta couleur pour contrer l'adversaire."})
        bucket = request.args.get("bucket", type=int)
        include = _assignment_include(c, cid)
        skip_main, skip_punish = _skip_ids()
        pc = sr.next_punish_card(c, cid, side, bucket=bucket,
                                 exclude=skip_main + skip_punish, include=include)
        if pc is None:
            return jsonify({"done": True})
        payload = _punish_payload(c, pc, _reflen())
        payload["deck"] = "punish"
        payload["remaining"] = sr.remaining_punish_cards(c, cid, side, bucket=bucket,
                                                         include=include)
        return jsonify(payload)

    @app.route("/api/train/<int:cid>/punish/check", methods=["POST"])
    def api_punish_check(cid: int):
        c = conn()
        owned_chapter_or_404(c, cid)
        data = request.get_json(force=True, silent=True) or {}
        pc = db.get_punish_card(c, int(data.get("card_id", 0)))
        if pc is None or int(pc["chapter_id"]) != cid:
            abort(404)
        if data.get("answer_uci") and data.get("fen4"):
            return jsonify(_freeform_check_payload(data["fen4"], data["answer_uci"], data.get("uci")))
        quiz_pid = int(data.get("quiz_position_id") or pc["position_id"])
        return jsonify(_position_check_payload(c, quiz_pid, data.get("uci"),
                                               bucket=_bucket_of(data)))

    @app.route("/api/train/<int:cid>/punish/grade", methods=["POST"])
    def api_punish_grade(cid: int):
        c = conn()
        owned_chapter_or_404(c, cid)
        data = request.get_json(force=True, silent=True) or {}
        pc = db.get_punish_card(c, int(data.get("card_id", 0)))
        if pc is None or int(pc["chapter_id"]) != cid:
            abort(404)
        return _grade(c, sr.grade_punish, pc, deck="punish", account_id=current_account_id(c))

    @app.route("/api/train/<int:cid>/punish/grade-undo", methods=["POST"])
    def api_punish_grade_undo(cid: int):
        c = conn()
        owned_chapter_or_404(c, cid)
        data = request.get_json(force=True, silent=True) or {}
        pc = db.get_punish_card(c, int(data.get("card_id", 0)))
        if pc is None or int(pc["chapter_id"]) != cid:
            abort(404)
        return _grade_undo(c, "punish_cards", int(pc["id"]),
                           deck="punish", account_id=current_account_id(c))

    # --- Personal deck: train on YOUR errors (M12/M13) ---------------------
    @app.route("/personal/<username>")
    def personal_view(username: str):
        c = conn()
        acct = current_account_id(c)
        rows = db.personal_errors_for_user(c, username, acct)
        errors = [{
            "line": _san_line(_shortest_path_ucis(c, r["position_id"])),
            "played": r["played_san"] or r["played_uci"],
            "best": r["best_move_san"] or r["best_move_uci"] or "—",
            "loss": fmt_loss(r["eval_loss_cp"]),
            "bucket": r["elo_bucket"], "type": r["error_type"],
            "crit": r["criticality"] or 0.0,
        } for r in rows]
        priorities = [{
            "line": _san_line(_shortest_path_ucis(c, p["position_id"])),
            "priority": p["priority"], "seen": p["occurrences"],
            "loss": fmt_loss(p["eval_loss_cp"]),
            "idle": p["days_since_review"],
        } for p in personal.ranked_priorities(c, username, account_id=acct)[:8]]
        progress = personal.progress(c, username, account_id=acct)
        deviations = [{
            "line": _san_line(_shortest_path_ucis(c, d["position_id"])),
            "played": d["played_san"] or d["played_uci"],
            "best": d["best_move_san"] or "—",
            "loss": fmt_loss(d["eval_loss_cp"]),
            "costly": bool(d["costly"]),
        } for d in personal.deviations(c, username, account_id=acct)[:12]]
        return render_template_string(PERSONAL_TMPL, title=f"{username} — erreurs",
                                      username=username, errors=errors,
                                      priorities=priorities, progress=progress,
                                      deviations=deviations)

    @app.route("/personal/<username>/train")
    def personal_train(username: str):
        c = conn()
        acct = current_account_id(c)
        if db.count_personal_cards(c, username, acct) == 0:
            sr.sync_personal_cards(c, username, acct)
        return render_template_string(
            TRAIN_TMPL, title=f"Entraînement — {username}",
            heading=f"Entraîne tes erreurs — {username}", back_url=f"/personal/{username}",
            back_label=username, api_base=f"/api/ptrain/{username}", buckets=[],
            reflen_default=config.refutation_max_quizzes)

    @app.route("/api/ptrain/<username>/next")
    def api_pnext(username: str):
        c = conn()
        acct = current_account_id(c)
        if db.count_personal_cards(c, username, acct) == 0:
            sr.sync_personal_cards(c, username, acct)
        card = sr.next_personal_card(c, username, acct, exclude=_skip_ids()[0])
        if card is None:
            return jsonify({"done": True})
        payload = _card_payload(c, card, request.args.get("side"),
                                request.args.get("opp", "punish"), _reflen())
        payload["deck"] = "main"
        payload["remaining"] = sr.remaining_personal_cards(c, username, acct)
        return jsonify(payload)

    @app.route("/api/ptrain/<username>/check", methods=["POST"])
    def api_pcheck(username: str):
        c = conn()
        acct = current_account_id(c)
        data = request.get_json(force=True, silent=True) or {}
        card = db.get_personal_card(c, int(data.get("card_id", 0)))
        if card is None or int(card["account_id"]) != acct:
            abort(404)
        if data.get("answer_uci") and data.get("fen4"):      # refutation followup (no cached pos)
            return jsonify(_freeform_check_payload(data["fen4"], data["answer_uci"], data.get("uci")))
        quiz_pid = int(data.get("quiz_position_id") or card["position_id"])
        return jsonify(_position_check_payload(c, quiz_pid, data.get("uci"),
                                               bucket=_bucket_of(data)))

    @app.route("/api/ptrain/<username>/grade", methods=["POST"])
    def api_pgrade(username: str):
        c = conn()
        acct = current_account_id(c)
        data = request.get_json(force=True, silent=True) or {}
        card = db.get_personal_card(c, int(data.get("card_id", 0)))
        if card is None or int(card["account_id"]) != acct:
            abort(404)
        return _grade(c, sr.grade_personal, card, deck="personal",
                      account_id=acct, username=username)

    @app.route("/api/ptrain/<username>/grade-undo", methods=["POST"])
    def api_pgrade_undo(username: str):
        c = conn()
        acct = current_account_id(c)
        data = request.get_json(force=True, silent=True) or {}
        card = db.get_personal_card(c, int(data.get("card_id", 0)))
        if card is None or int(card["account_id"]) != acct:
            abort(404)
        return _grade_undo(c, "personal_cards", int(card["id"]),
                           deck="personal", account_id=acct)

    return app


_GRADE_FROM_QUALITY = {0: "again", 1: "again", 2: "hard", 3: "hard", 4: "good", 5: "easy"}


def _log_review(c, card, deck, account_id, username, data, grade_str, quality):
    """Append this review to the history journal (P4). Best-effort context: chapter/mode/
    position are read from the card if present (personal_cards carry no chapter_id)."""
    keys = set(card.keys())
    if grade_str not in ("again", "hard", "good", "easy"):
        grade_str = _GRADE_FROM_QUALITY.get(quality, "good")
    rms = data.get("response_ms")
    try:
        rms = int(rms) if rms not in (None, "") else None
    except (TypeError, ValueError):
        rms = None
    if rms is not None:
        rms = max(0, min(rms, 3_600_000))          # clamp to [0, 1h] — guard against garbage
    student_id = None                              # attribute to a student iff the id is theirs
    sid = data.get("student_id")
    if sid not in (None, ""):
        try:
            sid = int(sid)
        except (TypeError, ValueError):
            sid = None
        if sid and db.get_student(c, sid, account_id) is not None:
            student_id = sid
    db.log_review(c, {
        "account_id": account_id, "student_id": student_id, "deck": deck,
        "chapter_id": card["chapter_id"] if "chapter_id" in keys else None,
        "username": username,
        "card_id": int(card["id"]),
        "position_id": card["position_id"] if "position_id" in keys else None,
        "elo_bucket": _bucket_of(data),
        "mode": card["mode"] if "mode" in keys else None,
        "grade": grade_str, "quality": quality,
        "response_ms": rms, "reviewed_at": db.now_iso(),
    })


def _grade(c: sqlite3.Connection, grade_fn, card: sqlite3.Row | None = None, *,
           deck: str | None = None, account_id: int | None = None,
           username: str | None = None):
    data = request.get_json(force=True, silent=True) or {}
    card_id = data.get("card_id")
    if card_id is None:
        abort(400)
    # Snapshot of the SM-2 state BEFORE the review: returned to the client so an
    # accidental note (« Trouvé » réflexe) can be taken back via /grade-undo.
    prev = None
    if card is not None:
        prev = {k: card[k] for k in
                ("ease", "interval_days", "reps", "lapses", "due_date", "last_review")}
    grade_str = str(data.get("grade") or "").strip().lower()
    quality = sr.QUALITY.get(grade_str, int(data.get("quality", 4)))
    try:
        due_in = grade_fn(c, int(card_id), quality)
    except ValueError:
        abort(404)
    if card is not None and account_id is not None and deck is not None:
        _log_review(c, card, deck, account_id, username, data, grade_str, quality)
    return jsonify({"ok": True, "due_in_days": due_in, "prev": prev})


def _grade_undo(c: sqlite3.Connection, table: str, card_id: int, *,
                deck: str | None = None, account_id: int | None = None):
    """Restore a card's pre-review SM-2 snapshot (sent back by /grade as ``prev``).
    The trainer is single-user on its own cards, so trusting the echoed snapshot is
    acceptable — same trust model as ``answer_uci`` in the followup check. The matching
    journal row is removed too, so an undone note leaves no ghost in the history (P4)."""
    prev = (request.get_json(force=True, silent=True) or {}).get("prev") or {}
    try:
        db.restore_card_sr(
            c, table, card_id,
            ease=float(prev["ease"]), interval_days=int(prev["interval_days"]),
            reps=int(prev["reps"]), lapses=int(prev["lapses"]),
            due_date=prev.get("due_date"), last_review=prev.get("last_review"),
        )
    except (KeyError, TypeError, ValueError):
        abort(400)
    if deck is not None and account_id is not None:
        db.delete_last_review(c, account_id, deck, card_id)
    return jsonify({"ok": True})


def _bucket_of(data: dict) -> int | None:
    """The trainer's current Elo filter, echoed in the /check payload — feeds the
    rating-aware side-note of the verdict (« à ce niveau »)."""
    b = data.get("bucket")
    try:
        return int(b) if b not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _skip_ids() -> tuple[tuple[int, ...], tuple[int, ...]]:
    """Card ids passed this session (?skip=12,p34) — excluded from /next, still due.
    Returns ``(main_ids, punish_ids)``: a ``p`` prefix marks a punish-deck card (the mixed
    main deck serves both tables, whose ids collide)."""
    main: list[int] = []
    punish: list[int] = []
    for x in request.args.get("skip", "").split(","):
        x = x.strip()
        if x.isdigit():
            main.append(int(x))
        elif x[:1] == "p" and x[1:].isdigit():
            punish.append(int(x[1:]))
    return tuple(main), tuple(punish)


def _shortest_path_ucis(conn_: sqlite3.Connection, position_id: int) -> list[str]:
    row = conn_.execute(
        "SELECT move_sequence FROM paths WHERE position_id = ? ORDER BY ply ASC LIMIT 1",
        (position_id,),
    ).fetchone()
    return row["move_sequence"].split() if row and row["move_sequence"] else []


def _card_line_ucis(conn_: sqlite3.Connection, card: sqlite3.Row) -> list[str]:
    """The concrete line of a per-path card (D15); falls back to the shortest path."""
    path_id = card["path_id"] if "path_id" in card.keys() else None
    if path_id is not None:
        row = conn_.execute(
            "SELECT move_sequence FROM paths WHERE id = ?", (path_id,)
        ).fetchone()
        if row and row["move_sequence"]:
            return row["move_sequence"].split()
    return _shortest_path_ucis(conn_, card["position_id"])


def _drill(
    conn_, position_id: int, mode: str, card_id: int, line_ucis: list[str] | None = None,
    *, opp_san: str | None = None, opp_uci: str | None = None
) -> dict:
    """One trainable board: the position to show + quiz. A card carries a list of these (one
    per opponent mistake for a punish/review card, else a single drill)."""
    row = db.get_position(conn_, position_id)
    if row is None:
        abort(404)
    board = chess.Board(_ensure_full_fen(row["fen4"]))
    dests: dict[str, list[str]] = {}
    for mv in board.legal_moves:
        dests.setdefault(chess.square_name(mv.from_square), []).append(
            chess.square_name(mv.to_square))
    turn = "white" if board.turn == chess.WHITE else "black"
    if line_ucis is None:
        line_ucis = _shortest_path_ucis(conn_, position_id)
    return {
        "card_id": card_id, "position_id": position_id,
        # The board / best move to quiz. Equals position_id normally; for a "punish" card it is
        # the position AFTER the opponent's mistake, so /check scores against the punishment.
        "quiz_position_id": position_id, "mode": mode,
        "fen": board.board_fen(), "fen4": row["fen4"],   # fen4: for typed-move SAN parsing
        "orientation": turn, "turn": turn,
        "dests": dests, "line": figurine(_san_line(line_ucis)),
        "opp_san": opp_san,   # the opponent mistake just played (punish/review), else None
        "opp_uci": opp_uci,   # same move in UCI — the board highlights it as lastMove
    }


def _legal_dests(board: chess.Board) -> dict[str, list[str]]:
    dests: dict[str, list[str]] = {}
    for mv in board.legal_moves:
        dests.setdefault(chess.square_name(mv.from_square), []).append(
            chess.square_name(mv.to_square))
    return dests


def _replay_push(board: chess.Board, uci: str) -> str | None:
    """Push a UCI move, tolerating king-to-rook castling (cloud form). Returns the standard UCI."""
    try:
        board.push_uci(uci)
        return uci
    except (ValueError, AssertionError):
        std = _to_standard_uci(fen4(board), uci)
        try:
            board.push_uci(std)
            return std
        except (ValueError, AssertionError):
            return None


def _is_forcing(board: chess.Board, move: chess.Move) -> bool:
    """A forcing move — a capture, a check, or a promotion — from ``board``. This is the
    "forcing-moves" proxy for whether a refutation is still live (Option A). (A later Option B
    would instead measure how far ahead the best move is — needs multi-PV at deepen time.)"""
    try:
        return board.is_capture(move) or move.promotion is not None or board.gives_check(move)
    except (ValueError, AssertionError):
        return False


def _refutation_followups(start_row: sqlite3.Row, max_quizzes: int = 3) -> list[dict]:
    """Chain the refutation after the punishment, from the position's stored PV — stopping as
    soon as the line goes quiet (Option A) or after ``max_quizzes`` player moves (the cap).

    ``start_row`` is the position after the opponent's mistake (player to move); its ``best_pv``
    is the engine's line ``[punishment, reply, answer, reply, answer, …]``. A followup is kept only
    while the pair (opponent reply, player answer) is still forcing — a capture, check, or
    promotion — so tactical traps chain through the combination while positional ones stop at the
    single punishment. Empty when there is no stored PV (run `deepen` to fill PVs)."""
    pv_col = start_row["best_pv"] if "best_pv" in start_row.keys() else None
    pv = pv_col.split() if pv_col else []
    if len(pv) < 3:            # need at least punishment + reply + one answer
        return []
    board = chess.Board(_ensure_full_fen(start_row["fen4"]))
    if _replay_push(board, pv[0]) is None:      # play the punishment (already quizzed at step 0)
        return []
    followups: list[dict] = []
    for q in range(max_quizzes):
        ri, qi = 2 * q + 1, 2 * q + 2            # opponent reply, then the player's answer
        if qi >= len(pv):
            break
        opp_std = _to_standard_uci(fen4(board), pv[ri])
        try:
            opp_move = chess.Move.from_uci(opp_std)
            opp_san = figurine(board.san(opp_move))
        except (ValueError, AssertionError):
            break
        opp_forcing = _is_forcing(board, opp_move)      # measured before the reply is played
        reply = _replay_push(board, pv[ri])      # opponent's forced reply -> player to move
        if reply is None:
            break
        answer = _to_standard_uci(fen4(board), pv[qi])
        answer_move = chess.Move.from_uci(answer)
        if answer_move not in board.legal_moves:
            break
        if not (opp_forcing or _is_forcing(board, answer_move)):
            break                                # the line went quiet — the refutation is over
        followups.append({
            "fen": board.board_fen(),
            "fen4": fen4(board),           # full 4-field, for freeform /check scoring
            "dests": _legal_dests(board),
            "orientation": "white" if board.turn == chess.WHITE else "black",
            "turn": "white" if board.turn == chess.WHITE else "black",
            "opp_uci": reply,
            "opp_san": opp_san,
            "answer_uci": answer,          # the expected move; freeform /check scores against it
        })
        if _replay_push(board, answer) is None:  # advance for the next followup
            break
    return followups


def _card_payload(conn_, card: sqlite3.Row, side: str | None, oppmode: str,
                  max_quizzes: int = 3) -> dict:
    """Build the next card as ``{card_id, drills:[...]}``. If the player plays ``side`` and the
    OPPONENT is to move at this decision point, one drill is produced per opponent mistake (most
    critical first): each plays the mistake and quizzes the punishment ('punish') or reveals it
    ('review'). Otherwise a single normal drill on the decision point itself."""
    pid = card["position_id"]
    base_line = _card_line_ucis(conn_, card)
    pos = db.get_position(conn_, pid)
    my = "w" if side == "white" else "b" if side == "black" else None
    drills: list[dict] = []
    if pos is not None and my is not None and side_to_move(pos["fen4"]) != my:
        mode = "review" if oppmode == "review" else "punish"
        mistakes = conn_.execute(
            "SELECT mistake_move_uci, mistake_move_san, MAX(criticality) AS crit "
            "FROM errors WHERE position_id = ? GROUP BY mistake_move_uci "
            "ORDER BY crit DESC NULLS LAST", (pid,)).fetchall()
        for m in mistakes:
            if not m["mistake_move_uci"]:
                continue
            try:
                board = chess.Board(_ensure_full_fen(pos["fen4"]))
                board.push_uci(m["mistake_move_uci"])
                child = db.get_position_by_fen(conn_, fen4(board))
            except (ValueError, AssertionError):
                child = None
            if child is not None and child["best_move_uci"]:
                drill = _drill(
                    conn_, int(child["id"]), mode, card["id"],
                    base_line + [m["mistake_move_uci"]],
                    opp_san=figurine(m["mistake_move_san"]),
                    opp_uci=m["mistake_move_uci"])
                if mode == "punish":
                    # Chain the refutation while it stays forcing, up to the cap (D15).
                    drill["followups"] = _refutation_followups(child, max_quizzes)
                drills.append(drill)
    if not drills:
        drills = [_drill(conn_, pid, card["mode"], card["id"], base_line)]
    return {"card_id": card["id"], "drills": drills, "count": len(drills)}


def _punish_payload(conn_, pc: sqlite3.Row, max_quizzes: int = 3, *,
                    oppmode: str = "punish") -> dict:
    """Build the drill for one punish-deck card (a single opponent trap): play the mistake,
    quiz the punishment ('punish') or reveal it ('review'), then chain the refutation.
    Shape matches ``_card_payload``."""
    pos = db.get_position(conn_, pc["position_id"])
    base_line = _shortest_path_ucis(conn_, pc["position_id"])
    if pc["path_id"] is not None:
        row = conn_.execute("SELECT move_sequence FROM paths WHERE id = ?", (pc["path_id"],)).fetchone()
        if row and row["move_sequence"]:
            base_line = row["move_sequence"].split()
    child = None
    if pos is not None:
        try:
            board = chess.Board(_ensure_full_fen(pos["fen4"]))
            board.push_uci(pc["mistake_uci"])
            child = db.get_position_by_fen(conn_, fen4(board))
        except (ValueError, AssertionError):
            child = None
    if child is None or not child["best_move_uci"]:
        return {"card_id": pc["id"], "drills": [], "count": 0}
    mis_san = conn_.execute(
        "SELECT mistake_move_san FROM errors WHERE position_id = ? AND mistake_move_uci = ? LIMIT 1",
        (pc["position_id"], pc["mistake_uci"])).fetchone()
    mode = "review" if oppmode == "review" else "punish"
    drill = _drill(conn_, int(child["id"]), mode, pc["id"],
                   base_line + [pc["mistake_uci"]],
                   opp_san=figurine(mis_san["mistake_move_san"] if mis_san else pc["mistake_uci"]),
                   opp_uci=pc["mistake_uci"])
    if mode == "punish":
        drill["followups"] = _refutation_followups(child, max_quizzes)
    return {"card_id": pc["id"], "drills": [drill], "count": 1}


# French SAN piece letters → English (R=Roi/K, D=Dame/Q, T=Tour/R, F=Fou/B, C=Cavalier/N).
# Uppercase only: files stay lowercase, so "Cc3" → "Nc3" without touching the "c" file.
_FR2EN = str.maketrans({"R": "K", "D": "Q", "T": "R", "F": "B", "C": "N"})


def _parse_move_text(fen4_str: str, text: str) -> str | None:
    """Parse a typed move against a position: UCI ("g1f3"), then French SAN ("Cf3", "Fxc3"),
    then English SAN ("Nf3"). French is tried before English because the UI is French and the
    two alphabets collide ("R" = roi in French but rook in English). Returns standard UCI."""
    board = chess.Board(_ensure_full_fen(fen4_str))
    t = (text or "").strip()
    if not t:
        return None
    try:
        return board.parse_uci(t.lower()).uci()
    except (ValueError, AssertionError):
        pass
    for candidate in (t.translate(_FR2EN), t):
        try:
            return board.parse_san(candidate).uci()
        except (ValueError, AssertionError):
            continue
    return None


def _to_standard_uci(fen4_str: str, uci: str | None) -> str | None:
    """Normalise a UCI move to standard notation. Castling in particular comes from cloud-eval
    as king-to-rook (e1a1 / e1h1, UCI_Chess960); the trainer's drag produces standard e1c1 /
    e1g1, so they must be compared in the same form. Returns the input unchanged if unparseable."""
    if not uci:
        return uci
    full = _ensure_full_fen(fen4_str)
    for chess960 in (False, True):
        try:
            b = chess.Board(full, chess960=chess960)
            return chess.Board(full).parse_san(b.san(b.parse_uci(uci))).uci()
        except (ValueError, AssertionError, KeyError):
            continue
    return uci


def _freeform_check_payload(fen4_str: str, answer_uci: str, played_uci: str | None) -> dict:
    """Score a refutation followup: no cached position, the expected move is given directly.
    (The trainer is single-user, so passing the answer to the client to score is acceptable.)"""
    best_uci = _to_standard_uci(fen4_str, answer_uci)
    board = chess.Board(_ensure_full_fen(fen4_str))
    try:
        best_san = figurine(board.san(chess.Move.from_uci(best_uci)))
    except (ValueError, AssertionError):
        best_san = best_uci
    best_fen = None
    try:
        b2 = chess.Board(_ensure_full_fen(fen4_str))
        b2.push_uci(best_uci)
        best_fen = b2.board_fen()
    except (ValueError, AssertionError):
        pass
    correct = (played_uci == best_uci) if played_uci else None
    played_san = _san_of(fen4_str, played_uci)
    if correct:
        # Sans « Correct » : le client préfixe déjà « Correct ! » — le doublon
        # « Correct ! Correct — … » était un tic d'assemblage.
        comment = "Tu continues la réfutation."
    elif played_san:
        comment = f"Tu as joué {played_san} — la suite était {best_san}."
    else:
        comment = f"La suite est {best_san}."
    return {"correct": correct, "best_uci": best_uci, "best_san": best_san,
            "best_fen": best_fen, "played_san": played_san,
            "comment": comment, "note": None}


def _san_of(fen4_str: str, uci: str | None) -> str | None:
    """Figurine SAN of a UCI move in a position — the played move, echoed back in text so
    the verdict is readable without seeing the board (screen readers, session recap)."""
    if not uci:
        return None
    try:
        b = chess.Board(_ensure_full_fen(fen4_str))
        return figurine(b.san(b.parse_uci(uci)))
    except (ValueError, AssertionError):
        return uci


def _position_check_payload(conn_, position_id: int, played_uci: str | None,
                            bucket: int | None = None) -> dict:
    row = db.get_position(conn_, position_id)
    if row is None:
        abort(404)
    best_uci = _to_standard_uci(row["fen4"], row["best_move_uci"])
    best_san = figurine(row["best_move_san"] or best_uci or "?")
    correct = (played_uci == best_uci) if played_uci else None
    played_san = _san_of(row["fen4"], played_uci)
    # Position *after* the best move, so the trainer can leave the piece on its destination
    # (and render castling / en-passant correctly) instead of snapping back to the start.
    best_fen = None
    if best_uci:
        try:
            board = chess.Board(_ensure_full_fen(row["fen4"]))
            board.push_uci(best_uci)
            best_fen = board.board_fen()
        except (ValueError, AssertionError):
            best_fen = None
    comment, note = _verdict_texts(conn_, position_id, played_uci, correct, best_san,
                                   played_san, bucket)
    return {
        "correct": correct, "best_uci": best_uci, "best_san": best_san,
        "best_fen": best_fen, "played_san": played_san,
        "comment": comment, "note": note,
    }


_CORRECT_VARIANTS = (
    "C'est le meilleur coup du moteur.",
    "Le coup du moteur, exactement.",
    "Oui — c'est ce que joue le moteur.",
)


def _verdict_texts(conn_, position_id, played, correct, best_san, played_san,
                   bucket: int | None = None) -> tuple[str, str | None]:
    """The verdict as ONE readable sentence about the student's own move (``comment``), plus an
    optional muted side-note about the frequent error at the student's level (``note``). Composed
    entirely server-side: the client displays them as-is and never concatenates clauses — the best
    move is named exactly once, and the frequent mistake never intrudes on the main sentence.

    ``bucket`` is the trainer's current Elo filter: with it, « à ce niveau » is TRUE (the top
    error of that bucket); without it (or when the bucket has no error row) the note falls back
    to the position-wide top error and says « sur cette position » — the copy never promises a
    rating-aware fact the query didn't make."""
    if correct:
        return random.choice(_CORRECT_VARIANTS), None
    worst = None
    at_level = bucket is not None
    if at_level:
        worst = conn_.execute(
            "SELECT mistake_move_san, eval_loss_cp FROM errors WHERE position_id = ? "
            "AND elo_bucket = ? ORDER BY criticality DESC NULLS LAST LIMIT 1",
            (position_id, bucket),
        ).fetchone()
    if worst is None:
        at_level = False
        worst = conn_.execute(
            "SELECT mistake_move_san, eval_loss_cp FROM errors WHERE position_id = ? "
            "ORDER BY criticality DESC NULLS LAST LIMIT 1",
            (position_id,),
        ).fetchone()
    note = None
    if worst is not None and worst["mistake_move_san"]:
        scope = "à ce niveau" if at_level else "sur cette position"
        note = (f"L’erreur fréquente {scope} est {figurine(worst['mistake_move_san'])} — "
                f"elle perd {fmt_loss(worst['eval_loss_cp'])} pion(s).")
    if played:
        m = conn_.execute(
            "SELECT mistake_move_san, eval_loss_cp FROM errors WHERE position_id = ? "
            "AND mistake_move_uci = ? ORDER BY criticality DESC NULLS LAST LIMIT 1",
            (position_id, played),
        ).fetchone()
        if m is not None:
            # The played move IS a known frequent error: its loss goes in the main sentence,
            # and the side-note only remains if a DIFFERENT move is the top error here.
            if worst is not None and worst["mistake_move_san"] == m["mistake_move_san"]:
                note = None
            return (f"Tu as joué {played_san} — il perd {fmt_loss(m['eval_loss_cp'])} pion(s). "
                    f"Le meilleur est {best_san}."), note
        return f"Tu as joué {played_san}. Le meilleur est {best_san}.", note
    return f"Le meilleur coup est {best_san}.", note


def _board_at(path_ucis: list[str]) -> chess.Board:
    board = chess.Board()
    for u in path_ucis:
        board.push_uci(u)
    return board


def _san_line(path_ucis: list[str]) -> str:
    board = chess.Board()
    moves = [chess.Move.from_uci(u) for u in path_ucis]
    return board.variation_san(moves) if moves else "(start)"
