// ══════════════════════════════════════════════════════
// VUE COACH — Explorateur de puzzles (pont OTKB local).
//
// Outil de PRÉPARATION : le coach atteint une position d'ouverture, voit les
// puzzles tactiques qui PASSENT PAR elle (through-position) servis par l'usine
// OTKB locale (corpus intégral 18 Go, jamais déployable), et en fait soit un
// PAQUET D'EXERCICES EECoach (assignable, résolvable, suivi Leitner), soit un
// export PGN — le même que l'outil coach OTKB.
//
// Le pont est un serveur HTTP `localhost` (cf. otkb/bridge.py) : EECoach déployé
// sur Pages a le droit de le fetch (localhost = origine « potentially trustworthy »,
// mesuré 200 depuis le vrai site HTTPS). La section est MASQUÉE si le pont ne
// répond pas — pas de bouton mort. Constante en dur ; le jour d'un déploiement en
// ligne, seule cette URL changera (pilote interchangeable).
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { renderStaticBoard } from './miniboard.js';
import { fig, escapeHtml } from './coach-core.js';

const ODP_BRIDGE_URL = 'http://localhost:8127';

// État local (aucune raison de monter dans CS : rien ne traverse d'autres modules).
let _expRows = [];            // dernière page de puzzles chargée
let _expNfen = null;          // FEN normalisée de la position courante
let _expTotal = 0;
const _expSel = new Set();    // ids de puzzles cochés

// ── Détection du pont ─────────────────────────────────
// Révèle/masque le bouton de nav selon que l'usine locale répond. Réutilisable
// (appelée au chargement coach ET une fois à l'import, pour couvrir le dev local
// où _coachLoad ne tourne pas forcément).
async function _expDetectBridge() {
  const btn = document.getElementById('csnav-explorer');
  if (!btn) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const r = await fetch(ODP_BRIDGE_URL + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    const ok = r.ok && (await r.json()).ok === true;
    btn.style.display = ok ? '' : 'none';
    return ok;
  } catch {
    btn.style.display = 'none';
    return false;
  }
}

// ── Rendu de la section ───────────────────────────────
function renderExplorer() {
  // La structure est statique (index.html) ; on (ré)initialise l'aperçu vide.
  const board = document.getElementById('exp-board');
  if (board && !_expNfen) board.innerHTML = '';
  const input = document.getElementById('exp-input');
  if (input) input.focus();
}

async function explorerLoad() {
  const raw = (document.getElementById('exp-input')?.value || '').trim();
  const countEl = document.getElementById('exp-count');
  const resEl = document.getElementById('exp-results');
  if (!raw) { window.toast?.('⚠ Saisis une position (coups UCI ou FEN)', 'ko'); return; }
  // Heuristique FEN vs coups : une FEN contient '/', une liste de coups non.
  const param = raw.includes('/') ? 'fen=' + encodeURIComponent(raw)
                                  : 'moves=' + encodeURIComponent(raw);
  if (countEl) countEl.innerHTML = '<span class="exp-loading">Recherche…</span>';
  if (resEl) resEl.innerHTML = '';
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/through?${param}&limit=45`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur du pont');
    _expNfen = data.nfen; _expTotal = data.total; _expRows = data.puzzles || [];
    _expSel.clear();
    const board = document.getElementById('exp-board');
    if (board) board.innerHTML = renderStaticBoard(_expNfen, { size: 180 });
    if (countEl) {
      countEl.innerHTML = _expTotal
        ? `<strong>${_expTotal.toLocaleString('fr-FR')}</strong> puzzle${_expTotal > 1 ? 's' : ''} passent par cette position${_expTotal > _expRows.length ? ` · <span class="exp-hint">${_expRows.length} affichés (les plus populaires)</span>` : ''}`
        : 'Aucun puzzle ne passe par cette position.';
    }
    _expRenderTable();
    _expSyncActionbar();
  } catch (e) {
    if (countEl) countEl.innerHTML = `<span class="exp-err">${escapeHtml(String(e.message || e))}</span>`;
  }
}

function _expRenderTable() {
  const resEl = document.getElementById('exp-results');
  if (!resEl) return;
  if (!_expRows.length) { resEl.innerHTML = ''; return; }
  const rows = _expRows.map(p => {
    const themes = (p.themes || '').split(/\s+/).filter(Boolean).slice(0, 4)
      .map(t => `<span class="exp-theme">${escapeHtml(t)}</span>`).join(' ');
    return `<tr>
      <td class="exp-td-check"><input type="checkbox" class="exp-check" aria-label="Sélectionner le puzzle ${escapeHtml(p.id)}" onchange="_expToggleSel('${escapeHtml(p.id)}', this)"></td>
      <td class="exp-td-rating"><span class="exp-rating">${p.rating ?? '—'}</span></td>
      <td class="exp-td-themes">${themes}</td>
      <td class="exp-td-id"><code class="exp-id">${escapeHtml(p.id)}</code></td>
    </tr>`;
  }).join('');
  resEl.innerHTML = `<table class="exp-table">
    <thead><tr><th></th><th>Difficulté</th><th>Motifs</th><th>Puzzle</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function _expToggleSel(id, el) {
  if (el.checked) _expSel.add(id); else _expSel.delete(id);
  _expSyncActionbar();
}

function _expSyncActionbar() {
  const bar = document.getElementById('exp-actionbar');
  const cnt = document.getElementById('exp-selcount');
  if (!bar || !cnt) return;
  const n = _expSel.size;
  bar.style.display = _expRows.length ? '' : 'none';
  cnt.textContent = `${n} sélectionné${n > 1 ? 's' : ''}`;
}

// ── Mapping OTKB → kp EECoach ──────────────────────────
// Un puzzle Lichess : `fen` = position AVANT moves[0] ; moves[0] = coup adverse
// qui ARME la tactique ; moves[1:] = la solution (élève au trait). On l'aligne sur
// le modèle d'exercice EECoach : kp.fen = position APRÈS moves[0] (élève au trait),
// kp.line = SAN de moves[1:]. Invariant moteur (cf. _exParseGameToKp, exercises.js) :
// la ligne finit sur le coup de l'élève → longueur impaire.
function _uciToKp(fen, moves) {
  const g = new Chess();
  if (!g.load(fen)) return null;
  const play = (uci) => g.move({
    from: uci.slice(0, 2), to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  });
  if (!moves.length || !play(moves[0])) return null;   // coup d'armement
  const kpFen = g.fen();
  const line = [];
  for (const uci of moves.slice(1)) {
    const mv = play(uci);
    if (!mv) break;
    line.push(mv.san);
  }
  if (!line.length) return null;
  if (line.length % 2 === 0) line.pop();               // finir sur le coup de l'élève
  const kp = { fen: kpFen, san: line[0], comment: '' };
  if (line.length > 1) kp.line = line;
  return kp;
}

async function explorerCreatePacket() {
  if (!_expSel.size) { window.toast?.('⚠ Coche au moins un puzzle', 'ko'); return; }
  const name = (prompt('Nom du paquet d\'exercices :', `Tactiques ${_expNfen ? '' : ''}`.trim() || 'Puzzles d\'ouverture') || '').trim();
  if (!name) return;
  const ids = [..._expSel];
  let kps = [];
  try {
    const puzzles = await Promise.all(ids.map(async id => {
      const r = await fetch(`${ODP_BRIDGE_URL}/puzzle?id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error('puzzle ' + id);
      return r.json();
    }));
    kps = puzzles.map(p => _uciToKp(p.fen, p.moves)).filter(Boolean);
  } catch (e) {
    window.toast?.('❌ Erreur de chargement des puzzles', 'ko');
    return;
  }
  if (!kps.length) { window.toast?.('❌ Aucun puzzle convertible', 'ko'); return; }
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const firstTurn = (kps[0].fen.split(/\s+/)[1] === 'b') ? 'b' : 'w';
  const mod = {
    id: Date.now(),
    name, level: 'Intermédiaire',
    side: firstTurn,
    mode: 'flash', varmode: null, tree: {},
    sessions: [{ label: 'Exercices', startFen, moves: [], kps }],
    hideComments: false, deadline: null,
    isExercise: true, exType: 'tactique',
    students: [],
    created: new Date().toLocaleDateString('fr-FR'),
    updatedAt: Date.now(),
  };
  G.drills.push(mod);
  window.save?.();
  window.saveModule?.(mod);
  window.toast?.(`✓ Paquet « ${name} » créé (${kps.length} exercice${kps.length > 1 ? 's' : ''})`, 'ok');
  window.renderDrillList?.();
  window.renderClassModuleSelect?.();
}

async function explorerExportPgn() {
  if (!_expNfen) { window.toast?.('⚠ Explore d\'abord une position', 'ko'); return; }
  const raw = (document.getElementById('exp-input')?.value || '').trim();
  const param = raw.includes('/') ? 'fen=' + encodeURIComponent(raw)
                                  : 'moves=' + encodeURIComponent(raw);
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/export?${param}&limit=200`);
    if (!r.ok) throw new Error('export');
    const pgn = await r.text();
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `otkb-${(_expNfen.split(/\s+/)[0] || 'position').replace(/\//g, '_').slice(0, 40)}.pgn`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    window.toast?.('✓ Dossier PGN téléchargé', 'ok');
  } catch {
    window.toast?.('❌ Échec de l\'export PGN', 'ko');
  }
}

Object.assign(window, {
  renderExplorer, explorerLoad, explorerCreatePacket, explorerExportPgn,
  _expToggleSel, _expDetectBridge,
});

// Dev local (sb=null → _coachLoad ne tourne pas) : tenter la détection à l'import,
// après un tick pour laisser le DOM se monter.
setTimeout(() => { _expDetectBridge(); }, 300);
