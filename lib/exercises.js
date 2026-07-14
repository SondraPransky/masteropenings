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
import { renderStaticBoard, BOARD_LIGHT, BOARD_DARK, BOARD_SEL, BOARD_MOVE } from './miniboard.js';
import { _exCloneKp } from './exercises-core.js';

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
  _EX.editId = null; _EX.exercises = []; _EX.name = ''; _EX.level = 'Intermédiaire'; _EX.exType = '';
  if (moduleId != null) {
    const d = G.drills.find(m => m.id === moduleId);
    if (d) {
      _EX.editId = d.id;
      _EX.name = d.name || '';
      _EX.level = d.level || 'Intermédiaire';
      _EX.exType = d.exType || '';
      const kps = d.sessions?.[0]?.kps || d.kps || [];
      // Clone canonique : préserve `line` (séquences multi-coups) — sinon les
      // mats en N seraient écrasés en exercices 1 coup au ré-enregistrement.
      _EX.exercises = kps.map(_exCloneKp);
    }
  }
  const t = document.getElementById('ex-pk-title'); if (t) t.innerHTML = '<i class="ti ti-puzzle" aria-hidden="true"></i> ' + (_EX.editId ? 'Modifier le paquet d\'exercices' : 'Nouveau paquet d\'exercices');
  const n = document.getElementById('ex-pk-name'); if (n) n.value = _EX.name;
  const lv = document.getElementById('ex-pk-level'); if (lv) lv.value = _EX.level;
  const ty = document.getElementById('ex-pk-type'); if (ty) ty.value = _EX.exType || '';
  _exRenderList();
  _exResetPanel();
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
    const multi = k.line && k.line.length > 1;
    const solText = multi ? window.escapeHtml?.(k.line.join(' ')) : window.escapeHtml?.(k.san);
    const alt = k.altSans?.length ? ` <span style="color:var(--dim)">(ou ${window.escapeHtml?.(k.altSans.join(', '))})</span>` : '';
    const nMoves = multi ? ` <span class="badge" style="background:var(--surf2);color:var(--violet);font-size:.66rem">mat en ${Math.ceil(k.line.length / 2)}</span>` : '';
    return `<div class="ex-row" style="display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px">
      ${renderStaticBoard(k.fen, { size: 92 })}
      <div style="flex:1;min-width:0">
        <div style="font-size:.72rem;color:var(--dim);margin-bottom:2px">Exercice ${i + 1} · ${turn}${nMoves}</div>
        <div style="font-weight:700;color:var(--cyan)">Solution : ${solText}${alt}</div>
        ${k.comment ? `<div style="font-size:.8rem;color:var(--text-2);margin-top:3px">${window.escapeHtml?.(k.comment)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button class="btn btn-ghost btn-sm btn-ico" onclick="exEditExercise(${i})" title="Modifier" aria-label="Modifier l'exercice"><i class="ti ti-edit" aria-hidden="true"></i></button>
        <button class="btn btn-ghost btn-sm btn-ico" onclick="exDeleteExercise(${i})" title="Supprimer" aria-label="Supprimer l'exercice"><i class="ti ti-trash" aria-hidden="true"></i></button>
      </div>
    </div>`;
  }).join('');
}

// Mini-échiquier statique → lib/miniboard.js (renderStaticBoard).

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
  // Révèle le champ FEN inline dans le panneau (plus de modal, refonte T6).
  const row = document.getElementById('ex-fen-row'); if (row) row.style.display = '';
  const empty = document.getElementById('ex-sol-empty'); if (empty) empty.style.display = 'none';
  const editor = document.getElementById('ex-sol-editor'); if (editor) editor.style.display = 'none';
  if (inp) inp.focus();
}
function exFenCancel() {
  const row = document.getElementById('ex-fen-row'); if (row) row.style.display = 'none';
  // Restaure l'état précédent : éditeur si une position est en cours, sinon l'invite vide.
  if (_EX.solFen) {
    const empty = document.getElementById('ex-sol-empty'); if (empty) empty.style.display = 'none';
    const editor = document.getElementById('ex-sol-editor'); if (editor) editor.style.display = '';
  } else { _exResetPanel(); }
}
function exFenContinue() {
  const raw = (document.getElementById('ex-fen-input')?.value || '').trim();
  if (!raw) { window.toast?.('⚠ Colle un FEN', 'ko'); return; }
  const g = new Chess();
  if (!g.load(raw)) { window.toast?.('❌ FEN invalide', 'ko'); return; }
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
// Construit un kp (position clé) depuis un coup chess.js validé. Source unique
// des drapeaux isCapture/isCastle/isCheck (evite la duplication verbatim).
function _exKp(fen, m, { altSans = [], comment = '' } = {}) {
  const flags = m.flags || '';
  return {
    fen, san: m.san, altSans, comment,
    isCapture: /x/.test(m.san) || flags.includes('e'),
    isCastle: flags.includes('k') || flags.includes('q'),
    isCheck: /\+|#/.test(m.san),
  };
}

function _exParseGameToKp(chunk) {
  const fenM = chunk.match(/\[FEN\s+"([^"]+)"\]/);
  const startFen = fenM ? fenM[1] : _EX_START;
  // On capture TOUTE la ligne principale (= la solution multi-coups). Robuste aux
  // NAG / variantes / commentaires ; l'eleve joue le 1er coup, l'adversaire repond, etc.
  const movetext = chunk.replace(/\[[^\]]*\]/g, ' ');
  // 1er VRAI commentaire (on ignore les annotations techniques : {[#]}, {[%evp …]}, {[%clk …]}…).
  const cM = (movetext.match(/\{([^}]*)\}/g) || [])
    .map(s => s.slice(1, -1).trim())
    .find(t => t && !/^\[?%/.test(t) && t !== '[#]' && !/^\[#\]/.test(t));
  const clean = movetext
    .replace(/\{[^}]*\}/g, ' ')                    // commentaires
    .replace(/\([^)]*\)/g, ' ')                    // variantes
    .replace(/\$\d+/g, ' ')                        // NAG
    .replace(/\d+\.(\.\.)?/g, ' ')                 // numeros de coup (1. / 1...)
    .replace(/\b(?:1-0|0-1|1\/2-1\/2)\b/g, ' ')    // resultat 1-0 / 0-1 / nulle
    .replace(/\*/g, ' ')                           // resultat * (pas de \b : * n'est pas un caractere de mot)
    .trim();
  const toks = clean.split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const g = new Chess(); if (!g.load(startFen)) return null;
  const sans = [];
  for (const t of toks) { const mv = g.move(t, { sloppy: true }); if (!mv) break; sans.push(mv.san); }
  if (!sans.length) return null;
  // Invariant moteur : la ligne finit sur le coup de l'eleve (longueur impaire).
  if (sans.length % 2 === 0) sans.pop();
  if (!sans.length) return null;
  const g0 = new Chess(); g0.load(startFen); const m = g0.move(sans[0], { sloppy: true });
  const kp = _exKp(startFen, m, { comment: cM || '' });
  if (sans.length > 1) kp.line = sans;             // multi-coups (mat en N / combinaison)
  return kp;
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

// ── Etape solution : jouer la SEQUENCE solution sur le mini-echiquier ─
// Le champ ex-sol-san contient la ligne complete en SAN separee par des espaces
// (source de verite). Les clics sur le plateau y ajoutent les coups ; l'elude
// joue le 1er coup, l'adversaire la reponse, etc. → mat en N / combinaison.
function _exLineTokens() {
  return (document.getElementById('ex-sol-san')?.value || '').trim().split(/\s+/).filter(Boolean);
}
// Position courante = FEN de depart + coups deja saisis (rejoues).
function _exCurrentGame() {
  const g = new Chess();
  if (!g.load(_EX.solFen)) return null;
  for (const t of _exLineTokens()) { const m = g.move(t, { sloppy: true }); if (!m) break; }
  return g;
}
function _exUpdateTurnLabel() {
  const turnEl = document.getElementById('ex-sol-turn'); if (!turnEl) return;
  const g = _exCurrentGame(); if (!g) return;
  const toks = _exLineTokens();
  const side = g.turn() === 'b' ? '⬛ Noirs' : '⬜ Blancs';
  if (!toks.length) { turnEl.innerHTML = `${side} jouent — joue le 1er coup de la solution (ou la suite complete pour un mat en N).`; return; }
  const mate = g.in_checkmate();
  turnEl.innerHTML = `Suite : <b>${toks.map(t => window.escapeHtml?.(t)).join(' ')}</b>`
    + (mate ? ' · <span style="color:var(--green);font-weight:700">MAT ✓</span>' : ` · au trait : ${side}`);
}

function _exOpenSolution(fen, existing) {
  _EX.solFen = fen; _EX.solSel = null; _EX.solMove = null;
  const g = new Chess();
  if (!g.load(fen)) { window.toast?.('❌ Position invalide', 'ko'); return; }
  const sanEl = document.getElementById('ex-sol-san');
  if (sanEl) sanEl.value = existing?.line?.length ? existing.line.join(' ') : (existing?.san || '');
  const altEl = document.getElementById('ex-sol-alt'); if (altEl) altEl.value = (existing?.altSans || []).join(', ');
  const comEl = document.getElementById('ex-sol-comment'); if (comEl) comEl.value = existing?.comment || '';
  _exUpdateTurnLabel();
  _exRenderSolBoard();
  // Panneau inline (refonte T6) : plus de modal empilé — on affiche l'éditeur dans la colonne de droite.
  const title = document.getElementById('ex-panel-title');
  if (title) title.textContent = (_EX.editIdx != null) ? `Modifier l'exercice ${_EX.editIdx + 1}` : 'Nouvel exercice';
  const row = document.getElementById('ex-fen-row'); if (row) row.style.display = 'none';
  const empty = document.getElementById('ex-sol-empty'); if (empty) empty.style.display = 'none';
  const editor = document.getElementById('ex-sol-editor'); if (editor) editor.style.display = '';
}

// Remet le panneau de droite à l'état vide (invite à choisir une position).
function _exResetPanel() {
  _EX.solFen = null; _EX.solSel = null; _EX.solMove = null; _EX.editIdx = null;
  const title = document.getElementById('ex-panel-title'); if (title) title.textContent = 'Nouvel exercice';
  const row = document.getElementById('ex-fen-row'); if (row) row.style.display = 'none';
  const editor = document.getElementById('ex-sol-editor'); if (editor) editor.style.display = 'none';
  const empty = document.getElementById('ex-sol-empty'); if (empty) empty.style.display = '';
}

function _exRenderSolBoard() {
  const grid = document.getElementById('ex-sol-board'); if (!grid) return;
  const g = _exCurrentGame(); if (!g) return;        // position courante (depart + ligne saisie)
  const flip = new Chess(_EX.solFen).turn() === 'b'; // orientation FIXE = cote au trait au DEPART
  const pos = {};
  g.SQUARES.forEach(sq => { const p = g.get(sq); if (p) pos[sq] = p.color + p.type.toUpperCase(); });
  const files = flip ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = flip ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
  let html = '';
  ranks.forEach((rank, ri) => {
    files.forEach((file, fi) => {
      const sq = file + rank;
      const light = (fi + ri) % 2 === 0;
      let bg = light ? BOARD_LIGHT : BOARD_DARK;
      if (_EX.solSel === sq) bg = BOARD_SEL;
      else if (_EX.solMove && (_EX.solMove.from === sq || _EX.solMove.to === sq)) bg = BOARD_MOVE;
      const p = pos[sq];
      const pc = p ? `<img src="${window.PIECE_CDN}${p}.svg" draggable="false" style="width:88%;height:88%;pointer-events:none">` : '';
      html += `<div onclick="_exSolClick('${sq}')" style="background:${bg};display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;aspect-ratio:1">${pc}</div>`;
    });
  });
  grid.innerHTML = html;
}

function _exSolClick(sq) {
  const g = _exCurrentGame(); if (!g) return;        // position courante (apres les coups deja saisis)
  const piece = g.get(sq);
  if (_EX.solSel) {
    if (sq === _EX.solSel) { _EX.solSel = null; _exRenderSolBoard(); return; }
    const mv = g.move({ from: _EX.solSel, to: sq, promotion: 'q' });
    if (mv) {
      _EX.solSel = null;
      const sanEl = document.getElementById('ex-sol-san');   // append a la ligne (source de verite)
      if (sanEl) sanEl.value = (sanEl.value.trim() + ' ' + mv.san).trim();
      _exRenderSolBoard(); _exUpdateTurnLabel();
      return;
    }
    // coup illegal → re-selection si on clique une piece au trait
    _EX.solSel = (piece && piece.color === g.turn()) ? sq : null;
    _exRenderSolBoard();
    return;
  }
  if (piece && piece.color === g.turn()) { _EX.solSel = sq; _exRenderSolBoard(); }
}

// Annule le dernier demi-coup de la sequence.
function exSolUndo() {
  const sanEl = document.getElementById('ex-sol-san'); if (!sanEl) return;
  const toks = _exLineTokens(); toks.pop();
  sanEl.value = toks.join(' ');
  _EX.solSel = null;
  _exRenderSolBoard(); _exUpdateTurnLabel();
}

function exSolReset() {
  _EX.solSel = null; _EX.solMove = null;
  const sanEl = document.getElementById('ex-sol-san'); if (sanEl) sanEl.value = '';
  _exRenderSolBoard(); _exUpdateTurnLabel();
}

// Valide la SEQUENCE solution (clics OU saisie SAN espacee) → construit le kp.
// 1 coup = tactique simple ; N coups (fin sur le coup de l'eleve) = mat en N.
function exSolAdd() {
  const fen = _EX.solFen;
  const toks = _exLineTokens();
  if (!toks.length) { window.toast?.('⚠ Indique le(s) coup(s) solution', 'ko'); return; }
  // Rejoue toute la ligne pour la valider et normaliser en SAN propre.
  const g = new Chess(); g.load(fen);
  const sans = [];
  for (const t of toks) {
    const mv = g.move(t, { sloppy: true });
    if (!mv) { window.toast?.(`❌ Coup illégal dans la séquence : ${window.escapeHtml?.(t)}`, 'ko'); return; }
    sans.push(mv.san);
  }
  // Invariant moteur : la sequence doit finir sur le coup de l'eleve (nombre impair de demi-coups).
  if (sans.length % 2 === 0) { window.toast?.('⚠ La séquence doit se terminer par le coup de l\'élève (nombre impair de demi-coups).', 'ko'); return; }
  // Premier coup (drapeaux du kp) + alternatives (acceptees pour le 1er coup seulement).
  const g0 = new Chess(); g0.load(fen); const m = g0.move(sans[0], { sloppy: true });
  const altRaw = (document.getElementById('ex-sol-alt')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const altSans = [];
  for (const a of altRaw) {
    const t = new Chess(); t.load(fen);
    const mm = t.move(a, { sloppy: true });
    if (mm && mm.san !== m.san && !altSans.includes(mm.san)) altSans.push(mm.san);
  }
  const comment = (document.getElementById('ex-sol-comment')?.value || '').trim();
  const kp = _exKp(fen, m, { altSans, comment });
  if (sans.length > 1) kp.line = sans;               // multi-coups (mat en N) ; sinon exercice 1 coup inchange
  const wasEdit = _EX.editIdx != null;
  if (wasEdit) { _EX.exercises[_EX.editIdx] = kp; _EX.editIdx = null; }
  else _EX.exercises.push(kp);
  _exRenderList();
  _exResetPanel();
  window.toast?.(wasEdit ? '✓ Exercice modifié' : '✓ Exercice ajouté', 'ok');
}

// ── Enregistrement du paquet → module mode:'flash' ────────
function saveExercisePacket() {
  const name = (document.getElementById('ex-pk-name')?.value || '').trim();
  const level = document.getElementById('ex-pk-level')?.value || 'Intermédiaire';
  const exType = (document.getElementById('ex-pk-type')?.value || '').trim();
  if (!name) { window.toast?.('⚠ Donne un nom au paquet', 'ko'); return; }
  if (!_EX.exercises.length) { window.toast?.('⚠ Ajoute au moins un exercice', 'ko'); return; }

  const kps = _EX.exercises.map(_exCloneKp);   // clone canonique (préserve `line`)
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
    isExercise: true, exType: exType || null,
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
  exDeleteExercise, _exSolClick, exSolReset, exSolUndo, exSolAdd, saveExercisePacket,
  exAddFromFen, exFenContinue, exFenCancel, exImportPgn, exPgnRun,
});
