// ══════════════════════════════════════════════════════
// lib/game-view.js — LECTURE D'UNE PARTIE D'ÉLÈVE : un seul écran (03/08)
//
// « Ouvrir » ouvre l'ÉDITEUR existant, ANCRÉ dans la section Parties, en densité
// LECTURE (outils masqués, plateau inerte) : le calme d'un lecteur, mais les
// variantes et commentaires du coach sont VISIBLES dès la lecture. Le bouton
// ✎ Annoter révèle les outils dans le même écran (editorDensity).
//
// L'ancien lecteur statique (échiquier renderStaticBoard + notation mainline)
// a été SUPPRIMÉ après validation utilisatrice du 03/08 — il ne rendait que la
// ligne principale, d'où l'obligation d'une 2e vue pour voir les annotations.
// Ce fichier ne garde que l'orchestration de la section (ouvrir/fermer/densité).
// ══════════════════════════════════════════════════════

import { G } from '../state.js';
import { pgnMainlineSans, moveLabel } from './core.js';
import { gameFaults } from './weakness-core.js';

const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

function closeGameView() {
  if (window._E?.docked) window.closeEditorModal?.();   // restitue l'éditeur ancré à <body>
  const panel = document.getElementById('pg-gameview'); if (panel) panel.style.display = 'none';
  const hd = document.querySelector('#csec-parties .cs-header'); if (hd) hd.style.display = '';
  const list = document.getElementById('prof-parties-content'); if (list) list.style.display = '';
  window.renderPartiesTab?.();   // rafraichit les statuts (une partie a pu etre annotee entre-temps)
}

// « Ouvrir » : l'éditeur ancré dans la section, en densité lecture.
function openGameDocked(pgn, meta = {}) {
  const list = document.getElementById('prof-parties-content'); if (list) list.style.display = 'none';
  // L'en-tête de section (« Parties » + sous-titre) redirait ce que la tête de
  // l'écran dit déjà (retour · joueurs) → masqué le temps de la lecture (~90px).
  const hd = document.querySelector('#csec-parties .cs-header'); if (hd) hd.style.display = 'none';
  const panel = document.getElementById('pg-gameview'); if (panel) panel.style.display = '';
  const title = document.getElementById('gv-title');
  const who = (meta.white || meta.black) ? `${escapeHtml(meta.white || '?')} – ${escapeHtml(meta.black || '?')}` : 'Partie de l\'élève';
  if (title) title.innerHTML = `<i class="ti ti-chess" aria-hidden="true"></i> ${who}`;
  _gvSyncTools(false);
  window.openReviewEditor?.(pgn, { ...meta, dock: 'gv-dock', density: 'lecture', flipped: meta.side === 'b' });
  _gvRenderMoments(meta.gameId);
}

// ── Moments clés (assistant faiblesses) ─────────────────────────────────────
// Gaffes/erreurs de l'analyse moteur + sortie de répertoire, en chips cliquables
// qui SAUTENT à la position dans l'éditeur ancré. Purement additif : sans
// analyse ni sortie, la bande reste masquée.
function _gvRenderMoments(gameId) {
  const el = document.getElementById('gv-moments');
  if (!el) return;
  el.style.display = 'none'; el.innerHTML = '';
  const g = (G.savedGames || []).find(x => String(x.id) === String(gameId));
  if (!g) return;
  const fg = (x) => window.fig ? window.fig(x) : x;
  const chips = [];
  // Le chemin dans l'arbre est résolu MAINTENANT (openReviewEditor a déjà bâti
  // _E.root, de façon synchrone) : une chip porte sa destination, ou n'existe pas.
  const sans = pgnMainlineSans(g.pgn || '');
  const chip = (ply, cls, title, body) => {
    const path = _gvPathForPly(sans, +ply);
    if (!path) return;   // SAN introuvable dans l'arbre : pas de chip, JAMAIS un saut au hasard
    chips.push(`<button class="gvm-chip ${cls}" data-path="${path.join(',')}" onclick="gvJumpPly(this.dataset.path)"
      title="${title}">${body}</button>`);
  };
  // Sortie de répertoire : on réutilise le calcul mémoïsé de coach-games via le pont.
  const rep = window._pgRepOf?.(g) || null;
  if (rep?.exit) {
    chip(rep.exit.ply, 'gvm-exit',
      `Le répertoire (${escapeHtml(rep.d.name)}) joue ${escapeHtml(rep.exit.expected.join(' ou '))}`,
      `<i class="ti ti-route-off" aria-hidden="true"></i> Sortie du répertoire — ${moveLabel(rep.exit.moveNo, rep.exit.color)} ${fg(escapeHtml(rep.exit.played))}`);
  }
  for (const ft of gameFaults(g)) {
    const pions = (ft.loss / 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    chip(ft.ply, `gvm-${ft.sev}`,
      `${ft.sev === 'blunder' ? 'Gaffe' : 'Erreur'} : perd ~${pions} pion${ft.loss >= 200 ? 's' : ''}${ft.best ? ' — le moteur préférait ' + escapeHtml(ft.best) : ''}`,
      `${moveLabel(ft.moveNo, ft.color)} ${fg(escapeHtml(ft.san))} <b>${ft.sev === 'blunder' ? '??' : '?'}</b>`);
  }
  if (!chips.length) {
    // Pas d'analyse encore : une ligne discrète seulement si le moteur doit passer.
    if (!g.analysis && g.shared) el.innerHTML = `<span class="gvm-pending"><i class="ti ti-loader-2 wq-spin" aria-hidden="true"></i> Analyse moteur en attente…</span>`;
    else return;
  } else {
    el.innerHTML = `<span class="gvm-lbl"><i class="ti ti-wand" aria-hidden="true"></i> Moments clés</span> ${chips.join('')}`;
  }
  el.style.display = '';
}

// Chemin (indices d'enfants) menant au ply N de la PARTIE dans l'arbre de
// l'éditeur ancré. On suit les SAN de la ligne principale : les variantes du
// coach peuvent avoir réordonné les enfants, l'enfant 0 n'est pas la partie.
// → null si la ligne ne se retrouve pas dans l'arbre (aucun repli : sauter à une
//   position approchante surlignerait un coup que l'élève n'a jamais joué).
function _gvPathForPly(sans, ply) {
  const root = window._E?.root;
  if (!root) return null;
  const path = [];
  let node = root;
  for (let i = 0; i <= ply; i++) {
    const idx = (node.children || []).findIndex(c => c.san === sans[i]);
    if (idx < 0) return null;
    node = node.children[idx];
    path.push(idx);
  }
  return path;
}

// La chip porte son chemin déjà résolu (« 0,1,0 ») — plus de PGN à re-parser au
// clic, ni d'état de module à garder synchronisé avec la partie affichée.
function gvJumpPly(csv) {
  const path = String(csv || '').split(',').filter(s => s !== '').map(Number);
  if (path.length) window.editorGoPath?.(path);
}

function _gvSyncTools(on) {
  const tb = document.getElementById('gv-tools-btn');
  if (tb) {
    tb.setAttribute('aria-pressed', String(on));
    tb.innerHTML = on ? '<i class="ti ti-eye" aria-hidden="true"></i> Lecture seule'
                      : '<i class="ti ti-edit" aria-hidden="true"></i> Annoter';
    tb.classList.toggle('btn-primary', !on); tb.classList.toggle('btn-ghost', on);
  }
  const sv = document.getElementById('gv-save-btn'); if (sv) sv.style.display = on ? '' : 'none';
}

function gvToggleTools() {
  const on = window._E?.density === 'lecture';        // on VA vers les outils ?
  window.editorDensity?.(on ? 'annot' : 'lecture');
  _gvSyncTools(on);
}

Object.assign(window, { closeGameView, openGameDocked, gvToggleTools, gvJumpPly });
