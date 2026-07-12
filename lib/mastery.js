// ══════════════════════════════════════════════════════
// MASTERY & ENREGISTREMENT — Leitner + résultats/pratique/parties — extrait d'app.js (§5.3/§5 step 4)
// Orchestration de la répétition espacée (sm2Update/sm2Get sur G.masteryData),
// synchro mastery multi-appareils (Supabase, debounce), et enregistrement des
// sessions : résultats (recordResult), pratique (recordPracticeSession),
// parties Maia (saveGame). Le cœur pur est `leitnerSchedule` (core.js, échelons).
// Données : `G` (state.js) + `S` (session.js). `Chess` non utilisé.
// La couche `_sb*` (writers Supabase) reste dans app.js → via le pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { S } from './session.js';
import { leitnerSchedule, DEFAULT_LADDER_HOURS } from './core.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const save              = (...a) => window.save?.(...a);
const _sbRecordResult   = (...a) => window._sbRecordResult?.(...a);
const _sbRecordPractice = (...a) => window._sbRecordPractice?.(...a);
const _sbSaveGame       = (...a) => window._sbSaveGame?.(...a);
const _sbSaveMastery    = (...a) => window._sbSaveMastery?.(...a);

// ── SM-2 spaced repetition ────────────────────────────
// ── Synchronisation SM-2 multi-appareils (profiles.mastery, Supabase) ──
// Debounce : G.currentUser n'est positionné que par l'auth Supabase → il implique
// que le client `sb` existe (resté dans app.js). `_sbSaveMastery` garde aussi `sb`.
let _masterySyncTimer = null;
function _scheduleMasterySync() {
  if (!G.currentUser) return;
  clearTimeout(_masterySyncTimer);
  _masterySyncTimer = setTimeout(() => _sbSaveMastery(), 2500);
}

// Nom conservé (sm2Update) pour ne pas casser le pont window/typedefs, mais le
// moteur est désormais Leitner à échelons (cf. core.js). L'échelle vient du coach
// (window._srGetLadder, réglages SR) → défaut Chessable si absente.
function sm2Update(student, drillId, posKey, correct) {
  const key = `${student}_${drillId}_${posKey}`;
  const ladder = (window._srGetLadder && window._srGetLadder()) || DEFAULT_LADDER_HOURS;
  G.masteryData[key] = leitnerSchedule(G.masteryData[key], correct, Date.now(), ladder);
  _scheduleMasterySync();
}

function sm2Get(student, drillId, posKey) {
  return G.masteryData[`${student}_${drillId}_${posKey}`] || null;
}

// ── Enregistrement de session ─────────────────────────
function recordPracticeSession(pct) {
  const rec = {
    drillId:      String(S.drill.id),
    drillName:    S.drill.name,
    student:      S.student || G.currentUser?.displayName || G.currentUser?.email || 'Anonyme',
    studentEmail:  G.currentUser?.email || null,
    studentPseudo: G.currentPseudo      || null,
    studentId:     G.currentUser?.uid   || null,
    pct,
    sessionIdx:   S.sessionIdx,
    ts: Date.now()
  };
  G.practiceLog.push(rec);
  save();
  _sbRecordPractice(rec);
}

// ── Sauvegarde de partie Maia ─────────────────────────
function saveGame() {
  const g = S.lineGame;
  if (!g || !g.history().length) return;
  const pgn = g.pgn({ sloppy: true });
  const res = g.in_checkmate() ? (g.turn()==='w' ? '0-1' : '1-0')
            : (g.in_draw()||g.in_stalemate()) ? '½-½' : '*';
  const rec = {
    id:        Date.now(),
    drillId:   String(S.drill.id),
    drillName: S.drill.name,
    student:   S.student || G.currentUser?.displayName || G.currentUser?.email || 'Anonyme',
    studentEmail: G.currentUser?.email || null,
    studentId:    G.currentUser?.uid   || null,
    level:     S.drill.level,
    side:      S.drill.side,
    pgn,
    result:    res,
    ts:        Date.now()
  };
  G.savedGames.push(rec);
  save();
  _sbSaveGame(rec);
}

function recordResult(correct, kp) {
  const student = S.student || G.currentUser?.displayName || G.currentUser?.email || 'Anonyme';
  const posKey  = kp.masteryKey || (kp.posIdx + '_' + (kp.san||''));
  sm2Update(student, S.drill.id, posKey, correct);
  const rec = {
    drillId:      String(S.drill.id),
    drillName:    S.drill.name,
    student,
    studentEmail:  G.currentUser?.email  || null,
    studentPseudo: G.currentPseudo       || null,
    studentId:     G.currentUser?.uid    || null,
    posIdx:       kp.posIdx,
    san:          kp.san,
    comment:      kp.comment,
    correct,
    ts: Date.now()
  };
  G.results.push(rec);
  save();
  _sbRecordResult(rec);
}

// Pont window : exposé aux appels app.js/lib (drill, sr, coach, maia).
// `_scheduleMasterySync` reste interne (appelé seulement par sm2Update).
Object.assign(window, {
  sm2Update, sm2Get, recordPracticeSession, saveGame, recordResult,
});
