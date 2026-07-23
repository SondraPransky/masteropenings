// ══════════════════════════════════════════════════════
// VUE COACH — Explorateur : dialogue « Dossier de puzzles à donner à un élève ».
//
// Transposition de _open_download_dialog (otkb/ui/app.py) : niveaux élève
// (pré-réglés sur les pastilles cochées du tableau — un seul vocabulaire de
// calibrage), tri par difficulté seulement, taille du lot, partie complète
// [%start], compteur live + aperçu des 5 premiers.
//
// Sous-fonctionnalité AUTONOME, extraite de coach-explorer.js (§2 de la revue) :
// son état (`_expDl`) est à elle ; son seul lien avec l'explorateur est la
// lecture de la position/niveaux courants via le socle `EX`.
// ══════════════════════════════════════════════════════
import { escapeHtml } from './coach-core.js';
import { ODP_BRIDGE_URL, EX, toggleLevel, levelChipsHTML } from './coach-explorer-core.js';

const _expDl = { levels: ['all'] };

function explorerOpenExport() {
  if (!EX.nfen) { window.toast?.('⚠ Explore d\'abord une position', 'ko'); return; }
  _expDl.levels = EX.levels.slice();          // pré-réglé sur le tableau
  _expDlRenderLevels();
  document.getElementById('modal-exp-export')?.classList.add('on');
  _expDlRefresh();
}

function _expDlRenderLevels() {
  const host = document.getElementById('expdl-levels');
  if (host) host.innerHTML = levelChipsHTML(EX.levelDefs, _expDl.levels, 'explorerDlToggleLevel');
}

function explorerDlToggleLevel(key) {
  _expDl.levels = toggleLevel(_expDl.levels, key, EX.levelDefs);
  _expDlRenderLevels();
  _expDlRefresh();
}

function _expDlParams() {
  const sort = document.getElementById('expdl-sort')?.value || 'rating_asc';
  const levels = _expDl.levels.includes('all') ? '' : `&levels=${_expDl.levels.join(',')}`;
  return { sort, levels };
}

async function _expDlRefresh() {
  const countEl = document.getElementById('expdl-count');
  const prevEl = document.getElementById('expdl-preview');
  if (!countEl) return;
  const { sort, levels } = _expDlParams();
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/through?${EX.posParam()}&limit=5&sort=${sort}${levels}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'pont');
    countEl.textContent = `${(data.total || 0).toLocaleString('fr-FR')} puzzle${(data.total || 0) > 1 ? 's' : ''} correspondent au filtre`;
    if (prevEl) prevEl.innerHTML = (data.puzzles || []).map(p =>
      `<div class="exp-dl-line">⚑ ${p.rating ?? '—'} · ${escapeHtml(p.themes_fr || '')}</div>`).join('');
  } catch (e) {
    countEl.textContent = '';
    if (prevEl) prevEl.innerHTML = `<span class="exp-err">${escapeHtml(String(e.message || e))}</span>`;
  }
}

async function explorerDlDownload() {
  const { sort, levels } = _expDlParams();
  const limit = Math.max(1, parseInt(document.getElementById('expdl-limit')?.value, 10) || 45);
  const full = document.getElementById('expdl-full')?.checked ? '&full=1' : '';
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/export?${EX.posParam()}&limit=${limit}&sort=${sort}${levels}${full}`);
    if (!r.ok) throw new Error('export');
    const pgn = await r.text();
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // même nom que l'original : puzzles_<fen court>_<niveaux>.pgn
    const fenPart = (EX.nfen.split(/\s+/)[0] || 'position').slice(0, 12).replace(/\//g, '-');
    a.download = `puzzles_${fenPart}_${_expDl.levels.join('-')}.pgn`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    window.toast?.('✓ Dossier PGN téléchargé', 'ok');
    window.closeModal?.('modal-exp-export');
  } catch {
    window.toast?.('❌ Échec de l\'export PGN', 'ko');
  }
}

// Export direct conservé pour le pont window (compat).
async function explorerExportPgn() { explorerOpenExport(); }

Object.assign(window, {
  explorerExportPgn, explorerOpenExport, explorerDlToggleLevel,
  explorerDlDownload, _expDlRefresh,
});
