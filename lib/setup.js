// ══════════════════════════════════════════════════════
// ÉDITEUR DE POSITION (Pilier 1, tranche C) — construire une position de départ
// (échiquier vide + placement de pièces + trait) ou coller un FEN, puis ouvrir
// l'éditeur de variantes/partie sur cette position. Roques/en-passant : défaut
// (aucun droit) — pas d'UI dédiée (cf. décision produit).
//   target 'drill' → module (coach)  ·  target 'game' → partie « Ma bibliothèque »
// `Chess` = global CDN ; pièces via window.PIECE_CDN ; toast via window.
// ══════════════════════════════════════════════════════
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const _PS = { pos: {}, side: 'w', sel: 'wP', target: 'drill', gameBaseId: null };

function openPositionSetupForExercise() {                 // exercice (coach)
  _PS.target = 'exercise'; _PS.gameBaseId = null;
  _psStart();
}

const _psToast = (...a) => window.toast?.(...a);

// ── FEN ↔ position (objet { 'e1':'wK', … }) ──────────────
function _psPosToFen(pos, side) {
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let row = '', empty = 0;
    for (const f of 'abcdefgh') {
      const p = pos[f + r];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += (p[0] === 'w') ? p[1] : p[1].toLowerCase();
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/') + ' ' + side + ' - - 0 1';
}
function _psFenToPos(fen) {
  const pos = {};
  const board = (fen || '').trim().split(/\s+/)[0] || '';
  const rows = board.split('/');
  for (let i = 0; i < 8 && i < rows.length; i++) {
    const r = 8 - i; let fi = 0;
    for (const ch of rows[i]) {
      if (/\d/.test(ch)) { fi += +ch; continue; }
      const file = 'abcdefgh'[fi];
      if (file) pos[file + r] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
      fi++;
    }
  }
  return pos;
}

// ── Ouverture ─────────────────────────────────────────
function openPositionSetup(role) {                       // module (coach)
  _PS.target = 'drill'; _PS.gameBaseId = null;
  _psStart();
}
function openPositionSetupForGame(baseId) {              // partie (élève)
  _PS.target = 'game'; _PS.gameBaseId = baseId != null ? String(baseId) : null;
  _psStart();
}
function _psStart() {
  _PS.pos = _psFenToPos(START_FEN);
  _PS.side = 'w';
  _PS.sel = 'wP';
  document.getElementById('modal-position-setup')?.classList.add('on');
  _psRender();
}

// ── Rendu ─────────────────────────────────────────────
function _psRender() {
  _psRenderBoard();
  _psRenderPalette();
  const sideSel = document.getElementById('ps-side'); if (sideSel) sideSel.value = _PS.side;
  const fenInp = document.getElementById('ps-fen'); if (fenInp) fenInp.value = _psPosToFen(_PS.pos, _PS.side);
}

function _psRenderBoard() {
  const grid = document.getElementById('ps-board'); if (!grid) return;
  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = ['8','7','6','5','4','3','2','1'];
  let html = '';
  ranks.forEach((rank, ri) => {
    files.forEach((file, fi) => {
      const sq = file + rank, light = (fi + ri) % 2 === 0;
      const p = _PS.pos[sq];
      const bg = light ? 'var(--board-light)' : 'var(--board-dark)';
      const pc = p ? `<img src="${window.PIECE_CDN}${p}.svg" draggable="false" style="width:86%;height:86%;pointer-events:none">` : '';
      html += `<div onclick="_psClickSquare('${sq}')" style="background:${bg};display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;aspect-ratio:1">${pc}</div>`;
    });
  });
  grid.innerHTML = html;
}

function _psRenderPalette() {
  const mk = (code) => {
    const on = _PS.sel === code;
    const inner = code === 'x'
      ? '<span style="font-size:1.3rem">🧽</span>'
      : `<img src="${window.PIECE_CDN}${code}.svg" draggable="false" style="width:78%;height:78%">`;
    return `<button type="button" class="ps-pal${on ? ' on' : ''}" onclick="_psSelect('${code}')" title="${code === 'x' ? 'Gomme' : code}">${inner}</button>`;
  };
  const w = document.getElementById('ps-palette-w');
  const b = document.getElementById('ps-palette-b');
  if (w) w.innerHTML = ['wK','wQ','wR','wB','wN','wP'].map(mk).join('');
  if (b) b.innerHTML = ['bK','bQ','bR','bB','bN','bP'].map(mk).concat(mk('x')).join('');
}

// ── Interactions ──────────────────────────────────────
function _psSelect(code) { _PS.sel = code; _psRenderPalette(); }

function _psClickSquare(sq) {
  if (_PS.sel === 'x' || !_PS.sel) { delete _PS.pos[sq]; }
  else {
    // Un seul roi par camp : déplacer plutôt que dupliquer.
    if (_PS.sel[1] === 'K') {
      for (const k in _PS.pos) if (_PS.pos[k] === _PS.sel) delete _PS.pos[k];
    }
    _PS.pos[sq] = _PS.sel;
  }
  _psRender();
}

function _psSetSide(s) { _PS.side = (s === 'b') ? 'b' : 'w'; _psRender(); }
function _psEmpty()   { _PS.pos = {}; _psRender(); }
function _psInitial() { _PS.pos = _psFenToPos(START_FEN); _PS.side = 'w'; _psRender(); }

// Coller / éditer un FEN → recharge la position.
function _psApplyFen() {
  const raw = (document.getElementById('ps-fen')?.value || '').trim();
  if (!raw) return;
  try {
    const g = new Chess(); if (!g.load(raw)) throw new Error('FEN invalide');
    _PS.pos = _psFenToPos(raw);
    _PS.side = raw.split(/\s+/)[1] === 'b' ? 'b' : 'w';
    _psRender();
    _psToast('✓ Position chargée', 'ok');
  } catch (e) { _psToast('❌ FEN invalide', 'ko'); }
}

// ── Validation → ouverture de l'éditeur sur cette position ──
function _psValidate() {
  const wK = Object.values(_PS.pos).filter(p => p === 'wK').length;
  const bK = Object.values(_PS.pos).filter(p => p === 'bK').length;
  if (wK !== 1 || bK !== 1) { _psToast('⚠ Il faut exactement un roi blanc et un roi noir', 'ko'); return; }
  const fen = _psPosToFen(_PS.pos, _PS.side);
  let g;
  try { g = new Chess(); if (!g.load(fen)) throw new Error('bad'); }
  catch (e) { _psToast('❌ Position invalide (rois en prise ? pions sur la 1re/8e ?)', 'ko'); return; }
  window.closeModal?.('modal-position-setup');
  if (_PS.target === 'game') window.openGameEditor?.('', fen);
  else if (_PS.target === 'exercise') window._exOnPositionReady?.(fen);
  else                        window.openPgnEditorNew?.('teacher', fen);
}

Object.assign(window, {
  openPositionSetup, openPositionSetupForGame, openPositionSetupForExercise,
  _psRender, _psSelect, _psClickSquare, _psSetSide, _psEmpty, _psInitial, _psApplyFen, _psValidate,
});
