// ══════════════════════════════════════════════════════
// lib/game-view.js — LECTURE D'UNE PARTIE D'ÉLÈVE (voir d'abord, Annoter en 2e)
//
// Arbitrage du grill (29/07) : ouvrir la partie d'un élève montre d'abord un écran
// de LECTURE (grand échiquier + navigation + panneau Référence), sans les outils
// d'annotation. Un bouton « Annoter » bascule vers l'éditeur d'annotation existant
// (openReviewEditor). Le coach regarde tranquillement, il annote s'il le veut.
//
// Échiquier STATIQUE (renderStaticBoard) : la lecture n'a pas besoin de drag, juste
// de naviguer. Clic sur un coup de la Référence = EXPLORATION hors de la partie
// (une ligne temporaire depuis la position courante) avec « revenir à la partie ».
// ══════════════════════════════════════════════════════
import { S } from './session.js';
import { fig, pgnMainlineSans, pgnStartFen } from './core.js';
import { renderStaticBoard } from './miniboard.js';

const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

// fens[0] = position de départ ; fens[i] = après le i-ème coup. sans[i] = i-ème coup.
// tab : panneau de droite — 'moves' (coups) ou 'ref' (Référence, fetch seulement si actif).
const _GV = { pgn: '', fens: [], sans: [], idx: 0, flip: false, meta: null, explore: null, tab: 'moves' };

function openGameView(pgn, meta = {}) {
  const startFen = pgnStartFen(pgn) || new Chess().fen();
  const g = new Chess(startFen);
  const fens = [startFen], sans = [];
  for (const s of pgnMainlineSans(pgn)) {
    const mv = g.move(s, { sloppy: true });
    if (!mv) break;                 // coup illisible → on s'arrête là (partie tronquée bénigne)
    sans.push(mv.san); fens.push(g.fen());
  }
  _GV.pgn = pgn; _GV.fens = fens; _GV.sans = sans;
  _GV.idx = fens.length - 1;         // on ouvre sur la position finale (« montre-moi la partie »)
  _GV.flip = meta.side === 'b'; _GV.meta = meta; _GV.explore = null;
  _GV.tab = 'moves'; _gvSyncTab();   // chaque partie s'ouvre sur ses coups
  // Ecran normal (plus une pop-up) : on remplace la LISTE des parties par la lecture,
  // dans la section Parties elle-meme (patron drill-down d'openClassDetail).
  const list = document.getElementById('prof-parties-content'); if (list) list.style.display = 'none';
  const panel = document.getElementById('pg-gameview'); if (panel) panel.style.display = '';
  _gvRender();
}

// Retour a la liste des parties (bouton « ← Parties »).
function closeGameView() {
  const panel = document.getElementById('pg-gameview'); if (panel) panel.style.display = 'none';
  const list = document.getElementById('prof-parties-content'); if (list) list.style.display = '';
  window.renderPartiesTab?.();   // rafraichit les statuts (une partie a pu etre annotee entre-temps)
}

function _gvCurFen() { return _GV.explore ? _GV.explore.game.fen() : _GV.fens[_GV.idx]; }

function _gvBoardSize() {
  // Derive de la largeur REELLE du panneau (il vit dans la zone de contenu coach,
  // a droite de la sidebar) — plus du window (l'ancienne overlay pleine largeur).
  const panel = document.getElementById('pg-gameview');
  const w = (panel && panel.clientWidth) ? panel.clientWidth : (window.innerWidth - 250);
  if (w < 720) return Math.min(w - 32, 460);             // empilé : pleine largeur bornée
  return Math.max(300, Math.min(480, w - 300 - 56));     // côte-à-côte : - panneau (min 260) - bordure/paddings
}

function _gvRender() {
  const board = document.getElementById('gv-board');
  if (!board) return;
  board.innerHTML = renderStaticBoard(_gvCurFen(), { size: _gvBoardSize(), flip: _GV.flip });

  const m = _GV.meta || {};
  const title = document.getElementById('gv-title');
  if (title) title.innerHTML = `<i class="ti ti-chess" aria-hidden="true"></i> ${escapeHtml(m.white || '?')} – ${escapeHtml(m.black || '?')}`;

  const exBar = document.getElementById('gv-explore-bar');
  if (exBar) exBar.style.display = _GV.explore ? '' : 'none';

  // Bande de notation : coups cliquables ; le coup courant surligné (hors exploration).
  const nt = document.getElementById('gv-notation');
  if (nt) {
    nt.innerHTML = _GV.sans.map((san, i) => {
      const ply = i + 1;               // fens[i+1] = après ce coup
      const white = i % 2 === 0;
      const num = white ? `<span class="gv-mv-num">${Math.floor(i / 2) + 1}.</span>` : '';
      const cur = !_GV.explore && _GV.idx === ply ? ' cur' : '';
      return `${num}<button type="button" class="gv-mv${cur}" onclick="gvGoto(${ply})">${fig(escapeHtml(san))}</button>`;
    }).join(' ') || '<span style="color:var(--dim);font-size:.8rem">Partie sans coup jouable.</span>';
  }

  // La Référence ne se rend (et ne fetch) que si son onglet est actif.
  if (_GV.tab === 'ref') window.renderReferencePanel?.({ hostId: 'gv-ref', fen: _gvCurFen(), onMove: _gvExplore });
}

// ── Onglets du panneau de droite : Coups | Référence ────────────────────────────
function _gvSyncTab() {
  const moves = _GV.tab === 'moves';
  const bm = document.getElementById('gv-tab-moves'), br = document.getElementById('gv-tab-ref');
  if (bm) { bm.classList.toggle('on', moves); bm.setAttribute('aria-selected', String(moves)); }
  if (br) { br.classList.toggle('on', !moves); br.setAttribute('aria-selected', String(!moves)); }
  const nt = document.getElementById('gv-notation'); if (nt) nt.style.display = moves ? '' : 'none';
  const rf = document.getElementById('gv-ref'); if (rf) rf.style.display = moves ? 'none' : '';
}
function gvTab(t) {
  _GV.tab = t === 'ref' ? 'ref' : 'moves';
  _gvSyncTab();
  if (_GV.tab === 'ref') window.renderReferencePanel?.({ hostId: 'gv-ref', fen: _gvCurFen(), onMove: _gvExplore });
}

function gvGoto(i) { _GV.explore = null; _GV.idx = Math.max(0, Math.min(i, _GV.fens.length - 1)); _gvRender(); }
function gvPrev() { gvGoto((_GV.explore ? _GV.idx : _GV.idx - 1)); }
function gvNext() { gvGoto((_GV.explore ? _GV.idx : _GV.idx + 1)); }
function gvGotoEnd() { gvGoto(_GV.fens.length - 1); }
function gvFlip() { _GV.flip = !_GV.flip; _gvRender(); }

// Exploration : jouer un coup de la Référence depuis la position courante, hors partie.
function _gvExplore(san) {
  if (!_GV.explore) _GV.explore = { game: new Chess(_GV.fens[_GV.idx]) };
  const mv = _GV.explore.game.move(san, { sloppy: true });
  if (mv) _gvRender();
}
function gvBackToGame() { _GV.explore = null; _gvRender(); }

// « Annoter » : ouvre l'éditeur d'annotation (une overlay par-dessus l'écran de lecture).
function gvAnnotate() {
  const m = _GV.meta || {};
  window.openReviewEditor?.(_GV.pgn, { gameId: m.gameId, role: m.role || 'coach', white: m.white, black: m.black });
}

// Redimensionnement : l'échiquier statique porte sa taille en dur → re-render.
let _gvResizeT;
window.addEventListener('resize', () => {
  const p = document.getElementById('pg-gameview');
  if (!p || p.style.display === 'none') return;   // l'écran de lecture n'est pas ouvert
  clearTimeout(_gvResizeT);
  _gvResizeT = setTimeout(_gvRender, 140);
});

Object.assign(window, { openGameView, closeGameView, openGameDocked, gvToggleTools, gvGoto, gvPrev, gvNext, gvGotoEnd, gvFlip, gvBackToGame, gvAnnotate, gvTab });
export { openGameView };
