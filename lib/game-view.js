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

Object.assign(window, { closeGameView, openGameDocked, gvToggleTools });
