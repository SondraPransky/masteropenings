"""Application NiceGUI : explorateur de positions + comparaison d'ouvertures.

Deux vues sur les données EN BANQUE (aucun réseau) :
  - Explorateur : échiquier navigable + compteurs live (puzzles démarrant / passant
    par la position), motifs de la position, ouvertures, suites de coups jouées.
  - Comparaison : ADN de 2-3 familles côte à côte (volume, niveau, motifs).

L'UI est une mince couche par-dessus `otkb.ui.data.UiData` (requêtes cachées).
Les requêtes SQLite de l'explorateur sont déportées hors de la boucle asyncio
(`run.io_bound`) : le ping socket.io de NiceGUI est agressif (2 s) et une requête
synchrone bloquante sur une position populaire ferait tomber la connexion.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path

import chess
from nicegui import app, run, ui

from ..explorer.insights import Continuation, PuzzleSummary
from ..logging_setup import get_logger

logger = get_logger(__name__)
from ..explorer.query import PositionCounts, PuzzleData
from .board import BoardState, PositionParseError, _piece_data_uri, to_figurine
from .data import CONTINUATIONS_CAP, UiData
from .levels import LEVELS, levels_ranges, toggle_level

# Ouverture → coups UCI (dataset Lichess chess-openings, restreint aux tags en base).
# Sert au sélecteur d'ouverture de l'onglet « Dossiers élèves » (atteindre une
# position par son nom, sans taper les coups). Chargé défensivement.
try:
    _OPENINGS_MOVES: dict[str, str] = json.loads(
        (Path(__file__).parent.parent / "assets" / "openings_moves.json").read_text(encoding="utf-8")
    )
except Exception:  # pragma: no cover - l'asset peut être absent
    _OPENINGS_MOVES = {}

# Thème Lichess (slug) → libellé français, depuis l'asset curated themes.json.
# L'outil est partagé entre entraîneurs : « fourchette · mat en 2 » se lit,
# « fork mateIn2 » se déchiffre. Repli sur le slug si absent du mapping.
try:
    _THEME_FR: dict[str, str] = {
        slug: str(v.get("label_fr") or slug)
        for slug, v in json.loads(
            (Path(__file__).parent.parent / "assets" / "themes.json").read_text(encoding="utf-8")
        ).items()
        if isinstance(v, dict)
    }
except Exception:  # pragma: no cover
    _THEME_FR = {}


def _fr_themes(raw: str, limit: int = 4) -> str:
    """« fork mateIn2 short » → « Fourchette · Mat en 2 · Court » (au plus `limit`)."""
    toks = [t for t in (raw or "").split() if t]
    return " · ".join(_THEME_FR.get(t, t) for t in toks[:limit])

# 480 (16/07, demande utilisateur) : la droite est bornée (tableau 660 + aperçu
# 320), la place libérée revient à l'échiquier principal — l'instrument de travail.
BOARD_SIZE = 480

# Identité OTKB = celle d'EECoach (cf. DESIGN.md) : papier zinc neutre, UNE encre
# indigo, grotesque à caractère pour les titres + monospace tabulaire pour la donnée.
# Tout est piloté par tokens + classes Quasar ; les composants existants lisent encore
# quelques alias `--otkb-*` (remappés en bas). Clair/sombre via `body.body--dark`
# (mécanisme NiceGUI/Quasar — PAS [data-theme]). Polices vendues en local (offline).
_THEME_CSS = """
<link rel="stylesheet" href="/otkb-static/fonts/fonts.css">
<style>
:root{
  --page:#fafafa; --surf:#ffffff; --surf2:#f4f4f5; --surf3:#e4e4e7;
  --border:#e4e4e7; --border-h:#d4d4d8;
  --ink:#18181b; --ink-2:#3f3f46; --dim:#65656d;
  --indigo:#4f46e5; --indigo-dim:rgba(79,70,229,.08); --indigo-glow:rgba(79,70,229,.30);
  --green:#16a34a; --green-ink:#166534; --green-dim:rgba(22,163,74,.10); --green-glow:rgba(22,163,74,.25);
  --gold:#d97706; --gold-ink:#92400e; --gold-dim:rgba(217,119,6,.10); --gold-glow:rgba(217,119,6,.25);
  --red:#dc2626; --red-ink:#be123c; --red-dim:rgba(220,38,38,.10); --red-glow:rgba(220,38,38,.25);
  --blue:#2563eb; --blue-ink:#1e40af; --blue-dim:rgba(37,99,235,.10); --blue-glow:rgba(37,99,235,.25);
  --violet:#7c3aed;
  --font-ui:'Hanken Grotesk',-apple-system,BlinkMacSystemFont,sans-serif;
  --font-display:'Bricolage Grotesque',var(--font-ui);
  --font-mono:'JetBrains Mono',ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;
  --r:8px; --rs:6px;
  --shadow-xs:0 1px 2px rgba(24,24,27,.05);
  --shadow-sm:0 1px 2px rgba(24,24,27,.06);
  --shadow:0 1px 3px rgba(24,24,27,.08),0 1px 2px rgba(24,24,27,.05);
  --shadow-lg:0 10px 30px rgba(30,27,75,.12),0 4px 8px rgba(24,24,27,.06);
  /* alias de compat : composants pas encore retouchés (_bar, tuiles, thermique) */
  --otkb-mono:var(--font-mono); --otkb-accent:var(--indigo);
  --otkb-paper:var(--page); --otkb-sheet:var(--surf); --otkb-panel:var(--surf2);
  --otkb-ink:var(--ink); --otkb-soft:var(--ink-2); --otkb-muted:var(--dim);
  --otkb-rule:var(--border); --otkb-track:var(--surf3);
  --otkb-bar:var(--indigo); --otkb-bar-alt:var(--gold);
  --otkb-sq-light:#eef0f2; --otkb-sq-dark:#c8ccd2;
}
body.body--dark{
  --page:#09090b; --surf:#18181b; --surf2:#27272a; --surf3:#3f3f46;
  --border:#27272a; --border-h:#3f3f46;
  --ink:#fafafa; --ink-2:#d4d4d8; --dim:#a1a1aa;
  --indigo:#818cf8; --indigo-dim:rgba(129,140,248,.14); --indigo-glow:rgba(129,140,248,.35);
  --green:#4ade80; --green-ink:#4ade80; --green-dim:rgba(74,222,128,.14); --green-glow:rgba(74,222,128,.35);
  --gold:#f59e0b; --gold-ink:#f59e0b; --gold-dim:rgba(245,158,11,.14); --gold-glow:rgba(245,158,11,.35);
  --red:#f87171; --red-ink:#fca5a5; --red-dim:rgba(248,113,113,.14); --red-glow:rgba(248,113,113,.35);
  --blue:#60a5fa; --blue-ink:#60a5fa; --blue-dim:rgba(96,165,250,.14); --blue-glow:rgba(96,165,250,.35);
  --violet:#a78bfa;
  --shadow-xs:0 1px 2px rgba(0,0,0,.4);
  --shadow-sm:0 1px 2px rgba(0,0,0,.5);
  --shadow:0 1px 3px rgba(0,0,0,.6),0 1px 2px rgba(0,0,0,.4);
  --shadow-lg:0 12px 40px rgba(0,0,0,.7),0 4px 12px rgba(0,0,0,.4);
  --otkb-sq-light:#2a2f37; --otkb-sq-dark:#1b1f26;
}
/* — base — */
body, .q-page, .nicegui-content{
  background:var(--page); color:var(--ink); font-family:var(--font-ui);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
.otkb-mono, .mono{ font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.tnum{ font-variant-numeric:tabular-nums; }
/* — bandeau haut : surface claire translucide, pas une masse sombre — */
.q-header{ background:color-mix(in srgb, var(--surf) 85%, transparent) !important;
  color:var(--ink) !important; border-bottom:1px solid var(--border);
  box-shadow:none; backdrop-filter:blur(16px); }
.q-header .text-lg{ font-family:var(--font-display); font-weight:800;
  letter-spacing:-.02em; color:var(--ink); }
/* — onglets : sentence-case Hanken, indicateur indigo (jamais de capitales tracked) — */
.q-tab{ font-family:var(--font-ui); font-weight:600; font-size:.82rem;
  letter-spacing:0; text-transform:none; color:var(--dim); }
.q-tab--active{ color:var(--indigo); }
.q-tab__indicator{ background:var(--indigo); height:2px; }
/* — cartes : surface plate, bordure 1px, pas d'ombre au repos — */
.q-card{ background:var(--surf); border:1px solid var(--border);
  border-radius:var(--r); box-shadow:none; color:var(--ink); }
/* — titres de sections : grotesque, sentence-case — */
.text-subtitle1, .text-subtitle2{ font-family:var(--font-display) !important;
  font-weight:700 !important; letter-spacing:-.01em; color:var(--ink) !important;
  text-transform:none !important; }
.text-subtitle2{ font-size:.96rem !important; }
/* — grands compteurs : monospace tabulaire, pas de sérif — */
.text-h4, .text-h5, .text-h6{ font-family:var(--font-mono) !important;
  font-variant-numeric:tabular-nums; letter-spacing:-.02em; font-weight:600; }
.text-grey, .text-grey-7, .text-grey-8{ color:var(--dim) !important; }
.text-primary{ color:var(--indigo) !important; }
/* — boutons : indigo plein = action principale ; focus = double anneau — */
.q-btn{ border-radius:var(--rs); font-family:var(--font-ui); font-weight:600;
  text-transform:none; letter-spacing:0; }
.q-btn.q-btn--standard.text-primary, .q-btn[color=primary]{ }
.q-btn:focus-visible{ outline:none;
  box-shadow:0 0 0 2px var(--surf),0 0 0 4px var(--indigo-glow); }
/* — champs (FEN/UCI en mono) : bordure 1px, focus indigo — */
.q-field--outlined .q-field__control{ border-radius:var(--rs); }
.q-field__native, .q-field__prefix, .q-field__suffix{ color:var(--ink); }
input.q-field__native{ font-family:var(--font-mono); }
/* — tableau des puzzles « qui suivent » (piste B : tableau + aperçu fixe) — */
.otkb-pztable{ width:100%; border-collapse:collapse; font-size:.83rem; }
.otkb-pztable thead th{ font-size:.7rem; font-weight:600; color:var(--dim);
  text-align:left; padding:3px 8px; border-bottom:1px solid var(--border);
  white-space:nowrap; }
.otkb-pztable thead th.sort{ cursor:pointer; color:var(--indigo);
  user-select:none; }
.otkb-pztable thead th.sort:hover{ text-decoration:underline; }
.otkb-pztable tbody td{ padding:5px 8px; border-bottom:1px solid var(--border);
  vertical-align:middle; white-space:nowrap; }
.otkb-pztable tbody tr{ cursor:pointer; }
.otkb-pztable tbody tr:hover{ background:var(--indigo-dim); }
.otkb-pztable tbody tr.otkb-rowsel{ background:var(--indigo-dim); }
/* focus clavier : même anneau que les boutons (Tab parcourt les lignes,
   Entrée/Espace résout — le focus pilote aussi l'aperçu, comme le survol) */
.otkb-pztable tbody tr:focus-visible, .otkb-pztable thead th.sort:focus-visible{
  outline:none; box-shadow:0 0 0 2px var(--surf), 0 0 0 4px var(--indigo-glow); }
.otkb-pztable .themes{ color:var(--dim); font-size:.78rem; max-width:44ch;
  overflow:hidden; text-overflow:ellipsis; }
/* colonne d'aperçu : épinglée en large, masquée quand l'écran est étroit
   (le clic ouvre alors directement le solveur — pas de survol sur tactile).
   320 px (demande utilisateur) : l'aperçu est fait pour LIRE une position. */
.otkb-prevcol{ flex:0 0 320px; position:sticky; top:8px; }
@media (max-width: 1020px){ .otkb-prevcol{ display:none; } }
/* — bande « Suites les plus jouées » : pastilles SOULIGNÉES (design validé sur
   maquette, composition Flux). Le trait indigo sous la pastille est proportionnel
   à la part de parties, relative au coup le plus joué — l'information d'une
   jauge, la discrétion d'une pastille. Clic = jouer le coup. — */
.otkb-mvpill.q-btn{ position:relative; overflow:hidden; min-height:0;
  padding:2px 12px 4px; border-radius:999px; border:1px solid var(--border);
  background:var(--surf); font-family:var(--font-mono); line-height:1.5; }
.otkb-mvpill.q-btn:hover{ border-color:var(--indigo-glow); color:var(--indigo); }
.otkb-mvpill.q-btn .q-focus-helper{ display:none; }
.otkb-mvpill .mv{ font-weight:500; font-size:.84rem; color:var(--ink); }
.otkb-mvpill:hover .mv{ color:var(--indigo); }
.otkb-mvpill .pc{ font-size:.68rem; color:var(--dim); margin-left:5px;
  font-variant-numeric:tabular-nums; }
.otkb-mvpill .under{ position:absolute; left:10%; right:10%; bottom:0;
  height:2.5px; background:var(--indigo); border-radius:2px;
  transform-origin:left; pointer-events:none; }
@media (pointer: coarse){ .otkb-mvpill.q-btn{ padding:8px 16px 10px; }
  .otkb-mvpill .mv{ font-size:.95rem; } }
/* au DOIGT (pas de souris) : cibles ≥ 44 px et texte ≥ 14 px, sans sacrifier
   la densité au bureau — 14 lignes visibles, c'est le geste métier du coach */
@media (pointer: coarse){
  .otkb-pztable{ font-size:.92rem; }
  .otkb-pztable tbody td{ padding:13px 10px; }
  .otkb-pztable .themes{ font-size:.88rem; }
  .otkb-pztable thead th{ font-size:.78rem; padding:8px 10px; }
  .q-btn--dense{ min-height:44px; min-width:44px; }
}
/* pastille de trait : forme + libellé, jamais la couleur seule */
.otkb-trait{ display:inline-block; width:9px; height:9px; border-radius:999px;
  vertical-align:-1px; margin-right:5px; }
.otkb-trait.wt{ background:#fafafa; border:1.5px solid var(--border-h); }
.otkb-trait.bk{ background:#18181b; border:1.5px solid var(--dim); }
/* pastilles de niveau élève : filtre à bascule TOUJOURS visible (8 options
   stables → un menu déroulant cachait l'état ; ici il se lit d'un coup d'œil).
   Sélection = teinte indigo, la seule encre d'accent — pas de croix, pas de champ. */
.otkb-lvl.q-btn{ min-height:0; padding:1px 10px; border-radius:999px;
  border:1px solid var(--border); background:var(--surf); color:var(--ink-2);
  font-size:.74rem; font-weight:600; line-height:1.5; }
.otkb-lvl.q-btn:hover{ border-color:var(--border-h); }
.otkb-lvl.q-btn.on{ background:var(--indigo-dim); border-color:var(--indigo-glow);
  color:var(--indigo); }
.otkb-lvl.q-btn .q-focus-helper{ display:none; }
@media (pointer: coarse){ .otkb-lvl.q-btn{ padding:8px 14px; font-size:.85rem; } }
/* badge difficulté : le repère fort du coach — mono, teinte indigo */
.otkb-diff{ font-family:var(--font-mono); font-variant-numeric:tabular-nums;
  font-weight:500; font-size:.78rem; color:var(--indigo); white-space:nowrap; }
/* — dialogues — */
.q-dialog .q-card{ border-radius:14px; box-shadow:var(--shadow-lg); }
@media (prefers-reduced-motion: reduce){ *{ animation-duration:.001ms !important;
  transition-duration:.001ms !important; } }
</style>
"""
_PZ_PAGE = 8                       # puzzles par page dans les listes en ligne
_TH_PAGE = 14                      # tableau « qui suivent » : lignes denses (~30 px)

# libellés des tris de puzzles (valeur -> libellé)
_PZ_SORTS = {
    "popularity": "Popularité",
    "rating_desc": "Difficulté ↓",
    "rating_asc": "Difficulté ↑",
}

# Tri des puzzles « à travers » : DIFFICULTÉ seulement (asc/desc, via clic sur
# l'en-tête de colonne). Volontairement SANS « Popularité » : cette colonne est
# absente de `positions`, donc ce tri impose une jointure sur les ~779 k puzzles
# de la position — mesuré 1,4 s à chaud et 17 s à froid, contre 0,3 ms pour la
# difficulté (poussée dans idx_positions_normfen_rating). Ce panneau se recalcule
# à CHAQUE coup : proposer ce tri serait un piège à 17 s. La popularité reste
# disponible dans l'onglet « Meilleurs puzzles », qui lit un cache précalculé.

# Échiquier Chessground (la lib de Lichess), vendue en local (otkb/ui/static).
# On instancie une fois, puis `otkbSet(cfg)` pousse fen/orientation/dests/lastMove
# à chaque position. Sur un coup de l'utilisateur, `movable.events.after` renvoie
# (from,to) via emitEvent('otkb_drop') → validé côté Python (promotion incluse).
_CG_JS = """
<script type="module">
import { Chessground } from '/otkb-static/chessground.min.js';
let cg = null;
window.otkbInit = () => {
  const el = document.getElementById('otkb-cg');
  if (!el || cg) return;
  cg = Chessground(el, {
    coordinates: true,
    animation: { enabled: true, duration: 200 },
    highlight: { lastMove: true, check: true },
    movable: {
      free: false, showDests: true,
      events: { after: (o, d) => window.emitEvent('otkb_drop', {from: o, to: d}) },
    },
    drawable: { enabled: false },
  });
  window.__cg = cg;
};
window.otkbSet = (cfg) => {
  if (!cg) window.otkbInit();
  if (!cg) return;
  cg.set({
    fen: cfg.fen,
    orientation: cfg.orientation,
    turnColor: cfg.turnColor,
    lastMove: cfg.lastMove || undefined,
    check: cfg.check || false,
    viewOnly: !!cfg.viewOnly,
    movable: {
      free: false,
      color: cfg.movableColor || undefined,
      dests: new Map(Object.entries(cfg.dests || {})),
    },
  });
  cg.setAutoShapes(cfg.hint ? [{orig: cfg.hint, brush: 'green'}] : []);
};

// ——— Échiquier d'APERÇU (panneau fixe à côté du tableau des puzzles) ———
// Seconde instance Chessground, viewOnly : mêmes cases brown, mêmes pièces
// cburnett que l'échiquier principal — la cohérence est structurelle.
// Le conteneur est recréé à chaque re-rendu NiceGUI → on ré-instancie si
// l'élément a changé. Tout le survol est CLIENT-SIDE : zéro aller-retour.
let cgPrev = null, cgPrevEl = null;
window.otkbPrevSet = (fen, orientation) => {
  const el = document.getElementById('otkb-cg-prev');
  if (!el) return;
  if (!cgPrev || cgPrevEl !== el) {
    cgPrev = Chessground(el, {
      viewOnly: true, coordinates: false,
      animation: { enabled: true, duration: 120 },
      drawable: { enabled: false },
    });
    cgPrevEl = el;
  }
  cgPrev.set({ fen, orientation });
};
const otkbPreviewRow = (tr) => {
  window.otkbPrevSet(tr.dataset.pzfen, tr.dataset.pzorient);
  const cap = document.getElementById('otkb-prev-cap');
  if (cap) cap.textContent = tr.dataset.pzcap || '';
  const tb = tr.closest('tbody');
  if (tb) tb.querySelectorAll('.otkb-rowsel').forEach(x => x.classList.remove('otkb-rowsel'));
  tr.classList.add('otkb-rowsel');
};
window.otkbPrevFirst = () => {         // aperçu de la 1re ligne au chargement d'une page
  const tr = document.querySelector('tr[data-pzfen]');
  if (tr) otkbPreviewRow(tr);
};
document.addEventListener('mouseover', (e) => {
  const tr = e.target.closest && e.target.closest('tr[data-pzfen]');
  if (tr) otkbPreviewRow(tr);
});
// le focus CLAVIER pilote l'aperçu comme le survol : Tab de ligne en ligne = parcourir
document.addEventListener('focusin', (e) => {
  const tr = e.target.closest && e.target.closest('tr[data-pzfen]');
  if (tr) otkbPreviewRow(tr);
});
document.addEventListener('click', (e) => {
  const th = e.target.closest && e.target.closest('th[data-pzsort]');
  if (th) { window.emitEvent('otkb_pzsort', {}); return; }
  const tr = e.target.closest && e.target.closest('tr[data-pzid]');
  if (tr) window.emitEvent('otkb_pzopen', { id: tr.dataset.pzid });
});
// Entrée/Espace = activer (lignes et en-tête de tri sont des role=button)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const th = e.target.closest && e.target.closest('th[data-pzsort]');
  if (th) { e.preventDefault(); window.emitEvent('otkb_pzsort', {}); return; }
  const tr = e.target.closest && e.target.closest('tr[data-pzid]');
  if (tr) { e.preventDefault(); window.emitEvent('otkb_pzopen', { id: tr.dataset.pzid }); }
});
// ——— navigation clavier de l'exploration : ← annule un coup, → le rejoue ———
// (ignoré quand on tape dans un champ — le FEN/UCI utilise les flèches pour
// déplacer le curseur, et les lignes du tableau gardent Entrée/Espace)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  window.emitEvent('otkb_nav', { dir: e.key === 'ArrowLeft' ? 'back' : 'fwd' });
});

// ——— signal de disponibilité : le CLIENT annonce que le module est chargé ———
// (remplace l'ancien SONDAGE serveur→client : jusqu'à 100 allers-retours
// run_javascript qui retardaient TOUT le contenu de ~15 s au chargement)
(function otkbSignalReady(){
  if (window.emitEvent) window.emitEvent('otkb_cgready', {});
  else setTimeout(otkbSignalReady, 100);
})();
</script>
"""


async def _js(code: str, *, timeout: float = 5.0):
    """`ui.run_javascript` qui ne TUE PAS l'appelant si le client tarde à répondre.

    ⚠️ Piège NiceGUI (coûteux) : `run_javascript` attend une RÉPONSE du navigateur,
    `timeout=1.0 s` par défaut, et lève `TimeoutError` sinon. Or `recompute()`
    commençait par pousser la position à l'échiquier : au moindre dépassement (module
    Chessground ESM encore en vol, onglet en arrière-plan, machine chargée, deuxième
    client connecté), l'exception tuait `recompute` AVANT la lecture des données —
    `holder["data"]` restait None et les panneaux restaient bloqués sur le spinner,
    définitivement. Symptôme observé : « extrêmement long à charger, rien ne s'affiche ».
    Aucun de nos appels n'exploite la valeur de retour hors sondage : on absorbe.
    """
    try:
        return await ui.run_javascript(code, timeout=timeout)
    except TimeoutError:
        return None


def _fmt(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def build(data: UiData) -> None:
    """Enregistre la page unique de l'application."""
    # sert les assets Chessground vendus en local (JS + CSS + pièces cburnett)
    app.add_static_files("/otkb-static", str(Path(__file__).parent / "static"))

    @ui.page("/")
    async def index() -> None:
        state = BoardState()
        ui.add_head_html(
            _THEME_CSS
            + '<link rel="stylesheet" href="/otkb-static/chessground.base.css">'
            '<link rel="stylesheet" href="/otkb-static/chessground.brown.css">'
            '<link rel="stylesheet" href="/otkb-static/chessground.cburnett.css">'
        )
        dark = ui.dark_mode()
        # L'UNIQUE accent = indigo (#4f46e5) sur tous les composants Quasar (bouton
        # primary, bascule, indicateur d'onglet…). ui.colors pose --q-primary via le
        # mécanisme Quasar, sinon NiceGUI le réécrit (bleu) sur un ancêtre.
        ui.colors(primary="#4f46e5")

        with ui.header().classes("items-center q-px-md"):
            ui.label("♞ OTKB").classes("text-lg")
            ui.label("Usine à exercices d'ouverture").classes("text-sm") \
                .style("color:var(--dim); font-family:var(--font-ui); margin-left:.6rem")
            ui.space()
            ui.button(icon="dark_mode", on_click=dark.toggle) \
                .props("flat round").style("color:var(--ink-2)").tooltip("Thème clair / sombre")

        # Sans le cache des compteurs, l'explorateur compte en direct : ~4 s par
        # coup au lieu de 0,005 s. Le dire, plutôt que de laisser croire à un bug.
        if data.position_counts_missing():
            with ui.row().classes("w-full items-center gap-2 q-pa-sm") \
                    .style("background:var(--gold-dim); color:var(--gold-ink);"
                           "border-bottom:1px solid var(--gold-glow)"):
                ui.icon("hourglass_bottom")
                ui.label(
                    "Cache des compteurs absent — l'explorateur sera lent (quelques "
                    "secondes par coup). Le construire une fois : python -m otkb build-counts"
                ).classes("text-sm")
        # Cache présent mais PÉRIMÉ (la base a grossi depuis le dernier build,
        # normalement rattrapé en fin de download-run/import — filet si interrompu) :
        # les compteurs affichés seraient silencieusement faux. Le dire aussi.
        elif data.position_caches_stale():
            with ui.row().classes("w-full items-center gap-2 q-pa-sm") \
                    .style("background:var(--gold-dim); color:var(--gold-ink);"
                           "border-bottom:1px solid var(--gold-glow)"):
                ui.icon("update")
                ui.label(
                    "Caches de positions périmés (la base a grossi depuis le dernier "
                    "build) — compteurs et suites peuvent être faux. Rafraîchir : "
                    "python -m otkb build-counts"
                ).classes("text-sm")

        # PLUS D'ONGLETS (16/07, décision utilisateur : « on se concentre sur
        # l'Explorateur ») : « Dossiers élèves » avait déjà été absorbé (sélecteur
        # d'ouverture), « Meilleurs puzzles » et « Comparaison » sont supprimés —
        # l'Explorateur EST la page. Bénéfice collatéral : plus de contrainte
        # d'onglet par défaut pour l'init Chessground, et plus besoin de construire
        # les caches d'ADN par famille au démarrage.
        with ui.column().classes("w-full q-pa-md"):
            exp = _explorer_view(data, state)

        # une fois connecté : attendre que le module Chessground (ESM, chargé de
        # façon asynchrone) et le conteneur DOM soient prêts, puis instancier et
        # charger la position de départ.
        import time as _time
        _t0 = _time.perf_counter()
        logger.info("index: page construite, attente connexion client…")
        await ui.context.client.connected()
        logger.info("index: client connecté en %.2fs", _time.perf_counter() - _t0)
        # Les PANNEAUX ne dépendent pas de l'échiquier : on les charge tout de
        # suite (serveur mesuré à 13 ms, même à froid). L'échiquier s'initialise
        # quand le CLIENT le signale (événement `otkb_cgready` émis en fin de
        # module _CG_JS) — l'ancien sondage serveur→client (100 allers-retours
        # run_javascript) retardait tout le contenu de ~15 s.
        await exp["recompute"]()
        logger.info("index: recompute initial fini à %.2fs", _time.perf_counter() - _t0)


# ---------------------------------------------------------------------------
# Vue Explorateur
# ---------------------------------------------------------------------------
@dataclass
class _Preview:
    """Un puzzle prêt à afficher dans le tableau. Construit HORS boucle asyncio.

    `fen` est le PLACEMENT seul (1er champ FEN, sans espace → sûr en attribut HTML)
    de la position telle que l'ÉLÈVE la voit : après `moves[0]` (le coup adverse qui
    pose le puzzle). L'aperçu est rendu côté CLIENT par la seconde instance
    Chessground (`otkbPrevSet`) au survol de la ligne — aucun SVG côté serveur,
    aucun aller-retour réseau.
    """
    summary: PuzzleSummary   # rating / popularité / thèmes (l'affichage)
    fen: str                 # placement de la position posée
    white_to_move: bool


def _preview_of(data: UiData, summary: PuzzleSummary) -> _Preview | None:
    """Position posée + trait d'un puzzle. None si le puzzle est inexploitable.

    `PuzzleSummary` porte les méta d'affichage (dont la popularité, absente de
    `PuzzleData`) ; `PuzzleData` n'est lu que pour construire la position.
    """
    pd = data.puzzle(summary.puzzle_id)
    if pd is None or not pd.moves:
        return None
    board = chess.Board(pd.fen)
    board.push_uci(pd.moves[0])            # position posée = après le coup adverse
    return _Preview(summary, board.board_fen(), board.turn == chess.WHITE)


@dataclass
class _PanelData:
    """Résultats des requêtes d'une position (calculés hors boucle asyncio)."""
    counts: PositionCounts
    continuations: list[Continuation] | None  # None = position trop fréquente/vide
    squares: dict[str, dict[str, int]]         # carte thermique (cases critiques/sacrifice)
    through: list[_Preview]                    # page courante des puzzles « à travers »
    through_total: int = 0                     # total FILTRÉ par niveau élève


@dataclass
class _PuzzleSession:
    """État d'un puzzle en cours de résolution."""
    data: PuzzleData
    solution: list[str]                 # coups UCI attendus (solveur, adv, solveur…)
    solver_color: bool                  # couleur qui résout
    # Board d'exploration à restaurer en sortie — une COPIE avec sa pile de coups.
    # Une FEN nue perdait l'historique : au retour, le fil de coups affichait
    # « position de départ » sous une Sicilienne et « ← Annuler » était mort.
    explore_board: chess.Board
    queue: list[str]                    # file de puzzles (ids) pour « suivant »
    queue_idx: int = 0                  # position dans la file
    idx: int = 0                        # index du prochain coup attendu dans `solution`
    solved: bool = False
    feedback: str = ""                  # message ('' | 'wrong')

    @property
    def has_next(self) -> bool:
        return self.queue_idx + 1 < len(self.queue)

    @property
    def solver_total(self) -> int:
        return (len(self.solution) + 1) // 2      # coups à trouver par le solveur

    @property
    def solver_done(self) -> int:
        return (self.idx + 1) // 2


def _explorer_view(data: UiData, state: BoardState):
    """Construit la vue explorateur ; renvoie la coroutine `recompute` initiale."""
    # holder : 'data' (panneaux explore), 'mode' ('explore'|'puzzle'),
    # 'puzzle' (_PuzzleSession), 'hint' (case d'indice), 'pz_sort'/'pz_offset'
    # (tri/pagination de la liste de puzzles de la position)
    # `th_sort` = rating_asc et NON popularity : ce tri-ci est poussé dans l'index
    # (idx_positions_normfen_rating) donc instantané, alors que « popularité » est
    # absente de `positions` et impose une jointure complète (~2 s sur 1.e4). La
    # liste se recalcule à CHAQUE coup : un défaut lent rendrait l'explorateur
    # inutilisable — c'est exactement ce que la passe perf a corrigé. La difficulté
    # est de toute façon le critère de calibrage du coach.
    # `th_level` = niveaux ÉLÈVE cochés (cf. levels.py) — une LISTE : un groupe de
    # cours est souvent hétérogène (« mes 1200-1400 ET 1400-1600 »). Les plages
    # correspondantes sont fusionnées/disjointes par `levels_ranges`. Le rating
    # Lichess reste affiché ligne à ligne.
    holder: dict = {
        "mode": "explore", "puzzle": None, "hint": None,
        "pz_sort": "popularity", "pz_offset": 0,
        "th_sort": "rating_asc", "th_offset": 0, "th_level": ["all"],
        "redo": [],   # coups annulés (←), rejouables (→) tant qu'on ne bifurque pas
    }

    with ui.row().classes("w-full items-start gap-5 wrap"):
        # -- colonne gauche : échiquier + navigation + contexte -----------
        # largeur bornée à l'échiquier : c'est l'atelier. Le balayage des puzzles
        # se fait à droite, dans la zone large.
        with ui.column().classes("items-stretch gap-3") \
                .style(f"flex:0 0 auto; width:min({BOARD_SIZE}px, 92vw)"):
            # échiquier Chessground (Lichess) — voir _CG_JS.
            ui.element("div").props("id=otkb-cg").classes("cg-wrap rounded overflow-hidden") \
                .style("width:100%; aspect-ratio:1; box-shadow:var(--shadow-sm);"
                       "border:1px solid var(--border)")

            moves_label = ui.label("").classes("otkb-mono text-sm") \
                .style("min-height:1.2em; color:var(--ink-2); word-wrap:break-word")

            # atteindre une position par le NOM de l'ouverture — zéro saisie de
            # coups (hérité de l'ex-onglet « Dossiers élèves », sa valeur unique)
            if _OPENINGS_MOVES:
                opening_options = {
                    t: t.replace("_", " ")
                    for t in sorted(_OPENINGS_MOVES, key=lambda x: x.replace("_", " "))
                }
                ui.select(opening_options, label="Ouverture", with_input=True,
                          on_change=lambda e: load_opening(e.value)) \
                    .props("use-input input-debounce=0 dense options-dense "
                           "behavior=menu clearable outlined") \
                    .classes("w-full")

            # saisie d'une position : FEN OU séquence de coups UCI
            with ui.row().classes("gap-2 items-center no-wrap w-full"):
                pos_input = ui.input(placeholder="FEN ou coups UCI (ex. e2e4 e7e5)") \
                    .props("dense outlined clearable").classes("otkb-mono").style("flex:1")
                ui.button("Aller", on_click=lambda: load_position()).props("dense unelevated color=primary")
                pos_input.on("keydown.enter", lambda: load_position())

            # DEUX rangées de contrôles, une par mode, basculées par render_info.
            # En mode solveur, « ⟲ Départ / ← Annuler » restaient visibles mais
            # MUETS (do_undo ignorait le mode puzzle) : l'utilisateur cliquait le
            # retour le plus naturel — sous l'échiquier, là où il regarde — et
            # rien ne répondait, pendant que le vrai « Retour » était enterré en
            # fin de rangée du panneau droit. Un contrôle visible doit répondre.
            with ui.row().classes("gap-2 items-center w-full") as explore_ctrls:
                btn_reset = ui.button("⟲ Départ").props("dense flat")
                btn_undo = ui.button("← Annuler").props("dense flat")
                ui.label("Glissez les pièces — flèches ← → pour naviguer.") \
                    .classes("text-xs self-center").style("color:var(--dim)")
            with ui.row().classes("gap-2 items-center w-full") as puzzle_ctrls:
                btn_quit = ui.button("← Quitter le puzzle", icon="arrow_back") \
                    .props("dense no-caps color=primary")
                ui.label("Retour à la position explorée.") \
                    .classes("text-xs self-center").style("color:var(--dim)")
            puzzle_ctrls.set_visibility(False)

            # panneaux de CONTEXTE (secondaires) : compteurs, motifs, ouvertures, suites
            side = ui.column().classes("items-stretch gap-3 w-full q-mt-sm")

        # -- colonne droite : LA LISTE DE PUZZLES (le héros) --------------
        with ui.column().classes("items-stretch gap-2") \
                .style("flex:1 1 460px; min-width:min(320px, 100%)"):
            busy = ui.linear_progress(show_value=False).props("indeterminate") \
                .classes("w-full")
            busy.set_visibility(False)
            main = ui.column().classes("items-stretch gap-4 w-full")

    # --- rendu (lit uniquement `holder`, aucune requête) -----------------
    def _board_cfg() -> dict:
        b = state.board
        turn = "white" if b.turn == chess.WHITE else "black"
        dests: dict[str, list[str]] = {}
        for m in b.legal_moves:
            dests.setdefault(chess.square_name(m.from_square), []) \
                .append(chess.square_name(m.to_square))
        last = None
        if b.move_stack:
            mv = b.peek()
            last = [chess.square_name(mv.from_square), chess.square_name(mv.to_square)]
        # qui peut jouer : le trait (explore) / le solveur tant que non résolu / personne
        sess = holder["puzzle"]
        if holder["mode"] == "puzzle":
            movable = "" if (sess and sess.solved) else turn
        else:
            movable = turn
        return {
            "fen": b.fen(),
            "orientation": "white" if state.orientation == chess.WHITE else "black",
            "turnColor": turn,
            "movableColor": movable,
            "dests": dests,
            "lastMove": last,
            "check": b.is_check(),
            "hint": (chess.square_name(holder["hint"]) if holder.get("hint") is not None else None),
        }

    async def refresh_board() -> None:
        # via _js : un client lent ne doit jamais empêcher les panneaux de charger
        await _js(f"window.otkbSet && window.otkbSet({json.dumps(_board_cfg())})")

    @ui.refreshable
    def render_info() -> None:
        main.clear()
        side.clear()
        pd = holder.get("data")

        # contrôles sous l'échiquier : ceux du mode courant, et EUX SEULS
        in_puzzle = holder["mode"] == "puzzle"
        explore_ctrls.set_visibility(not in_puzzle)
        puzzle_ctrls.set_visibility(in_puzzle)

        # ZONE DE GAUCHE (contexte, exploration seulement — le solveur n'en a pas
        # besoin). Composition « Flux » (validée sur maquette 16/07) : les cartes
        # « Compteurs », « Motifs tactiques ici » et « Ouvertures ici » ont été
        # SUPPRIMÉES (redondantes ou vides dans l'ouverture) ; les suites vivent
        # désormais à DROITE, au-dessus du tableau. Ne reste ici que la thermique.
        with side:
            if pd is None:
                ui.spinner(size="lg")
            elif not in_puzzle:
                crit = pd.squares.get("critical") or {}
                sac = pd.squares.get("sacrifice") or {}
                if crit or sac:
                    _thermal_panel(state, crit, sac)

        # ZONE DE DROITE (héros) : le solveur en mode puzzle, sinon le FLUX —
        # suites les plus jouées (où va la partie) PUIS puzzles qui suivent.
        with main:
            if holder["mode"] == "puzzle":
                _puzzle_panel(holder["puzzle"], give_hint, show_solution,
                              exit_puzzle, next_puzzle)
                return
            if pd is None:
                return
            _suites_strip(pd.counts.through_count, pd.continuations, go_move)
            if _through_ready():
                _card_through(
                    pd.through, pd.through_total,
                    holder["th_sort"], holder["th_level"], holder["th_offset"],
                    _TH_PAGE, set_th_level, th_prev, th_next,
                    on_download=lambda: _open_download_dialog(
                        data, state.normalized_fen, pd.through_total,
                        holder["th_level"]),
                )
            else:
                # avant 2 demi-coups, une liste de 1,2 M puzzles n'apprend rien
                ui.label("Jouez au moins un coup complet pour voir les puzzles "
                         "qui suivent la position.") \
                    .classes("text-sm q-pa-sm").style("color:var(--dim)")
            _card_puzzles(
                data, state.normalized_fen, pd.counts.start_count,
                holder["pz_sort"], holder["pz_offset"], _PZ_PAGE,
                open_puzzle_from_list, set_pz_sort, pz_prev, pz_next,
            )

    def _through_ready() -> bool:
        """Le tableau des puzzles n'apparaît qu'à partir de 2 demi-coups (1 coup).

        À la position de départ (et après un seul demi-coup) « 1 207 204 puzzles
        suivent » n'apprend rien : on n'affiche pas de liste. `board.ply()` se
        déduit de la POSITION (n° de coup + trait), donc le seuil vaut aussi pour
        une position chargée par FEN, où `move_stack` est vide.
        """
        return state.board.ply() >= 2

    def _through_page(nfen: str) -> list[_Preview]:
        """Page courante des puzzles « à travers », filtrée par niveaux élève.

        Appelée depuis le threadpool (`run.io_bound`) : lecture DB uniquement.
        """
        rows = data.puzzles_through_multi(
            nfen, levels_ranges(holder["th_level"]),
            sort=holder["th_sort"], limit=_TH_PAGE, offset=holder["th_offset"],
        )
        return [p for p in (_preview_of(data, s) for s in rows) if p is not None]

    def _through_total(nfen: str, counts: PositionCounts) -> int:
        """Total des puzzles des niveaux cochés. Sans filtre : le compteur caché."""
        ranges = levels_ranges(holder["th_level"])
        if ranges == [(None, None)]:
            return counts.through_count
        return data.count_through_multi(nfen, ranges)

    async def _reload_through() -> None:
        """Recharge la seule liste « à travers » (tri/pagination/niveau)."""
        pd = holder.get("data")
        if pd is None or not _through_ready():
            return
        nfen = state.normalized_fen

        def work() -> tuple[list[_Preview], int]:
            return _through_page(nfen), _through_total(nfen, pd.counts)

        busy.set_visibility(True)
        try:
            pd.through, pd.through_total = await run.io_bound(work)
        finally:
            busy.set_visibility(False)
        render_info.refresh()

    async def set_th_level(keys: list[str]) -> None:
        """Niveaux cochés (déjà normalisés par `toggle_level`) : tout repart de zéro."""
        holder["th_level"] = list(keys) or ["all"]
        holder["th_offset"] = 0
        await _reload_through()

    async def toggle_th_sort() -> None:
        """Clic sur l'en-tête « Difficulté » : inverse le sens du tri."""
        holder["th_sort"] = ("rating_desc" if holder["th_sort"] == "rating_asc"
                             else "rating_asc")
        holder["th_offset"] = 0
        await _reload_through()

    async def th_prev() -> None:
        holder["th_offset"] = max(0, holder["th_offset"] - _TH_PAGE)
        await _reload_through()

    async def th_next() -> None:
        holder["th_offset"] += _TH_PAGE
        await _reload_through()

    async def open_through_puzzle(pid: str) -> None:
        """« Résoudre » : file = les puzzles de la position, même tri, MÊME NIVEAU.

        Le filtre de niveau s'applique aussi à la file : « puzzle suivant » ne doit
        pas faire sortir l'élève de sa plage de travail.
        """
        rows = await run.io_bound(
            lambda: data.puzzles_through_multi(
                state.normalized_fen, levels_ranges(holder["th_level"]),
                sort=holder["th_sort"], limit=60, offset=0,
            )
        )
        ids = [s.puzzle_id for s in rows]
        if pid not in ids:
            ids = [pid] + ids
        await enter_puzzle(pid, queue=ids, queue_idx=ids.index(pid))

    async def recompute() -> None:
        holder["pz_offset"] = 0
        holder["th_offset"] = 0
        await refresh_board()
        moves_label.set_text(state.moves_line(figurine=True) or "position de départ")
        nfen = state.normalized_fen

        def work() -> _PanelData:
            counts = data.counts(nfen)
            ready = _through_ready()
            return _PanelData(
                counts=counts,
                continuations=data.continuations(state, counts.through_count),
                squares=data.position_squares(nfen),
                through=_through_page(nfen) if ready else [],
                through_total=_through_total(nfen, counts) if ready else 0,
            )

        busy.set_visibility(True)
        try:
            holder["data"] = await run.io_bound(work)
        finally:
            busy.set_visibility(False)
        render_info.refresh()

    async def _resolve_move(frm: str, to: str):
        """Coup légal correspondant au drag (dialogue si promotion), ou None."""
        try:
            cands = state.moves_between(chess.parse_square(frm), chess.parse_square(to))
        except ValueError:
            cands = []
        if not cands:
            return None
        if len(cands) == 1 and cands[0].promotion is None:
            return cands[0]
        return await _ask_promotion(state.board.turn, cands)  # None si annulé

    async def handle_drop(e) -> None:
        frm, to = (e.args or {}).get("from"), (e.args or {}).get("to")
        move = await _resolve_move(frm, to) if (frm and to) else None
        if move is None:
            await refresh_board()                 # illégal/annulé → retour
            return
        if holder["mode"] == "puzzle":
            await _puzzle_try(move)
        else:
            state.board.push(move)
            holder["redo"].clear()          # nouveau coup = la branche « rejouer » meurt
            await recompute()

    async def go_move(uci: str) -> None:
        state.push_uci(uci)
        holder["redo"].clear()
        await recompute()

    # --- navigation clavier : ← annule, → rejoue (exploration seulement) ---
    async def nav_key(e) -> None:
        if holder["mode"] != "explore":
            return
        if (e.args or {}).get("dir") == "back":
            await do_undo()
        else:
            await do_redo()

    async def do_redo() -> None:
        if holder["mode"] == "explore" and holder["redo"]:
            state.board.push(holder["redo"].pop())
            await recompute()

    # --- liste de puzzles de la position (tri / pagination) --------------
    def set_pz_sort(value: str) -> None:
        holder["pz_sort"] = value
        holder["pz_offset"] = 0
        render_info.refresh()

    def pz_prev() -> None:
        holder["pz_offset"] = max(0, holder["pz_offset"] - _PZ_PAGE)
        render_info.refresh()

    def pz_next() -> None:
        holder["pz_offset"] += _PZ_PAGE
        render_info.refresh()

    async def open_puzzle_from_list(puzzle_id: str) -> None:
        # file = tous les puzzles de la position dans le tri courant (pour « suivant »)
        nfen = state.normalized_fen
        ids = [p.puzzle_id for p in data.puzzles_at(nfen, sort=holder["pz_sort"], limit=200)]
        idx = ids.index(puzzle_id) if puzzle_id in ids else 0
        await enter_puzzle(puzzle_id, queue=ids, queue_idx=idx)

    # --- solveur de puzzles ----------------------------------------------
    async def enter_puzzle(
        puzzle_id: str, *, queue: list[str] | None = None, queue_idx: int = 0
    ) -> None:
        pd = await run.io_bound(data.puzzle, puzzle_id)
        if pd is None or len(pd.moves) < 2:
            ui.notify("Puzzle indisponible.", type="negative")
            return
        board = chess.Board(pd.fen)
        board.push_uci(pd.moves[0])               # coup adverse : pose le puzzle
        # conserve le board d'exploration (AVEC son historique de coups) ; si on
        # enchaîne les puzzles, on transmet celui déjà mémorisé
        explore_board = (
            holder["puzzle"].explore_board if holder["mode"] == "puzzle"
            else state.board.copy()
        )
        holder["puzzle"] = _PuzzleSession(
            data=pd, solution=pd.moves[1:], solver_color=board.turn,
            explore_board=explore_board, queue=queue or [puzzle_id], queue_idx=queue_idx,
        )
        holder["mode"] = "puzzle"
        holder["hint"] = None
        state.board = board
        state.orientation = board.turn            # solveur en bas
        await refresh_board()
        moves_label.set_text("")
        render_info.refresh()

    async def next_puzzle() -> None:
        sess: _PuzzleSession = holder["puzzle"]
        if sess and sess.has_next:
            await enter_puzzle(
                sess.queue[sess.queue_idx + 1], queue=sess.queue,
                queue_idx=sess.queue_idx + 1,
            )

    async def exit_puzzle() -> None:
        # restaure le board d'exploration INTÉGRAL (position + pile de coups) :
        # le fil de coups reste juste et « ← Annuler » redéroule les coups
        sess = holder["puzzle"]
        state.board = sess.explore_board if sess else chess.Board()
        state.orientation = chess.WHITE
        holder["mode"] = "explore"
        holder["puzzle"] = None
        holder["hint"] = None
        await recompute()

    async def _puzzle_try(move: chess.Move) -> None:
        sess: _PuzzleSession = holder["puzzle"]
        holder["hint"] = None
        expected = sess.solution[sess.idx]
        # bon coup, OU coup alternatif qui mate (dernier coup)
        state.board.push(move)
        mates = state.board.is_checkmate()
        if move.uci() == expected or mates:
            sess.feedback = ""
            sess.idx += 1
            if sess.idx >= len(sess.solution) or mates:
                sess.solved = True
            else:                                  # réponse adverse automatique
                state.board.push_uci(sess.solution[sess.idx])
                sess.idx += 1
                if sess.idx >= len(sess.solution):
                    sess.solved = True
            await refresh_board()
        else:                                      # mauvais coup : on annule
            state.board.pop()
            sess.feedback = "wrong"
            await refresh_board()
        render_info.refresh()

    async def show_solution() -> None:
        sess: _PuzzleSession = holder["puzzle"]
        holder["hint"] = None
        sess.feedback = ""
        while sess.idx < len(sess.solution):
            state.board.push_uci(sess.solution[sess.idx])
            sess.idx += 1
            await refresh_board()
            await asyncio.sleep(0.45)              # petite animation
        sess.solved = True
        render_info.refresh()

    async def give_hint() -> None:
        sess: _PuzzleSession = holder["puzzle"]
        if sess.solved or sess.idx >= len(sess.solution):
            return
        holder["hint"] = chess.Move.from_uci(sess.solution[sess.idx]).from_square
        await refresh_board()

    def _leave_puzzle_mode() -> None:
        """Charger une nouvelle position VAUT sortie du solveur — sans ça, le
        panneau puzzle restait affiché sur une position qui n'était plus la sienne."""
        holder["mode"] = "explore"
        holder["puzzle"] = None
        holder["hint"] = None
        holder["redo"].clear()              # nouvelle position = branche morte
        state.orientation = chess.WHITE

    async def load_position() -> None:
        try:
            state.set_position(pos_input.value or "")
        except PositionParseError:
            ui.notify("Position invalide (FEN ou coups UCI attendus).", type="negative")
            return
        pos_input.set_value(None)
        _leave_puzzle_mode()
        await recompute()

    async def load_opening(tag) -> None:
        """Sélecteur d'ouverture : joue les coups de l'ouverture nommée."""
        if not tag or tag not in _OPENINGS_MOVES:
            return
        state.set_moves(_OPENINGS_MOVES[tag])
        _leave_puzzle_mode()
        await recompute()

    async def do_reset() -> None:
        state.reset()
        state.orientation = chess.WHITE
        holder["mode"] = "explore"
        holder["puzzle"] = None
        holder["redo"].clear()
        await recompute()

    async def do_undo() -> None:
        if holder["mode"] == "explore" and state.board.move_stack:
            holder["redo"].append(state.board.pop())   # rejouable par →
            await recompute()

    btn_reset.on_click(do_reset)
    btn_undo.on_click(do_undo)
    btn_quit.on_click(exit_puzzle)

    ui.add_body_html(_CG_JS)            # module Chessground (une fois par page)
    ui.on("otkb_drop", handle_drop)     # coups reçus depuis Chessground

    async def on_cg_ready(_e=None) -> None:
        """Le module Chessground est chargé côté client : instancier + pousser
        la position courante. Idempotent (otkbInit ne crée qu'une instance)."""
        await _js("window.otkbInit()")
        await refresh_board()

    ui.on("otkb_cgready", on_cg_ready)
    ui.on("otkb_nav", nav_key)          # flèches ← / → : annuler / rejouer
    # clics du tableau « qui suivent » (HTML brut → événements délégués) :
    # ligne = résoudre, en-tête « Difficulté » = inverser le tri
    ui.on("otkb_pzopen",
          lambda e: open_through_puzzle((e.args or {}).get("id", "")))
    ui.on("otkb_pzsort", lambda e: toggle_th_sort())

    render_info()  # spinner jusqu'au 1er recompute (déclenché par la page)
    return {"recompute": recompute, "enter_puzzle": enter_puzzle}


async def _ask_promotion(color: bool, cands: list):
    """Boîte de dialogue de promotion : renvoie le coup choisi, ou None si annulé."""
    by_pt = {m.promotion: m for m in cands}
    with ui.dialog() as dialog, ui.card().classes("items-center"):
        ui.label("Promotion").classes("text-subtitle2")
        with ui.row().classes("gap-2"):
            for pt in (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT):
                mv = by_pt.get(pt)
                if mv is None:
                    continue
                uri = _piece_data_uri(chess.Piece(pt, color))
                with ui.button(on_click=lambda m=mv: dialog.submit(m)) \
                        .props("flat").style("padding:4px"):
                    ui.image(uri).style("width:48px; height:48px")
    return await dialog


# rampe thermique (froid → brûlant), identique à la fiche ADN / page de garde
_HEAT_STOPS = ((0.0, (225, 230, 234)), (0.28, (244, 206, 94)),
               (0.62, (232, 129, 60)), (1.0, (206, 59, 46)))


def _heat(t: float) -> str:
    """Couleur rgb() interpolée sur la rampe froid→chaud pour t ∈ [0,1]."""
    t = max(0.0, min(1.0, t))
    for i in range(1, len(_HEAT_STOPS)):
        a, ca = _HEAT_STOPS[i - 1]
        b, cb = _HEAT_STOPS[i]
        if t <= b:
            k = (t - a) / (b - a) if b > a else 0.0
            rgb = tuple(round(ca[j] + (cb[j] - ca[j]) * k) for j in range(3))
            return f"rgb({rgb[0]},{rgb[1]},{rgb[2]})"
    return "rgb(206,59,46)"


def _thermal_board_html(squares: dict[str, int], *, white_pov: bool = True) -> str:
    """Échiquier 8×8 (HTML statique) où les cases rougeoient selon leur fréquence.

    Chaleur calculée côté serveur (aucun JS) ; orientée comme l'échiquier principal.
    """
    files = "abcdefgh"
    top = max(squares.values(), default=1) or 1
    ranks = range(8, 0, -1) if white_pov else range(1, 9)
    cols = list(files) if white_pov else list(reversed(files))
    cells: list[str] = []
    for rank in ranks:
        for f, file in enumerate(cols):
            dark = (files.index(file) + rank) % 2 == 0
            base = "var(--otkb-sq-dark)" if dark else "var(--otkb-sq-light)"
            glow = ""
            v = squares.get(f"{file}{rank}")
            if v:
                t = v / top
                col = _heat(t)
                glow = (
                    f'<span style="position:absolute;inset:0;background:radial-gradient('
                    f'circle at 50% 45%,{col} 0%,{col} 55%,transparent 100%);'
                    f'opacity:{0.35 + 0.65 * t:.2f}"></span>'
                )
            cells.append(f'<div style="position:relative;background:{base}">{glow}</div>')
    return (
        '<div style="display:grid;grid-template-columns:repeat(8,1fr);aspect-ratio:1;'
        'width:100%;max-width:240px;margin:.1rem auto 0;border:1px solid var(--otkb-ink,#171C23);'
        f'border-radius:2px;overflow:hidden">{"".join(cells)}</div>'
    )


def _thermal_panel(
    state: BoardState, crit: dict[str, int], sac: dict[str, int]
) -> None:
    """Sous-bloc : carte thermique + bascule critiques ⇄ sacrifices (si les deux)."""
    white_pov = state.orientation == chess.WHITE
    modes: dict[str, str] = {}
    if crit:
        modes["critical"] = "Critiques"
    if sac:
        modes["sacrifice"] = "Sacrifices"
    default = "critical" if crit else "sacrifice"
    sets = {"critical": crit, "sacrifice": sac}

    with ui.column().classes("w-full gap-1 q-mt-sm"):
        with ui.row().classes("w-full items-center justify-between no-wrap"):
            ui.label("Carte thermique · cases disputées").classes("text-xs").style(
                "color:var(--otkb-muted); letter-spacing:.06em; text-transform:uppercase"
            )
            toggle_holder = ui.row().classes("gap-0")
        board = ui.html().classes("w-full")

        def _paint(mode: str) -> None:
            board.set_content(_thermal_board_html(sets[mode], white_pov=white_pov))

        if len(modes) > 1:
            with toggle_holder:
                ui.toggle(modes, value=default, on_change=lambda e: _paint(e.value)) \
                    .props("dense no-caps size=sm").classes("otkb-mono")
        _paint(default)


def _level_chips(selected: list[str], on_change) -> None:
    """Rangée de pastilles à bascule des niveaux élève (état toujours visible).

    `on_change` reçoit la NOUVELLE sélection (déjà normalisée par `toggle_level`).
    Libellés courts, plage Lichess en tooltip pour qui veut vérifier le calibrage.
    """
    with ui.row().classes("items-center gap-1 wrap"):
        ui.label("Niveau élève").classes("text-xs q-mr-xs") \
            .style("color:var(--dim); font-weight:600")
        for lv in LEVELS:
            on = lv.key in selected
            b = ui.button(lv.short,
                          on_click=lambda k=lv.key: on_change(toggle_level(selected, k))) \
                .props("flat dense no-caps") \
                .classes("otkb-lvl" + (" on" if on else ""))
            if lv.key != "all":
                lo = lv.rating_min if lv.rating_min is not None else "…"
                hi = lv.rating_max if lv.rating_max is not None else "…"
                b.tooltip(f"{lv.label} — puzzles Lichess {lo}–{hi}")


_DL_SORTS = {"rating_asc": "Difficulté ↑", "rating_desc": "Difficulté ↓"}


def _open_download_dialog(data: UiData, nfen: str, through_total: int,
                          level_keys: list[str] | None = None) -> None:
    """Dialogue : calibrer et télécharger un dossier PGN des puzzles « à travers ».

    Parle NIVEAUX ÉLÈVE (levels.py, sélection MULTIPLE), pré-réglé sur les niveaux
    cochés dans le tableau — un seul vocabulaire de calibrage dans tout l'outil.
    Tri par difficulté seulement (« Popularité » y déclenchait la jointure à
    1,4-17 s : retirée, comme du tableau).
    ⚠️ Le rafraîchissement passe par `run.io_bound` : sa version synchrone bloquait
    la boucle asyncio pendant le comptage, et > 2 s = websocket NiceGUI morte.
    """
    st = {"sort": "rating_asc", "levels": list(level_keys or ["all"]),
          "limit": 45, "full": False}

    with ui.dialog() as dialog, ui.card().classes("w-96 max-w-full"):
        ui.label("Dossier de puzzles à donner à un élève").classes("text-subtitle1")
        ui.label("Puzzles dont une partie passe par cette position, "
                 "à un moment ou un autre.").classes("text-xs text-grey")

        async def _on_levels(keys: list[str]) -> None:
            st["levels"] = keys
            render_chips.refresh()
            await _refresh()

        @ui.refreshable
        def render_chips() -> None:
            _level_chips(st["levels"], _on_levels)

        render_chips()
        ui.select(_DL_SORTS, value=st["sort"], label="Tri",
                  on_change=lambda e: (st.update(sort=e.value), _refresh())) \
            .props("dense options-dense").classes("w-full")
        ui.number("Nombre de puzzles (lot)", value=st["limit"], min=1, step=5, format="%d",
                  on_change=lambda e: st.update(limit=_as_int(e.value) or 1)) \
            .props("dense").classes("w-full")
        ui.switch("Partie complète (depuis le coup 1, avec [%start])",
                  value=st["full"], on_change=lambda e: st.update(full=e.value)) \
            .props("dense").classes("text-sm")

        count_label = ui.label().classes("text-sm text-primary q-mt-xs")
        preview = ui.column().classes("w-full gap-0 q-mt-xs")

        async def _refresh() -> None:
            ranges = levels_ranges(st["levels"])

            def work():
                total = data.count_through_multi(nfen, ranges)
                rows = data.puzzles_through_multi(
                    nfen, ranges, sort=st["sort"], limit=5
                )
                return total, rows

            total, rows = await run.io_bound(work)
            count_label.set_text(f"{_fmt(total)} puzzle(s) correspondent au filtre")
            preview.clear()
            with preview:
                for s in rows:
                    ui.label(f"⚑ {s.rating if s.rating is not None else '—'}  ·  "
                             f"{_fr_themes(s.themes)}") \
                        .classes("text-xs text-grey ellipsis")

        async def _do_download() -> None:
            ranges = levels_ranges(st["levels"])
            text = await run.io_bound(
                lambda: data.through_pgn_multi(
                    nfen, ranges, sort=st["sort"], limit=st["limit"],
                    annotated=st["full"],
                )
            )
            fname = f"puzzles_{nfen.split()[0][:12]}_{'-'.join(st['levels'])}.pgn"
            ui.download(text.encode("utf-8"), fname.replace("/", "-"))
            ui.notify("Dossier PGN téléchargé", type="positive")

        with ui.row().classes("w-full justify-end gap-2 q-mt-sm"):
            ui.button("Fermer", on_click=dialog.close).props("flat dense no-caps")
            ui.button("Télécharger le PGN", icon="download", on_click=_do_download) \
                .props("dense no-caps color=primary")

    dialog.open()
    ui.timer(0.05, _refresh, once=True)


def _as_int(v) -> int | None:
    """Convertit la valeur d'un ui.number en int ou None (champ vidé)."""
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _puzzle_row(summary, on_open) -> None:
    """Une ligne de puzzle : bouton Résoudre + rating + thèmes."""
    with ui.row().classes("w-full items-center gap-2 no-wrap"):
        ui.button("Résoudre", icon="play_arrow",
                  on_click=lambda p=summary.puzzle_id: on_open(p)) \
            .props("dense outline size=sm no-caps")
        ui.label(str(summary.rating if summary.rating is not None else "—")) \
            .classes("text-sm text-primary").style("width:42px")
        ui.label(_fr_themes(summary.themes)) \
            .classes("text-xs text-grey ellipsis").style("flex:1; min-width:0")


def _pager(offset: int, page: int, total: int, on_prev, on_next) -> None:
    """Barre de pagination 'Précédent / X–Y sur N / Suivant'."""
    if total <= page:
        return
    lo, hi = offset + 1, min(offset + page, total)
    with ui.row().classes("w-full items-center justify-between no-wrap q-mt-xs"):
        ui.button(icon="chevron_left", on_click=on_prev) \
            .props("dense flat size=sm").set_enabled(offset > 0)
        ui.label(f"{lo}–{hi} sur {total}").classes("text-xs text-grey")
        ui.button(icon="chevron_right", on_click=on_next) \
            .props("dense flat size=sm").set_enabled(hi < total)


def _card_through(rows: list[_Preview], total: int, sort: str, level: list[str],
                  offset: int, page: int, on_level, on_prev, on_next,
                  on_download=None) -> None:
    """Les puzzles qui SUIVENT la position — le HÉROS de l'écran.

    À distinguer de `_card_puzzles`, qui liste ceux qui DÉMARRENT exactement ici :
    dans l'ouverture ce dernier est presque toujours vide (0 puzzle démarre à 1.e4,
    alors que 779 k parties y passent). C'est cette liste-ci qui répond à « qu'est-ce
    que mes élèves vont rencontrer à partir d'ici ».

    Piste B (validée sur maquette) : TABLEAU dense + panneau d'aperçu fixe, le
    schéma ChessBase. Survoler une ligne met à jour l'échiquier d'aperçu (seconde
    instance Chessground viewOnly — mêmes cases, mêmes pièces que l'échiquier
    principal, par construction) ; cliquer ouvre le solveur ; cliquer l'EN-TÊTE
    « Difficulté » inverse le tri. Le sélecteur de NIVEAU parle la langue du coach
    (Elo FIDE / débutant, cf. levels.py) et filtre par la plage Lichess associée —
    le rating Lichess du puzzle reste affiché ligne à ligne.
    """
    with ui.card().classes("w-full"):
        with ui.row().classes("w-full items-center justify-between no-wrap"):
            with ui.row().classes("items-baseline gap-2 no-wrap"):
                ui.label("Puzzles qui suivent").classes("text-subtitle1")
                ui.label(_fmt(total)).classes("otkb-mono text-sm") \
                    .style("color:var(--indigo); font-weight:600")
            if on_download is not None:
                # Télécharger vit À CÔTÉ de ce qu'il exporte : le dialogue
                # s'ouvre pré-réglé sur les niveaux cochés
                ui.button("Télécharger", icon="download",
                          on_click=lambda: on_download()) \
                    .props("dense no-caps outline") \
                    .tooltip("Dossier PGN de ces puzzles, calibré par niveau")
        # pastilles de niveau : cocher plusieurs = union des plages (groupe hétérogène)
        with ui.element("div").classes("q-mb-xs"):
            _level_chips(level, on_level)
        if not rows:
            ui.label("Aucun puzzle de ce niveau ne suit cette position — élargissez "
                     "le niveau ou jouez d'autres coups.").classes("text-xs") \
                .style("color:var(--dim)")
            return
        with ui.row().classes("w-full no-wrap items-start gap-4"):
            # — le tableau (héros), largeur BORNÉE : sans borne il s'étalait et
            # laissait un vide entre les motifs et l'aperçu (retour utilisateur) —
            with ui.column().classes("gap-0").style("flex:0 1 660px; min-width:0"):
                ui.html(_through_table_html(rows, sort), sanitize=False).classes("w-full") \
                    .style("overflow-x:auto")
                _pager(offset, page, total, on_prev, on_next)
            # — l'aperçu épinglé (Chessground viewOnly) ; masqué en étroit (CSS) —
            with ui.column().classes("gap-1 otkb-prevcol"):
                ui.element("div").props("id=otkb-cg-prev") \
                    .classes("cg-wrap rounded overflow-hidden") \
                    .style("width:100%; aspect-ratio:1; border:1px solid var(--border)")
                ui.label("Survolez une ligne").props("id=otkb-prev-cap") \
                    .classes("otkb-mono text-xs").style("color:var(--dim); min-height:1.2em")
        # aperçu de la 1re ligne dès que le DOM de la page est en place
        ui.timer(0.15, lambda: _js("window.otkbPrevFirst && window.otkbPrevFirst()"),
                 once=True)


def _through_table_html(rows: list[_Preview], sort: str) -> str:
    """Le tableau en HTML brut : lignes légères, data-attrs pour le survol/clic.

    HTML brut plutôt que composants NiceGUI : une vraie <table> (sémantique et
    layout corrects), des data-attrs simples, et UNE seule mise à jour DOM par
    page. Les FEN (placement seul) et ids sont sans espaces ni caractères HTML ;
    les thèmes traduits passent par html.escape. L'en-tête « Difficulté » porte la
    direction du tri courant et se clique pour l'inverser (`otkb_pzsort`).
    """
    import html as _html

    cells = []
    for p in rows:
        s = p.summary
        rating = s.rating if s.rating is not None else "—"
        trait_cls, trait = ("wt", "Blancs") if p.white_to_move else ("bk", "Noirs")
        cap = f"⚑ {rating} — trait aux {trait}"
        themes = _html.escape(_fr_themes(s.themes))
        cells.append(
            f'<tr data-pzid="{s.puzzle_id}" data-pzfen="{p.fen}" '
            f'data-pzorient="{"white" if p.white_to_move else "black"}" '
            f'data-pzcap="{cap}" tabindex="0" role="button" '
            f'aria-label="Résoudre le puzzle {s.puzzle_id}, difficulté {rating}, '
            f'trait aux {trait}">'
            f'<td><span class="otkb-diff">⚑ {rating}</span></td>'
            f'<td><span class="otkb-trait {trait_cls}"></span>{trait}</td>'
            f'<td class="themes">{themes}</td></tr>'
        )
    asc = sort == "rating_asc"
    arrow = "▲" if asc else "▼"
    # pas de colonne « Résoudre » (retirée, décision utilisateur) : toute la ligne
    # est cliquable/focusable et son aria-label l'annonce — l'étiquette était
    # redondante et mangeait la place des motifs.
    return (
        '<table class="otkb-pztable" aria-label="Puzzles qui suivent la position">'
        '<thead><tr>'
        f'<th class="sort" data-pzsort="1" tabindex="0" role="button" '
        f'aria-sort="{"ascending" if asc else "descending"}" '
        f'title="Inverser le tri par difficulté">'
        f"Difficulté {arrow}</th><th>Trait</th><th>Motifs</th>"
        f'</tr></thead><tbody>{"".join(cells)}</tbody></table>'
    )


def _card_puzzles(data, nfen, total, sort, offset, page,
                  on_open, on_sort, on_prev, on_next) -> None:
    """Liste triable/paginée des puzzles démarrant à la position."""
    if not total:
        return
    rows = data.puzzles_at(nfen, sort=sort, limit=page, offset=offset)
    with ui.card().classes("w-full"):
        with ui.row().classes("w-full items-center justify-between no-wrap"):
            ui.label(f"Puzzles à résoudre ici ({_fmt(total)})").classes("text-subtitle2")
            ui.select(_PZ_SORTS, value=sort, on_change=lambda e: on_sort(e.value)) \
                .props("dense options-dense borderless").classes("text-xs")
        for s in rows:
            _puzzle_row(s, on_open)
        _pager(offset, page, total, on_prev, on_next)


def _puzzle_panel(sess, on_hint, on_solution, on_exit, on_next) -> None:
    """Panneau du solveur : consigne, progression, indice/solution/retour/suivant."""
    with ui.card().classes("w-full"):
        with ui.row().classes("w-full items-center justify-between no-wrap"):
            title = f"Puzzle {sess.data.puzzle_id}"
            if len(sess.queue) > 1:
                title += f"  ({sess.queue_idx + 1}/{len(sess.queue)})"
            ui.label(title).classes("text-subtitle1")
            if sess.data.rating is not None:
                ui.label(f"⚑ {sess.data.rating}").classes("text-primary")

        # tokens sémantiques (et non couleurs en dur) : leurs variantes sombres
        # tiennent le contraste AA — #c0392b sur fond sombre tombait à 3,3:1
        if sess.solved:
            ui.label("Résolu ✔").classes("text-h6").style("color:var(--green-ink)")
        elif sess.feedback == "wrong":
            ui.label("Ce n'est pas la solution — réessayez.").classes("text-sm") \
                .style("color:var(--red-ink)")
        else:
            trait = "Blancs" if sess.solver_color == chess.WHITE else "Noirs"
            ui.label(f"Trait aux {trait} — trouvez le meilleur coup.").classes("text-sm")

        if sess.solver_total:
            ui.linear_progress(
                value=sess.solver_done / sess.solver_total, show_value=False
            ).props("rounded").classes("w-full")
            ui.label(f"{sess.solver_done} / {sess.solver_total} coup(s) trouvé(s)") \
                .classes("text-xs text-grey")

        themes = [t for t in (sess.data.themes or "").split() if t]
        if themes:
            with ui.row().classes("gap-1 wrap q-mt-xs"):
                for t in themes[:8]:
                    ui.badge(_THEME_FR.get(t, t)).props("outline color=grey")

        with ui.row().classes("w-full gap-2 q-mt-sm wrap"):
            if not sess.solved:
                ui.button("Indice", icon="lightbulb", on_click=on_hint) \
                    .props("dense outline size=sm no-caps")
                ui.button("Voir la solution", icon="visibility", on_click=on_solution) \
                    .props("dense outline size=sm no-caps")
            if sess.has_next:
                ui.button("Puzzle suivant", icon="skip_next", on_click=on_next) \
                    .props("dense size=sm no-caps color=primary")
            ui.button("Retour", icon="arrow_back", on_click=on_exit) \
                .props("dense outline size=sm no-caps")

        if sess.data.game_url:
            ui.link("Partie sur Lichess ↗", sess.data.game_url, new_tab=True) \
                .classes("text-xs q-mt-xs")


def _suites_strip(through: int, conts: list[Continuation] | None, go_move) -> None:
    """Bande « Suites les plus jouées » : pastilles SOULIGNÉES, au-dessus du tableau.

    Composition « Flux » validée sur maquette (16/07) : l'ordre de lecture suit le
    geste du coach — où va la partie (les suites) → quels puzzles ici (le tableau).
    Chaque pastille = coup en figurine + part des parties ; le trait indigo sous la
    pastille est proportionnel à cette part (relative au coup le plus joué, sinon
    les coups à 3 % seraient invisibles). Clic = jouer le coup. Remplace les cartes
    « Motifs tactiques ici » et « Ouvertures ici » (supprimées, décision
    utilisateur : quasi toujours vides dans l'ouverture) et l'ancienne carte
    suites à barres (identité dépassée).
    """
    with ui.card().classes("w-full q-py-sm"):
        with ui.row().classes("items-center gap-2 wrap"):
            ui.label("Suites les plus jouées").classes("text-subtitle2") \
                .style("flex:0 0 auto; margin:0")
            if through <= 0:
                ui.label("Index des parties vide pour cette position.") \
                    .classes("text-xs").style("color:var(--dim)")
                return
            if conts is None and through > CONTINUATIONS_CAP:
                # base sans le cache `position_children` uniquement (garde-fou)
                ui.label(f"Position très fréquente ({_fmt(through)} parties) — lancez "
                         "python -m otkb build-counts pour des suites instantanées.") \
                    .classes("text-xs").style("color:var(--dim)")
                return
            if not conts:
                ui.label("Aucune suite indexée au-delà de cette position.") \
                    .classes("text-xs").style("color:var(--dim)")
                return
            top = conts[0].game_count
            for c in conts:
                pct = 100.0 * c.game_count / through if through else 0.0
                rel = c.game_count / top if top else 0.0
                with ui.button(on_click=lambda _e=None, u=c.uci: go_move(u)) \
                        .props("flat dense no-caps").classes("otkb-mvpill") as b:
                    ui.html(f'<span class="under" style="transform:scaleX({rel:.3f})"></span>'
                            f'<span class="mv">{to_figurine(c.san)}</span>'
                            f'<span class="pc">{pct:.1f}%</span>')
                b.tooltip(f"{_fmt(c.game_count)} parties — jouer {to_figurine(c.san)}")


# ---------------------------------------------------------------------------
# Vue Comparaison (lectures cachées, instantanées : pas d'offload nécessaire)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Vue « Meilleurs puzzles par ouverture »
# ---------------------------------------------------------------------------
