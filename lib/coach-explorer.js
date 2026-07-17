// ══════════════════════════════════════════════════════
// VUE COACH — Explorateur de puzzles (pont OTKB local).
//
// Outil de PRÉPARATION : le coach atteint une position d'ouverture (échiquier
// jouable, sélecteur d'ouverture, ou FEN/coups tapés), voit les puzzles tactiques
// qui PASSENT PAR elle (through-position) servis par l'usine OTKB locale (corpus
// intégral 18 Go, jamais déployable), les calibre au niveau de l'élève (filtres
// FIDE), et en fait soit un PAQUET D'EXERCICES EECoach (assignable, résolvable,
// suivi Leitner), soit un export PGN — le même que l'outil coach OTKB.
//
// Le pont est un serveur HTTP `localhost` (cf. otkb/bridge.py) : EECoach déployé
// sur Pages a le droit de le fetch (localhost = origine « potentially trustworthy »,
// mesuré 200 depuis le vrai site HTTPS). La section est MASQUÉE si le pont ne
// répond pas — pas de bouton mort. Constante en dur ; le jour d'un déploiement en
// ligne, seule cette URL changera (pilote interchangeable).
//
// L'échiquier est un composant clic-à-clic AUTONOME (chess.js + re-rendu) — il ne
// réutilise PAS lib/board.js, zone critique couplée au drill (canvas #board unique).
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { escapeHtml } from './coach-core.js';

const ODP_BRIDGE_URL = 'http://localhost:8127';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// État local (aucune raison de monter dans CS : rien ne traverse d'autres modules).
let _expRows = [];            // dernière page de puzzles chargée
let _expNfen = null;          // FEN normalisée de la position courante
let _expTotal = 0;
const _expSel = new Set();    // ids de puzzles cochés
let _expGame = null;          // chess.js : position construite sur l'échiquier
let _expUci = [];             // coups UCI joués (source de vérité de la position)
let _expSelSq = null;         // case source sélectionnée (clic-à-clic)
let _expOpeningsLoaded = false;
// Niveaux élève FIDE (multi-sélection, mêmes pastilles que l'outil coach OTKB —
// la vérité vit dans otkb/ui/levels.py, servie par /levels). « all » = exclusif.
let _expLevels = ['all'];
let _expLevelDefs = [];       // [{key, short, label}] depuis le pont
// Tri du tableau : difficulté croissante par défaut (comme l'outil coach) ;
// cliquer l'en-tête « Difficulté » inverse.
let _expSort = 'rating_asc';

// ── Détection du pont ─────────────────────────────────
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
  if (!_expGame) { _expGame = new Chess(); _expUci = []; }
  _expRenderBoard();
  _expLoadOpenings();
  _expLoadLevels();
  const input = document.getElementById('exp-input');
  if (input) input.focus();
}

// ── Niveaux élève FIDE (pastilles multi-sélection, servies par /levels) ──
async function _expLoadLevels() {
  if (_expLevelDefs.length) { _expRenderLevels(); return; }
  try {
    const r = await fetch(ODP_BRIDGE_URL + '/levels');
    _expLevelDefs = (await r.json()).levels || [];
    _expRenderLevels();
  } catch { /* pont indisponible : pas de pastilles, la recherche marche sans */ }
}

function _expRenderLevels() {
  const host = document.getElementById('exp-levelchips');
  if (!host) return;
  host.innerHTML = _expLevelDefs.map(lv =>
    `<button type="button" class="exp-levelchip${_expLevels.includes(lv.key) ? ' on' : ''}"
      title="${escapeHtml(lv.label)}" onclick="explorerToggleLevel('${escapeHtml(lv.key)}')">${escapeHtml(lv.short)}</button>`
  ).join('');
}

function explorerToggleLevel(key) {
  // Même règle que toggle_level (otkb/ui/levels.py) : « Tous » est exclusif ;
  // cocher un niveau précis l'écarte ; tout décocher revient à « tous ».
  if (key === 'all') {
    _expLevels = ['all'];
  } else {
    let sel = _expLevels.filter(k => k !== 'all' && k !== key);
    if (!_expLevels.includes(key)) sel.push(key);
    const order = _expLevelDefs.map(l => l.key);
    sel.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    _expLevels = sel.length ? sel : ['all'];
  }
  _expRenderLevels();
  if (_expPosParam()) explorerLoad();
}

function explorerToggleSort() {
  _expSort = _expSort === 'rating_asc' ? 'rating_desc' : 'rating_asc';
  if (_expPosParam()) explorerLoad();
}

// ── Échiquier jouable (clic-à-clic, autonome) ─────────
function _expRenderBoard() {
  const host = document.getElementById('exp-board');
  if (!host) return;
  const g = _expGame;
  const rows = g.fen().split(/\s+/)[0].split('/');
  const files = 'abcdefgh';
  let cells = '';
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { for (let k = 0; k < +ch; k++, f++) cells += _expCell(files[f] + (8 - r), null, r, f); }
      else { cells += _expCell(files[f] + (8 - r), (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(), r, f); f++; }
    }
  }
  host.innerHTML = `<div class="exp-playboard">${cells}</div>`;
}

function _expCell(sq, piece, r, f) {
  const dark = (r + f) % 2 === 1;
  const sel = _expSelSq === sq ? ' exp-sq-sel' : '';
  const pc = piece ? `<img src="${window.PIECE_CDN}${piece}.svg" draggable="false" alt="">` : '';
  return `<div class="exp-sq${dark ? ' exp-sq-d' : ''}${sel}" data-sq="${sq}" onclick="_expClickSq('${sq}')">${pc}</div>`;
}

function _expClickSq(sq) {
  const g = _expGame;
  if (_expSelSq && _expSelSq !== sq) {
    // tentative de coup source → dest (promotion auto en dame, suffisant pour préparer)
    const mv = g.move({ from: _expSelSq, to: sq, promotion: 'q' });
    if (mv) {
      _expUci.push(mv.from + mv.to + (mv.promotion || ''));
      _expSelSq = null;
      _expSyncInput();
      _expRenderBoard();
      explorerLoad();
      return;
    }
  }
  // (re)sélection d'une pièce du camp au trait
  const pc = g.get(sq);
  _expSelSq = (pc && pc.color === g.turn()) ? sq : null;
  _expRenderBoard();
}

function _expSyncInput() {
  const input = document.getElementById('exp-input');
  if (input) input.value = _expUci.join(' ');
  const op = document.getElementById('exp-opening');
  if (op) op.value = '';   // la position ne correspond plus forcément à l'ouverture nommée
}

function explorerResetBoard() {
  _expGame = new Chess(); _expUci = []; _expSelSq = null;
  _expSyncInput();
  _expRenderBoard();
  const c = document.getElementById('exp-count'); if (c) c.innerHTML = '';
  const res = document.getElementById('exp-results'); if (res) res.innerHTML = '';
  _expRows = []; _expNfen = null; _expSel.clear(); _expSyncActionbar();
}

// ── Sélecteur d'ouverture (datalist depuis /openings) ──
async function _expLoadOpenings() {
  if (_expOpeningsLoaded) return;
  try {
    const r = await fetch(ODP_BRIDGE_URL + '/openings');
    const data = await r.json();
    const dl = document.getElementById('exp-opening-list');
    if (dl && data.openings) {
      dl.innerHTML = data.openings
        .map(o => `<option value="${escapeHtml(o.name)}" data-moves="${escapeHtml(o.moves)}">`).join('');
      _expOpeningsMap = new Map(data.openings.map(o => [o.name, o.moves]));
      _expOpeningsLoaded = true;
    }
  } catch { /* pont indisponible : la datalist reste vide, le champ texte suffit */ }
}
let _expOpeningsMap = new Map();

function explorerPickOpening(name) {
  const moves = _expOpeningsMap.get(name);
  if (!moves) return;
  // rejoue les coups de l'ouverture sur un échiquier neuf
  const g = new Chess(); const uci = [];
  for (const m of moves.split(/\s+/)) {
    const mv = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    if (!mv) break;
    uci.push(m);
  }
  _expGame = g; _expUci = uci; _expSelSq = null;
  const input = document.getElementById('exp-input'); if (input) input.value = uci.join(' ');
  _expRenderBoard();
  explorerLoad();
}

function _expRatingParam() {
  return _expLevels.includes('all') ? '' : `&levels=${_expLevels.join(',')}`;
}

// ── Chargement de la liste (through) ───────────────────
function _expPosParam() {
  const raw = (document.getElementById('exp-input')?.value || '').trim();
  if (!raw) return null;
  return raw.includes('/') ? 'fen=' + encodeURIComponent(raw)
                           : 'moves=' + encodeURIComponent(raw);
}

async function explorerLoad() {
  const countEl = document.getElementById('exp-count');
  const resEl = document.getElementById('exp-results');
  const param = _expPosParam();
  if (!param) { window.toast?.('⚠ Saisis une position (coups UCI ou FEN)', 'ko'); return; }
  if (countEl) countEl.innerHTML = '<span class="exp-loading">Recherche…</span>';
  if (resEl) resEl.innerHTML = '';
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/through?${param}&limit=45&sort=${_expSort}${_expRatingParam()}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur du pont');
    _expNfen = data.nfen; _expTotal = data.total; _expRows = data.puzzles || [];
    _expSel.clear();
    if (countEl) {
      const filt = _expLevels.includes('all') ? '' : ' <span class="exp-hint">(niveau filtré)</span>';
      countEl.innerHTML = _expTotal
        ? `<strong>${_expTotal.toLocaleString('fr-FR')}</strong> puzzle${_expTotal > 1 ? 's' : ''} passent par cette position${filt}${_expTotal > _expRows.length ? ` · <span class="exp-hint">${_expRows.length} affichés</span>` : ''}`
        : 'Aucun puzzle de ce niveau ne suit cette position — élargis le niveau ou joue d\'autres coups.';
    }
    _expRenderTable();
    _expSyncActionbar();
  } catch (e) {
    if (countEl) countEl.innerHTML = `<span class="exp-err">${escapeHtml(String(e.message || e))}</span>`;
  }
}

// Tableau au FORMAT DE L'OUTIL COACH OTKB (_through_table_html, validé 16/07) :
// Difficulté (⚑ rating, en-tête cliquable pour inverser le tri) · Trait (pastille
// + Blancs/Noirs) · Motifs (traduits FR côté pont). Pas d'id de puzzle — il
// n'apprend rien au coach. S'y ajoute la case à cocher, propre à EECoach (elle
// alimente « Créer un paquet », geste que l'outil OTKB n'a pas).
function _expRenderTable() {
  const resEl = document.getElementById('exp-results');
  if (!resEl) return;
  if (!_expRows.length) { resEl.innerHTML = ''; return; }
  const rows = _expRows.map(p => {
    const trait = p.white ? 'Blancs' : 'Noirs';
    const traitCls = p.white ? 'exp-trait-w' : 'exp-trait-b';
    return `<tr>
      <td class="exp-td-check"><input type="checkbox" class="exp-check" aria-label="Sélectionner le puzzle (difficulté ${p.rating ?? 'inconnue'}, trait aux ${trait})" onchange="_expToggleSel('${escapeHtml(p.id)}', this)"></td>
      <td class="exp-td-rating"><span class="exp-rating">⚑ ${p.rating ?? '—'}</span></td>
      <td class="exp-td-trait"><span class="exp-trait ${traitCls}"></span>${trait}</td>
      <td class="exp-td-themes">${escapeHtml(p.themes_fr || '')}</td>
    </tr>`;
  }).join('');
  const arrow = _expSort === 'rating_asc' ? '▲' : '▼';
  resEl.innerHTML = `<table class="exp-table" aria-label="Puzzles qui suivent la position">
    <thead><tr><th></th>
      <th class="exp-th-sort" role="button" tabindex="0" aria-sort="${_expSort === 'rating_asc' ? 'ascending' : 'descending'}"
        title="Inverser le tri par difficulté" onclick="explorerToggleSort()"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();explorerToggleSort()}">Difficulté ${arrow}</th>
      <th>Trait</th><th>Motifs</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
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
  const name = (prompt('Nom du paquet d\'exercices :', 'Puzzles d\'ouverture') || '').trim();
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
  } catch {
    window.toast?.('❌ Erreur de chargement des puzzles', 'ko');
    return;
  }
  if (!kps.length) { window.toast?.('❌ Aucun puzzle convertible', 'ko'); return; }
  const firstTurn = (kps[0].fen.split(/\s+/)[1] === 'b') ? 'b' : 'w';
  const mod = {
    id: Date.now(),
    name, level: 'Intermédiaire',
    side: firstTurn,
    mode: 'flash', varmode: null, tree: {},
    sessions: [{ label: 'Exercices', startFen: START_FEN, moves: [], kps }],
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
  const param = _expPosParam();
  if (!param) { window.toast?.('⚠ Explore d\'abord une position', 'ko'); return; }
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/export?${param}&limit=200${_expRatingParam()}`);
    if (!r.ok) throw new Error('export');
    const pgn = await r.text();
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `otkb-${(_expNfen?.split(/\s+/)[0] || 'position').replace(/\//g, '_').slice(0, 40)}.pgn`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    window.toast?.('✓ Dossier PGN téléchargé', 'ok');
  } catch {
    window.toast?.('❌ Échec de l\'export PGN', 'ko');
  }
}

Object.assign(window, {
  renderExplorer, explorerLoad, explorerCreatePacket, explorerExportPgn,
  explorerResetBoard, explorerPickOpening, explorerToggleLevel, explorerToggleSort,
  _expToggleSel, _expClickSq, _expDetectBridge,
});

// Dev local (sb=null → _coachLoad ne tourne pas) : tenter la détection à l'import,
// après un tick pour laisser le DOM se monter.
setTimeout(() => { _expDetectBridge(); }, 300);
