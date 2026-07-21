// ══════════════════════════════════════════════════════
// RÉPÉTITION ESPACÉE (SR) — moteur « comme Chess Tempo »
//   • Nouveaux (jamais vus) vs Révisions (dues) + quota de nouveaux/jour
//   • Coup raté → révélé puis remis plus loin dans la session (étape)
//   • Bilan de fin (révisé, rétention, nouveaux appris, prévision)
//   • Tableau de bord élève + réglages + suspension de positions
// Extrait d'app.js (cf. CLAUDE.md §5.2). État session partagé : lib/session.js
// (`S`). Réutilise le mode positions (window.loadPosition/tryMoveInPositions de
// lib/drill.js). Fonctions app-level résolues au runtime via le pont window.
// `Chess` = global CDN.
// ══════════════════════════════════════════════════════
import { S } from './session.js';
import { G } from '../state.js';
import { _treePlayerPositions, _materialHint } from './tree.js';
import { _drillSessions } from './drill-core.js';
import { DEFAULT_LADDER_HOURS } from './core.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const toast         = (...a) => window.toast?.(...a);
const clearFeedback = (...a) => window.clearFeedback?.(...a);
const clearLog      = (...a) => window.clearLog?.(...a);
const updateScores  = (...a) => window.updateScores?.(...a);
const drawCoords    = (...a) => window.drawCoords?.(...a);
const resizeBoard   = (...a) => window.resizeBoard?.(...a);
const drawBoard     = (...a) => window.drawBoard?.(...a);
const setFeedback   = (...a) => window.setFeedback?.(...a);
const addLog        = (...a) => window.addLog?.(...a);
const goPage        = (...a) => window.goPage?.(...a);
const closeModal    = (...a) => window.closeModal?.(...a);
const recordResult  = (...a) => window.recordResult?.(...a);
const fig           = (x) => window.fig ? window.fig(x) : x;

function updateReviserToutBadge() {
  const btn = document.getElementById('reviser-tout-btn');
  const cnt = document.getElementById('reviser-tout-count');
  if (!btn) return;
  if (!S.student) { btn.style.display='none'; return; }
  const total = _srSessionSize('all');
  if (total > 0) {
    btn.style.display = 'inline-flex';
    cnt.textContent   = total;
  } else {
    btn.style.display = 'none';
  }
}

// Points d'entrée (hero + bannières modules) → session de répétition espacée.
function reviserTout() { srStart('all'); }
function reviserDrill(i) { srStart('drill', i); }

function _srNewLimit() { const v = parseInt(localStorage.getItem('mc_sr_newlimit'), 10); return Number.isFinite(v) && v >= 0 ? v : 12; }
function _srTodayKey(student) { return 'mc_srnew_' + student + '_' + new Date().toISOString().slice(0, 10); }
function _srNewToday(student) { return parseInt(localStorage.getItem(_srTodayKey(student)) || '0', 10) || 0; }
function _srBumpNewToday(student) { try { localStorage.setItem(_srTodayKey(student), String(_srNewToday(student) + 1)); } catch (e) {} }

// Toutes les positions « joueur » d'un module, avec clé de maîtrise (FEN pour les arbres).
function _srPositions(d) {
  if (!d) return [];
  if (d.varmode === 'tree') return _treePlayerPositions(d);
  const out = [];
  _drillSessions(d).forEach(sess => (sess.kps || []).forEach((kp, posIdx) => {
    out.push({ fen: kp.fen, masteryKey: posIdx + '_' + (kp.san || ''), san: kp.san, altSans: kp.altSans || [], comment: kp.comment || '', isCapture: kp.isCapture, isCastle: kp.isCastle, isCheck: kp.isCheck });
  }));
  return out;
}

function _srScopeList(scope, drillIdx) {
  return scope === 'drill' ? (G.drills[drillIdx] ? [{ d: G.drills[drillIdx], i: drillIdx }] : [])
                           : G.drills.map((d, i) => ({ d, i }));
}

// File d'une session : révisions dues + quota de nouvelles, mélangées.
function _srBuildQueue(scopeList, student) {
  const now = Date.now();
  const reviews = [], news = [];
  const suspended = _srSuspendedMap();                      // parse UNE fois (au lieu d'un JSON.parse par position)
  scopeList.forEach(({ d, i }) => {
    const did = String(d.id);
    _srPositions(d).forEach(p => {
      const fullKey = `${student}_${did}_${p.masteryKey}`;
      if (suspended[fullKey]) return;                       // position suspendue → ignorée
      const rec = G.masteryData[fullKey];
      const card = { ...p, _drill: d, _drillIdx: i, _due: rec ? rec.due : 0, attempted: false, correct: false };
      if (!rec) news.push(card);
      else if (rec.due <= now) reviews.push(card);
    });
  });
  const shuffle = a => { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
  // Plafond de dus/session (réglage coach global ; 0 = illimité). On garde les
  // plus en retard d'abord ; le reste revient à la prochaine session.
  const revBacklog = reviews.length;
  const dueLimit = _srDueLimit();
  let revs = reviews;
  if (dueLimit > 0 && reviews.length > dueLimit) {
    revs = [...reviews].sort((a, b) => (a._due || 0) - (b._due || 0)).slice(0, dueLimit);
  }
  shuffle(revs); shuffle(news);
  const cap = Math.max(0, _srNewLimit() - _srNewToday(student));
  const picked = news.slice(0, cap).map(c => ({ ...c, _srNew: true }));
  const combined = revs.concat(picked);
  const queue = (localStorage.getItem('mc_sr_order') || 'mixed') === 'due' ? combined : shuffle(combined);
  return { queue, revTotal: revs.length, newTotal: picked.length, revBacklog };
}

// Plafond de dus par session (réglage coach global). 0/invalide = illimité.
function _srDueLimit() { const v = parseInt(localStorage.getItem('mc_sr_duelimit'), 10); return Number.isFinite(v) && v > 0 ? v : 0; }

// Nombre de cartes qu'une session contiendrait maintenant (compteurs hero/badge).
function _srSessionSize(scope, drillIdx) {
  const student = S.student || (G.currentUser ? (G.currentUser.displayName || G.currentUser.email) : '');
  if (!student) return 0;
  return _srBuildQueue(_srScopeList(scope, drillIdx), student).queue.length;
}

// Lance une session de répétition espacée. scope = 'all' | 'drill'.
function srStart(scope, drillIdx) {
  if (!S.student) { toast('⚠ Identifiez-vous d\'abord', 'ko'); return; }
  const student = S.student;
  const { queue, revTotal, newTotal, revBacklog } = _srBuildQueue(_srScopeList(scope, drillIdx), student);
  if (!queue.length) { toast('✓ Rien à réviser pour le moment !', 'ok'); return; }
  S.sr = { active: true, scope, drillIdx, student, scopeList: _srScopeList(scope, drillIdx),
           graded: new Set(), passed: new Set(),
           newTotal, revTotal, newRemaining: newTotal, revRemaining: revTotal, total: queue.length,
           revBacklog, backlogShown: revBacklog > revTotal,
           stats: { reviewed: 0, correct: 0, again: 0, newLearned: 0 } };
  S.drill = queue[0]._drill; S.idx = queue[0]._drillIdx;
  S.ok = 0; S.ko = 0; S.sel = null; S.sessionIdx = 0; S.chapterTree = null; S.postTheory = false;
  S.phase = 'test'; S._reviewMode = true; S.unifiedReview = (scope !== 'drill');
  S.kps = queue;
  document.getElementById('s-name').textContent  = scope === 'drill' ? (S.drill.name + ' — Révision') : '↻ Révision espacée';
  document.getElementById('s-level').textContent = (revTotal + newTotal) + ' carte' + ((revTotal + newTotal) > 1 ? 's' : '');
  document.getElementById('s-side').textContent  = '';
  document.getElementById('s-mode-badge').textContent = '↻ SR';
  document.getElementById('learn-card').style.display    = 'none';
  document.getElementById('notation-card').style.display = 'none';
  document.getElementById('pos-card').style.display      = 'block';
  document.getElementById('test-btns').style.display     = '';
  document.getElementById('score-card').style.display    = '';
  document.getElementById('history-card').style.display  = '';
  // ⚠️ RÉVÉLER LA PAGE AVANT de dessiner (patron de startStudentDrill/playVsMaia) :
  // Chessground ne se monte que sur un `#board` VISIBLE (clientWidth non nul). En
  // dessinant d'abord, le montage paresseux échouait et rien ne le relançait —
  // `initDrillPage` sort tôt sur `S._reviewMode` — d'où une page drill SANS plateau
  // au tout premier clic de la session (une fois monté, le bug disparaissait).
  goPage('drill');
  clearFeedback(); clearLog(); updateScores(); drawCoords(); resizeBoard();
  window.loadPosition?.(0);
  toast(`↻ ${revTotal} révision${revTotal > 1 ? 's' : ''} · ${newTotal} nouveau${newTotal > 1 ? 'x' : ''}`, 'ok');
  // Bandeau backlog : plafond atteint (dus > montrés) OU gros retard non plafonné.
  const behind = revBacklog - revTotal;
  if (behind > 0) toast(`⏳ ${revBacklog} révisions en retard : on t'en propose ${revTotal} aujourd'hui, le reste reviendra.`, 'ok');
  else if (revBacklog >= 40) toast(`⏳ ${revBacklog} révisions en retard : prends ton temps, ou fais-en une partie.`, 'ok');
}

function _srToggleBar(on) {
  const head = document.getElementById('pos-card-head'), strip = document.getElementById('pos-strip'), bar = document.getElementById('sr-bar');
  if (head) head.style.display = on ? 'none' : '';
  if (strip) strip.style.display = on ? 'none' : '';
  if (bar) bar.style.display = on ? 'block' : 'none';
  const susp = document.getElementById('sr-suspend-btn'); if (susp) susp.style.display = on ? '' : 'none';
}

function _srUpdateBar() {
  const bar = document.getElementById('sr-bar'); if (!bar || !S.sr) return;
  const passed = S.sr.passed.size, total = S.sr.total, pct = total ? Math.round(passed / total * 100) : 0;
  bar.innerHTML =
    `<div class="sr-bar-top"><span>Révision espacée</span><span>${passed} / ${total}</span></div>`
    + `<div class="sr-prog"><div class="sr-prog-fill" style="width:${pct}%"></div></div>`
    + `<div class="sr-counts">`
    + `<span class="sr-count sr-new"><i class="ti ti-sparkles" aria-hidden="true"></i> Nouveaux · ${S.sr.newRemaining}</span>`
    + `<span class="sr-count sr-rev"><i class="ti ti-history" aria-hidden="true"></i> Révisions · ${S.sr.revRemaining}</span>`
    + `</div>`
    + (S.sr.backlogShown ? `<div class="sr-backlog"><i class="ti ti-clock-exclamation" aria-hidden="true"></i> ${S.sr.revBacklog} en retard — le reste reviendra à la prochaine session</div>` : '');
}

// Réponse pendant une session SR (depuis tryMoveInPositions / skipPosition).
function _srAnswer(kp, played, isCorrect) {
  const key = kp.masteryKey, first = !S.sr.graded.has(key);
  kp.attempted = true; kp.correct = isCorrect;
  if (first) {                                   // la 1re tentative seule pilote la planification
    S.sr.graded.add(key);
    recordResult(isCorrect, kp);                 // clé FEN correcte (corrige le bug de la révision arbre)
    S.sr.stats.reviewed++;
    if (isCorrect) { S.sr.stats.correct++; S.ok++; } else { S.sr.stats.again++; S.ko++; }
    if (kp._srNew) _srBumpNewToday(S.sr.student);
    updateScores();
  }
  if (isCorrect) {
    if (played) S.game.move({ from: played.from, to: played.to, promotion: 'q' });
    if (!S.sr.passed.has(key)) {
      S.sr.passed.add(key);
      if (kp._srNew) { S.sr.newRemaining = Math.max(0, S.sr.newRemaining - 1); S.sr.stats.newLearned++; }
      else S.sr.revRemaining = Math.max(0, S.sr.revRemaining - 1);
    }
    setFeedback('ok', '✓ ' + fig(kp.san), S.drill?.hideComments ? '' : kp.comment);
    addLog(kp.san, true, S.posIdx + 1);
    drawBoard(); _srUpdateBar();
    setTimeout(() => window.loadPosition?.(S.posIdx + 1), 850);
  } else {
    const matHint = played ? _materialHint(S.game.fen(), played.san) : '';
    setFeedback('ko', '✗ Le coup était : ' + fig(kp.san) + (matHint ? ' · ' + matHint : '') + '  ↻ revu plus tard', S.drill?.hideComments ? '' : kp.comment);
    addLog((played ? played.san : '?') + ' ✗', false, S.posIdx + 1);
    const insertAt = Math.min(S.posIdx + 3, S.kps.length);   // étape : remis plus loin dans la session
    S.kps.splice(insertAt, 0, { ...kp, attempted: false, correct: false, _requeued: true });
    drawBoard(); _srUpdateBar();
    setTimeout(() => window.loadPosition?.(S.posIdx + 1), 1400);
  }
}

// Prévision : nb de positions dues par jour (offsets 1..days) pour le périmètre.
function _srForecast(scopeList, student, days) {
  const counts = new Array(days).fill(0);
  const t0 = new Date(); t0.setHours(0, 0, 0, 0); const startToday = t0.getTime();
  scopeList.forEach(({ d }) => {
    const did = String(d.id);
    _srPositions(d).forEach(p => {
      const rec = G.masteryData[`${student}_${did}_${p.masteryKey}`];
      if (!rec) return;
      const off = Math.floor((rec.due - startToday) / 86400000);
      if (off >= 1 && off <= days) counts[off - 1]++;
    });
  });
  return counts;
}

function _srBilan() {
  const sr = S.sr, s = sr.stats;
  const retention = s.reviewed ? Math.round(s.correct / s.reviewed * 100) : 0;
  const fc = _srForecast(sr.scopeList, sr.student, 6), maxFc = Math.max(1, ...fc);
  const labels = ['dem.', '+2j', '+3j', '+4j', '+5j', '+6j'];
  const bars = fc.map((c, i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">`
    + `<span style="font-size:.6rem;color:var(--dim);height:.7rem">${c || ''}</span>`
    + `<div style="width:100%;height:${Math.round(5 + c / maxFc * 38)}px;background:${i === 0 ? 'var(--gold)' : 'var(--cyan)'};border-radius:3px 3px 0 0;opacity:${c ? 1 : .3}"></div>`
    + `<span style="font-size:.6rem;color:var(--dim)">${labels[i]}</span></div>`).join('');
  const scope = sr.scope, drillIdx = sr.drillIdx, scopeList = sr.scopeList, student = sr.student;
  S.sr = null;   // fin de session
  const title = document.getElementById('end-title'); if (title) title.textContent = '✓ Session terminée';
  document.getElementById('end-body').innerHTML =
    `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:6px">`
    + `<div class="score-box"><div class="score-val">${s.reviewed}</div><div class="score-lbl">Révisé</div></div>`
    + `<div class="score-box"><div class="score-val" style="color:var(--green)">${retention}%</div><div class="score-lbl">Rétention</div></div>`
    + `<div class="score-box"><div class="score-val" style="color:var(--cyan)">${s.newLearned}</div><div class="score-lbl">Nouveaux</div></div>`
    + `<div class="score-box"><div class="score-val" style="color:var(--gold)">${s.again}</div><div class="score-lbl">À revoir</div></div>`
    + `</div>`
    + `<div style="font-size:.72rem;color:var(--dim);margin:14px 0 6px;display:flex;align-items:center;gap:5px"><i class="ti ti-calendar" aria-hidden="true"></i> Tes prochaines révisions</div>`
    + `<div style="display:flex;align-items:flex-end;gap:6px;height:60px">${bars}</div>`;
  const errBtn = document.getElementById('btn-replay-errors'); if (errBtn) errBtn.style.display = 'none';
  const more = _srBuildQueue(scopeList, student).queue.length;
  const replayBtn = document.getElementById('btn-replay');
  if (replayBtn) {
    if (more > 0) { replayBtn.style.display = ''; replayBtn.className = 'btn btn-blue'; replayBtn.textContent = `↻ Continuer (${more})`; replayBtn.onclick = () => { closeModal('modal-end'); srStart(scope, drillIdx); }; }
    else replayBtn.style.display = 'none';
  }
  const nextBtn = document.getElementById('btn-next-drill');
  if (nextBtn) { nextBtn.style.display = ''; nextBtn.className = 'btn btn-primary'; nextBtn.style.color = ''; nextBtn.textContent = '✓ Terminer'; nextBtn.onclick = () => { closeModal('modal-end'); goPage('student-home'); }; }
  updateReviserToutBadge();
  document.getElementById('modal-end').classList.add('on');
}

// ── Suspendre une position (P4) : la sortir de la révision (persisté localStorage) ──
function _srSuspendedMap() { try { return JSON.parse(localStorage.getItem('mc_sr_suspended') || '{}'); } catch (e) { return {}; } }
function _srIsSuspended(fullKey) { return !!_srSuspendedMap()[fullKey]; }
function _srSetSuspended(fullKey, on) { const m = _srSuspendedMap(); if (on) m[fullKey] = 1; else delete m[fullKey]; try { localStorage.setItem('mc_sr_suspended', JSON.stringify(m)); } catch (e) {} }
function _srSuspendedCount() { return Object.keys(_srSuspendedMap()).length; }
function srSuspendCurrent() {
  if (!(S.sr && S.sr.active)) return;
  const card = S.kps[S.posIdx]; if (!card) return;
  _srSetSuspended(S.sr.student + '_' + String(card._drill.id) + '_' + card.masteryKey, true);
  const here = S.posIdx;
  S.kps = S.kps.filter((k, i) => i <= here || k.masteryKey !== card.masteryKey);   // retire les occurrences à venir
  if (!S.sr.passed.has(card.masteryKey)) {
    if (card._srNew) S.sr.newRemaining = Math.max(0, S.sr.newRemaining - 1);
    else S.sr.revRemaining = Math.max(0, S.sr.revRemaining - 1);
    S.sr.total = Math.max(S.sr.passed.size, S.sr.total - 1);
  }
  toast('⏸ Position suspendue (réglages pour réactiver)', 'ok');
  window.loadPosition?.(S.posIdx + 1);
}

// ── Échelle Leitner éditable par le coach (paliers, en heures) ──
// Stockée globalement (single-coach) dans localStorage, comme mc_sr_newlimit.
// Lue par le moteur (mastery.sm2Update → window._srGetLadder) et pour l'affichage.
const _SR_LADDER_PRESETS = {
  standard: DEFAULT_LADDER_HOURS,                            // 4h·1j·3j·1sem·2sem·1mois·3mois·6mois
  agressif: [1, 8, 24, 72, 168, 336, 720, 1440],            // plus serré (1h → 2mois)
  detendu:  [8, 48, 168, 336, 720, 2160, 4320, 8760],       // plus espacé (8h → 1an)
};
function _srGetLadder() {
  try {
    const arr = JSON.parse(localStorage.getItem('mc_sr_ladder') || 'null');
    if (Array.isArray(arr) && arr.length && arr.every(h => Number.isFinite(h) && h > 0)) return arr;
  } catch (e) {}
  return DEFAULT_LADDER_HOURS;
}
function _srSetLadder(arr) { try { localStorage.setItem('mc_sr_ladder', JSON.stringify(arr)); } catch (e) {} }

// Choisit l'unité la plus lisible pour un nombre d'heures (mois/sem/j/h).
/** @type {[string, number][]} */
const _SR_UNITS = [['mois', 720], ['sem', 168], ['j', 24], ['h', 1]];
function _srHoursToNice(h) {
  for (const [, u] of _SR_UNITS) if (h % u === 0) return { value: h / u, unit: u };
  return { value: h, unit: 1 };
}

// Brouillon d'échelle édité dans le modal (tableau d'heures) ; committé au save.
let _srLadderDraft = null;
function _srRenderLadderEditor() {
  const box = document.getElementById('sr-set-ladder'); if (!box) return;
  box.innerHTML = _srLadderDraft.map((h, k) => {
    const { value, unit } = _srHoursToNice(h);
    const opts = _SR_UNITS.map(([lbl, u]) =>
      `<option value="${u}"${u === unit ? ' selected' : ''}>${lbl === 'h' ? 'heures' : lbl === 'j' ? 'jours' : lbl === 'sem' ? 'semaines' : 'mois'}</option>`).join('');
    return `<div style="display:flex;align-items:center;gap:8px">
      <span style="width:70px;font-size:.78rem;color:var(--dim)">Palier ${k + 1}</span>
      <input type="number" min="1" step="1" value="${value}" data-rung="${k}" class="sr-set-input" style="width:74px">
      <select data-rung-unit="${k}" class="sr-set-input" style="flex:1">${opts}</select>
    </div>`;
  }).join('');
}
// Relit les champs du DOM vers le brouillon (avant add/remove/save).
function _srSyncLadderDraftFromDOM() {
  const box = document.getElementById('sr-set-ladder'); if (!box) return;
  _srLadderDraft = [...box.querySelectorAll('[data-rung]')].map(inp => {
    const k = inp.getAttribute('data-rung');
    const unit = parseInt(box.querySelector(`[data-rung-unit="${k}"]`)?.value, 10) || 1;
    return Math.max(1, Math.round((parseFloat(inp.value) || 1) * unit));
  });
}
function _srApplyPreset(name) {
  _srLadderDraft = [...(_SR_LADDER_PRESETS[name] || DEFAULT_LADDER_HOURS)];
  _srRenderLadderEditor();
}
function _srLadderAddRung() {
  _srSyncLadderDraftFromDOM();
  if (_srLadderDraft.length >= 12) { toast('12 paliers maximum', 'ko'); return; }
  const last = _srLadderDraft[_srLadderDraft.length - 1] || 24;
  _srLadderDraft.push(last * 2);
  _srRenderLadderEditor();
}
function _srLadderRemoveRung() {
  _srSyncLadderDraftFromDOM();
  if (_srLadderDraft.length <= 2) { toast('2 paliers minimum', 'ko'); return; }
  _srLadderDraft.pop();
  _srRenderLadderEditor();
}

// ── Réglages de la révision (P4) ──
function openSrSettings() {
  const ni = document.getElementById('sr-set-newlimit'); if (ni) ni.value = _srNewLimit();
  const di = document.getElementById('sr-set-duelimit'); if (di) di.value = _srDueLimit();
  const or = document.getElementById('sr-set-order'); if (or) or.value = localStorage.getItem('mc_sr_order') || 'mixed';
  const su = document.getElementById('sr-set-suspended');
  if (su) { const n = _srSuspendedCount(); su.innerHTML = n ? `${n} · <a href="#" onclick="event.preventDefault();_srClearSuspended()" style="color:var(--cyan)">réactiver tout</a>` : 'aucune'; }
  _srLadderDraft = [..._srGetLadder()];
  _srRenderLadderEditor();
  document.getElementById('modal-sr-settings').classList.add('on');
}
function _srClearSuspended() { try { localStorage.setItem('mc_sr_suspended', '{}'); } catch (e) {} openSrSettings(); renderSrDashboard(); updateReviserToutBadge(); }
function saveSrSettings() {
  const ni = document.getElementById('sr-set-newlimit'), lim = Math.max(0, Math.min(100, parseInt(ni && ni.value, 10) || 0));
  try { localStorage.setItem('mc_sr_newlimit', String(lim)); } catch (e) {}
  const di = document.getElementById('sr-set-duelimit'), dlim = Math.max(0, Math.min(500, parseInt(di && di.value, 10) || 0));
  try { localStorage.setItem('mc_sr_duelimit', String(dlim)); } catch (e) {}
  const or = document.getElementById('sr-set-order'); try { localStorage.setItem('mc_sr_order', (or && or.value) || 'mixed'); } catch (e) {}
  _srSyncLadderDraftFromDOM();
  if (_srLadderDraft && _srLadderDraft.length >= 2) _srSetLadder(_srLadderDraft);
  closeModal('modal-sr-settings');
  renderSrDashboard(); updateReviserToutBadge();
  toast('✓ Réglages enregistrés', 'ok');
}

// ── Tableau de bord élève : métriques + prévision 14 j (P3) ──
function _srMyResults() {
  const id = S.student, email = G.currentUser && G.currentUser.email;
  return G.results.filter(r => r.student === id || (email && r.studentEmail === email));
}
function renderSrDashboard() {
  const el = document.getElementById('sh-dashboard'); if (!el) return;
  // En-tête « Mes statistiques » (index.html) : masqué tant qu'il n'y a rien à montrer
  // (compte neuf) — sinon heading orphelin au premier lancement.
  const head = document.getElementById('sh-stats-head');
  const _empty = () => { el.innerHTML = ''; if (head) head.style.display = 'none'; };
  const student = S.student;
  if (!student) { _empty(); return; }
  const recKeys = Object.keys(G.masteryData).filter(k => k.startsWith(student + '_'));
  const seen = recKeys.length, dueNow = _srSessionSize('all');
  if (!seen && !dueNow) { _empty(); return; }
  if (head) head.style.display = '';
  const mature = recKeys.filter(k => (G.masteryData[k].level || 0) >= 6).length;   // Leitner : niveau ≥6 = ≥1 mois (« maîtrisées »)
  const cutoff = Date.now() - 30 * 86400000;
  const rr = _srMyResults().filter(r => r.ts >= cutoff);
  const retention = rr.length ? Math.round(rr.filter(r => r.correct).length / rr.length * 100) : null;
  const fc = _srForecast(G.drills.map((d, i) => ({ d, i })), student, 13);
  const series = [dueNow].concat(fc), maxV = Math.max(1, ...series);
  const lbl = i => i === 0 ? "aujourd'hui" : i === 7 ? 'dans 1 sem.' : i === 13 ? 'dans 2 sem.' : '';
  const bars = series.map((c, i) => `<div class="srdash-bar-col" title="${c} position${c > 1 ? 's' : ''} à revoir">`
    + `<div class="srdash-bar" style="height:${Math.round(4 + c / maxV * 42)}px;background:${i === 0 ? 'var(--gold)' : 'var(--cyan)'};opacity:${c ? 1 : .25}"></div>`
    + `<span class="srdash-bar-lbl">${lbl(i)}</span></div>`).join('');
  el.innerHTML =
    `<div class="srdash"><div class="srdash-head">`
    + `<span class="srdash-title"><i class="ti ti-chart-line" aria-hidden="true"></i> Ma progression</span>`
    + `<button class="btn btn-ghost btn-sm btn-ico" style="font-size:.72rem" title="Réglages de la révision" aria-label="Réglages de la révision" onclick="openSrSettings()"><i class="ti ti-settings" aria-hidden="true"></i></button></div>`
    + `<div class="srdash-sub">Tes ouvertures reviennent au bon moment pour que tu les retiennes durablement.</div>`
    + `<div class="srdash-metrics">`
    + `<div class="srdash-m"><div class="srdash-v" style="color:${dueNow>0?'var(--cyan)':'var(--green)'}">${dueNow}</div><div class="srdash-l">à réviser aujourd'hui</div></div>`
    + `<div class="srdash-m"><div class="srdash-v" style="color:var(--gold-ink)">${mature}</div><div class="srdash-l">positions bien retenues</div></div>`
    + `<div class="srdash-m"><div class="srdash-v" style="color:var(--green)">${retention != null ? retention + '%' : '—'}</div><div class="srdash-l">bonnes réponses (30 j)</div></div>`
    + `</div>`
    + `<div class="srdash-fc-lbl">Ce qui t'attend les prochains jours</div>`
    + `<div class="srdash-fc">${bars}</div></div>`;
}

// Pont window : exposé aux onclick="" (index.html), aux appels app.js et aux
// ponts SR de lib/drill.js (_srToggleBar/_srUpdateBar/_srAnswer/_srBilan).
Object.assign(window, {
  updateReviserToutBadge, reviserTout, reviserDrill, _srNewLimit, _srTodayKey, _srNewToday,
  _srBumpNewToday, _srPositions, _srScopeList, _srBuildQueue, _srSessionSize, srStart, _srToggleBar,
  _srUpdateBar, _srAnswer, _srForecast, _srBilan, _srSuspendedMap, _srIsSuspended, _srSetSuspended,
  _srSuspendedCount, srSuspendCurrent, openSrSettings, _srClearSuspended, saveSrSettings, _srMyResults,
  renderSrDashboard,
  _srGetLadder, _srSetLadder, _srApplyPreset, _srLadderAddRung, _srLadderRemoveRung,
});
