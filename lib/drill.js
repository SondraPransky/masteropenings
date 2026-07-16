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

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const currentSession        = (...a) => window.currentSession?.(...a);
const totalSessions         = (...a) => window.totalSessions?.(...a);
const drawBoard             = (...a) => window.drawBoard?.(...a);
const drawCoords            = (...a) => window.drawCoords?.(...a);
const setFeedback           = (...a) => window.setFeedback?.(...a);
const clearFeedback         = (...a) => window.clearFeedback?.(...a);
const setBoardComment       = (...a) => window.setBoardComment?.(...a);
const setBoardPrompt        = (...a) => window.setBoardPrompt?.(...a);
const addLog                = (...a) => window.addLog?.(...a);
const updateScores          = (...a) => window.updateScores?.(...a);
const recordResult          = (...a) => window.recordResult?.(...a);
const recordPracticeSession = (...a) => window.recordPracticeSession?.(...a);
const updateReviserToutBadge= (...a) => window.updateReviserToutBadge?.(...a);
const updateSessionInfo     = (...a) => window.updateSessionInfo?.(...a);
const resizeBoard           = (...a) => window.resizeBoard?.(...a);
const clearLog              = (...a) => window.clearLog?.(...a);
const closeModal            = (...a) => window.closeModal?.(...a);
const isLineMode            = (...a) => window.isLineMode?.(...a);
const startDrill            = (...a) => window.startDrill?.(...a);
const nextDrill             = (...a) => window.nextDrill?.(...a);
const _setStudyLayout       = (...a) => window._setStudyLayout?.(...a);   // → lib/study.js (phase apprentissage)
// SR (répétition espacée, reste dans app.js → futur lib/sr.js)
const _srToggleBar          = (...a) => window._srToggleBar?.(...a);
const _srUpdateBar          = (...a) => window._srUpdateBar?.(...a);
const _srAnswer             = (...a) => window._srAnswer?.(...a);
const _srBilan              = (...a) => window._srBilan?.(...a);
const fig        = (x) => window.fig ? window.fig(x) : x;
const figText    = (x) => window.figurineText ? window.figurineText(x) : x;   // coups inline d'un commentaire → figurines
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

// Coup adverse en attente quand l'auto-play est en pause (local au module).
let _pendingAdversaryMv = null;

// Persistance debouncée de G.oppSeen : évite un JSON.stringify + localStorage.setItem
// SYNCHRONE à chaque coup adverse (hot path). Flush garanti avant fermeture d'onglet.
let _oppSeenSaveTimer = null;
function _flushOppSeen() {
  _oppSeenSaveTimer = null;
  try { localStorage.setItem('mc_opp_seen', JSON.stringify(G.oppSeen)); } catch (e) {}
}
function _saveOppSeenSoon() {
  clearTimeout(_oppSeenSaveTimer);
  _oppSeenSaveTimer = setTimeout(_flushOppSeen, 600);
}
window.addEventListener('pagehide', () => { if (_oppSeenSaveTimer) _flushOppSeen(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && _oppSeenSaveTimer) _flushOppSeen(); });

function startLineDrill() {
  const d    = S.drill;
  const sess = currentSession();
  const startFen = sess.startFen || new Chess().fen();
  S.hintSquare   = null;
  S.pauseAdversary = S.pauseAdversary || false;
  _pendingAdversaryMv = null;
  S.lineGame = new Chess(startFen);
  S.preview = null;
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
  S.preview = null;   // toute progression sort d'un éventuel aperçu
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

// Feuille de coups (mode ligne/test) — composant unifié : flux soigné, coup courant
// surligné, coups futurs cachés (`?`/`·`), et CLIC-NAVIGATION sur les coups déjà
// révélés (aperçu lecture-seule via S.preview, sans toucher S.lineGame).
function renderNotation() {
  const el = document.getElementById('notation-moves');
  if (!el) return;
  const prev = S.preview;   // aperçu actif ?
  let html = '';

  // Bandeau d'aperçu : revenir au coup courant.
  if (prev) html += `<span class="mv-preview-bar" onclick="linePreviewExit()"><i class="ti ti-player-play" aria-hidden="true"></i> Aperçu · revenir au coup courant</span>`;

  S.lineAllMoves.forEach((mv, i) => {
    const turn = mv.fenBefore.split(' ')[1];
    const num  = mv.fenBefore.split(' ')[5];
    if (turn === 'w')      html += `<span class="mv-num">${num}.</span>`;
    else if (i === 0)      html += `<span class="mv-num">${num}…</span>`;

    // Un coup est « révélé » (donc cliquable) s'il a déjà été joué/dévoilé.
    const revealed = i < S.lineMoveIdx || !!mv.result;
    const isAsk    = (i === S.lineMoveIdx && S.waitingForPlayer && mv.isPlayer);

    let cls = 'mv', body, id = '', title = '';
    if (isAsk) { cls += ' ask'; body = '?'; id = ' id="notation-active"'; }
    else if (i > S.lineMoveIdx && !mv.result) { cls += ' future'; body = mv.isPlayer ? '?' : '·'; }
    else {
      body = fig(mv.san);
      if (mv.result === 'ok')      cls += ' ok';
      else if (mv.result === 'ko') cls += ' ko';
      else if (mv.result === 'auto' || !mv.isPlayer) cls += ' auto';
      else cls += ' played';
      if (mv.comment) title = ` title="${escapeHtml(mv.comment)}"`;
    }
    // Surbrillance de la position prévisualisée.
    if (prev && prev.ply === i) cls += ' cur';
    // Cliquable : coup révélé (hors coup courant à trouver).
    const clickable = revealed && !isAsk;
    if (clickable) cls += ' clickable';
    const onclick = clickable ? ` onclick="linePreviewGoto(${i})"` : '';
    html += `<span class="${cls}"${id}${title}${onclick}>${body}</span>`;
  });

  el.innerHTML = html;
  requestAnimationFrame(() => {
    const a = document.getElementById('notation-active');
    if (a) a.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });
}

// ── Aperçu lecture-seule d'une position passée (clic-navigation) ──
// N'altère jamais S.lineGame/S.lineMoveIdx : pose S.preview, honoré par currentGame().
function linePreviewGoto(ply) {
  const mv = S.lineAllMoves[ply]; if (!mv) return;
  const g = new Chess(mv.fenBefore);
  try { g.move(mv.san); } catch (e) {}
  S.preview = { ply, game: g };
  S.sel = null;
  drawBoard();
  renderNotation();
}
function linePreviewExit() {
  if (!S.preview) return;
  S.preview = null;
  S.sel = null;
  drawBoard();
  renderNotation();
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
      <button class="btn btn-primary" style="margin-top:10px;width:100%;font-size:.84rem"
        onclick="nextSession()"><i class="ti ti-player-track-next" aria-hidden="true"></i> Session suivante : ${escapeHtml(nextSess.label)} →</button>`;
    setBoardComment(''); setBoardPrompt('ok', `✓ ${pct}% — Session ${S.sessionIdx+1}/${total}`);
  } else {
    recordPracticeSession(pct);
    showEndModal(pct);
  }
}

function togglePauseAdversary() {
  S.pauseAdversary = !S.pauseAdversary;
  const btn = document.getElementById('btn-pause-adv');
  if (btn) btn.innerHTML = S.pauseAdversary ? '<i class="ti ti-player-play" aria-hidden="true"></i> Adv.' : '<i class="ti ti-player-pause" aria-hidden="true"></i> Auto';
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
  S.sel       = null;
  S.hintSquare = null;
  S.srFlash   = false;
  S.preview   = null;
  S.exPly     = 0;        // exercice multi-coups : on repart au 1er demi-coup
  S.exWaiting = false;
  S.game   = new Chess(S.kps[posIdx].fen);
  // Exercices : chaque position s'oriente du côté au trait (paquet mêlant mats
  // Blancs et Noirs → l'élève voit toujours sa position dans le bon sens).
  if (S.drill?.isExercise) { S.flipped = (S.game.turn() === 'b'); drawCoords(); }
  clearFeedback();
  renderPosStrip();
  updatePosInfo();
  drawBoard();
  _srToggleBar(!!(S.sr && S.sr.active));
  if (S.sr && S.sr.active) _srUpdateBar();
  // Nouvelle position (jamais vue) en session SR : phase d'apprentissage « flash »
  // (montrer le bon coup + commentaire), PUIS test — façon Chessable. Marquée
  // _taught pour ne pas re-flasher aux occurrences suivantes de la session.
  const kp = S.kps[posIdx];
  if (S.sr && S.sr.active && kp._srNew && !kp._taught) _srShowFlash(kp);
}

// Affiche le bon coup + commentaire avant de laisser l'élève le rejouer.
function _srShowFlash(kp) {
  S.srFlash = true;
  let toSq = null;
  try { const tmp = new Chess(kp.fen); const mv = tmp.move(kp.san); if (mv) toSq = mv.to; } catch (e) {}
  S.hintSquare = toSq;
  drawBoard();
  const el = document.getElementById('feedback');
  if (!el) return;
  el.className = 'feedback hint';
  // Multi-coups : on montre toute la solution (coups de l'élève) ; sinon le seul bon coup.
  const solLabel = (kp.line && kp.line.length > 1)
    ? 'la solution : <b>' + kp.line.filter((_, i) => i % 2 === 0).map(fig).join(' … ') + '</b>'
    : 'le bon coup : <b>' + fig(kp.san) + '</b>';
  el.innerHTML =
    `<div><span style="color:var(--cyan);font-weight:700">✨ Nouveau</span> · ${solLabel}</div>`
    + (kp.comment && !S.drill?.hideComments ? `<div style="margin-top:6px;color:var(--text-2);font-size:.85rem">${figText(escapeHtml(kp.comment))}</div>` : '')
    + `<button class="btn btn-primary" style="margin-top:10px;width:100%;font-size:.84rem" onclick="srFlashDone()">À toi de le jouer →</button>`;
}
// Fin du flash : l'élève enchaîne sur le test de la même position.
function srFlashDone() {
  const kp = S.kps[S.posIdx]; if (kp) kp._taught = true;
  S.srFlash = false;
  S.hintSquare = null;
  clearFeedback();
  drawBoard();
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

// Normalise un SAN pour comparaison (retire échec/mat/annotations).
const _normSan = s => String(s).replace(/[+#!?]/g,'');

function tryMoveInPositions(from, to) {
  const legal = S.game.moves({square:from,verbose:true}).find(m=>m.to===to);
  if (!legal) { drawBoard(); return; }
  const tmp = new Chess(S.game.fen());
  const played = tmp.move({from,to,promotion:'q'});
  if (!played) { drawBoard(); return; }

  const kp = S.kps[S.posIdx];
  // Exercice multi-coups (mat en N / combinaison forcée) : on joue la séquence.
  if (kp.line && kp.line.length > 1) { _exSeqMove(played, kp); return; }

  const norm = _normSan;
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

// ── Exercices multi-coups (mat en N / combinaison forcée) ──────────────
// kp.line = séquence SAN complète, l'élève commence (plies pairs = élève,
// impairs = réplique adverse auto-jouée). L'élève doit trouver chacun de ses
// coups ; la position n'est validée (SR/mastery) qu'à la séquence complète.
function _exSeqMove(played, kp) {
  const ply = S.exPly || 0;
  const expected = kp.line[ply];
  // Alternatives acceptées seulement pour le 1er coup (v1 : ligne forcée unique).
  const accept = ply === 0 ? [expected, ...(kp.altSans||[])].map(_normSan) : [_normSan(expected)];
  if (!accept.includes(_normSan(played.san))) { _exSeqFinalize(kp, false, played); return; }

  // Bon coup de l'élève → on l'applique sur le plateau.
  S.game.move({ from: played.from, to: played.to, promotion: 'q' });
  S.exPly = ply + 1;
  S.sel = null;
  renderPosStrip(); drawBoard();
  if (S.exPly >= kp.line.length) { _exSeqFinalize(kp, true, played); return; }   // séquence terminée

  // Réplique adverse forcée, auto-jouée ; plateau verrouillé pendant l'animation.
  S.exWaiting = true;
  setFeedback('ok', '✓ ' + fig(played.san) + ' — l\'adversaire répond…', '');
  const oppSan = kp.line[S.exPly];
  setTimeout(() => {
    if (!S.game || S.exPly == null) return;
    const m = S.game.move(oppSan, { sloppy: true });
    if (m) S.last = { from: m.from, to: m.to };
    S.exPly = (S.exPly || 0) + 1;
    S.exWaiting = false;
    drawBoard();
    // Défensif : ligne se terminant sur un coup adverse (longueur paire) → clôture ici.
    if (S.exPly >= kp.line.length) { _exSeqFinalize(kp, true, m); return; }
    setFeedback('hint', '➡ À toi de jouer', '');
  }, 550);
}

function _exSeqFinalize(kp, isCorrect, played) {
  kp.attempted = true; kp.correct = isCorrect;
  const studentLine = kp.line.filter((_, i) => i % 2 === 0).map(fig).join(' … ');   // récap des coups de l'élève
  const mate = /#/.test(kp.line[kp.line.length - 1]);
  if (S.sr && S.sr.active) {
    _srAnswer(kp, null, isCorrect);   // played=null → ne rejoue pas S.game ; gère grade + requeue + avance
    if (isCorrect) setFeedback('ok', '✓ Résolu ! ' + studentLine, S.drill?.hideComments ? '' : kp.comment);
    return;
  }
  if (isCorrect) {
    S.ok++;
    setFeedback('ok', '✓ Résolu ! ' + studentLine + (mate ? ' — mat !' : ''), S.drill.hideComments ? '' : kp.comment);
    addLog(kp.san, true, S.posIdx + 1);
  } else {
    S.ko++;
    setFeedback('ko', '✗ Pas la bonne suite. Solution : ' + studentLine, S.drill.hideComments ? '' : kp.comment);
    addLog((played ? played.san : '?') + ' ✗', false, S.posIdx + 1);
  }
  updateScores(); renderPosStrip(); drawBoard();
  recordResult(isCorrect, { san: kp.san, comment: kp.comment, posIdx: S.posIdx });
  // Multi-coups : on avance dans les deux cas (le plateau a bougé → pas de re-essai sur place).
  setTimeout(() => loadPosition(S.posIdx + 1), isCorrect ? 1200 : 1900);
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
  _saveOppSeenSoon();
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

function enterTestPhase() {
  if (S.phase === 'study') return startTreeDrill();
  S.phase      = 'test';
  S.ok         = 0;
  S.ko         = 0;
  S.hintSquare = null;
  updateScores();
  clearLog();
  document.getElementById('learn-card').style.display = 'none';
  document.getElementById('notation-card').style.display = 'block';
  document.getElementById('test-btns').style.display = '';
  document.getElementById('score-card').style.display = '';
  document.getElementById('history-card').style.display = '';
  clearFeedback();
  const pauseBtn = document.getElementById('btn-pause-adv');
  if (pauseBtn) { pauseBtn.style.display = ''; pauseBtn.innerHTML = S.pauseAdversary ? '<i class="ti ti-player-play" aria-hidden="true"></i> Adv.' : '<i class="ti ti-player-pause" aria-hidden="true"></i> Auto'; }
  resizeBoard();
  startLineDrill();
}

// ══════════════════════════════════════════════════════
// FIN DE DRILL (commun)
// ══════════════════════════════════════════════════════
// Moment de complétion « sans faute » d'un paquet d'exercices (tactiques/mats) :
// coche dessinée sobre + mot d'encouragement varié. Rare par choix (0 erreur),
// pour que le moment reste spécial — pas de confetti, cohérent avec la marque.
const _EX_DONE_LINES = [
  'Sans faute — ces motifs sont à toi.',
  'Zéro erreur, bien vu sur toute la ligne.',
  'Parcours net. Les tactiques rentrent.',
];
const _EX_DONE_CHECK =
  `<svg class="ex-done-check" viewBox="0 0 52 52" width="60" height="60" aria-hidden="true" focusable="false">
     <circle cx="26" cy="26" r="24" fill="none" stroke="var(--cyan-glow)" stroke-width="2"/>
     <path d="M15 27 l7.5 7.5 L37.5 17" fill="none" stroke="var(--cyan)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
   </svg>`;

function showEndModal(pct) {
  const flawlessEx = !!S.drill?.isExercise && S.ko === 0 && S.ok > 0;   // paquet d'exercices résolu sans erreur
  const _et = document.getElementById('end-title'); if (_et) _et.textContent = flawlessEx ? 'Sans faute !' : '🏁 Module terminé !';
  const msg = flawlessEx ? _EX_DONE_LINES[Math.floor(Math.random() * _EX_DONE_LINES.length)]
            : pct>=85?'🌟 Excellent ! Maîtrise parfaite.':pct>=60?'👍 Bon travail, continuez !':'💪 Persistez, vous progressez !';
  const showContinue = (isLineMode() || S.drill?.varmode === 'tree') && S.lineGame && !S.lineGame.game_over();

  let errRecap = '';
  if (isLineMode() && S.ko > 0 && S.lineAllMoves?.length) {
    const failed = S.lineAllMoves.filter(m => m.isPlayer && m.result === 'ko');
    if (failed.length) {
      errRecap = `<div style="margin:12px 0 0;padding:10px 12px;background:var(--red-dim);border:1px solid rgba(225,29,72,.15);border-radius:var(--rs);text-align:left">
        <div style="font-size:.7rem;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Coups à retravailler</div>
        ${failed.map(m=>`<div style="display:flex;align-items:baseline;gap:8px;font-size:.82rem;padding:2px 0">
          <span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--text)">${fig(m.san)}</span>
          ${m.comment?`<span style="color:var(--text-2);font-size:.75rem;line-height:1.35">${escapeHtml(m.comment.slice(0,70))}${m.comment.length>70?'…':''}</span>`:''}
        </div>`).join('')}
      </div>`;
    }
  }

  document.getElementById('end-body').innerHTML=`
    ${flawlessEx ? `<div style="text-align:center;margin:-4px 0 10px">${_EX_DONE_CHECK}</div>` : ''}
    <div class="scores-row" style="margin-bottom:14px">
      <div class="score-box"><div class="score-val" style="color:var(--green)">${S.ok}</div><div class="score-lbl">Corrects</div></div>
      <div class="score-box"><div class="score-val" style="color:var(--red)">${S.ko}</div><div class="score-lbl">Erreurs</div></div>
      <div class="score-box"><div class="score-val" style="color:var(--cyan)">${pct}%</div><div class="score-lbl">Réussite</div></div>
    </div>
    <p style="font-size:.84rem;color:var(--dim)">${msg}</p>
    ${errRecap}
    ${showContinue?`<button class="btn btn-blue" onclick="startPostTheory()" style="margin-top:10px;width:100%;font-weight:600"><i class="ti ti-player-play" aria-hidden="true"></i> Continuer la partie</button>`:''}`;
  // ── Boutons du modal : intentions calculées UNE fois, appliquées UNE fois ──
  // Hiérarchie : un SEUL primaire (plein indigo). S'il y a des erreurs, c'est LES
  // RÉVISER — « Continuer la partie » reste tonal, « Module suivant » est démoté.
  const errBtn    = document.getElementById('btn-replay-errors');
  const nextBtn   = document.getElementById('btn-next-drill');
  const replayBtn = document.getElementById('btn-replay');
  const isTree        = S.drill?.varmode === 'tree';
  const hasTreeErrors = isTree && S._treeErrors?.length > 0;
  const hasLineErrors = isLineMode() && S.ko > 0;
  const hasErrors     = hasLineErrors || hasTreeErrors;
  const restart = () => { closeModal('modal-end'); startDrill(S.idx); };
  const next    = () => { closeModal('modal-end'); nextDrill(); };

  if (errBtn) {
    errBtn.style.display = hasErrors ? '' : 'none';
    if (hasErrors) {
      errBtn.innerHTML = hasTreeErrors
        ? `<i class="ti ti-refresh" aria-hidden="true"></i> Réviser les erreurs (${S._treeErrors.length})`
        : `<i class="ti ti-arrow-back-up" aria-hidden="true"></i> Réviser les erreurs (${S.ko})`;
      errBtn.className   = 'btn btn-primary';
      errBtn.style.color = '';
    }
  }
  if (replayBtn) {
    replayBtn.innerHTML = isTree ? '<i class="ti ti-player-play" aria-hidden="true"></i> Poursuivre la révision'
                                 : '<i class="ti ti-rotate" aria-hidden="true"></i> Rejouer';
    replayBtn.className = isTree ? 'btn btn-blue' : 'btn btn-ghost';
    replayBtn.onclick   = restart;
  }
  if (nextBtn) {
    const unseen = isTree ? _treeUnseenCount() : 0;
    let label = 'Module suivant →', primary = true, onclick = next;
    if (unseen > 0) { label = `${unseen} variante${unseen > 1 ? 's' : ''} restante${unseen > 1 ? 's' : ''}`; primary = false; onclick = restart; }
    else if (G.drills.length <= 1) {
      label   = isTree ? '<i class="ti ti-check" aria-hidden="true"></i> Tout revu' : '<i class="ti ti-rotate" aria-hidden="true"></i> Rejouer';
      primary = !isTree;
      onclick = isTree ? null : restart;
    }
    if (hasErrors) primary = false;   // démoté : le primaire est « Réviser les erreurs »
    nextBtn.innerHTML   = label;
    nextBtn.className   = primary ? 'btn btn-primary' : 'btn btn-ghost';
    nextBtn.style.color = primary ? '' : 'var(--dim)';
    nextBtn.onclick     = onclick;
  }
  document.getElementById('modal-end').classList.add('on');
}

function replayErrors() {
  if (S.drill?.varmode === 'tree') {
    const errors = S._treeErrors || [];
    if (!errors.length) return;
    S.kps = errors.map(e => ({ fen: e.fen, san: e.san, comment: e.comment, attempted: false, correct: false }));
    S.ok = 0; S.ko = 0; S.posIdx = 0; S.sel = null;
    S.unifiedReview = true;
    closeModal('modal-end');
    document.getElementById('learn-card').style.display    = 'none';
    document.getElementById('notation-card').style.display = 'none';
    document.getElementById('pos-card').style.display      = 'block';
    document.getElementById('test-btns').style.display     = '';
    document.getElementById('score-card').style.display    = '';
    document.getElementById('history-card').style.display  = '';
    S.phase = 'test';
    updateScores(); clearLog(); clearFeedback();
    renderPosStrip();
    loadPosition(0);
    const n = S.kps.length;
    setFeedback('hint', `🔄 ${n} erreur${n>1?'s':''} à corriger — jouez le bon coup`, '');
    return;
  }
  const failed = (S.lineAllMoves||[]).filter(m => m.isPlayer && m.result === 'ko');
  if (!failed.length) return;
  S.errorOnlySet = new Set(failed.map(m => m.idx));
  closeModal('modal-end');
  enterTestPhase();
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js.
Object.assign(window, {
  startLineDrill, advanceLine, tryMoveInLine, skipLinePosition,
  updateLinePosInfo, renderNotation, linePreviewGoto, linePreviewExit, endLineDrill, togglePauseAdversary,
  loadPosition, updatePosInfo, renderPosStrip, tryMoveInPositions, endPositionsDrill, srFlashDone,
  startTreeDrill, _pickOppMove, _treeUnseenCount, _computeForcedPath, advanceTree, _treeEnd, tryMoveInTree,
  enterTestPhase, showEndModal, replayErrors,
});
