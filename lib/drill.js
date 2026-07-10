// ══════════════════════════════════════════════════════
// DRILL — UI (modes ligne, positions clés/flash, arbre/étude).
// Extrait d'app.js (étape 5.2c du découpage drill engine, cf. CLAUDE.md §5.2).
// Cœur pur : lib/drill-core.js. État session partagé : lib/session.js (`S`).
// Fonctions app-level (board, feedback, score, enregistrement) résolues au
// runtime via le pont window, comme lib/editor.js.
// `Chess` = global CDN.
// ══════════════════════════════════════════════════════
import { S } from './session.js';
import { G } from '../state.js';
import { isPlayerMove, _materialHint } from './tree.js';
import { _normFen } from './core.js';
import { _commentDelay, oppSeenKey, pickOppMove, computeForcedPath, treeUnseenCount } from './drill-core.js';
import { pgnToEditorTree, nagGlyphs } from './editor-core.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const currentSession        = (...a) => window.currentSession?.(...a);
const totalSessions         = (...a) => window.totalSessions?.(...a);
const drawBoard             = (...a) => window.drawBoard?.(...a);
const setFeedback           = (...a) => window.setFeedback?.(...a);
const clearFeedback         = (...a) => window.clearFeedback?.(...a);
const setBoardComment       = (...a) => window.setBoardComment?.(...a);
const setBoardPrompt        = (...a) => window.setBoardPrompt?.(...a);
const addLog                = (...a) => window.addLog?.(...a);
const updateScores          = (...a) => window.updateScores?.(...a);
const recordResult          = (...a) => window.recordResult?.(...a);
const recordPracticeSession = (...a) => window.recordPracticeSession?.(...a);
const showEndModal          = (...a) => window.showEndModal?.(...a);
const updateReviserToutBadge= (...a) => window.updateReviserToutBadge?.(...a);
const updateSessionInfo     = (...a) => window.updateSessionInfo?.(...a);
const resizeBoard           = (...a) => window.resizeBoard?.(...a);
// SR (répétition espacée, reste dans app.js → futur lib/sr.js)
const _srToggleBar          = (...a) => window._srToggleBar?.(...a);
const _srUpdateBar          = (...a) => window._srUpdateBar?.(...a);
const _srAnswer             = (...a) => window._srAnswer?.(...a);
const _srBilan              = (...a) => window._srBilan?.(...a);
const fig        = (x) => window.fig ? window.fig(x) : x;
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

// Coup adverse en attente quand l'auto-play est en pause (local au module).
let _pendingAdversaryMv = null;

function startLineDrill() {
  const d    = S.drill;
  const sess = currentSession();
  const startFen = sess.startFen || new Chess().fen();
  S.hintSquare   = null;
  S.errorOnlySet = null;
  S.pauseAdversary = S.pauseAdversary || false;
  _pendingAdversaryMv = null;
  S.lineGame = new Chess(startFen);
  S.lineAllMoves = sess.moves.map((mv,i)=>({
    ...mv,
    isPlayer: isPlayerMove(mv.fenBefore, d.side),
    idx: i,
    result: null  // null | 'ok' | 'ko' | 'auto'
  }));
  S.lineMoveIdx      = 0;
  S.waitingForPlayer = false;
  S.lineErrorCounted = false;
  S.postTheory       = false;

  renderNotation();
  updateLinePosInfo();
  drawBoard();
  setTimeout(advanceLine, 300);
}

function advanceLine() {
  if (S.lineMoveIdx >= S.lineAllMoves.length) { endLineDrill(); return; }

  const mv = S.lineAllMoves[S.lineMoveIdx];
  updateLinePosInfo();
  renderNotation();
  drawBoard();

  if (!mv.isPlayer) {
    S.waitingForPlayer = false;
    if (S.pauseAdversary) {
      _pendingAdversaryMv = mv;
      setFeedback('hint', '⏸ Prêt — cliquez ▶ Adv. pour que les noirs jouent', '');
      return;
    }
    setFeedback('hint', '⟳ Adversaire réfléchit…', '');
    setTimeout(() => {
      if (!S.lineGame) return;
      const r = S.lineGame.move(mv.san);
      mv.result = 'auto';
      S.lineMoveIdx++;
      if (mv.comment) {
        setFeedback('hint', '📘 ' + fig(mv.san), mv.comment);
      } else {
        clearFeedback();
      }
      renderNotation();
      drawBoard();
      setTimeout(advanceLine, _commentDelay(mv.comment));
    }, 650);
  } else {
    // Mode "erreurs seulement" : auto-jouer les coups déjà sus
    if (S.errorOnlySet?.size && !S.errorOnlySet.has(mv.idx)) {
      S.lineGame.move(mv.san);
      mv.result = 'ok';
      S.lineMoveIdx++;
      renderNotation(); drawBoard();
      setTimeout(advanceLine, 80);
      return;
    }
    S.waitingForPlayer = true;
    S.lineErrorCounted = false;
    setFeedback('hint', '🎯 À vous — trouvez le bon coup !', '');
  }
}

function tryMoveInLine(from, to) {
  if (!S.waitingForPlayer) return;
  const mv = S.lineAllMoves[S.lineMoveIdx];
  if (!mv) return;

  const tmp = new Chess(S.lineGame.fen());
  const played = tmp.move({from, to, promotion:'q'});
  if (!played) { drawBoard(); return; }

  const norm = s=>s.replace(/[+#!?]/g,'');
  const isCorrect = norm(played.san)===norm(mv.san);
  S.hintSquare = null;

  if (isCorrect) {
    S.lineGame.move({from, to, promotion:'q'});
    mv.result = 'ok';
    S.ok++;
    S.waitingForPlayer = false;
    setFeedback('ok', '✓ '+fig(played.san), S.drill.hideComments ? '' : mv.comment);
    addLog(played.san, true, Math.ceil((S.lineMoveIdx+1)/2));
    updateScores();
    renderNotation();
    recordResult(true, {san:mv.san, comment:mv.comment, posIdx:Math.ceil((S.lineMoveIdx+1)/2)-1});
    S.lineMoveIdx++;
    setTimeout(advanceLine, (!S.drill.hideComments && mv.comment) ? _commentDelay(mv.comment) : 800);
  } else {
    if (!S.lineErrorCounted) {
      S.ko++;
      S.lineErrorCounted = true;
      mv.result = 'ko';
      recordResult(false, {san:mv.san, comment:mv.comment, posIdx:Math.ceil((S.lineMoveIdx+1)/2)-1});
      updateScores();
    }
    setFeedback('ko', '✗ Pas tout à fait — réessaie !', '');
    addLog(played.san+' ✗', false, Math.ceil((S.lineMoveIdx+1)/2));
    renderNotation();
    drawBoard();
    const _cvs = document.getElementById('board');
    _cvs.classList.remove('shake'); void _cvs.offsetWidth; _cvs.classList.add('shake');
  }
}

function skipLinePosition() {
  if (!S.waitingForPlayer) return;
  const mv = S.lineAllMoves[S.lineMoveIdx];
  if (!mv) return;

  if (!S.lineErrorCounted) {
    S.ko++; mv.result='ko';
    S.lineErrorCounted = true;
    recordResult(false, {san:mv.san, comment:mv.comment, posIdx:Math.ceil((S.lineMoveIdx+1)/2)-1});
    updateScores();
  }
  S.lineGame.move(mv.san);
  setFeedback('ko', '→ Le coup était : '+fig(mv.san), S.drill.hideComments ? '' : mv.comment);
  S.waitingForPlayer = false;
  S.lineMoveIdx++;
  renderNotation(); drawBoard();
  setTimeout(advanceLine, S.drill.hideComments ? 1200 : _commentDelay(mv.comment));
}

function updateLinePosInfo() {
  const playerMoves = S.lineAllMoves.filter(m=>m.isPlayer);
  const done = S.lineAllMoves.slice(0, S.lineMoveIdx).filter(m=>m.isPlayer).length;
  document.getElementById('pos-prog-line').textContent = done+' / '+playerMoves.length;
  const t = S.lineGame?.turn()||'w';
  document.getElementById('s-turn').textContent = t==='w'?'⬜ Blancs jouent':'⬛ Noirs jouent';
  document.getElementById('s-turn').style.color = 'var(--dim)';
}

function renderNotation() {
  const el = document.getElementById('notation-moves');
  if (!el) return;
  let html = '';

  S.lineAllMoves.forEach((mv, i) => {
    const turn = mv.fenBefore.split(' ')[1];
    const num  = mv.fenBefore.split(' ')[5];

    if (turn==='w') {
      html += `<span style="color:var(--dim);margin-right:2px">${num}.</span>`;
    } else if (i===0) {
      html += `<span style="color:var(--dim);margin-right:2px">${num}…</span>`;
    }

    // Coup en cours que le joueur doit trouver
    if (i===S.lineMoveIdx && S.waitingForPlayer && mv.isPlayer) {
      html += `<span id="notation-active" style="background:var(--cyan);color:#111;padding:1px 7px;border-radius:4px;font-weight:700;margin-right:4px">?</span>`;
    } else if (mv.result==='ok') {
      html += `<span style="color:var(--green);margin-right:4px" title="${escapeHtml(mv.comment)}">${fig(mv.san)}</span>`;
    } else if (mv.result==='ko') {
      html += `<span style="color:var(--red);margin-right:4px" title="${escapeHtml(mv.comment)}">${fig(mv.san)}</span>`;
    } else if (mv.result==='auto' || (!mv.isPlayer && i<S.lineMoveIdx)) {
      html += `<span style="color:var(--dim);margin-right:4px">${fig(mv.san)}</span>`;
    } else if (i>S.lineMoveIdx) {
      if (mv.isPlayer) {
        html += `<span style="color:var(--cyan);opacity:.35;margin-right:4px;font-style:italic;font-size:.78em">?</span>`;
      } else {
        html += `<span style="color:var(--dim);opacity:.25;margin-right:4px">·</span>`;
      }
    } else {
      html += `<span style="color:var(--dim);margin-right:4px">${fig(mv.san)}</span>`;
    }
  });

  el.innerHTML = html;
  requestAnimationFrame(() => {
    const a = document.getElementById('notation-active');
    if (a) a.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });
}

function endLineDrill() {
  const playerMoves = S.lineAllMoves.filter(m=>m.isPlayer);
  const pct = playerMoves.length ? Math.min(100, Math.round(S.ok/playerMoves.length*100)) : 100;
  const total = totalSessions();

  if (S.sessionIdx < total - 1) {
    recordPracticeSession(pct);
    const nextSess = (S.drill.sessions || [])[S.sessionIdx + 1] || { label: 'Session suivante' };
    const el = document.getElementById('feedback');
    el.className = 'feedback ok';
    el.innerHTML = `<div>✓ Session ${S.sessionIdx+1}/${total} terminée — ${pct}%</div>
      <button class="btn btn-gold" style="margin-top:10px;width:100%;font-size:.84rem"
        onclick="nextSession()">📖 Session suivante : ${escapeHtml(nextSess.label)} →</button>`;
    setBoardComment(''); setBoardPrompt('ok', `✓ ${pct}% — Session ${S.sessionIdx+1}/${total}`);
  } else {
    recordPracticeSession(pct);
    showEndModal(pct);
  }
}

function togglePauseAdversary() {
  S.pauseAdversary = !S.pauseAdversary;
  const btn = document.getElementById('btn-pause-adv');
  if (btn) btn.textContent = S.pauseAdversary ? '▶ Adv.' : '⏸ Auto';
  if (!S.pauseAdversary && _pendingAdversaryMv) {
    const mv = _pendingAdversaryMv;
    _pendingAdversaryMv = null;
    setFeedback('hint', '⟳ Adversaire réfléchit…', '');
    setTimeout(() => {
      if (!S.lineGame) return;
      S.lineGame.move(mv.san);
      mv.result = 'auto';
      S.lineMoveIdx++;
      if (mv.comment) setFeedback('hint', '📘 ' + fig(mv.san), mv.comment);
      else clearFeedback();
      renderNotation(); drawBoard();
      setTimeout(advanceLine, _commentDelay(mv.comment));
    }, 400);
  }
}

// ══════════════════════════════════════════════════════
// MODE POSITIONS CLÉS / FLASH
// ══════════════════════════════════════════════════════
function loadPosition(posIdx) {
  if (posIdx>=S.kps.length) { endPositionsDrill(); return; }
  S.posIdx = posIdx;
  if (S.kps[posIdx]._drill) { S.drill = S.kps[posIdx]._drill; S.idx = S.kps[posIdx]._drillIdx; }
  S.sel    = null;
  S.game   = new Chess(S.kps[posIdx].fen);
  clearFeedback();
  renderPosStrip();
  updatePosInfo();
  drawBoard();
  _srToggleBar(!!(S.sr && S.sr.active));
  if (S.sr && S.sr.active) _srUpdateBar();
}

function updatePosInfo() {
  document.getElementById('pos-prog').textContent = (S.posIdx+1)+' / '+S.kps.length;
  const t = S.game?.turn()||'w';
  document.getElementById('s-turn').textContent = t==='w'?'⬜ Blancs jouent':'⬛ Noirs jouent';
  document.getElementById('s-turn').style.color = 'var(--dim)';
}

function renderPosStrip() {
  document.getElementById('pos-strip').innerHTML = S.kps.map((p,i)=>{
    let cls='pos-dot';
    if(i===S.posIdx) cls+=' current';
    else if(p.attempted&&p.correct) cls+=' done-ok';
    else if(p.attempted) cls+=' done-ko';
    return `<div class="${cls}" title="Position ${i+1}">${i+1}</div>`;
  }).join('');
}

function tryMoveInPositions(from, to) {
  const legal = S.game.moves({square:from,verbose:true}).find(m=>m.to===to);
  if (!legal) { drawBoard(); return; }
  const tmp = new Chess(S.game.fen());
  const played = tmp.move({from,to,promotion:'q'});
  if (!played) { drawBoard(); return; }

  const norm = s=>s.replace(/[+#!?]/g,'');
  const kp = S.kps[S.posIdx];
  const accept = [kp.san, ...(kp.altSans||[])].map(norm);
  const isCorrect = accept.includes(norm(played.san));
  if (S.sr && S.sr.active) { _srAnswer(kp, played, isCorrect); return; }
  kp.attempted=true; kp.correct=isCorrect;

  if (isCorrect) {
    S.game.move({from,to,promotion:'q'});
    S.ok++;
    setFeedback('ok',
      '✓ Correct ! '+fig(played.san)+(kp.isCapture?' — bonne capture !':kp.isCastle?' — roque !':kp.isCheck?' — échec !':''),
      S.drill.hideComments ? '' : kp.comment);
    addLog(played.san, true, S.posIdx+1);
  } else {
    S.ko++;
    const matHint = _materialHint(S.game.fen(), played.san);
    setFeedback('ko','✗ Pas tout à fait. Le coup attendu était : '+fig(kp.san)+(matHint?' · '+matHint:''), S.drill.hideComments ? '' : kp.comment);
    addLog(played.san+' ✗', false, S.posIdx+1);
  }

  updateScores(); renderPosStrip(); drawBoard();
  recordResult(isCorrect, {san:kp.san, comment:kp.comment, posIdx:S.posIdx});
  if (isCorrect) setTimeout(()=>loadPosition(S.posIdx+1), 1100);
}

function endPositionsDrill() {
  if (S.sr && S.sr.active) { _srBilan(); return; }
  const done = S.ok+S.ko;
  const pct  = done ? Math.round(S.ok/done*100) : 0;
  if (!S.unifiedReview) recordPracticeSession(pct);
  S.unifiedReview = false;
  updateReviserToutBadge();
  showEndModal(pct);
}

// ══════════════════════════════════════════════════════
// MODE ARBRE DYNAMIQUE
// ══════════════════════════════════════════════════════
function startTreeDrill() {
  const d = S.drill;
  S._treeGen = (S._treeGen || 0) + 1;
  S.lineGame = new Chess(d.sessions?.[0]?.startFen || new Chess().fen());
  S.ok = 0; S.ko = 0; S.sel = null; S.postTheory = false;
  S.waitingForPlayer = false;
  S.phase = 'tree';
  S._forcedPath = _computeForcedPath(S.student || '', String(d.id ?? ''), d.tree || {}, d.side);
  S._treeErrors = [];
  updateScores(); updateSessionInfo();
  _setStudyLayout(false);   // sortie de l'apprentissage → réaffiche l'info-card
  document.getElementById('learn-card').style.display    = 'none';
  document.getElementById('notation-card').style.display = 'none';
  document.getElementById('pos-card').style.display      = 'none';
  document.getElementById('test-btns').style.display     = 'none';
  document.getElementById('score-card').style.display    = '';
  document.getElementById('history-card').style.display  = '';
  clearFeedback(); drawBoard();
  const unseen = _treeUnseenCount();
  if (unseen > 0) setFeedback('hint', `🗺 ${unseen} branche${unseen>1?'s':''} non explorée${unseen>1?'s':''} — session ciblée`, '');
  const gen = S._treeGen;
  setTimeout(() => { if (S._treeGen === gen) advanceTree(); }, 200);
}

// Wrapper stateful : lit S/G.oppSeen, délègue le choix à pickOppMove (pur),
// puis enregistre le coup retenu dans G.oppSeen (+ localStorage).
function _pickOppMove(nf, moves) {
  const st  = S.student || '';
  const did = String(S.drill?.id ?? '');
  const seenTs = {};
  for (const m of moves) seenTs[m.san] = G.oppSeen[oppSeenKey(st, did, nf, m.san)] || 0;
  const chosen = pickOppMove(moves, seenTs, S._forcedPath?.[nf]);
  G.oppSeen[oppSeenKey(st, did, nf, chosen.san)] = Date.now();
  localStorage.setItem('mc_opp_seen', JSON.stringify(G.oppSeen));
  return chosen;
}

function _treeUnseenCount() {
  if (S.drill?.varmode !== 'tree') return 0;
  return treeUnseenCount(S.drill.tree || {}, S.student || '', String(S.drill?.id ?? ''), G.oppSeen);
}

// BFS from root to find the path of opp choices that leads to the
// shallowest unseen (or LRU) opp move. Returns {normFen: san} map
// used by _pickOppMove to deterministically steer the opp each session.
// Wrapper stateful : injecte G.oppSeen dans computeForcedPath (pur).
function _computeForcedPath(student, drillId, tree, drillSide) {
  return computeForcedPath(student, drillId, tree, drillSide, G.oppSeen);
}

function advanceTree() {
  const gen = S._treeGen;
  const g = S.lineGame;
  if (!g || g.game_over()) {
    _treeEnd(); return;
  }
  const nf   = _normFen(g.fen());
  const node = S.drill.tree?.[nf];
  if (!node) { _treeEnd(); return; }

  const playerTurn = isPlayerMove(g.fen(), S.drill.side);

  if (!playerTurn && node.opp.length) {
    S.waitingForPlayer = false;
    const mv = _pickOppMove(nf, node.opp);
    const r  = g.move(mv.san);
    if (r) { S.last = { from: r.from, to: r.to }; drawBoard(); }
    setTimeout(() => { if (S._treeGen === gen) advanceTree(); }, 350);
  } else if (playerTurn && node.player.length) {
    S.waitingForPlayer = true;
    setFeedback('hint', '🎯 Jouez le bon coup !', '');
    drawBoard();
  } else {
    _treeEnd();
  }
}

function _treeEnd() {
  S.waitingForPlayer = false;
  const done = S.ok + S.ko;
  const pct  = done ? Math.round(S.ok / done * 100) : 100;
  recordPracticeSession(pct);
  showEndModal(pct);
}

function tryMoveInTree(from, to) {
  if (!S.waitingForPlayer) return;
  const g  = S.lineGame;
  if (!g || g.game_over()) return;
  const nf   = _normFen(g.fen());
  const node = S.drill.tree?.[nf];
  if (!node) return;
  const legal = g.moves({ square: from, verbose: true }).find(m => m.to === to);
  if (!legal) { drawBoard(); return; }
  const isValid = node.player.find(m => m.san === legal.san);
  if (isValid) {
    const posIdx = S.ok + S.ko;
    g.move(legal.san);
    S.last = { from, to }; S.sel = null; S.ok++;
    updateScores(); setFeedback('ok', `✓ ${legal.san}`, S.drill.hideComments ? '' : (isValid.comment||'')); drawBoard();
    addLog(legal.san, true, S.ok + S.ko);
    recordResult(true, {san: legal.san, comment: isValid.comment||'', posIdx, masteryKey: nf + '_' + node.player[0].san});
    S.waitingForPlayer = false;
    setTimeout(advanceTree, 600);
  } else {
    const posIdx = S.ok + S.ko;
    S.waitingForPlayer = false;
    S.ko++; S.sel = null; updateScores();
    const expected = node.player.map(m => m.san).join(' / ');
    const corrComment = node.player[0].comment||'';
    const matHint = _materialHint(g.fen(), legal.san);
    setFeedback('ko', `✗ ${legal.san} — attendu : ${expected}${matHint ? ' · ' + matHint : ''}`, S.drill.hideComments ? '' : corrComment); drawBoard();
    addLog(legal.san + ' ✗', false, S.ok + S.ko);
    recordResult(false, {san: node.player[0].san, comment: corrComment, posIdx, masteryKey: nf + '_' + node.player[0].san});
    if (!S._treeErrors) S._treeErrors = [];
    S._treeErrors.push({ fen: g.fen(), san: node.player[0].san, comment: corrComment });
    setTimeout(() => {
      const corr = node.player[0];
      const r    = g.move(corr.san);
      if (r) { S.last = { from: r.from, to: r.to }; drawBoard(); }
      setTimeout(advanceTree, 800);
    }, 1600);
  }
}

// ══════════════════════════════════════════════════════
// PHASE APPRENTISSAGE (arbre) — explorer TOUT le PGN avant la révision
// ══════════════════════════════════════════════════════
function startStudyPhase() {
  const d = S.drill;
  const startFen = d.sessions?.[0]?.startFen || new Chess().fen();
  let root = null;
  if (d.pgn) { try { root = pgnToEditorTree(d.pgn, startFen); } catch(e) { root = null; } }
  if (!root || !root.children.length) { startTreeDrill(); return; }   // pas d'arbre exploitable → révision directe
  S.phase = 'study';
  S.studyStartFen = startFen;
  S.studyTree = root;
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
  if (gb) { gb.classList.remove('active'); gb.textContent = '🎯 Devine le coup'; }
  if (on) {
    if (nota)  { nota.style.maxHeight = 'min(50vh, 440px)'; nota.style.fontSize = '13.5px'; nota.style.lineHeight = '1.85'; }
    if (cm)    { cm.style.display = 'none'; }   // commentaires déjà affichés en ligne dans le PGN → boîte inutile
    if (card)  { card.style.marginTop = '0'; card.style.paddingTop = '14px'; }   // remonte le bloc (pas d'espace perdu au-dessus)
    if (title) title.textContent = '📖 ' + (S.drill?.name || 'Apprentissage');
  } else {
    if (nota)  { nota.style.maxHeight = '160px'; nota.style.fontSize = ''; nota.style.lineHeight = ''; }
    if (cm)    { cm.style.display = ''; cm.style.height = '58px'; cm.style.minHeight = ''; cm.style.maxHeight = ''; cm.style.fontSize = ''; }
    if (card)  { card.style.marginTop = ''; card.style.paddingTop = ''; }
    const bubble = document.getElementById('study-bubble'); if (bubble) { bubble.style.display = 'none'; bubble.innerHTML = ''; }
    if (title) title.textContent = '📖 Apprentissage';
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

// Bulle façon Duolingo : commentaire du coup courant (rien à afficher → masquée)
function renderStudyBubble() {
  const el = document.getElementById('study-bubble'); if (!el) return;
  const c = S.studyNode && S.studyNode.comment ? S.studyNode.comment : '';
  if (!c) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.innerHTML = `<span class="bubble-avatar">💡</span>${escapeHtml(c)}`;
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
  if (btn) { btn.classList.toggle('active', S.studyGuess); btn.textContent = S.studyGuess ? '🎯 Devine : activé' : '🎯 Devine le coup'; }
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

// Vue resserrée en mode devine : coups joués + « ? » pour le coup à trouver.
function renderStudyGuessLine() {
  const el = document.getElementById('learn-notation'); if (!el) return;
  let node = S.studyTree, h = '', first = true;
  for (const idx of (S.studyPath || [])) {
    node = node.children[idx]; if (!node) break;
    const white = node.fenBefore.split(' ')[1] === 'w';
    const lead = first ? '' : 'margin-left:6px;';
    if (white) h += `<span style="color:var(--dim);font-size:.72rem;${lead}">${node.fenBefore.split(' ')[5]}.</span><span style="color:var(--text);font-weight:600;padding:1px 3px">${fig(node.san)}</span>`;
    else h += `<span style="${lead}color:var(--text);font-weight:600;padding:1px 3px">${fig(node.san)}</span>`;
    first = false;
  }
  const nxt = node && node.children && node.children[0];
  if (nxt) {
    const white = nxt.fenBefore.split(' ')[1] === 'w';
    h += `<span style="color:var(--dim);font-size:.72rem;margin-left:6px;">${nxt.fenBefore.split(' ')[5]}${white?'.':'…'}</span>`;
    h += `<span style="margin-left:1px;border:1px dashed var(--cyan);color:var(--cyan);padding:0 7px;border-radius:5px;font-weight:700">?</span>`;
  } else {
    h += `<span style="margin-left:8px;color:#22c55e;font-weight:600">✓ Ligne terminée</span>`;
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
  const testBtn = document.querySelector('#learn-card .btn-gold'); if (testBtn) testBtn.textContent = '🚀 Commencer la révision';
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

  // Palette de profondeur : chaque niveau d'imbrication a SA couleur (rail + flèche + teinte)
  const VAR_COL = ['#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6'];   // Océan : indigo → bleu → ciel → cyan → teal
  const depthCol = d => VAR_COL[(d - 1) % VAR_COL.length];
  // depth 0 = ligne principale (forte) ; depth ≥ 1 = variante, texte estompé par paliers
  const VAR_SHADE = ['var(--text-2)', 'var(--dim)'];
  const moveSpan = (node, path, depth, lead) => {
    const isCur = JSON.stringify(path) === curStr;
    const s = isCur ? 'background:var(--cyan);color:#fff;font-weight:700'
            : depth === 0 ? 'color:var(--text);font-weight:600'
            : `color:${VAR_SHADE[Math.min(depth - 1, VAR_SHADE.length - 1)]};font-weight:500`;
    const fs = depth === 0 ? '' : 'font-size:.93em;';
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
        const col = depthCol(depth + 1);
        h += `<div class="study-var" style="border-left-color:${col};background:${col}1f">`
           + `<span class="study-var-arrow" style="color:${col}">↳</span>`
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

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js.
Object.assign(window, {
  startLineDrill, advanceLine, tryMoveInLine, skipLinePosition,
  updateLinePosInfo, renderNotation, endLineDrill, togglePauseAdversary,
  loadPosition, updatePosInfo, renderPosStrip, tryMoveInPositions, endPositionsDrill,
  startTreeDrill, _pickOppMove, _treeUnseenCount, _computeForcedPath, advanceTree, _treeEnd, tryMoveInTree,
  startStudyPhase, _setStudyLayout, studyGoPath, renderStudyBubble, _studyGuessReady, toggleStudyGuess,
  _studyGuessSync, _studyGuessPrompt, tryStudyGuess, renderStudyGuessLine, studyNext, studyPrev,
  updateStudyProgress, _studyMastery, renderStudyTree,
});
