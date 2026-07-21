// ══════════════════════════════════════════════════════
// STUDY — UI de la phase « Apprentissage » du drill.
// Extrait de lib/drill.js (décomposition dette juillet 2026, cf. CLAUDE.md §3).
// Deux sous-phases :
//   • phase « study » (arbre d'étude, mode ligne principale + sous-variantes,
//     carte pédagogique, « devine le coup ») ;
//   • phase « learn » (parcours guidé de la ligne avant le test).
// État session partagé : lib/session.js (`S`). Cœur pur : lib/drill-core.js.
// Fonctions app-level (board, feedback…) résolues au runtime via le pont window,
// comme lib/drill.js. `Chess` = global CDN.
// ══════════════════════════════════════════════════════
import { S } from './session.js';
import { G } from '../state.js';
import { isPlayerMove, chapterCount, chapterPgn } from './tree.js';
import { _normFen } from './core.js';
import { pgnToEditorTree, nagGlyphs } from './editor-core.js';

// ── Ponts vers app.js / lib/drill.js (résolus au runtime via le pont window) ──
const currentSession    = (...a) => window.currentSession?.(...a);
const drawBoard         = (...a) => window.drawBoard?.(...a);
const resizeBoard       = (...a) => window.resizeBoard?.(...a);
const setFeedback       = (...a) => window.setFeedback?.(...a);
const clearFeedback     = (...a) => window.clearFeedback?.(...a);
const updateSessionInfo = (...a) => window.updateSessionInfo?.(...a);
const startTreeDrill    = (...a) => window.startTreeDrill?.(...a);   // reste dans lib/drill.js
const fig        = (x) => window.fig ? window.fig(x) : x;
const figText    = (x) => window.figurineText ? window.figurineText(x) : x;   // coups inline d'un commentaire → figurines
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

function startStudyPhase() {
  const d = S.drill;
  // Module a CHAPITRES : on n'etudie que la partie du chapitre courant (sessionIdx).
  // Parser d.pgn entier fusionnerait les chapitres (les parties se rejouent depuis
  // la racine de la 1re et les coups illegaux sont silencieusement sautes).
  const sess = window.currentSession?.() || d.sessions?.[0];
  const startFen = sess?.startFen || new Chess().fen();
  const pgn = chapterCount(d) > 1 ? chapterPgn(d, S.sessionIdx) : d.pgn;
  let root = null;
  if (pgn) { try { root = pgnToEditorTree(pgn, startFen); } catch(e) { root = null; } }
  if (!root || !root.children.length) { startTreeDrill(); return; }   // pas d'arbre exploitable → révision directe
  S.phase = 'study';
  S.studyStartFen = startFen;
  S.studyTree = root;
  window.updateSessionInfo?.();   // barre « Chapitre N/M » visible des l'apprentissage
  S.studyMaxDepth = (function md(n, depth){ let m = depth; n.children.forEach(c => { m = Math.max(m, md(c, depth+1)); }); return m; })(root, 0);
  S.hintSquare = null; S.sel = null;
  document.getElementById('learn-card').style.display    = 'block';
  document.getElementById('notation-card').style.display = 'none';
  document.getElementById('pos-card').style.display      = 'none';
  document.getElementById('test-btns').style.display     = 'none';
  document.getElementById('score-card').style.display    = 'none';
  document.getElementById('history-card').style.display  = 'none';
  _setStudyLayout(true);
  clearFeedback();
  studyGoPath([0]);
}

// Bascule la mise en page « apprentissage » : info-card masquée, panneau des
// coups élargi (CSS) + plus haut + police plus grande pour mieux voir les coups.
function _setStudyLayout(on) {
  const grid  = document.getElementById('drill-grid');
  const info  = document.getElementById('drill-info-card');
  const title = document.getElementById('learn-card-title');
  const nota  = document.getElementById('learn-notation');
  const cm    = document.getElementById('learn-comment');
  const card  = document.getElementById('learn-card');
  const guessRow = document.getElementById('study-guess-row');
  if (grid) grid.classList.toggle('study-mode', on);
  if (info) info.style.display = on ? 'none' : '';
  if (guessRow) guessRow.style.display = on ? 'block' : 'none';
  S.studyGuess = false;   // « devine le coup » toujours désactivé à l'entrée/sortie de l'étude
  const gb = document.getElementById('study-guess-btn');
  if (gb) { gb.classList.remove('active'); gb.innerHTML = '<i class="ti ti-target" aria-hidden="true"></i> Devine le coup'; }
  if (on) {
    if (nota)  { nota.style.maxHeight = 'min(50vh, 440px)'; nota.style.fontSize = '13.5px'; nota.style.lineHeight = '1.85'; }
    if (cm)    { cm.style.display = 'none'; }   // commentaires déjà affichés en ligne dans le PGN → boîte inutile
    if (card)  { card.style.marginTop = '0'; card.style.paddingTop = '14px'; }   // remonte le bloc (pas d'espace perdu au-dessus)
    if (title) title.innerHTML = '<i class="ti ti-book" aria-hidden="true"></i> ' + escapeHtml(S.drill?.name || 'Apprentissage');
  } else {
    if (nota)  { nota.style.maxHeight = '160px'; nota.style.fontSize = ''; nota.style.lineHeight = ''; }
    if (cm)    { cm.style.display = ''; cm.style.height = '58px'; cm.style.minHeight = ''; cm.style.maxHeight = ''; cm.style.fontSize = ''; }
    if (card)  { card.style.marginTop = ''; card.style.paddingTop = ''; }
    const bubble = document.getElementById('study-bubble'); if (bubble) { bubble.style.display = 'none'; bubble.innerHTML = ''; }
    if (title) title.innerHTML = '<i class="ti ti-book" aria-hidden="true"></i> Apprentissage';
  }
  resizeBoard();   // re-ajuste le plateau à la nouvelle largeur de colonne
}

function studyGoPath(path) {
  if (!S.studyTree) return;
  let node = S.studyTree, g = new Chess(S.studyStartFen);
  const valid = [];
  for (const idx of path) { if (!node.children[idx]) break; node = node.children[idx]; g.move(node.san); valid.push(idx); }
  S.studyPath = valid;
  S.studyNode = node;
  S.lineGame  = g;
  drawBoard();
  renderStudyTree();
  updateStudyProgress();
  renderStudyBubble();
}

// Carte pédagogique : en-tête = coup courant (figurine + NAG), corps = commentaire
// VERBATIM du PGN du coach. Rien à afficher → masquée.
function renderStudyBubble() {
  const el = document.getElementById('study-bubble'); if (!el) return;
  const node = S.studyNode;
  const c = node && node.comment ? node.comment : '';
  if (!c) { el.style.display = 'none'; el.innerHTML = ''; return; }
  let head = '<i class="ti ti-bulb" aria-hidden="true"></i>';
  if (node.san && node.fenBefore) {
    const parts = node.fenBefore.split(' ');
    const white = parts[1] === 'w';
    head += ` <span class="study-card-move">${parts[5] || ''}${white ? '.' : '…'} ${fig(node.san)}${nagGlyphs(node)}</span>`;
  }
  el.innerHTML = `<div class="study-card-head">${head}</div><div class="study-card-body">${figText(escapeHtml(c))}</div>`;
  el.style.display = 'block';
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');   // relance l'animation d'apparition
}

// ── « Devine le coup » : rappel actif pendant l'étude (testing effect) ──
// L'élève joue le prochain coup sur l'échiquier au lieu de le lire.
function _studyGuessReady() {
  if (!S.studyGuess || !S.studyNode) return false;
  const nxt = S.studyNode.children && S.studyNode.children[0];
  return !!(nxt && isPlayerMove(nxt.fenBefore, S.drill?.side));
}

function toggleStudyGuess() {
  S.studyGuess = !S.studyGuess;
  const btn = document.getElementById('study-guess-btn');
  if (btn) { btn.classList.toggle('active', S.studyGuess); btn.innerHTML = S.studyGuess ? '<i class="ti ti-target" aria-hidden="true"></i> Devine : activé' : '<i class="ti ti-target" aria-hidden="true"></i> Devine le coup'; }
  S.sel = null;
  if (S.studyGuess) { _studyGuessSync(); _studyGuessPrompt(); }
  else { clearFeedback(); studyGoPath(S.studyPath || []); }
}

// Révèle automatiquement les coups adverses : l'élève ne devine que SES coups.
function _studyGuessSync() {
  let path = (S.studyPath || []).slice(), node = S.studyNode, guard = 0;
  while (guard++ < 300) {
    const nxt = node && node.children && node.children[0];
    if (!nxt || isPlayerMove(nxt.fenBefore, S.drill?.side)) break;
    path.push(0); node = nxt;
  }
  studyGoPath(path);
}

function _studyGuessPrompt() {
  if (_studyGuessReady()) setFeedback('hint', '🎯 Joue le prochain coup sur l\'échiquier', '');
  else if (!(S.studyNode && S.studyNode.children && S.studyNode.children.length)) setFeedback('ok', '✓ Ligne terminée — bravo !', '');
  else clearFeedback();
}

function tryStudyGuess(from, to) {
  const expected = S.studyNode && S.studyNode.children && S.studyNode.children[0];
  if (!expected) return;
  const g = new Chess(S.lineGame.fen());
  const mv = g.move({ from, to, promotion: 'q' });
  S.sel = null;
  if (!mv) { drawBoard(); return; }                       // coup illégal → on ignore
  if (mv.san === expected.san) {
    studyGoPath([...(S.studyPath || []), 0]);             // révèle le bon coup
    _studyGuessSync();                                     // révèle la réponse adverse, repasse le trait à l'élève
    _studyGuessPrompt();
  } else {
    drawBoard();
    setFeedback('ko', "✗ Ce n'est pas le coup principal — réessaie", '');
    const cv = document.getElementById('board');
    if (cv) { cv.classList.remove('shake'); void cv.offsetWidth; cv.classList.add('shake'); }
  }
}

// Vue resserrée en mode devine : coups joués (format `.mv` unifié) + « ? » pour le
// coup à trouver (masqué, comme en test).
function renderStudyGuessLine() {
  const el = document.getElementById('learn-notation'); if (!el) return;
  let node = S.studyTree, h = '';
  for (const idx of (S.studyPath || [])) {
    node = node.children[idx]; if (!node) break;
    const white = node.fenBefore.split(' ')[1] === 'w';
    if (white) h += `<span class="mv-num">${node.fenBefore.split(' ')[5]}.</span>`;
    h += `<span class="mv played">${fig(node.san)}</span>`;
  }
  const nxt = node && node.children && node.children[0];
  if (nxt) {
    const white = nxt.fenBefore.split(' ')[1] === 'w';
    h += `<span class="mv-num">${nxt.fenBefore.split(' ')[5]}${white ? '.' : '…'}</span>`;
    h += `<span class="mv ask">?</span>`;
  } else {
    h += `<span class="mv ok">✓ Ligne terminée</span>`;
  }
  el.innerHTML = h;
}

function studyNext() { if (S.studyNode && S.studyNode.children && S.studyNode.children.length) studyGoPath([...(S.studyPath || []), 0]); }
function studyPrev() { if (S.studyPath && S.studyPath.length) studyGoPath(S.studyPath.slice(0, -1)); }

function updateStudyProgress() {
  const lnum = document.getElementById('learn-pos-num');
  if (lnum) {
    const n = S.studyNode;
    if (!n || !n.san) { lnum.textContent = 'Position de départ'; lnum.style.color = 'var(--dim)'; }
    else { const isP = isPlayerMove(n.fenBefore, S.drill?.side); lnum.textContent = isP ? '● Ton coup' : "○ Coup adverse"; lnum.style.color = isP ? 'var(--cyan)' : 'var(--dim)'; }
  }
  const depth = (S.studyPath || []).length;
  const prog = document.getElementById('learn-prog'); if (prog) prog.textContent = depth + ' / ' + (S.studyMaxDepth || depth);
  const fill = document.getElementById('learn-prog-fill'); if (fill) fill.style.width = (S.studyMaxDepth ? Math.round(depth / S.studyMaxDepth * 100) : 0) + '%';
  const prevB = document.getElementById('learn-prev-btn'); if (prevB) prevB.disabled = depth === 0;
  const nextB = document.getElementById('learn-next-btn'); if (nextB) nextB.disabled = !(S.studyNode && S.studyNode.children && S.studyNode.children.length);
  const testBtn = document.querySelector('#learn-card .btn-primary'); if (testBtn) testBtn.innerHTML = '<i class="ti ti-player-play" aria-hidden="true"></i> Commencer la révision';
}

// État de maîtrise SM-2 d'un coup de l'élève dans l'arbre d'étude.
// → 'known' (révisé, pas encore dû), 'due' (à revoir), ou null (pas un coup élève / jamais vu).
function _studyMastery(node) {
  if (!node || !node.san || typeof _normFen !== 'function') return null;
  if (!isPlayerMove(node.fenBefore, S.drill?.side)) return null;   // seuls les coups de l'élève sont révisés
  const student = S.student || G.currentUser?.displayName || G.currentUser?.email || 'Anonyme';
  const did = String(S.drill?.id ?? '');
  const m = G.masteryData[`${student}_${did}_${_normFen(node.fenBefore)}_${node.san}`];
  if (!m) return null;                              // jamais révisé
  return m.due <= Date.now() ? 'due' : 'known';
}

function renderStudyTree() {
  const el = document.getElementById('learn-notation'); if (!el) return;
  if (S.studyGuess) return renderStudyGuessLine();   // mode rappel actif : on masque les coups à venir
  const curStr = JSON.stringify(S.studyPath || []);
  // Pastille discrète : ce coup a un commentaire (affiché en bulle quand on est dessus)
  const dot = '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--cyan);vertical-align:middle;margin-left:3px;opacity:.85"></span>';
  // Indicateurs de maîtrise (réutilise les données SM-2 de la révision)
  const masteredMark = '<span title="Maîtrisé" style="color:#22c55e;font-size:.82em;font-weight:700;margin-left:3px">✓</span>';
  const dueMark = '<span title="À revoir" style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#f59e0b;vertical-align:middle;margin-left:3px"></span>';

  // Hiérarchie pédagogique : la LIGNE PRINCIPALE domine (texte fort), les sous-variantes
  // reculent (estompées + plus petites, sans blocs colorés) → l'élève suit d'abord la ligne
  // principale. Un simple rail neutre marque l'indentation, la profondeur estompe le texte.
  const VAR_SHADE = ['var(--text-2)', 'var(--dim)', 'var(--dim)'];
  const moveSpan = (node, path, depth, lead) => {
    const isCur = JSON.stringify(path) === curStr;
    const s = isCur ? 'background:var(--cyan);color:#fff;font-weight:700'
            : depth === 0 ? 'color:var(--text);font-weight:600'
            : `color:${VAR_SHADE[Math.min(depth - 1, VAR_SHADE.length - 1)]};font-weight:400`;
    const fs = depth === 0 ? '' : (depth === 1 ? 'font-size:.86em;' : 'font-size:.8em;');
    return `<span ${isCur?'id="study-active"':''} onclick="studyGoPath(${JSON.stringify(path)})" style="cursor:pointer;${lead||''}${s};${fs}padding:1px 3px;border-radius:5px">${fig(node.san)}${nagGlyphs(node)}</span>`;
  };
  // Un demi-coup : numéro (blanc, ou début de ligne forcé) + coup + pastille éventuelle.
  // `first` supprime l'espacement de tête (début de ligne / juste après la flèche ↳).
  const ply = (node, path, depth, showNum, first) => {
    const white = node.fenBefore.split(' ')[1] === 'w';
    const lead = first ? '' : 'margin-left:6px;';
    let h = '';
    if (showNum) {
      h += `<span style="color:var(--dim);font-size:.72rem;${lead}">${node.fenBefore.split(' ')[5]}${white?'.':'…'}</span>`;
      h += moveSpan(node, path, depth, '');
    } else {
      h += moveSpan(node, path, depth, lead);
    }
    if (node.comment) h += dot;
    const mast = _studyMastery(node);
    if (mast === 'known') h += masteredMark;
    else if (mast === 'due') h += dueMark;
    return h;
  };
  // Ligne principale en fil ; chaque variante part dans un bloc indenté à SA couleur de
  // profondeur (rail gauche + flèche ↳ + teinte de fond) → niveaux nettement différenciés.
  function mainline(pos, path, depth, freshFirst) {
    let h = '', first = true, fresh = freshFirst;
    while (pos.children && pos.children.length) {
      const mv = pos.children[0], mvPath = [...path, 0];
      const white = mv.fenBefore.split(' ')[1] === 'w';
      h += ply(mv, mvPath, depth, white || fresh, first);
      pos.children.slice(1).forEach((v, vi) => {
        const vPath = [...path, vi + 1];
        h += `<div class="study-var">`
           + `<span class="study-var-arrow">↳</span>`
           + ply(v, vPath, depth + 1, true, true)
           + mainline(v, vPath, depth + 1, false)
           + `</div>`;
      });
      fresh = pos.children.length > 1;   // après une variante on réaffiche le numéro
      first = false;
      pos = mv; path = mvPath;
    }
    return h;
  }
  const body = mainline(S.studyTree, [], 0, false);   // mode unique : arbre complet (toutes les sous-variantes nichées)
  el.innerHTML = body || '<span style="color:var(--dim)">Aucun coup.</span>';
  requestAnimationFrame(() => { const a = document.getElementById('study-active'); if (a) a.scrollIntoView({ block:'nearest', behavior:'instant' }); });
}

// ══════════════════════════════════════════════════════
// PHASE APPRENTISSAGE (mode ligne) — parcours guidé avant le test
// ══════════════════════════════════════════════════════
function startLearnPhase() {
  const d    = S.drill;
  const sess = currentSession();
  const startFen = sess.startFen || new Chess().fen();
  S.phase    = 'learn';
  S.learnIdx = 0;
  // Reset ici (entrée d'une session neuve) et non dans startLineDrill : replayErrors
  // pose errorOnlySet juste avant enterTestPhase → startLineDrill, qui l'écraserait.
  S.errorOnlySet = null;

  // Préparer la liste des coups (même structure que le test)
  S.lineAllMoves = sess.moves.map((mv, i) => ({
    ...mv,
    isPlayer: isPlayerMove(mv.fenBefore, d.side),
    idx: i,
    result: null
  }));
  S.lineGame = new Chess(startFen);
  // Cursor starts on first move, not position de départ
  if (S.lineAllMoves.length > 0) {
    S.lineGame.move(S.lineAllMoves[0].san);
    S.learnIdx = 1;
  } else {
    S.learnIdx = 0;
  }
  updateSessionInfo();

  _setStudyLayout(false);   // mode ligne : info-card visible, panneau standard
  document.getElementById('learn-card').style.display = 'block';
  document.getElementById('notation-card').style.display = 'none';
  document.getElementById('test-btns').style.display = 'none';
  document.getElementById('score-card').style.display = 'none';
  document.getElementById('history-card').style.display = 'none';
  clearFeedback();
  renderLearnState();
  drawBoard();
}

function learnNext() {
  if (S.phase === 'study') return studyNext();
  if (S.learnIdx >= S.lineAllMoves.length) return;
  clearFeedback();
  const mv = S.lineAllMoves[S.learnIdx];
  S.lineGame.move(mv.san);
  S.learnIdx++;
  renderLearnState();
  drawBoard();
  // Fin de ligne : animation bouton
  if (S.learnIdx >= S.lineAllMoves.length) {
    setFeedback('ok', '✓ Tu as tout vu — lance le test !', '');
  }
}

function learnPrev() {
  if (S.phase === 'study') return studyPrev();
  if (S.learnIdx <= 0) return;
  clearFeedback();
  S.learnIdx--;
  const startFen = currentSession().startFen || new Chess().fen();
  S.lineGame = new Chess(startFen);
  for (let i = 0; i < S.learnIdx; i++) S.lineGame.move(S.lineAllMoves[i].san);
  renderLearnState();
  drawBoard();
}

function renderLearnState() {
  renderLearnNotation();
  renderLearnComment();
  updateLearnProgress();
}

// Apprentissage : feuille de coups au MÊME format unifié (flux `.mv`) que le test,
// entièrement cliquable (aucun coup caché) → navigation directe dans la ligne.
function renderLearnNotation() {
  const el = document.getElementById('learn-notation');
  if (!el) return;
  if (!S.lineAllMoves.length) { el.innerHTML = '<span class="mv future">—</span>'; return; }
  let html = '';
  S.lineAllMoves.forEach((mv, i) => {
    const turn = mv.fenBefore.split(' ')[1];
    const num  = mv.fenBefore.split(' ')[5];
    if (turn === 'w')  html += `<span class="mv-num">${num}.</span>`;
    else if (i === 0)  html += `<span class="mv-num">${num}…</span>`;

    let cls = 'mv clickable';
    let id = '';
    if (i === S.learnIdx - 1)      { cls += ' cur'; id = ' id="learn-notation-active"'; }  // coup courant
    else if (i < S.learnIdx)       { cls += mv.isPlayer ? ' played' : ' auto'; }            // déjà vus
    else                           { cls += ' future'; }                                    // pas encore atteints
    const title = mv.comment ? ` title="${escapeHtml(mv.comment)}"` : '';
    html += `<span class="${cls}"${id}${title} onclick="learnGoto(${i})">${fig(mv.san)}</span>`;
  });
  el.innerHTML = html;
  requestAnimationFrame(() => {
    const a = document.getElementById('learn-notation-active');
    if (a) a.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });
}

// Clic-navigation en apprentissage : rejoue la ligne jusqu'au coup cliqué (inclus).
function learnGoto(ply) {
  if (S.phase !== 'learn' || !S.lineAllMoves[ply]) return;
  clearFeedback();
  S.learnIdx = ply + 1;
  const startFen = currentSession().startFen || new Chess().fen();
  S.lineGame = new Chess(startFen);
  for (let i = 0; i < S.learnIdx; i++) S.lineGame.move(S.lineAllMoves[i].san);
  renderLearnState();
  drawBoard();
}

function renderLearnComment() {
  const el = document.getElementById('learn-comment');
  if (!el) return;
  // Si la ligne n'a aucun commentaire, on masque entièrement la boîte (pas d'espace vide inutile).
  const lineHasComments = (S.lineAllMoves || []).some(m => m && m.comment);
  if (!lineHasComments) { el.style.display = 'none'; return; }
  el.style.display = '';
  const mv = S.learnIdx > 0 ? S.lineAllMoves[S.learnIdx - 1] : null;
  const comment = mv && mv.comment ? mv.comment : '';
  if (comment) {
    el.style.background = 'var(--bg)';
    el.innerHTML = `<span style="color:var(--cyan);margin-right:5px">💬</span>${escapeHtml(comment)}`;
  } else {
    // Coup sans commentaire (mais la ligne en a ailleurs) : boîte invisible mais hauteur conservée → aucun mouvement.
    el.style.background = 'transparent';
    el.innerHTML = '';
  }
  el.scrollTop = 0;
}

function updateLearnProgress() {
  const total = S.lineAllMoves.length;
  document.getElementById('learn-prog').textContent = S.learnIdx + ' / ' + total;
  const pct = total > 0 ? Math.round(S.learnIdx / total * 100) : 0;
  const fill = document.getElementById('learn-prog-fill');
  if (fill) fill.style.width = pct + '%';
  let label, labelColor;
  if (S.learnIdx === 0) {
    label = 'Position de départ'; labelColor = 'var(--dim)';
  } else if (S.learnIdx === total) {
    label = '✓ Fin de la ligne'; labelColor = 'var(--green)';
  } else {
    const mv = S.lineAllMoves[S.learnIdx - 1];
    label = mv.isPlayer ? 'Votre coup' : 'Adversaire';
    labelColor = mv.isPlayer ? 'var(--cyan)' : 'var(--dim)';
  }
  const lnum = document.getElementById('learn-pos-num');
  lnum.textContent = label;
  lnum.style.color = labelColor;
  document.getElementById('learn-prev-btn').disabled = S.learnIdx <= 0;
  document.getElementById('learn-next-btn').disabled = S.learnIdx >= total;
  // Bouton test : s'illumine quand la ligne est vue en entier
  const testBtn = document.querySelector('#learn-card .btn-primary');
  if (testBtn) {
    const done = S.learnIdx >= total;
    testBtn.innerHTML = done ? '<i class="ti ti-player-play" aria-hidden="true"></i> Commencer le test' : '<i class="ti ti-target" aria-hidden="true"></i> Je connais la ligne — Tester';
    testBtn.style.opacity = done ? '1' : '0.75';
    testBtn.style.transform = done ? 'scale(1.02)' : '';
    testBtn.style.boxShadow = done ? '0 0 12px var(--cyan-glow)' : '';
  }
}

// ── Pont window (onclick inline + accès inter-modules) ──
Object.assign(window, {
  startStudyPhase, _setStudyLayout, studyGoPath, renderStudyBubble, _studyGuessReady, toggleStudyGuess,
  _studyGuessSync, _studyGuessPrompt, tryStudyGuess, renderStudyGuessLine, studyNext, studyPrev,
  updateStudyProgress, _studyMastery, renderStudyTree,
  startLearnPhase, learnNext, learnPrev, learnGoto, renderLearnState, renderLearnNotation, renderLearnComment,
  updateLearnProgress,
});
