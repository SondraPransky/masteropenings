// ══════════════════════════════════════════════════════
// EXERCICES (E1) — paquet d'exercices « position → trouve le coup ».
// Un paquet = un MODULE `mode:'flash'` avec sessions[0].kps = N positions.
// Le moteur (drill positions, SR flash→test, mastery, assignation par classe)
// est DEJA en place — ici on ne fait que la CREATION.
//   • position saisie via l'editeur de position existant (lib/setup.js,
//     target 'exercise') ou colle-FEN,
//   • coup(s) solution captures sur un mini-echiquier autonome (chess.js),
//     independant de lib/board.js (zone critique non touchee).
// Chaque exercice → kp { fen, san, altSans[], comment, isCapture, isCastle,
// isCheck } — meme forme que les positions cles consommees par le drill.
// `Chess` = global CDN ; pieces via window.PIECE_CDN ; toast/save/closeModal
// /escapeHtml = globaux app.js.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';

const _EX_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const _EX = {
  editId: null,        // id du module si on modifie un paquet existant
  name: '', level: 'Intermédiaire',
  exercises: [],       // [{fen, san, altSans, comment, isCapture, isCastle, isCheck}]
  // brouillon de capture de solution :
  solFen: null, solSel: null, solMove: null, editIdx: null,
};

// ── Ouverture du paquet (nouveau ou edition) ──────────────
function openExercisePacket(moduleId) {
  _EX.editId = null; _EX.exercises = []; _EX.name = ''; _EX.level = 'Intermédiaire';
  if (moduleId != null) {
    const d = G.drills.find(m => m.id === moduleId);
    if (d) {
      _EX.editId = d.id;
      _EX.name = d.name || '';
      _EX.level = d.level || 'Intermédiaire';
      const kps = d.sessions?.[0]?.kps || d.kps || [];
      _EX.exercises = kps.map(k => ({
        fen: k.fen, san: k.san, altSans: [...(k.altSans || [])], comment: k.comment || '',
        isCapture: !!k.isCapture, isCastle: !!k.isCastle, isCheck: !!k.isCheck,
      }));
    }
  }
  const t = document.getElementById('ex-pk-title'); if (t) t.textContent = _EX.editId ? '🧩 Modifier le paquet d\'exercices' : '🧩 Nouveau paquet d\'exercices';
  const n = document.getElementById('ex-pk-name'); if (n) n.value = _EX.name;
  const lv = document.getElementById('ex-pk-level'); if (lv) lv.value = _EX.level;
  _exRenderList();
  document.getElementById('modal-exercise-packet')?.classList.add('on');
}

// ── Liste des exercices du paquet ─────────────────────────
function _exRenderList() {
  const el = document.getElementById('ex-list'); if (!el) return;
  const n = _EX.exercises.length;
  const c = document.getElementById('ex-count'); if (c) c.textContent = n ? `${n} exercice${n > 1 ? 's' : ''}` : 'Aucun exercice pour l\'instant';
  if (!n) {
    el.innerHTML = `<div style="text-align:center;color:var(--dim);font-size:.85rem;padding:22px 0">Ajoute une première position ci-dessous.</div>`;
    return;
  }
  el.innerHTML = _EX.exercises.map((k, i) => {
    const turn = (k.fen.split(/\s+/)[1] === 'b') ? '⬛ Noirs jouent' : '⬜ Blancs jouent';
    const alt = k.altSans?.length ? ` <span style="color:var(--dim)">(ou ${window.escapeHtml?.(k.altSans.join(', '))})</span>` : '';
    return `<div class="ex-row" style="display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px">
      ${_exMiniBoard(k.fen, 92)}
      <div style="flex:1;min-width:0">
        <div style="font-size:.72rem;color:var(--dim);margin-bottom:2px">Exercice ${i + 1} · ${turn}</div>
        <div style="font-weight:700;color:var(--cyan)">Solution : ${window.escapeHtml?.(k.san)}${alt}</div>
        ${k.comment ? `<div style="font-size:.8rem;color:var(--text-2);margin-top:3px">${window.escapeHtml?.(k.comment)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="exEditExercise(${i})" title="Modifier">✏️</button>
        <button class="btn btn-ghost btn-sm" onclick="exDeleteExercise(${i})" title="Supprimer">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// Mini-echiquier statique (lecture seule) rendu depuis un FEN.
function _exMiniBoard(fen, px) {
  const board = (fen || '').trim().split(/\s+/)[0] || '';
  const rows = board.split('/');
  const files = 'abcdefgh';
  let cells = '';
  for (let i = 0; i < 8; i++) {
    let fi = 0;
    const rowStr = rows[i] || '8';
    const cellsRow = [];
    for (const ch of rowStr) {
      if (/\d/.test(ch)) { for (let k = 0; k < +ch; k++) cellsRow.push(null); fi += +ch; }
      else { cellsRow.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase()); fi++; }
    }
    while (cellsRow.length < 8) cellsRow.push(null);
    cellsRow.forEach((p, f) => {
      const light = (i + f) % 2 === 0;
      const bg = light ? '#f0d9b5' : '#b58863';
      const pc = p ? `<img src="${window.PIECE_CDN}${p}.svg" draggable="false" style="width:90%;height:90%">` : '';
      cells += `<div style="background:${bg};display:flex;align-items:center;justify-content:center">${pc}</div>`;
    });
  }
  return `<div style="display:grid;grid-template-columns:repeat(8,1fr);width:${px}px;height:${px}px;flex:0 0 ${px}px;border-radius:6px;overflow:hidden;border:1px solid var(--border)">${cells}</div>`;
}

function exDeleteExercise(i) { _EX.exercises.splice(i, 1); _exRenderList(); }

function exEditExercise(i) {
  const k = _EX.exercises[i];
  if (!k) return;
  _EX.editIdx = i;
  _exOpenSolution(k.fen, k);
}

// ── Ajout d'un exercice : ouvre l'editeur de position ─────
function exAddExercise() {
  _EX.editIdx = null;
  window.openPositionSetupForExercise?.();
}

// ── E2a : ajout rapide par FEN colle → etape solution ─────
function exAddFromFen() {
  _EX.editIdx = null;
  const inp = document.getElementById('ex-fen-input'); if (inp) inp.value = '';
  document.getElementById('modal-exercise-fen')?.classList.add('on');
}
function exFenContinue() {
  const raw = (document.getElementById('ex-fen-input')?.value || '').trim();
  if (!raw) { window.toast?.('⚠ Colle un FEN', 'ko'); return; }
  const g = new Chess();
  if (!g.load(raw)) { window.toast?.('❌ FEN invalide', 'ko'); return; }
  window.closeModal?.('modal-exercise-fen');
  _exOpenSolution(raw, null);
}

// ── E2b : import PGN en lot (1 partie = 1 exercice) ───────
// Chaque partie collee : position = en-tete [FEN] (ou depart standard),
// solution = 1er coup de la ligne principale, commentaire = 1er { … }.
function exImportPgn() {
  const inp = document.getElementById('ex-pgn-input'); if (inp) inp.value = '';
  document.getElementById('modal-exercise-pgn')?.classList.add('on');
}
function _exSplitPgnGames(text) {
  // Separe sur une ligne vide suivie d'un bloc de tags [ … ] (nouvelle partie).
  return String(text || '').split(/\n\s*\n(?=\s*\[)/).map(s => s.trim()).filter(Boolean);
}
function _exParseGameToKp(chunk) {
  const fenM = chunk.match(/\[FEN\s+"([^"]+)"\]/);
  const startFen = fenM ? fenM[1] : _EX_START;
  // On n'a besoin QUE du 1er coup (la solution) → on l'extrait du movetext et on
  // le valide contre le FEN. Robuste aux suites longues/illegales, NAG, variantes.
  const movetext = chunk.replace(/\[[^\]]*\]/g, ' ');
  const cM = movetext.match(/\{([^}]*)\}/);
  const clean = movetext
    .replace(/\{[^}]*\}/g, ' ')                    // commentaires
    .replace(/\([^)]*\)/g, ' ')                    // variantes
    .replace(/\$\d+/g, ' ')                        // NAG
    .replace(/\d+\.(\.\.)?/g, ' ')                 // numeros de coup (1. / 1...)
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ')   // resultat
    .trim();
  const firstTok = clean.split(/\s+/)[0];
  if (!firstTok) return null;
  const test = new Chess(); if (!test.load(startFen)) return null;
  const m = test.move(firstTok, { sloppy: true });
  if (!m) return null;
  return {
    fen: startFen, san: m.san, altSans: [], comment: cM ? cM[1].trim() : '',
    isCapture: /x/.test(m.san) || (m.flags || '').includes('e'),
    isCastle: (m.flags || '').includes('k') || (m.flags || '').includes('q'),
    isCheck: /\+|#/.test(m.san),
  };
}
function exPgnRun() {
  const raw = (document.getElementById('ex-pgn-input')?.value || '').trim();
  if (!raw) { window.toast?.('⚠ Colle un ou plusieurs PGN', 'ko'); return; }
  const games = _exSplitPgnGames(raw);
  let added = 0, skipped = 0;
  for (const chunk of games) {
    const kp = _exParseGameToKp(chunk);
    if (kp) { _EX.exercises.push(kp); added++; } else skipped++;
  }
  if (!added) { window.toast?.('❌ Aucun exercice extrait (vérifie le PGN)', 'ko'); return; }
  window.closeModal?.('modal-exercise-pgn');
  _exRenderList();
  window.toast?.(`✓ ${added} exercice${added > 1 ? 's' : ''} importé${added > 1 ? 's' : ''}${skipped ? ` · ${skipped} ignoré${skipped > 1 ? 's' : ''}` : ''}`, 'ok');
}

// Rappel depuis lib/setup.js une fois la position validee.
function _exOnPositionReady(fen) {
  _exOpenSolution(fen, null);
}

// ── Etape solution : jouer le bon coup sur le mini-echiquier ─
function _exOpenSolution(fen, existing) {
  _EX.solFen = fen; _EX.solSel = null; _EX.solMove = null;
  const g = new Chess();
  if (!g.load(fen)) { window.toast?.('❌ Position invalide', 'ko'); return; }
  const sanEl = document.getElementById('ex-sol-san'); if (sanEl) sanEl.value = existing?.san || '';
  const altEl = document.getElementById('ex-sol-alt'); if (altEl) altEl.value = (existing?.altSans || []).join(', ');
  const comEl = document.getElementById('ex-sol-comment'); if (comEl) comEl.value = existing?.comment || '';
  const turnEl = document.getElementById('ex-sol-turn');
  if (turnEl) turnEl.textContent = g.turn() === 'b' ? '⬛ Les Noirs jouent — indique leur coup' : '⬜ Les Blancs jouent — indique leur coup';
  _exRenderSolBoard();
  document.getElementById('modal-exercise-solution')?.classList.add('on');
}

function _exRenderSolBoard() {
  const grid = document.getElementById('ex-sol-board'); if (!grid) return;
  const g = new Chess(); g.load(_EX.solFen);
  const flip = g.turn() === 'b';                     // orienter du cote au trait
  const pos = {};
  g.SQUARES.forEach(sq => { const p = g.get(sq); if (p) pos[sq] = p.color + p.type.toUpperCase(); });
  const files = flip ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = flip ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
  let html = '';
  ranks.forEach((rank, ri) => {
    files.forEach((file, fi) => {
      const sq = file + rank;
      const lightIdx = (files.indexOf(file) + ranks.indexOf(rank));
      const light = (fi + ri) % 2 === 0;
      let bg = light ? '#f0d9b5' : '#b58863';
      if (_EX.solSel === sq) bg = '#7dd3fc';
      else if (_EX.solMove && (_EX.solMove.from === sq || _EX.solMove.to === sq)) bg = '#bbf7d0';
      const p = pos[sq];
      const pc = p ? `<img src="${window.PIECE_CDN}${p}.svg" draggable="false" style="width:88%;height:88%;pointer-events:none">` : '';
      html += `<div onclick="_exSolClick('${sq}')" style="background:${bg};display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;aspect-ratio:1">${pc}</div>`;
    });
  });
  grid.innerHTML = html;
}

function _exSolClick(sq) {
  const g = new Chess(); g.load(_EX.solFen);
  const piece = g.get(sq);
  if (_EX.solSel) {
    if (sq === _EX.solSel) { _EX.solSel = null; _exRenderSolBoard(); return; }
    const mv = g.move({ from: _EX.solSel, to: sq, promotion: 'q' });
    if (mv) {
      _EX.solMove = mv;                              // g a avance mais on ne garde que le coup
      _EX.solSel = null;
      const sanEl = document.getElementById('ex-sol-san'); if (sanEl) sanEl.value = mv.san;
      _exRenderSolBoard();
      return;
    }
    // coup illegal → re-selection si on clique une piece au trait
    _EX.solSel = (piece && piece.color === g.turn()) ? sq : null;
    _exRenderSolBoard();
    return;
  }
  if (piece && piece.color === g.turn()) { _EX.solSel = sq; _exRenderSolBoard(); }
}

function exSolReset() {
  _EX.solSel = null; _EX.solMove = null;
  const sanEl = document.getElementById('ex-sol-san'); if (sanEl) sanEl.value = '';
  _exRenderSolBoard();
}

// Valide le coup solution (clic OU saisie manuelle SAN/coord) → construit le kp.
function exSolAdd() {
  const fen = _EX.solFen;
  const primary = (document.getElementById('ex-sol-san')?.value || '').trim();
  if (!primary) { window.toast?.('⚠ Indique le coup solution', 'ko'); return; }
  const test = new Chess(); test.load(fen);
  const m = test.move(primary, { sloppy: true });
  if (!m) { window.toast?.('❌ Coup solution illégal dans cette position', 'ko'); return; }
  const altRaw = (document.getElementById('ex-sol-alt')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const altSans = [];
  for (const a of altRaw) {
    const t = new Chess(); t.load(fen);
    const mm = t.move(a, { sloppy: true });
    if (mm && mm.san !== m.san && !altSans.includes(mm.san)) altSans.push(mm.san);
  }
  const comment = (document.getElementById('ex-sol-comment')?.value || '').trim();
  const kp = {
    fen, san: m.san, altSans, comment,
    isCapture: /x/.test(m.san) || (m.flags || '').includes('e'),
    isCastle: (m.flags || '').includes('k') || (m.flags || '').includes('q'),
    isCheck: /\+|#/.test(m.san),
  };
  if (_EX.editIdx != null) { _EX.exercises[_EX.editIdx] = kp; _EX.editIdx = null; }
  else _EX.exercises.push(kp);
  window.closeModal?.('modal-exercise-solution');
  _exRenderList();
}

// ── Enregistrement du paquet → module mode:'flash' ────────
function saveExercisePacket() {
  const name = (document.getElementById('ex-pk-name')?.value || '').trim();
  const level = document.getElementById('ex-pk-level')?.value || 'Intermédiaire';
  if (!name) { window.toast?.('⚠ Donne un nom au paquet', 'ko'); return; }
  if (!_EX.exercises.length) { window.toast?.('⚠ Ajoute au moins un exercice', 'ko'); return; }

  const kps = _EX.exercises.map(k => ({ ...k, altSans: [...(k.altSans || [])] }));
  // Orientation du plateau (positions mode : S.flipped = side==='b') = trait du 1er exercice.
  const firstTurn = (kps[0].fen.split(/\s+/)[1] === 'b') ? 'b' : 'w';

  const existing = _EX.editId != null ? G.drills.find(m => m.id === _EX.editId) : null;
  const mod = {
    id: existing?.id ?? Date.now(),
    name, level,
    side: firstTurn,
    mode: 'flash', varmode: null, tree: {},
    sessions: [{ label: 'Exercices', startFen: _EX_START, moves: [], kps }],
    hideComments: false, deadline: existing?.deadline ?? null,
    isExercise: true,
    students: existing?.students || [],
    created: existing?.created || new Date().toLocaleDateString('fr-FR'),
    updatedAt: Date.now(),
  };
  if (existing) {
    const idx = G.drills.findIndex(m => m.id === existing.id);
    if (idx >= 0) G.drills[idx] = mod;
  } else {
    G.drills.push(mod);
  }
  window.save?.();
  window.saveModule?.(mod);
  window.closeModal?.('modal-exercise-packet');
  window.toast?.(existing ? '✓ Paquet mis à jour' : `✓ Paquet « ${name} » créé`, 'ok');
  window.renderDrillList?.();
  window.renderClassModuleSelect?.();
}

Object.assign(window, {
  openExercisePacket, exAddExercise, _exOnPositionReady, exEditExercise,
  exDeleteExercise, _exSolClick, exSolReset, exSolAdd, saveExercisePacket,
  exAddFromFen, exFenContinue, exImportPgn, exPgnRun,
});
