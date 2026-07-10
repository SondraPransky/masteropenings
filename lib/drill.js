// ══════════════════════════════════════════════════════
// DRILL — MODE LIGNE (UI) : jeu d'une ligne complète coup par coup,
// auto-play adverse, notation, fin de session/module.
// Extrait d'app.js (étape 5.2c du découpage drill engine, cf. CLAUDE.md §5.2).
// Cœur pur : lib/drill-core.js. État session partagé : lib/session.js (`S`).
// Fonctions app-level (board, feedback, score, enregistrement) résolues au
// runtime via le pont window, comme lib/editor.js.
// `Chess` = global CDN.
// ══════════════════════════════════════════════════════
import { S } from './session.js';
import { isPlayerMove, _materialHint } from './tree.js';
import { _commentDelay } from './drill-core.js';

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

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js.
Object.assign(window, {
  startLineDrill, advanceLine, tryMoveInLine, skipLinePosition,
  updateLinePosInfo, renderNotation, endLineDrill, togglePauseAdversary,
  loadPosition, updatePosInfo, renderPosStrip, tryMoveInPositions, endPositionsDrill,
});
