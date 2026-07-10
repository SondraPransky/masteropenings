// ══════════════════════════════════════════════════════
// MODULES ES (Vite) + vendors CDN
// ══════════════════════════════════════════════════════
// Vendors (chess.js, @supabase/supabase-js) restent chargés en CDN dans index.html.
// Dans un module ES, un identifiant non déclaré (Chess, supabase) se résout sur
// globalThis → `new Chess()` et `supabase.createClient` marchent sans import vendor.
import { _normFen, sm2Schedule, normalizeSAN, extractAllLines } from './lib/core.js';
import {
  _sbModuleToRow, _sbRowToModule, _sbClassToRow, _sbRowToClass,
  _sbResultToRow, _sbRowToResult, _sbPracticeToRow, _sbRowToPractice,
  _sbGameToRow, _sbRowToGame
} from './lib/dbmap.js';
import { isPlayerMove, _buildDrillTree, _treePlayerPositions, _materialHint } from './lib/tree.js';
import {
  oppSeenKey, _commentDelay, _drillSessions, countPlayerMoves,
  computeForcedPath, pickOppMove, treeUnseenCount
} from './lib/drill-core.js';
import {
  NAG_GLYPH, _parseShapes, _shapesToPGN, _commentWithShapes, nagGlyphs, _nagGroup,
  _findNodeByFen, pgnToEditorTree, editorTreeToPGN, _SHAPE_COL
} from './lib/editor-core.js';
import { G } from './state.js';
import { S } from './lib/session.js';
import './lib/editor.js';
import './lib/drill.js';
import './lib/sr.js';
import './lib/coach.js';

// ── Configuration Supabase (client `sb`) ──────────────────
// Clé « publishable » PUBLIQUE (protégée par RLS) → OK committée. Jamais de clé « secret » ici.
const SUPABASE_URL = 'https://smoftbuyejoyxlonhjcu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Bn0asUgcNYPYA1wnl9bokw_k1xshFC4';
const SUPABASE_CONFIGURED = (typeof supabase !== 'undefined') && !!supabase.createClient;
const sb = SUPABASE_CONFIGURED ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;

// ══════════════════════════════════════════════════════
// ÉTAT GLOBAL — auth Supabase
// ══════════════════════════════════════════════════════
// « Mode comptes » : login obligatoire + backend distant (Supabase).
const ACCOUNTS_ON = (typeof SUPABASE_CONFIGURED !== 'undefined') && SUPABASE_CONFIGURED;
// G.currentUser / G.currentRole / G.pendingRole / G.currentPseudo → state.js (G)

// ── Mise à jour de la nav selon le rôle ───────────────
function updateNav() {
  const navUser      = document.getElementById('nav-user');
  const btnLogout    = document.getElementById('btn-logout');
  const navRoleChip  = document.getElementById('nav-role-chip');
  const navTabs      = document.getElementById('nav-tabs');
  const btnBack      = document.getElementById('btn-back-student');
  const tabs         = document.querySelectorAll('nav .tab');

  // En mode Firebase, le chip nav-student (mode local) est inutile
  const navStudentChip = document.getElementById('nav-student');
  if (navStudentChip) navStudentChip.style.display = ACCOUNTS_ON ? 'none' : '';

  if (!ACCOUNTS_ON) return;

  const isTeacher = G.currentRole === 'teacher';
  const isStudent = G.currentRole === 'student';

  if (G.currentUser) {
    // Nom utilisateur
    navUser.textContent   = G.currentUser.displayName || G.currentUser.email;
    navUser.style.display = '';
    // Bouton déconnexion
    btnLogout.style.display = '';
    // Badge rôle
    if (navRoleChip) {
      navRoleChip.className   = 'role-chip ' + (isTeacher ? 'teacher' : 'student');
      navRoleChip.innerHTML = isTeacher ? '<i class="ti ti-clipboard-text" aria-hidden="true"></i> Prof' : '<i class="ti ti-user" aria-hidden="true"></i> Élève';
      navRoleChip.style.display = '';
    }
    // Onglets : cachés pour les élèves
    if (navTabs) navTabs.style.display = isStudent ? 'none' : '';
    // Bouton retour élève : visible uniquement pour les élèves sur la page drill
    if (btnBack) btnBack.style.display = isStudent ? '' : 'none';
  } else {
    // Non connecté
    navUser.style.display   = 'none';
    btnLogout.style.display = 'none';
    if (navRoleChip) navRoleChip.style.display = 'none';
    if (navTabs)     navTabs.style.display     = 'none';
    if (btnBack)     btnBack.style.display     = 'none';
  }
}

// ── Fonctions d'authentification ─────────────────────
async function loginUser() { return _sbLogin(); }

async function registerUser() { return _sbRegister(); }

async function logoutUser() { return _sbLogout(); }

// ── Réinitialisation du mot de passe ──────────────────
function requestPasswordReset() {
  const email = (document.getElementById('login-email')?.value || '').trim();
  _sbResetPassword(email);
}
// Affiché quand l'utilisateur revient via le lien de réinitialisation (événement PASSWORD_RECOVERY).
function showRecoveryForm() {
  goPage('login');
  document.getElementById('login-form').style.display    = 'none';
  document.getElementById('register-form').style.display = 'none';
  const tabs = document.querySelector('.login-tabs'); if (tabs) tabs.style.display = 'none';
  document.getElementById('recovery-form').style.display = '';
  const err = document.getElementById('login-error'); if (err) err.style.display = 'none';
  setTimeout(() => document.getElementById('recovery-pwd')?.focus(), 100);
}
async function submitNewPassword() {
  const pwd = document.getElementById('recovery-pwd')?.value || '';
  if (pwd.length < 6) { showLoginError('Le mot de passe doit contenir au moins 6 caractères.'); return; }
  const err = await _sbUpdatePassword(pwd);
  if (err) { showLoginError(err); return; }
  // Succès → on recharge sur une URL propre (sans le token de récup) : session active, routage normal.
  location.replace(location.origin + location.pathname);
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent    = msg;
  el.style.display  = 'block';
}

function showLoginTab(tab) {
  const lf  = document.getElementById('login-form');
  const rf  = document.getElementById('register-form');
  const tl  = document.getElementById('btn-tab-login');
  const tr  = document.getElementById('btn-tab-register');
  const err = document.getElementById('login-error');
  if (lf)  lf.style.display = tab === 'login'    ? '' : 'none';
  if (rf)  rf.style.display = tab === 'register' ? '' : 'none';
  if (tl)  tl.className = 'login-tab' + (tab === 'login'    ? ' on' : '');
  if (tr)  tr.className = 'login-tab' + (tab === 'register' ? ' on' : '');
  if (err) err.style.display = 'none';
}

// ── Données — modules + G.classes (enseignant) ──────────
async function loadTeacherModules()          { return _sbLoadTeacherModules(); }
async function syncModuleToFirestore(drill)   { return _sbSaveModule(drill); }
async function deleteModuleFromFirestore(drillId) { return _sbDeleteModule(drillId); }

// ── Identifiants de l'élève pour le matching des G.classes (pseudo, email, nom) ──
function _myIdentifiers() {
  return [...new Set([
    G.currentPseudo,
    (G.currentUser?.email || '').toLowerCase(),
    (G.currentUser?.displayName || '').toLowerCase()
  ].filter(Boolean))].slice(0, 10);
}

// ── Données — modules de l'élève (assignés + perso) ───
async function loadStudentModules() { return _sbLoadStudentModules(); }

function renderStudentHome(assigned, personal) {
  assigned = assigned || [];
  personal = personal || [];
  const first = G.currentUser ? (G.currentUser.displayName || G.currentUser.email).split(' ')[0] : '';
  if (G.currentUser) S.student = G.currentUser.displayName || G.currentUser.email;
  const nameEl = document.getElementById('sh-student-name');
  if (nameEl) nameEl.textContent = 'Salut ' + first;

  // Streak (jours d'affilée avec activité)
  const streak = _computeStreak();
  const streakEl = document.getElementById('sh-streak');
  if (streakEl) streakEl.innerHTML = streak > 0 ? `🔥 ${streak} j` : '';

  // Notification : modules assignés pas encore ouverts
  const seen    = _seenModules();
  const seenVer = _seenVersions();
  const newOnes = assigned.filter(m => !seen.includes(String(m.id)));
  // Modules ÉDITÉS depuis la dernière ouverture par l'élève
  const updatedOnes = assigned.filter(m => {
    const id = String(m.id);
    if (!seen.includes(id)) return false;                                          // pas encore vu = "nouveau"
    if (!(id in seenVer)) { _markVersionSeen(id, m.updatedAt || 0); return false; } // baseline (vu avant cette fonctionnalité)
    return (m.updatedAt || 0) > seenVer[id];
  });
  assigned.forEach(m => { m._updated = updatedOnes.includes(m); });

  // Hero : à réviser aujourd'hui (positions dues — répétition espacée)
  const all    = [...assigned, ...personal];
  const dueN   = window._srSessionSize?.('all');
  const heroEl = document.getElementById('sh-hero');
  if (heroEl) {
    if (dueN > 0) {
      heroEl.innerHTML = `<div class="sh-hero-label">À réviser aujourd'hui</div>
        <div class="sh-hero-sub">${dueN} position${dueN>1?'s':''} due${dueN>1?'s':''} — choisies par la répétition espacée.</div>
        <button class="sh-hero-btn" onclick="reviserTout()">▶ Commencer la révision</button>`;
    } else if (all.length) {
      heroEl.innerHTML = `<div class="sh-hero-label">Tout est à jour ✓</div>
        <div class="sh-hero-sub">Bravo ${escapeHtml(first)} ! Rien à réviser aujourd'hui. Reviens demain ou explore un module.</div>`;
    } else {
      heroEl.innerHTML = `<div class="sh-hero-label">Bienvenue 👋</div>
        <div class="sh-hero-sub">Ton prof va t'assigner des modules. En attendant, tu peux importer ton propre PGN ci-dessous.</div>`;
    }
  }

  window.renderSrDashboard?.();   // tableau de bord répétition espacée (P3)

  // Bannière nouveaux modules
  const notifEl = document.getElementById('sh-notif');
  if (notifEl) {
    let _nb = '';
    if (newOnes.length) _nb += `<div class="sh-notif-banner">🔔 <strong>${newOnes.length} nouveau${newOnes.length>1?'x':''} module${newOnes.length>1?'s':''}</strong> de ton prof !</div>`;
    if (updatedOnes.length) _nb += `<div class="sh-notif-banner" style="background:var(--cyan-dim);border-color:var(--cyan-glow);color:var(--cyan)">✏️ <strong>${updatedOnes.length} module${updatedOnes.length>1?'s':''} mis à jour</strong> par ton coach — rouvre${updatedOnes.length>1?'-les':'-le'} pour voir les nouveautés.</div>`;
    notifEl.innerHTML = _nb;
  }

  // Modules assignés
  const el = document.getElementById('sh-module-list');
  if (el) el.innerHTML = assigned.length
    ? assigned.map((m, i) => _shModuleCard(m, i, newOnes.some(n => String(n.id)===String(m.id)), false)).join('')
    : '<div class="sh-empty">Aucun module assigné. Ton prof t\'en enverra bientôt — tu seras prévenu ici.</div>';

  // Révisions perso
  const pel = document.getElementById('sh-perso-list');
  if (pel) pel.innerHTML = personal.length
    ? personal.map((m, j) => _shModuleCard(m, assigned.length + j, false, true)).join('')
    : '<div class="sh-empty">Aucune révision perso. Importe un PGN pour t\'entraîner sur ce que tu veux.</div>';
}

// Stats d'un module pour l'élève (depuis les résultats réels)
function _moduleStats(m) {
  const student = S.student || (G.currentUser ? (G.currentUser.displayName || G.currentUser.email) : '');
  const rs = G.results.filter(r => String(r.drillId) === String(m.id));
  const total   = rs.length;
  const correct = rs.filter(r => r.correct).length;
  let pct = total ? Math.round(correct / total * 100) : null;
  let due = 0, totalPos = 0, played = false;
  if (m.varmode === 'tree') {
    const positions = _treePlayerPositions(m);
    totalPos = positions.length;
    const did = String(m.id), now = Date.now();
    positions.forEach(p => {
      const mm = G.masteryData[`${student}_${did}_${p.masteryKey}`];
      if (mm) played = true;
      if (!mm || mm.due <= now) due++;
    });
    // L'anneau = couverture de maîtrise (positions non dues / total)
    pct = totalPos ? Math.round((totalPos - due) / totalPos * 100) : null;
  }
  let state;
  if (m.varmode === 'tree') {
    if (!played && due === totalPos) state = 'new';
    else if (due === 0)             state = 'mastered';
    else                           state = 'review';
  } else {
    state = total > 0 ? (pct >= 90 ? 'mastered' : 'review') : 'new';
  }
  return { total, correct, pct, due, totalPos, played, state };
}

function _computeStreak() {
  const days = new Set();
  const add = ts => { if (ts) days.add(new Date(ts).toDateString()); };
  G.results.forEach(r => add(r.ts));
  (typeof G.practiceLog !== 'undefined' ? G.practiceLog : []).forEach(p => add(p.ts));
  if (!days.size) return 0;
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // tolère "hier" comme départ
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function _renderRing(pct, colorVar) {
  const has = pct !== null && pct !== undefined;
  const p   = Math.max(0, Math.min(100, has ? pct : 0));
  const C    = 100.5;                       // 2·π·r, r=16
  const off  = (C * (1 - p / 100)).toFixed(1);
  const label = has ? p + '%' : '·';
  return `<svg width="38" height="38" viewBox="0 0 40 40" class="sh-ring" aria-hidden="true">
    <circle cx="20" cy="20" r="16" fill="none" stroke="var(--surf3)" stroke-width="4"/>
    <circle cx="20" cy="20" r="16" fill="none" stroke="${colorVar}" stroke-width="4" stroke-dasharray="${C}" stroke-dashoffset="${off}" stroke-linecap="round" transform="rotate(-90 20 20)"/>
    <text x="20" y="20" text-anchor="middle" dominant-baseline="central" style="font-size:10px;font-weight:700;fill:var(--text)">${label}</text>
  </svg>`;
}

function _shModuleCard(m, idx, isNew, isPersonal) {
  const st = _moduleStats(m);
  const sideSym = m.side === 'w' ? '♔' : m.side === 'b' ? '♚' : '⇄';
  const sideTxt = m.side === 'w' ? 'Blancs' : m.side === 'b' ? 'Noirs' : 'Les deux';
  // État → classe + libellé de la pastille (new / review / mastered)
  let stCls, stTxt;
  if (isNew)                        { stCls = 'new';      stTxt = '🔔 Nouveau'; }
  else if (m._updated)              { stCls = 'new';      stTxt = '✏️ Mis à jour'; }
  else if (st.state === 'new')      { stCls = 'new';      stTxt = 'À découvrir'; }
  else if (st.state === 'mastered') { stCls = 'mastered'; stTxt = '✓ Maîtrisé'; }
  else                              { stCls = 'review';   stTxt = `↻ À revoir${st.due ? ` · ${st.due}` : ''}`; }
  const pct = (st.pct == null) ? 0 : st.pct;
  const coachBadge = (!isPersonal && m._showCoach && m.coachName)
    ? `<span class="sh-mod-side" style="background:var(--cyan-dim);color:var(--cyan);padding:2px 9px;border-radius:999px">👤 ${escapeHtml(m.coachName)}</span>` : '';
  const edit = isPersonal ? `<button class="sh-card-act" onclick="event.stopPropagation();openPgnEditor(${idx})" title="Éditer sur échiquier">🎹</button>` : '';
  const del  = isPersonal ? `<button class="sh-card-act" onclick="event.stopPropagation();deleteStudentDrill('${m.id}')" title="Supprimer">🗑</button>` : '';
  return `<div class="sh-mod${isNew ? ' sh-mod-new' : ''}" onclick="startStudentDrill(${idx})">
    <div class="sh-mod-head">
      <div class="sh-mod-name">${escapeHtml(m.name)}</div>
      <div class="sh-mod-icon">${sideSym}</div>
    </div>
    <div class="sh-mod-meta">
      <span class="sh-mod-state ${stCls}">${stTxt}</span>
      <span class="sh-mod-side">${sideTxt}</span>
      ${coachBadge}
    </div>
    <div class="sh-mod-progress"><div class="sh-mod-progress-fill" style="width:${pct}%"></div></div>
    <div class="sh-mod-actions">
      ${edit}${del}
      <button class="sh-card-act" onclick="event.stopPropagation();playVsMaia(${idx})" title="Jouer contre Maia">🤖</button>
      <button class="sh-card-act sh-card-play" title="Réviser">▶</button>
    </div>
  </div>`;
}

// ── Suivi "déjà vu" pour la notification (local par élève) ──
function _seenKey()    { return 'mc_seen_modules_' + (G.currentUser?.uid || 'anon'); }
function _seenModules(){ try { return JSON.parse(localStorage.getItem(_seenKey()) || '[]'); } catch(e){ return []; } }
function _markModuleSeen(id) {
  const seen = _seenModules();
  if (!seen.includes(String(id))) { seen.push(String(id)); localStorage.setItem(_seenKey(), JSON.stringify(seen)); }
}

// Suivi de la version vue — pour notifier les modules ÉDITÉS par le coach
function _seenVerKey()   { return 'mc_seen_versions_' + (G.currentUser?.uid || 'anon'); }
function _seenVersions() { try { return JSON.parse(localStorage.getItem(_seenVerKey()) || '{}'); } catch(e){ return {}; } }
function _markVersionSeen(id, ver) {
  const v = _seenVersions();
  v[String(id)] = ver || 0;
  localStorage.setItem(_seenVerKey(), JSON.stringify(v));
}

function startStudentDrill(idx) {
  S.student = G.currentUser?.displayName || G.currentUser?.email || 'Élève';
  localStorage.setItem('mc_student', S.student);
  const d = G.drills[idx];
  if (d) { _markModuleSeen(d.id); _markVersionSeen(d.id, d.updatedAt || 0); }
  goPage('drill');
  startDrill(idx);
}

// ── Import perso par l'élève (privé) ──────────────────
function openStudentImport() {
  const n = document.getElementById('si-name'); if (n) n.value = '';
  const p = document.getElementById('si-pgn');  if (p) p.value = '';
  document.getElementById('modal-student-import').classList.add('on');
}

function importStudentDrill() {
  const name = document.getElementById('si-name').value.trim();
  const pgn  = document.getElementById('si-pgn').value.trim();
  const side = document.getElementById('si-side').value;
  if (!name) { toast('⚠ Donne un nom à ta révision', 'ko'); return; }
  if (!pgn)  { toast('⚠ Colle un PGN', 'ko'); return; }
  let allLines;
  try { allLines = extractAllLines(pgn); }
  catch(e) { toast('❌ PGN invalide : ' + e.message, 'ko'); return; }
  if (!allLines.length) { toast('❌ Aucune ligne jouable dans ce PGN', 'ko'); return; }
  const tree = _buildDrillTree(allLines, side);
  if (!Object.keys(tree).length) { toast('⚠ Aucun coup extractible', 'ko'); return; }
  const d = {
    id: Date.now(),
    name, level: 'Perso', side, pgn,
    mode: 'line', varmode: 'tree', tree,
    sessions: [{ label: 'Arbre complet', startFen: new Chess().fen(), moves: [], kps: [] }],
    hideComments: false, deadline: null,
    personal: true,
    ownerStudentId: G.currentUser?.uid || null,
    created: new Date().toLocaleDateString('fr-FR')
  };
  G.drills.push(d);
  save();
  _sbSaveStudentModule(d);
  closeModal('modal-student-import');
  toast('✓ Révision perso créée', 'ok');
  loadStudentModules();
}

function deleteStudentDrill(id) {
  if (!confirm('Supprimer cette révision perso ?')) return;
  G.drills = G.drills.filter(d => String(d.id) !== String(id));
  save();
  _sbDeleteStudentModule(id);
  loadStudentModules();
}

// ── Données — Vue Prof (résultats / pratique / parties) ──
async function loadTeacherResults()  { return _sbLoadTeacherResults(); }
async function loadTeacherPractice() { return _sbLoadTeacherPractice(); }
async function loadTeacherGames()    { return _sbLoadTeacherGames(); }

// ── Auth state (Supabase) ─────────────────────────────
if (sb) _sbInitAuth();

// ══════════════════════════════════════════════════════
// DONNÉES
// ══════════════════════════════════════════════════════
// G.drills / G.practiceLog / G.savedGames / G.masteryData / G.oppSeen → state.js (G).

// ── Thème ──────────────────────────────────────────────
function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('mc_theme', next);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.innerHTML = next === 'dark' ? '<i class="ti ti-sun" aria-hidden="true"></i>' : '<i class="ti ti-moon" aria-hidden="true"></i>';
}
document.addEventListener('DOMContentLoaded', function() {
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.innerHTML = document.documentElement.getAttribute('data-theme') === 'dark' ? '<i class="ti ti-sun" aria-hidden="true"></i>' : '<i class="ti ti-moon" aria-hidden="true"></i>';
});

// ══════════════════════════════════════════════════════
// ÉTAT SESSION → lib/session.js (objet `S` partagé, jamais réassigné)
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════
function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Notation figurine : remplace K/Q/R/B/N par les symboles Unicode
const PIECE_SYMS = { K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘' };
function fig(san) {
  if (!san) return san;
  return san.replace(/^([KQRBN])/, m => PIECE_SYMS[m] || m);
}

function currentGame() {
  if (S.drill?.varmode === 'tree') return S.lineGame;
  return S.drill?.mode === 'line' ? S.lineGame : S.game;
}

function isLineMode() {
  return S.drill?.mode === 'line';
}

// Retourne la session courante (compatible ancien format sans sessions)
function currentSession() {
  const d = S.drill;
  if (!d) return null;
  if (d.sessions?.length) return d.sessions[Math.min(S.sessionIdx, d.sessions.length - 1)];
  // Ancien format : drill avec moves/kps directs → session unique
  return { label: d.lineLabel || 'Ligne principale', depth: d.depth || 0,
           startFen: d.startFen, moves: d.moves || [], kps: d.kps || [] };
}

function totalSessions() {
  const d = S.drill;
  if (!d) return 0;
  return d.sessions?.length || 1;
}

// isPlayerMove → lib/tree.js

// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
function switchCoachSection(sec) {
  const sections = ['modules','eleves','classes','heatmap','parties','export'];
  sections.forEach(s => {
    const el = document.getElementById('csec-'+s);
    if (el) el.style.display = s===sec ? '' : 'none';
    const btn = document.getElementById('csnav-'+s);
    if (btn) btn.classList.toggle('on', s===sec);
  });
  if (sec==='eleves')  { Promise.all([loadTeacherResults(), loadTeacherPractice(), loadTeacherGames()]).then(()=>window.renderProfView?.()); }
  if (sec==='classes') { window.renderClassesTab?.(); renderClassModuleSelect(); }
  if (sec==='heatmap') { _syncHeatmapFilters(); window.renderHeatmap?.(); }
  if (sec==='parties') { loadTeacherGames().then(()=>{ _syncPartiesFilter(); window.renderPartiesTab?.(); }); }
}

function _syncHeatmapFilters() {
  const src = document.getElementById('prof-drill-filter');
  const hm  = document.getElementById('hm-drill-filter');
  if (src && hm) { hm.innerHTML = src.innerHTML; hm.value = src.value; }
}

function _syncPartiesFilter() {
  const src = document.getElementById('prof-drill-filter');
  const pt  = document.getElementById('parties-drill-filter');
  if (src && pt) { pt.innerHTML = src.innerHTML; pt.value = src.value; }
}

function openCreateDrillModal() {
  document.getElementById('modal-create-drill').classList.add('on');
}

// ── Bibliothèque d'ouvertures prêtes à l'emploi ──────────
const OPENINGS_LIBRARY = [
  { name:"Ouverture italienne", side:"w", level:"Débutant",
    desc:"Sortie rapide des pièces et pression sur f7 — idéale pour débuter.",
    pgn:"1. e4 e5 2. Nf3 {Attaque e5 et développe le cavalier.} Nc6 3. Bc4 {Le fou vise f7, le point le plus faible des Noirs.} Bc5 4. c3 {Prépare d4 pour bâtir un grand centre.} Nf6 5. d3 d6 6. O-O O-O *" },
  { name:"Partie espagnole (Ruy Lopez)", side:"w", level:"Intermédiaire",
    desc:"L'ouverture la plus jouée au plus haut niveau : pression durable sur le centre.",
    pgn:"1. e4 e5 2. Nf3 Nc6 3. Bb5 {Le fou attaque le cavalier qui défend e5.} a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 {Renforce e4 et prépare le plan c3-d4.} b5 7. Bb3 d6 *" },
  { name:"Défense sicilienne (Najdorf)", side:"b", level:"Avancé",
    desc:"La réponse la plus combative à 1.e4 : déséquilibre et contre-jeu pour les Noirs.",
    pgn:"1. e4 c5 {Les Noirs contestent le centre de flanc.} 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 {Le coup Najdorf : contrôle b5 et prépare e5 ou e6.} *" },
  { name:"Défense Caro-Kann", side:"b", level:"Intermédiaire",
    desc:"Solide et fiable : une structure saine sans faiblesse pour les Noirs.",
    pgn:"1. e4 c6 {Prépare d5 en soutenant le pion.} 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 {Le fou sort activement avant de jouer e6.} 5. Ng3 Bg6 *" },
  { name:"Système Londonien", side:"w", level:"Débutant",
    desc:"Un plan simple et solide pour les Blancs, jouable contre presque tout.",
    pgn:"1. d4 d5 2. Bf4 {Le fou sort hors de la chaîne de pions — c'est l'idée clé.} Nf6 3. e3 e6 4. Nf3 c5 5. c3 Nc6 *" },
  { name:"Défense française", side:"b", level:"Intermédiaire",
    desc:"Contre-attaque sur le centre blanc ; patience et bon plan requis.",
    pgn:"1. e4 e6 {Prépare d5 pour frapper le centre.} 2. d4 d5 3. Nc3 Nf6 4. e5 Nfd7 {Le cavalier recule pour préparer la rupture c5.} *" }
];

function openLibrary() { renderLibrary(); document.getElementById('modal-library').classList.add('on'); }

function renderLibrary() {
  const el = document.getElementById('library-list');
  if (!el) return;
  const verb = (G.currentRole === 'teacher') ? 'Ajouter' : 'Apprendre';
  el.innerHTML = OPENINGS_LIBRARY.map((o, i) => `
    <div class="lib-row">
      <div class="lib-info">
        <div class="lib-name">${escapeHtml(o.name)} <span class="lib-side">${o.side==='w'?'Blancs':o.side==='b'?'Noirs':'Les deux'}</span></div>
        <div class="lib-desc">${escapeHtml(o.desc)}</div>
      </div>
      <button class="btn btn-gold btn-sm" onclick="addFromLibrary(${i})">${verb}</button>
    </div>`).join('');
}

function addFromLibrary(idx) {
  const o = OPENINGS_LIBRARY[idx];
  if (!o) return;
  const asStudent = (G.currentRole !== 'teacher');
  let allLines;
  try { allLines = extractAllLines(o.pgn); } catch(e) { toast('❌ Erreur de chargement', 'ko'); return; }
  const tree = _buildDrillTree(allLines, o.side);
  if (!Object.keys(tree).length) { toast('❌ Ouverture invalide', 'ko'); return; }
  const d = {
    id: Date.now(),
    name: o.name, level: o.level || 'Intermédiaire', side: o.side, pgn: o.pgn,
    mode: 'line', varmode: 'tree', tree,
    sessions: [{ label: 'Arbre complet', startFen: new Chess().fen(), moves: [], kps: [] }],
    hideComments: false, deadline: null,
    fromLibrary: true,
    created: new Date().toLocaleDateString('fr-FR')
  };
  if (asStudent) { d.personal = true; d.ownerStudentId = G.currentUser?.uid || null; }
  G.drills.push(d);
  save();
  if (G.currentUser) {
    if (asStudent) _sbSaveStudentModule(d);
    else syncModuleToFirestore(d);
  }
  closeModal('modal-library');
  toast(`✓ « ${o.name} » ajouté`, 'ok');
  if (asStudent) loadStudentModules();
  else { renderDrillList(); renderClassModuleSelect(); }
}

function goPage(name) {
  // 'prof' redirects to coach>eleves section
  if (name === 'prof') { goPage('coach'); switchCoachSection('eleves'); return; }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('nav .tab').forEach(t => t.classList.remove('on'));
  const pageEl = document.getElementById('page-' + name);
  if (pageEl) pageEl.classList.add('on');
  const tabMap = { coach: 'tab-coach', drill: 'tab-drill' };
  if (tabMap[name]) document.getElementById(tabMap[name])?.classList.add('on');
  if (name === 'drill') initDrillPage();
  if (name === 'coach') { renderClassModuleSelect(); }
  // Bouton retour visible sur la page drill pour les élèves Firebase
  const btnBack = document.getElementById('btn-back-student');
  if (btnBack) btnBack.style.display = (ACCOUNTS_ON && G.currentRole === 'student' && name === 'drill') ? '' : 'none';
}

// ══════════════════════════════════════════════════════
// PARSING PGN + SM-2 (cœur) + _normFen → déplacés dans lib/core.js
// (normalizeSAN, extractAllLines, sm2Schedule, _normFen), chargé avant app.js
// et testés via Vitest (tests/core.test.js).
// ══════════════════════════════════════════════════════

// Détecte si un coup laisse du matériel en prise (heuristique 1 coup, prudente).
// _materialHint + _buildDrillTree → lib/tree.js

// ══════════════════════════════════════════════════════
// IMPORT DRILL (création)
// ══════════════════════════════════════════════════════
function previewDrill() {
  const pgn  = document.getElementById('inp-pgn').value.trim();
  const side = document.getElementById('inp-side').value;
  const el   = document.getElementById('drill-preview');
  if (!pgn) { el.style.display='block'; el.innerHTML='<span style="color:var(--dim)">Collez un PGN d\'abord.</span>'; return; }
  let allLines;
  try { allLines = extractAllLines(pgn); } catch(e) { el.style.display='block'; el.innerHTML=`<span style="color:var(--red)">❌ PGN invalide : ${escapeHtml(e.message)}</span>`; return; }
  const tree      = _buildDrillTree(allLines, side);
  const positions = Object.keys(tree).length;
  const playerPos = Object.values(tree).filter(n=>n.player.length>0).length;
  const lines     = [...allLines].sort((a,b)=>a.depth-b.depth);
  const rows = lines.map(line => {
    const label  = line.depth===0 ? 'Ligne principale' : (line.label.match(/\[[^\]]+\]/g)||[]).pop()?.replace(/[\[\]]/g,'').trim() || line.label;
    const player = line.moves.filter(m=>isPlayerMove(m.fenBefore,side)).length;
    return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text);font-size:.82rem">${escapeHtml(label)}</span>
      <span style="color:var(--cyan);font-family:'JetBrains Mono',monospace;font-size:.78rem">${player} coup${player>1?'s':''} à jouer</span>
    </div>`;
  });
  el.style.display = 'block';
  el.innerHTML = `<div style="display:flex;gap:16px;margin-bottom:8px;font-size:.82rem">
    <span style="font-weight:700;color:var(--cyan)">🌿 ${positions} positions</span>
    <span style="color:var(--dim)">${playerPos} à jouer · ${lines.length} variante${lines.length>1?'s':''}</span>
  </div>${rows.join('')}`;
}

function loadExample() {
  document.getElementById('inp-name').value  = 'Espagnole – Plan de Breyer';
  document.getElementById('inp-level').value = 'Intermédiaire';
  document.getElementById('inp-side').value  = 'w';
  document.getElementById('inp-drillmode').value = 'line';
  document.getElementById('inp-pgn').value =
`1. e4 {Contrôle du centre avec le pion e} e5 2. Nf3 {Développement et attaque sur e5} Nc6 3. Bb5 {L'ouverture espagnole : clouage du cavalier} a6 4. Ba4 {Le fou recule pour maintenir la pression} Nf6 5. O-O {Mise en sécurité du roi — moment clé !} Be7 6. Re1 {La tour soutient le centre} b5 7. Bb3 {Le fou se repositionne sur une diagonale active} d6 8. c3 {Prépare d4 — plan de rupture centrale} O-O 9. h3 {Prévient Bg4 qui épinglerait le cavalier f3} Nb8 10. d4 {La rupture centrale tant préparée !} Nbd7 *`;
}

function toggleAdvOpts() {
  const el    = document.getElementById('adv-opts');
  const arrow = document.getElementById('adv-arrow');
  const open  = el.style.display === 'none' || el.style.display === '';
  el.style.display = open ? 'block' : 'none';
  if (arrow) arrow.textContent = open ? '▼' : '▶';
}

function autoFillFromPgn(pgn) {
  const nameEl = document.getElementById('inp-name');
  if (!pgn || nameEl.value.trim()) return;
  const opening = pgn.match(/\[Opening\s+"([^"?]+)"\]/)?.[1];
  const event   = pgn.match(/\[Event\s+"([^"?]+)"\]/)?.[1];
  const white   = pgn.match(/\[White\s+"([^"?]+)"\]/)?.[1];
  const name    = (opening || event || (white ? 'Ouverture – ' + white : '')).trim();
  if (name) nameEl.value = name;
}

function loadPgnFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const txt = String(reader.result || '');
    const ta = document.getElementById('inp-pgn');
    if (ta) { ta.value = txt; if (typeof autoFillFromPgn === 'function') autoFillFromPgn(txt); }
    toast('✓ PGN importé : ' + file.name, 'ok');
  };
  reader.onerror = () => toast('❌ Lecture du fichier impossible', 'ko');
  reader.readAsText(file);
  e.target.value = '';   // autorise le ré-import du même fichier
}

function importDrill() {
  const baseName     = document.getElementById('inp-name').value.trim();
  const level        = document.getElementById('inp-level').value;
  const pgn          = document.getElementById('inp-pgn').value.trim();
  const side         = document.getElementById('inp-side').value;
  const deadline     = document.getElementById('inp-deadline').value || null;
  const hideComments = document.getElementById('inp-hide-comments').checked;

  if (!baseName) { toast('⚠ Donnez un nom au module', 'ko'); return; }
  if (!pgn)      { toast('⚠ Collez un PGN', 'ko'); return; }

  let allLines;
  try { allLines = extractAllLines(pgn); }
  catch(e) { toast('❌ PGN invalide : '+e.message, 'ko'); return; }
  if (!allLines.length) { toast('❌ Aucune ligne jouable', 'ko'); return; }

  const tree = _buildDrillTree(allLines, side);
  if (!Object.keys(tree).length) { toast('⚠ Aucun coup extractible', 'ko'); return; }

  const newDrill = {
    id: Date.now(),
    name: baseName,
    level, side, pgn,
    mode: 'line', varmode: 'tree', tree,
    sessions: [{ label: 'Arbre complet', startFen: new Chess().fen(), moves: [], kps: [] }],
    hideComments, deadline,
    created: new Date().toLocaleDateString('fr-FR'),
    updatedAt: Date.now()
  };
  G.drills.push(newDrill);
  S.idx = G.drills.length - 1;

  save();
  syncModuleToFirestore(newDrill);
  renderDrillList();
  renderClassModuleSelect();
  document.getElementById('inp-name').value='';
  document.getElementById('inp-pgn').value='';
  document.getElementById('inp-deadline').value='';
  document.getElementById('inp-hide-comments').checked=false;
  document.getElementById('drill-preview').style.display='none';
  closeModal('modal-create-drill');
  toast(`✓ Module créé — ${Object.keys(tree).length} positions indexées`, 'ok');
}

// _drillSessions → lib/drill-core.js

// Repetition espacee (SR) : updateReviserToutBadge, reviserTout/reviserDrill, srStart,
// _srBuildQueue, _srAnswer, _srBilan, srSuspendCurrent, openSrSettings, renderSrDashboard...
// -> lib/sr.js (exposees sur window ; appelees via window.xxx?.() cote app.js)

let _pendingDelId = null;
function deleteDrill(id) {
  _pendingDelId = id;
  // Fermer toute modale/overlay ouverte avant d'afficher la confirmation
  document.querySelectorAll('.modal.on, .overlay.on').forEach(m => m.classList.remove('on'));
  document.getElementById('del-dialog').style.display = 'block';
  document.getElementById('del-backdrop').style.display = 'block';
}
function confirmDel() {
  const id = _pendingDelId;
  cancelDel();
  const toDel = G.drills.find(d=>d.id===id);
  if (toDel && toDel.demo) localStorage.setItem('mc_demo_seen','1');
  G.drills      = G.drills.filter(d=>String(d.id)!==String(id));
  G.results     = G.results.filter(r=>String(r.drillId)!==String(id));
  G.practiceLog = G.practiceLog.filter(l=>String(l.drillId)!==String(id));
  G.savedGames  = G.savedGames.filter(g=>String(g.drillId)!==String(id));
  for (const k of Object.keys(G.masteryData)) {
    if (k.includes(`_${id}_`)) delete G.masteryData[k];
  }
  save();
  deleteModuleFromFirestore(id);
  renderDrillList();
  renderClassModuleSelect();
  toast('Module supprimé');
}
function cancelDel() {
  _pendingDelId = null;
  document.getElementById('del-dialog').style.display = 'none';
  document.getElementById('del-backdrop').style.display = 'none';
}

function save() {
  localStorage.setItem('mc_drills',   JSON.stringify(G.drills));
  localStorage.setItem('mc_results',  JSON.stringify(G.results));
  localStorage.setItem('mc_practice', JSON.stringify(G.practiceLog));
  localStorage.setItem('mc_games',    JSON.stringify(G.savedGames));
  localStorage.setItem('mc_mastery',  JSON.stringify(G.masteryData));
  localStorage.setItem('mc_opp_seen', JSON.stringify(G.oppSeen));
}
function saveClasses() {
  localStorage.setItem('mc_classes', JSON.stringify(G.classes));
}

// countPlayerMoves → lib/drill-core.js

// ── Drill de démo : injecté automatiquement au premier lancement ──────────
function injectDemoDrill() {
  const pgn = `1. e4 {Contrôle du centre avec le pion e} e5 2. Nf3 {Développement et attaque sur e5} Nc6 3. Bb5 {L'ouverture espagnole : clouage du cavalier} a6 4. Ba4 {Le fou recule pour maintenir la pression} Nf6 5. O-O {Mise en sécurité du roi — moment clé !} Be7 6. Re1 {La tour soutient le centre} b5 7. Bb3 {Le fou se repositionne sur une diagonale active} d6 8. c3 {Prépare d4 — plan de rupture centrale} O-O 9. h3 {Prévient Bg4 qui épinglerait le cavalier f3} Nb8 10. d4 {La rupture centrale tant préparée !} Nbd7 *`;
  try {
    const allLines = extractAllLines(pgn);
    if (!allLines.length) return;
    const line = allLines[0];
    G.drills.push({
      id: 9e8,            // id fixe réservé au démo
      name: 'Espagnole – Plan de Breyer',
      level: 'Intermédiaire',
      side: 'w',
      mode: 'line',
      depth: 0,
      lineLabel: 'Ligne principale',
      startFen: line.startFen,
      moves: line.moves,
      kps: [],
      created: 'Démo',
      demo: true
    });
    save();
  } catch(e) {
    console.warn('injectDemoDrill failed:', e);
  }
}

// ── Onboarding prof : guide de démarrage en 3 étapes ──
function renderCoachOnboarding() {
  const el = document.getElementById('coach-onboarding');
  if (!el) return;
  if (localStorage.getItem('mc_onboarding_done')) { el.innerHTML = ''; return; }
  const nbModules = G.drills.filter(d => !d.personal && !d.demo).length;
  const nbClasses = (typeof G.classes !== 'undefined' ? G.classes : []).length;
  const steps = [
    { done: true,          label: 'Compte professeur créé', cta: '' },
    { done: nbModules > 0, label: 'Créez votre premier module',
      cta: `<button class="btn btn-gold btn-sm" onclick="openCreateDrillModal()">Créer</button>` },
    { done: nbClasses > 0, label: 'Créez une classe et ajoutez vos élèves',
      cta: `<button class="btn btn-gold btn-sm" onclick="switchCoachSection('classes')">Créer une classe</button>` }
  ];
  const doneN = steps.filter(s => s.done).length;
  if (doneN === steps.length) {
    el.innerHTML = `<div class="onb-card">
      <div class="onb-head"><span>🎉 Tout est prêt !</span><button class="onb-x" onclick="dismissOnboarding()" title="Masquer">×</button></div>
      <div class="onb-sub">Vos élèves voient leurs modules assignés et révisent. Suivez leur progression dans l'onglet Élèves.</div>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="onb-card">
    <div class="onb-head">
      <span>👋 Bienvenue ! Démarrez en 3 étapes</span>
      <span class="onb-prog">${doneN}/${steps.length}</span>
      <button class="onb-x" onclick="dismissOnboarding()" title="Masquer">×</button>
    </div>
    ${steps.map(s => `<div class="onb-step ${s.done ? 'on' : ''}">
      <span class="onb-check">${s.done ? '✓' : ''}</span>
      <span class="onb-label">${s.label}</span>
      ${!s.done ? s.cta : ''}
    </div>`).join('')}
  </div>`;
}

function dismissOnboarding() {
  localStorage.setItem('mc_onboarding_done', '1');
  renderCoachOnboarding();
}

function renderDrillList() {
  renderCoachOnboarding();
  const grid = document.getElementById('module-cards-grid');
  const n    = G.drills.length;

  // Update sidebar badge + subtitle
  const countBadge = document.getElementById('csnav-count-modules');
  if (countBadge) countBadge.textContent = n;
  const sub = document.getElementById('cs-modules-sub');
  if (sub) sub.textContent = n === 0 ? 'Aucun module créé' : n + ' module' + (n>1?'s':'') + ' créé' + (n>1?'s':'');

  if (!grid) return;

  if (!n) {
    grid.innerHTML = `<div class="mcard-empty">
      <div class="mcard-empty-ico">📦</div>
      <div class="mcard-empty-title">Aucun module pour l'instant</div>
      <div class="mcard-empty-sub">Créez votre premier module en important un PGN<br>et vos élèves pourront réviser les ouvertures.</div>
      <button class="btn btn-gold" onclick="openCreateDrillModal()">+ Créer mon premier module</button>
    </div>`;
    return;
  }

  const now = Date.now();
  grid.innerHTML = G.drills.map((d,i) => {
    const ns = d.sessions?.length || 1;
    const count = d.varmode==='tree' ? Object.keys(d.tree||{}).length+' pos.' : countPlayerMoves(d)+(countPlayerMoves(d)===1?' coup':' coups');
    const side  = d.side==='w' ? '♔ Blancs' : d.side==='b' ? '♚ Noirs' : '⇄ Les deux';

    const dueCount = Object.keys(G.masteryData).filter(k=>k.includes(`_${d.id}_`)&&G.masteryData[k].due<=now).length;
    const dueBanner = dueCount>0
      ? `<div class="mcard-due-banner" onclick="event.stopPropagation();reviserDrill(${i})">↻ ${dueCount} coup${dueCount>1?'s':''} à réviser</div>`
      : '';

    const levelColor = {Débutant:'var(--green)',Intermédiaire:'var(--blue)',Avancé:'var(--cyan)',Expert:'var(--violet)',Maître:'var(--gold)',GrandMaître:'var(--red)'}[d.level?.replace('-','')]||'var(--dim)';

    const badges = [
      `<span class="badge badge-blue">${escapeHtml(d.level)}</span>`,
      ns>1 ? `<span class="badge" style="background:var(--cyan-dim);color:var(--cyan)">⇶ ${ns} sessions</span>`
           : `<span class="badge badge-gold">● 1 ligne</span>`,
      d.varmode==='tree' ? `<span class="badge" style="background:var(--blue-dim);color:var(--blue)">🌿 Arbre</span>` : '',
      d.demo    ? `<span class="badge" style="background:var(--gold-dim);color:var(--gold)">✦ Démo</span>` : '',
      d.hideComments ? `<span class="badge" style="background:var(--surf2);color:var(--dim)">🔇 Confirmé</span>` : '',
      d.students?.length ? `<span class="badge" style="background:var(--green-dim);color:var(--green)">👥 ${d.students.length}</span>` : '',
      window._deadlinePill?.(d),
    ].filter(Boolean).join('');

    const editorBtn = `<button class="btn btn-ghost btn-sm" onclick="openPgnEditor(${i})" title="Éditeur sur échiquier">🎹</button>`;

    return `<div class="mcard">
      ${dueBanner}
      <div class="mcard-name">${escapeHtml(d.name)}</div>
      <div class="mcard-meta">${count} · ${side} · ${escapeHtml(d.created||'—')}</div>
      <div class="mcard-badges">${badges}</div>
      <div class="mcard-footer">
        <button class="btn btn-gold btn-sm" style="flex:1" onclick="launchDrill(${i})">▶ Jouer</button>
        <button class="btn btn-blue btn-sm" style="flex:1" onclick="shareDrill(${i})" title="Assigner ce module à des élèves">📤 Partager</button>
        <button class="btn btn-ghost btn-sm" onclick="playVsMaia(${i})" title="Jouer contre Maia">🤖</button>
        ${editorBtn}
        <button class="btn btn-ghost btn-sm" onclick="deleteDrill(${d.id})" title="Supprimer">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function launchDrill(i) { S.idx=i; goPage('drill'); }

// Partager un module = ouvrir le formulaire de classe avec ce module déjà coché.
// Il ne reste au prof qu'à saisir les élèves puis valider (l'assignation passe par les G.classes).
function shareDrill(i) {
  const d = G.drills[i];
  if (!d) return;
  switchCoachSection('classes');
  cancelEditClass();            // repart d'un formulaire « nouvelle classe » vierge
  renderClassModuleSelect();    // reconstruit la liste des cases à cocher
  document.querySelectorAll('#inp-cls-modules input[type=checkbox]').forEach(c => {
    c.checked = String(c.value) === String(d.id);
  });
  const t = document.getElementById('cls-form-title');
  if (t) t.textContent = '📤 Partager « ' + (d.name || 'module') + ' »';
  const s = document.getElementById('inp-cls-students');
  if (s) { s.scrollIntoView({ behavior:'smooth', block:'center' }); setTimeout(() => s.focus(), 300); }
  toast('Ajoutez les élèves (pseudo ou email) puis validez', 'ok');
}

// ══════════════════════════════════════════════════════
// PARTAGE PAR CODE
// ══════════════════════════════════════════════════════
// (Partage par code retiré — l'assignation se fait uniquement via les G.classes,
//  et l'élève peut importer ses propres PGN depuis son espace.)

// ══════════════════════════════════════════════════════
// CLASSES
// ══════════════════════════════════════════════════════
let _editingClassId = null;

// Bascule classe ↔ cours particulier (élève seul)
function toggleClassMode() {
  const ind = !!document.getElementById('inp-cls-individual')?.checked;
  const nameRow = document.getElementById('cls-name-row'); if (nameRow) nameRow.style.display = ind ? 'none' : '';
  const lbl = document.getElementById('cls-students-label');
  if (lbl) lbl.innerHTML = ind
    ? 'Élève <span style="font-weight:400;color:var(--dim);font-size:.72rem">— pseudo ou email</span>'
    : 'Élèves <span style="font-weight:400;color:var(--dim);font-size:.72rem">— pseudo ou email, un par ligne</span>';
  const ta = document.getElementById('inp-cls-students'); if (ta) { ta.rows = ind ? 1 : 3; ta.placeholder = ind ? 'alex12' : 'alex12\nmarie\nbob@email.com'; }
  if (_editingClassId == null) {
    const t = document.getElementById('cls-form-title'); if (t) t.textContent = ind ? '👤 Nouveau cours particulier' : '🏫 Nouvelle classe';
    const b = document.getElementById('cls-save-btn');   if (b) b.textContent = ind ? "👤 Ajouter l'élève" : '🏫 Créer la classe';
  }
}

async function saveClass() {
  const individual    = !!document.getElementById('inp-cls-individual')?.checked;
  const selectEl      = document.getElementById('inp-cls-modules');
  const selectedIds   = selectEl ? [...selectEl.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value) : [];
  const stuRaw        = document.getElementById('inp-cls-students').value.trim();
  let studentEmails   = stuRaw ? stuRaw.split('\n').map(s=>s.trim().toLowerCase()).filter(Boolean) : [];
  if (individual) studentEmails = studentEmails.slice(0, 1);   // cours particulier = un seul élève
  let name = document.getElementById('inp-cls-name').value.trim();
  if (individual) name = studentEmails[0] ? '👤 ' + studentEmails[0] : '';

  if (!name && !individual) { toast('⚠ Donnez un nom à la classe','ko'); return; }
  // Cours particulier : le module est optionnel (on peut l'assigner plus tard via 📤 Partager).
  if (!selectedIds.length && !individual) { toast('⚠ Sélectionnez au moins un module','ko'); return; }
  if (!studentEmails.length){ toast(individual ? '⚠ Indiquez le pseudo ou l\'email de l\'élève' : '⚠ Ajoutez au moins un élève','ko'); return; }

  let cls = (_editingClassId != null) ? G.classes.find(c => c.id === _editingClassId) : null;
  const isEdit = !!cls;
  if (cls) {
    cls.name = name; cls.moduleIds = selectedIds; cls.studentEmails = studentEmails; cls.students = studentEmails; cls.individual = individual;
  } else {
    cls = { id: Date.now(), name, moduleIds: selectedIds, moduleCodes: [], studentEmails, students: studentEmails, individual, created: new Date().toLocaleDateString('fr-FR') };
    G.classes.push(cls);
  }
  saveClasses();
  await _sbSaveClass(cls);
  cancelEditClass();
  renderClassList();
  window.renderClassesTab?.();
  toast('✓ ' + (individual ? 'Cours particulier' : 'Classe') + (isEdit ? ' mis à jour' : ' enregistré'), 'ok');
}

function openEditClass(id) {
  const cls = G.classes.find(c => c.id === id);
  if (!cls) return;
  _editingClassId = id;
  const indBox = document.getElementById('inp-cls-individual'); if (indBox) indBox.checked = !!cls.individual;
  toggleClassMode();
  document.getElementById('inp-cls-name').value = cls.name;
  document.getElementById('inp-cls-students').value = (cls.studentEmails || cls.students || []).join('\n');
  renderClassModuleSelect();
  const ids = (cls.moduleIds || []).map(String);
  document.querySelectorAll('#inp-cls-modules input[type=checkbox]').forEach(c => { c.checked = ids.includes(String(c.value)); });
  const t = document.getElementById('cls-form-title'); if (t) t.textContent = cls.individual ? '✏️ Modifier le cours particulier' : '✏️ Modifier la classe';
  const b = document.getElementById('cls-save-btn');   if (b) b.textContent = '💾 Enregistrer';
  const x = document.getElementById('cls-cancel-btn'); if (x) x.style.display = '';
  document.getElementById('inp-cls-name').scrollIntoView({ behavior:'smooth', block:'center' });
}

function cancelEditClass() {
  _editingClassId = null;
  const n = document.getElementById('inp-cls-name');     if (n) n.value = '';
  const s = document.getElementById('inp-cls-students'); if (s) s.value = '';
  document.querySelectorAll('#inp-cls-modules input[type=checkbox]').forEach(c => c.checked = false);
  const ind = document.getElementById('inp-cls-individual'); if (ind) ind.checked = false;
  const t = document.getElementById('cls-form-title');  if (t) t.textContent = '🏫 Nouvelle classe';
  const b = document.getElementById('cls-save-btn');    if (b) b.textContent = '🏫 Créer la classe';
  const x = document.getElementById('cls-cancel-btn');  if (x) x.style.display = 'none';
  toggleClassMode();
}

// Ajouter un élève = ouvrir le formulaire en mode « cours particulier ».
// Il suffit de saisir le pseudo ; le module s'assigne plus tard via 📤 Partager.
function addStudent() {
  switchCoachSection('classes');
  cancelEditClass();
  const ind = document.getElementById('inp-cls-individual');
  if (ind) { ind.checked = true; toggleClassMode(); }
  renderClassModuleSelect();
  const t = document.getElementById('cls-form-title');
  if (t) t.textContent = '👤 Nouvel élève';
  const s = document.getElementById('inp-cls-students');
  if (s) { s.scrollIntoView({ behavior:'smooth', block:'center' }); setTimeout(() => s.focus(), 300); }
  toast('Saisis le pseudo de l\'élève puis valide', 'ok');
}

function deleteClass(id) {
  if (!confirm('Supprimer cette classe ? Les élèves n\'y auront plus accès.')) return;
  G.classes = G.classes.filter(c=>c.id!==id);
  saveClasses();
  _sbDeleteClass(id);
  if (_editingClassId === id) cancelEditClass();
  renderClassList();
  window.renderClassesTab?.();
  toast('Classe supprimée');
}

function renderClassList() {
  renderCoachOnboarding();
  const el = document.getElementById('cls-list');
  if (!el) return;
  if (!G.classes.length) { el.innerHTML=''; return; }
  el.innerHTML = G.classes.map(cls => {
    const modNames = (cls.moduleIds || []).map(id => { const d = G.drills.find(x => String(x.id) === String(id)); return d ? d.name : '— supprimé —'; });
    const stuList  = (cls.studentEmails || cls.students || []);
    return `<div style="padding:10px 12px;background:var(--surf2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.88rem">${cls.individual ? '👤' : '🏫'} ${escapeHtml(cls.individual ? cls.name.replace(/^👤\s*/,'') : cls.name)}${cls.individual ? ' <span style="color:var(--dim);font-weight:400;font-size:.7rem">· cours particulier</span>' : ''}</div>
          <div style="font-size:.72rem;color:var(--dim);margin-top:2px">${modNames.length} module${modNames.length>1?'s':''}${cls.individual ? '' : ` · ${stuList.length} élève${stuList.length>1?'s':''}`}</div>
          ${modNames.length ? `<div style="font-size:.7rem;color:var(--cyan);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📦 ${modNames.map(escapeHtml).join(', ')}</div>` : ''}
          ${stuList.length ? `<div style="font-size:.7rem;color:var(--dim);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">👤 ${stuList.slice(0,4).map(escapeHtml).join(', ')}${stuList.length>4?' +'+(stuList.length-4):''}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" onclick="openEditClass(${cls.id})" title="Modifier">✏️</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteClass(${cls.id})" title="Supprimer">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderClassModuleSelect() {
  const el = document.getElementById('inp-cls-modules');
  if (!el) return;
  const prev = [...el.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
  if (!G.drills.length) {
    el.innerHTML = '<div style="padding:8px;font-size:.8rem;color:var(--dim)">Aucun module créé</div>';
    return;
  }
  el.innerHTML = G.drills.map(d =>
    `<label><input type="checkbox" value="${d.id}"${prev.includes(String(d.id))?' checked':''}> ${escapeHtml(d.name)}</label>`
  ).join('');
}


// ══════════════════════════════════════════════════════
// PRÉNOM ÉLÈVE
// ══════════════════════════════════════════════════════
function askName(restrictedStudents) {
  // Avec Firebase : le nom vient du compte, pas d'un prompt
  if (ACCOUNTS_ON && G.currentUser) {
    S.student = G.currentUser.displayName || G.currentUser.email;
    localStorage.setItem('mc_student', S.student);
    updateStudentBar();
    return;
  }
  const students = restrictedStudents || null;
  const field = document.getElementById('student-name-field');
  const label = document.getElementById('student-name-label');
  if (students && students.length) {
    label.textContent = 'Choisis ton nom dans la liste';
    field.innerHTML = `<select id="inp-student-name" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:var(--rs);background:var(--surf);color:var(--text);font-size:.9rem">
      <option value="">— Sélectionne ton nom —</option>
      ${students.map(n=>`<option value="${escapeHtml(n)}"${n===S.student?' selected':''}>${escapeHtml(n)}</option>`).join('')}
    </select>`;
  } else {
    label.textContent = 'Ton prénom';
    field.innerHTML = `<input type="text" id="inp-student-name" placeholder="Ex : Thomas" maxlength="30"
      onkeydown="if(event.key==='Enter') confirmName()"
      value="${escapeHtml(S.student||'')}"
      style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:var(--rs);background:var(--surf);color:var(--text);font-size:.9rem">`;
    setTimeout(()=>document.getElementById('inp-student-name')?.focus(),100);
  }
  S._pendingStudents = students;
  document.getElementById('modal-name').classList.add('on');
}

function confirmName() {
  const name = document.getElementById('inp-student-name').value.trim();
  if (!name) { toast('⚠ Entrez votre prénom','ko'); return; }
  if (S._pendingStudents?.length && !S._pendingStudents.includes(name)) {
    toast('⚠ Ce nom n\'est pas dans la liste autorisée','ko'); return;
  }
  const isFirst    = !S.student;
  const wasPending = !!S._pendingStudents;
  S._pendingStudents = null;
  S.student = name;
  localStorage.setItem('mc_student', name);
  const _accs = JSON.parse(localStorage.getItem('mc_accounts') || '[]');
  if (!_accs.find(a => a.name === name)) {
    _accs.push({name, createdAt: Date.now()});
    localStorage.setItem('mc_accounts', JSON.stringify(_accs));
  }
  closeModal('modal-name');
  updateStudentBar();
  if (isFirst || wasPending) startDrill(S.idx);
}

function updateStudentBar() {
  const bar = document.getElementById('student-bar');
  if (S.student) {
    bar.style.display='flex';
    document.getElementById('student-name-display').textContent = S.student;
    // Avec Firebase, le nom est dans nav-user, pas nav-student
    if (!ACCOUNTS_ON) document.getElementById('nav-student').textContent = '👤 '+S.student;
  } else {
    bar.style.display='none';
    if (!ACCOUNTS_ON) document.getElementById('nav-student').textContent='';
  }
  window.updateReviserToutBadge?.();
}

// ══════════════════════════════════════════════════════
// PAGE DRILL — INIT
// ══════════════════════════════════════════════════════
function initDrillPage() {
  if (!G.drills.length) {
    document.getElementById('no-drill').style.display='block';
    document.getElementById('drill-ui').style.display='none';
    return;
  }
  document.getElementById('no-drill').style.display='none';
  document.getElementById('drill-ui').style.display='block';

  const sel = document.getElementById('drill-sel');
  sel.innerHTML = G.drills.map((d,i)=>`<option value="${i}">${escapeHtml(d.name)}</option>`).join('');
  sel.value = S.idx;

  updateStudentBar();
  if (S._reviewMode) { S._reviewMode = false; return; }
  startDrill(S.idx);
}

function selectDrill(i) { S.idx=i; startDrill(i); }

// ══════════════════════════════════════════════════════
// DÉMARRAGE DRILL (dispatch selon mode)
// ══════════════════════════════════════════════════════
function updateSessionInfo() {
  const total = totalSessions();
  const bar   = document.getElementById('session-bar');
  if (total <= 1) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  const sess = currentSession();
  document.getElementById('session-label').textContent = sess.label;
  document.getElementById('session-prog').textContent  = (S.sessionIdx + 1) + ' / ' + total;
  document.getElementById('session-fill').style.width  = ((S.sessionIdx + 1) / total * 100) + '%';
}

function startDrill(i) {
  const d = G.drills[i];
  if (!d) return;
  document.getElementById('btn-quit-maia').style.display = 'none';   // aucune partie Maia en cours en mode drill
  S.sr = null;   // sortie d'une éventuelle session de révision espacée
  // Avec Firebase : le nom vient du compte
  if (ACCOUNTS_ON && G.currentUser && !S.student) {
    S.student = G.currentUser.displayName || G.currentUser.email;
    localStorage.setItem('mc_student', S.student);
    updateStudentBar();
  }
  // Vérifier liste de pseudos autorisés (mode non-Firebase uniquement)
  if (!ACCOUNTS_ON && d.students?.length && S.student && !d.students.includes(S.student)) {
    S.idx = i;
    askName(d.students);
    return;
  }
  S.idx        = i;
  S.drill      = d;
  S.ok         = 0;
  S.ko         = 0;
  S.sel        = null;
  S.flipped    = (d.side === 'b');
  S.sessionIdx = 0;   // toujours repartir de la session 1
  S.postTheory = false;
  window._setStudyLayout?.(false);   // reset propre (réactivé par startStudyPhase si arbre)

  // Badges info
  document.getElementById('s-name').textContent  = d.name;
  document.getElementById('s-level').textContent = d.level;
  document.getElementById('s-side').textContent  = d.side==='w'?'♔ Blancs':d.side==='b'?'♚ Noirs':'⇄ Les deux';
  document.getElementById('s-mode-badge').textContent = d.mode==='line'?'↗ Ligne':'⊞ Flash';
  document.getElementById('drill-sel').value = i;

  clearFeedback(); clearLog(); updateScores(); drawCoords();
  resizeBoard();

  const sess = currentSession();
  if (d.varmode === 'tree' && d.tree) {
    window.startStudyPhase?.();
  } else if (d.mode==='line' && sess?.moves?.length) {
    document.getElementById('learn-card').style.display='none';
    document.getElementById('notation-card').style.display='none';
    document.getElementById('pos-card').style.display='none';
    document.getElementById('test-btns').style.display='none';
    window.startLearnPhase?.();
  } else {
    document.getElementById('learn-card').style.display='none';
    document.getElementById('notation-card').style.display='none';
    document.getElementById('pos-card').style.display='block';
    document.getElementById('test-btns').style.display='';
    document.getElementById('score-card').style.display='';
    document.getElementById('history-card').style.display='';
    S.phase  = 'test';
    S.posIdx = 0;
    const kps = sess?.kps || d.kps || [];
    S.kps    = kps.map(p=>({...p, attempted:false, correct:false}));
    updateSessionInfo();
    window.renderPosStrip?.();
    window.loadPosition?.(0);
  }
}

function nextSession() {
  S.sessionIdx++;
  S.ok = 0; S.ko = 0;
  updateScores(); clearLog(); clearFeedback();
  const sess = currentSession();
  if (S.drill.mode === 'line' && sess?.moves?.length) {
    window.startLearnPhase?.();
  } else {
    const kps = sess?.kps || [];
    S.kps = kps.map(p=>({...p, attempted:false, correct:false}));
    S.posIdx = 0;
    updateSessionInfo();
    window.renderPosStrip?.();
    window.loadPosition?.(0);
  }
}

// ══════════════════════════════════════════════════════
// MODE POSITIONS CLÉS
// ══════════════════════════════════════════════════════
// Mode positions clés / flash (loadPosition, updatePosInfo, renderPosStrip,
// tryMoveInPositions, endPositionsDrill) → lib/drill.js
// (exposées sur window ; appelées via window.xxx?.() côté app.js et SR)

// ══════════════════════════════════════════════════════
// MODE LIGNE COMPLÈTE
// ══════════════════════════════════════════════════════
// _commentDelay → lib/drill-core.js

// Mode ligne (startLineDrill, advanceLine, tryMoveInLine, skipLinePosition,
// updateLinePosInfo, renderNotation, endLineDrill, togglePauseAdversary)
// → lib/drill.js (exposées sur window, appelées via window.xxx?.() côté app.js)

// Mode arbre/etude + phase apprentissage arbre (startTreeDrill, advanceTree, tryMoveInTree,
// startStudyPhase, studyGoPath, tryStudyGuess, renderStudyTree, _pickOppMove...)
// → lib/drill.js (exposées sur window, appelées via window.xxx?.() côté app.js)

// Phases apprentissage/test (mode ligne) + fin de drill commune :
// startLearnPhase / learnNext / learnPrev / renderLearnState / renderLearnNotation
// renderLearnComment / updateLearnProgress / enterTestPhase / showEndModal / replayErrors
// -> lib/drill.js (exposees sur window ; appelees via window.xxx?.() cote app.js)

function closeModal(id){document.getElementById(id).classList.remove('on');}
function nextDrill(){S.idx=(S.idx+1)%G.drills.length; initDrillPage();}

// ── SM-2 spaced repetition ────────────────────────────
// ── Synchronisation SM-2 multi-appareils (profiles.mastery, Supabase) ──
let _masterySyncTimer = null;
function _scheduleMasterySync() {
  if (!sb || !G.currentUser) return;
  clearTimeout(_masterySyncTimer);
  _masterySyncTimer = setTimeout(_sbSaveMastery, 2500);
}

function sm2Update(student, drillId, posKey, correct) {
  const key = `${student}_${drillId}_${posKey}`;
  G.masteryData[key] = sm2Schedule(G.masteryData[key], correct, Date.now());
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

// ══════════════════════════════════════════════════════
// ÉCHIQUIER
// ══════════════════════════════════════════════════════
let BSIZE=480, SQ=60;
const FILES=['a','b','c','d','e','f','g','h'];
const PIECES={w:{k:'♔',q:'♕',r:'♖',b:'♗',n:'♘',p:'♙'},b:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'}};

// ── Pièces SVG (cburnett — Lichess) ──────────────────
const PIECE_CDN='https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/cburnett/';
const pieceImgs={}; window.pieceImgs=pieceImgs; window.PIECE_CDN=PIECE_CDN;
['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'].forEach(k=>{
  const img=new Image(); img.crossOrigin='anonymous';
  img.onload=()=>{ if(document.getElementById('board')) drawBoard(); };
  img.src=PIECE_CDN+k+'.svg'; pieceImgs[k]=img;
});
function getPieceImg(color,type){
  const img=pieceImgs[color+type.toUpperCase()];
  return img&&img.complete&&img.naturalWidth>0?img:null;
}

function setBoardComment(comment) {
  const el = document.getElementById('board-comment');
  if (!el) return;
  if (comment) {
    el.style.display = 'block';
    el.innerHTML = `<span style="color:var(--cyan);margin-right:5px">💬</span>${escapeHtml(comment)}`;
  } else {
    el.style.display = 'none';
    el.innerHTML = '';
  }
}

function setBoardPrompt(type, msg) {
  // type: '' | 'player' | 'opponent' | 'ok' | 'ko'
  const el = document.getElementById('board-turn-prompt');
  if (!el) return;
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  const styles = {
    player:   'background:rgba(212,167,75,.13);color:var(--cyan);border:1px solid rgba(212,167,75,.28)',
    opponent: 'background:var(--surf2);color:var(--dim);border:1px solid var(--border)',
    ok:       'background:var(--green-dim);color:var(--green);border:1px solid var(--green)',
    ko:       'background:var(--red-dim);color:var(--red);border:1px solid var(--red)',
  };
  el.style.cssText = `display:block;font-size:.78rem;font-weight:700;letter-spacing:.3px;padding:6px 12px;border-radius:7px;text-align:center;${styles[type]||styles.opponent}`;
  el.textContent = msg;
}

function resizeBoard() {
  const wrap = document.getElementById('board-wrap');
  if (!wrap) return;
  if (!wrap.clientWidth) return;   // page masquée → ne pas rétrécir le plateau à son minimum
  const avail = Math.min(
    wrap.clientWidth - 30,
    window.innerHeight * 0.78,
    560
  );
  const newSize = Math.max(320, Math.floor(avail/8)*8);
  if (newSize===BSIZE) return;
  BSIZE=newSize; SQ=BSIZE/8;
  const cvs=document.getElementById('board');
  cvs.width=BSIZE; cvs.height=BSIZE;
  const ghost=document.getElementById('ghost-canvas');
  ghost.width=SQ; ghost.height=SQ;
  drawCoords(); drawBoard();
}

let _resizeTimer;
window.addEventListener('resize', ()=>{
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(resizeBoard, 120);
});

// Touches ← → pour naviguer en phase apprentissage (ligne) ET étude (arbre PGN)
document.addEventListener('keydown', e => {
  if (S.phase !== 'learn' && S.phase !== 'study') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'ArrowRight') { e.preventDefault(); window.learnNext?.(); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); window.learnPrev?.(); }
});

function drawCoords() {
  const ranks = S.flipped?['1','2','3','4','5','6','7','8']:['8','7','6','5','4','3','2','1'];
  const files = S.flipped?[...FILES].reverse():FILES;
  document.getElementById('ranks-col').innerHTML=ranks.map(r=>`<div class="rank-lbl" style="height:${SQ}px;width:18px">${r}</div>`).join('');
  const fr=document.getElementById('files-row');
  fr.style.marginLeft='22px';
  fr.innerHTML=files.map(f=>`<div class="file-lbl" style="width:${SQ}px">${f}</div>`).join('');
}

// ══════════════════════════════════════════════════════
// MOTEUR MAIA — ONNX Runtime Web
// Modèle : maiachess.com/maia3/maia3_simplified.onnx
// ELO interpolé selon le niveau du drill
// ══════════════════════════════════════════════════════
const MAIA_MODEL_URL = 'https://www.maiachess.com/maia3/maia3_simplified.onnx';
const MAIA_MOVES_URL = 'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/main/src/lib/engine/data/all_moves_maia3.json';
const MAIA_ELO = { 'Débutant':900, 'Intermédiaire':1300, 'Avancé':1600, 'Expert':1900, 'Maître':2200, 'Grand-Maître':2500 };

let _maiaSession  = null;
let _maiaUci2Idx  = null;   // "e2e4" → 1234
let _maiaIdx2Uci  = null;   // 1234   → "e2e4"
let _maiaState    = 'idle'; // idle | loading | ready | error
let _maiaThinking = false;

// Charge onnxruntime-web À LA DEMANDE (1re partie vs Maia), pas au démarrage de la page.
// Le <script> n'est plus dans le <head> → l'app démarre sans télécharger le runtime ONNX.
let _ortPromise = null;
function _ensureOrt() {
  if (typeof ort !== 'undefined') return Promise.resolve();
  if (_ortPromise) return _ortPromise;
  _ortPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.wasm.min.js';
    s.onload  = () => resolve();
    s.onerror = () => { _ortPromise = null; reject(new Error('Échec du chargement de onnxruntime-web')); };
    document.head.appendChild(s);
  });
  return _ortPromise;
}

async function loadMaia(onProgress) {
  if (_maiaState === 'ready')   return;
  if (_maiaState === 'loading') return;
  _maiaState = 'loading';
  try {
    // Runtime ONNX chargé à la demande (lazy) — accélère le démarrage de l'app
    onProgress?.('Chargement du runtime…', 2);
    await _ensureOrt();

    // Config WASM
    ort.env.wasm.wasmPaths  = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
    ort.env.wasm.numThreads = 1;

    // Carte des coups UCI ↔ index
    onProgress?.('Chargement des données…', 5);
    const r = await fetch(MAIA_MOVES_URL);
    _maiaUci2Idx = await r.json();
    _maiaIdx2Uci = {};
    for (const [uci, idx] of Object.entries(_maiaUci2Idx)) _maiaIdx2Uci[idx] = uci;

    // Téléchargement du modèle avec progression
    onProgress?.('Téléchargement du moteur Maia…', 10);
    const resp  = await fetch(MAIA_MODEL_URL);
    const total = parseInt(resp.headers.get('content-length') || '45683686');
    const reader = resp.body.getReader();
    let loaded = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress?.(
        `Moteur Maia — ${Math.round(loaded/1e6)} / ${Math.round(total/1e6)} Mo`,
        10 + Math.round(loaded / total * 80)
      );
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }

    onProgress?.('Initialisation…', 93);
    _maiaSession = await ort.InferenceSession.create(buf.buffer, { executionProviders: ['wasm'] });
    _maiaState   = 'ready';
    onProgress?.('✓ Maia prêt', 100);
  } catch(e) {
    _maiaState = 'error';
    console.error('[Maia]', e);
    throw e;
  }
}

// Miroir de FEN (côté noir → perspective blancs)
function _mirrorFen(fen) {
  const [pos, turn, cast, ep, h, f] = fen.split(' ');
  const newPos  = pos.split('/').reverse()
    .map(r => [...r].map(c =>
      c>='a'&&c<='z' ? c.toUpperCase() :
      c>='A'&&c<='Z' ? c.toLowerCase() : c
    ).join('')).join('/');
  const newCast = cast==='-' ? '-' : [...cast].map(c => ({K:'k',Q:'q',k:'K',q:'Q'}[c]||c)).join('');
  const newEp   = ep==='-'   ? '-' : ep[0] + (ep[1]==='3' ? '6' : '3');
  return `${newPos} ${turn==='w'?'b':'w'} ${newCast} ${newEp} ${h} ${f}`;
}

// Miroir d'un coup UCI (rangs 1↔8, 2↔7 …)
function _mirrorUci(uci) {
  const mr = r => String(9 - parseInt(r));
  return uci[0]+mr(uci[1])+uci[2]+mr(uci[3])+(uci[4]||'');
}

// Inférence Maia sur un FEN, renvoie le meilleur coup UCI
async function _getMaiaMove(fen, level) {
  const g       = new Chess(fen);
  const isBlack = g.turn() === 'b';
  const wg      = isBlack ? new Chess(_mirrorFen(fen)) : g;

  // tokens [1, 64, 12] — encodage one-hot position/piece
  const tokens = new Float32Array(64 * 12);
  const CH = { w:{p:0,n:1,b:2,r:3,q:4,k:5}, b:{p:6,n:7,b:8,r:9,q:10,k:11} };
  wg.board().forEach((row, ri) => row.forEach((pc, fi) => {
    if (!pc) return;
    tokens[((7-ri)*8+fi)*12 + CH[pc.color][pc.type]] = 1.0;
  }));

  // masque des coups légaux [4352]
  const mask = new Float32Array(4352);
  wg.moves({ verbose:true }).forEach(m => {
    const idx = _maiaUci2Idx[m.from + m.to + (m.promotion||'')];
    if (idx !== undefined) mask[idx] = 1.0;
  });

  const eloSelf = MAIA_ELO[level] || 1300;
  const feeds = {
    tokens:   new ort.Tensor('float32', tokens, [1, 64, 12]),
    elo_self: new ort.Tensor('float32', new Float32Array([eloSelf]), [1]),
    elo_oppo: new ort.Tensor('float32', new Float32Array([1500]),    [1])
  };

  const out = await _maiaSession.run(feeds);

  // Récupérer les logits de coups (tenseur de dim 4352)
  let logits = null;
  for (const t of Object.values(out)) { if (t.data.length === 4352) { logits = t.data; break; } }
  if (!logits) return null;

  // Meilleur coup légal selon les logits
  let bestIdx = -1, bestScore = -Infinity;
  for (let i = 0; i < 4352; i++) {
    if (mask[i] > 0 && logits[i] > bestScore) { bestScore = logits[i]; bestIdx = i; }
  }
  if (bestIdx < 0) return null;

  const uci = _maiaIdx2Uci[bestIdx];
  return (uci && isBlack) ? _mirrorUci(uci) : uci;
}

async function enginePlay() {
  if (_maiaThinking) return;
  const g = S.lineGame;
  if (!g || g.game_over() || !S.postTheory) return;

  _maiaThinking = true;
  try {
    const uci = await _getMaiaMove(g.fen(), S.drill?.level);
    if (!uci || !S.postTheory) { _maiaThinking = false; return; }

    const mv = g.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4]||'q' });
    if (!mv) { _maiaThinking = false; _checkPTEnd(); return; }

    S.last = { from: uci.slice(0,2), to: uci.slice(2,4) };
    drawBoard();
    _checkPTEnd();
  } catch(e) {
    console.error('[Maia]', e);
    setFeedback('hint', '⚠️ Erreur du moteur Maia.', '');
  }
  _maiaThinking = false;
}

function _checkPTEnd() {
  const g = S.lineGame;
  if (g.game_over()) {
    S.postTheory = false;
    saveGame();
    document.getElementById('test-btns').style.display = 'none';
    document.getElementById('btn-quit-maia').style.display = 'none';
    let msg = '🏁 Partie terminée — enregistrée dans Vue Prof.';
    if (g.in_checkmate()) msg = g.turn()==='w' ? '⚔️ Mat — les Noirs gagnent !' : '🏆 Mat — les Blancs gagnent !';
    else if (g.in_draw() || g.in_stalemate()) msg = '🤝 Partie nulle.';
    setFeedback('hint', msg, '');
    drawBoard(); return;
  }
  setFeedback('hint', '🎯 À vous — partie libre !', '');
}

function _afterMaiaReady() {
  if (!S.postTheory) return;
  if (S.lineGame.turn() !== S.drill.side) {
    setFeedback('hint', '⚙️ Maia réfléchit…', '');
    setTimeout(enginePlay, 400);
  } else {
    setFeedback('hint', '🎯 La théorie est terminée — jouez librement !', '');
  }
}

function startPostTheory() {
  closeModal('modal-end');
  S.postTheory = true; S.sel = null; _maiaThinking = false;
  S._ptStartPly = (S.lineGame && S.lineGame.history) ? S.lineGame.history().length : 0;   // coups déjà joués (théorie) → pour détecter si l'élève joue vraiment
  document.getElementById('test-btns').style.display = 'inline-flex';
  document.getElementById('btn-quit-maia').style.display = '';   // bouton « Arrêter la partie »
  document.getElementById('pos-card').style.display  = 'none';
  drawBoard();

  if (_maiaState === 'ready') {
    _afterMaiaReady();
  } else {
    setFeedback('hint', '⏳ Chargement du moteur Maia (43 Mo)…', '');
    loadMaia((msg, pct) => {
      if (S.postTheory) setFeedback('hint', `⏳ ${msg} (${pct}%)`, '');
    })
    .then(() => { if (S.postTheory) _afterMaiaReady(); })
    .catch(()  => { if (S.postTheory) setFeedback('hint', '⚠️ Moteur indisponible — vérifiez votre connexion.', ''); });
  }
}

// Arrêter une partie contre Maia : on l'enregistre (si l'élève a joué au moins
// un coup depuis la théorie) puis on revient à son espace.
function quitMaiaGame() {
  const played = S.lineGame && S.lineGame.history && S.lineGame.history().length > (S._ptStartPly || 0);
  if (played) saveGame();          // résultat '*' (partie inachevée) — visible dans Vue Prof
  S.postTheory = false;
  _maiaThinking = false;
  document.getElementById('btn-quit-maia').style.display = 'none';
  document.getElementById('test-btns').style.display = 'none';
  toast(played ? '✓ Partie enregistrée dans Vue Prof' : 'Partie quittée', 'ok');
  goPage(G.currentRole === 'teacher' ? 'coach' : 'student-home');
}

// Jouer une partie contre Maia depuis une ouverture (accès direct, 1 clic)
function playVsMaia(idx) {
  const d = G.drills[idx];
  if (!d) return;
  S.student = G.currentUser?.displayName || G.currentUser?.email || S.student || 'Élève';
  S.drill = d; S.idx = idx;
  S.flipped = (d.side === 'b');
  // Jouer la ligne principale jusqu'à la sortie du répertoire
  const g = new Chess(d.sessions?.[0]?.startFen || new Chess().fen());
  if (d.varmode === 'tree' && d.tree) {
    let guard = 0;
    while (guard++ < 300) {
      const node = d.tree[_normFen(g.fen())];
      if (!node) break;
      const mv = isPlayerMove(g.fen(), d.side) ? node.player?.[0] : node.opp?.[0];
      if (!mv || !g.move(mv.san)) break;
    }
  } else {
    (d.sessions?.[0]?.moves || []).forEach(m => { try { g.move(m.san); } catch(e) {} });
  }
  S.lineGame = g;
  document.getElementById('s-name').textContent  = d.name + ' — Partie vs Maia';
  document.getElementById('s-level').textContent = d.level || '';
  document.getElementById('s-side').textContent  = d.side==='w'?'♔ Blancs':d.side==='b'?'♚ Noirs':'⇄ Les deux';
  document.getElementById('s-mode-badge').textContent = '🤖 vs Maia';
  document.getElementById('learn-card').style.display    = 'none';
  document.getElementById('notation-card').style.display = 'none';
  document.getElementById('score-card').style.display    = 'none';
  document.getElementById('history-card').style.display  = 'none';
  S._reviewMode = true;            // empêche initDrillPage de relancer startDrill
  goPage('drill');
  resizeBoard();
  startPostTheory();               // active le mode partie libre + Maia
}

function tryMovePostTheory(from, to, promo) {
  if (_maiaThinking) return;
  const g = S.lineGame;
  if (!g || g.game_over() || g.turn() !== S.drill.side) return;
  if (!promo) {
    const mp=g.get(from);
    if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===to&&m.flags.includes('p'))){
      showPromoPicker(mp.color,_lastMoveXY.x,_lastMoveXY.y,pr=>tryMovePostTheory(from,to,pr));
      return;
    }
    promo='q';
  }
  const move = g.move({ from, to, promotion:promo });
  if (!move) { S.sel=null; drawBoard(); return; }
  S.last = { from, to }; S.sel = null; drawBoard();
  if (g.game_over()) { _checkPTEnd(); return; }
  setFeedback('hint', '⚙️ Maia réfléchit…', '');
  setTimeout(enginePlay, 300);
}

function drawBoard() {
  const cvs=document.getElementById('board');
  const ctx=cvs.getContext('2d');
  ctx.clearRect(0,0,BSIZE,BSIZE);
  const g=currentGame();
  if(!g) return;
  const board=g.board();
  const hist=g.history({verbose:true});
  const last=hist.length?hist[hist.length-1]:null;
  const legal=new Set();
  if(S.sel) g.moves({square:S.sel,verbose:true}).forEach(m=>legal.add(m.to));

  for(let row=0;row<8;row++){
    for(let col=0;col<8;col++){
      const rr=S.flipped?7-row:row, rc=S.flipped?7-col:col;
      const sq=FILES[rc]+(8-rr);
      const light=(row+col)%2===0;
      const bg=light?'#f0d9b5':'#b58863';
      ctx.fillStyle=bg; ctx.fillRect(col*SQ,row*SQ,SQ,SQ);
      if(last&&(sq===last.from||sq===last.to)){
        ctx.fillStyle=light?'rgba(205,210,106,.76)':'rgba(170,162,58,.82)';
        ctx.fillRect(col*SQ,row*SQ,SQ,SQ);
      }
      if(sq===S.sel){
        ctx.fillStyle='rgba(20,100,0,.48)';
        ctx.fillRect(col*SQ,row*SQ,SQ,SQ);
      }
      if(sq===S.hintSquare){
        ctx.fillStyle='rgba(251,191,36,.55)';
        ctx.fillRect(col*SQ,row*SQ,SQ,SQ);
      }

      if(legal.has(sq)){
        const p=g.get(sq);
        if(p){ctx.strokeStyle='rgba(0,0,0,.35)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(col*SQ+SQ/2,row*SQ+SQ/2,SQ/2-3,0,Math.PI*2);ctx.stroke();}
        else{ctx.fillStyle='rgba(0,0,0,.2)';ctx.beginPath();ctx.arc(col*SQ+SQ/2,row*SQ+SQ/2,SQ*.15,0,Math.PI*2);ctx.fill();}
      }
      const piece=board[rr][rc];
      if(piece){
        const img=getPieceImg(piece.color,piece.type);
        if(img){ ctx.drawImage(img,col*SQ,row*SQ,SQ,SQ); }
        else{
          const sym=PIECES[piece.color][piece.type];
          ctx.font=`${SQ*.76}px 'Segoe UI Symbol','Apple Symbols',serif`;
          ctx.textAlign='center';ctx.textBaseline='middle';
          const cx=col*SQ+SQ/2, cy=row*SQ+SQ/2+SQ*.02;
          ctx.fillStyle=piece.color==='w'?'rgba(0,0,0,.4)':'rgba(0,0,0,.5)';
          ctx.fillText(sym,cx+SQ*.027,cy+SQ*.034);
          ctx.fillStyle=piece.color==='w'?'#fefefe':'#131313';
          ctx.fillText(sym,cx,cy);
        }
      }
    }
  }
  // Flèches / cercles du PGN (phase apprentissage) — dual coding
  if (S.phase === 'study' && S.studyNode && S.studyNode.shapes && S.studyNode.shapes.length)
    _drawBoardShapes(ctx, S.studyNode.shapes);
}

// Centre pixel d'une case sur l'échiquier principal (gère le retournement)
function _sqCenter(sq) {
  const fileIdx = FILES.indexOf(sq[0]);
  const rankNum = parseInt(sq[1], 10);
  if (fileIdx < 0 || !rankNum) return null;
  const rr = 8 - rankNum, rc = fileIdx;
  const row = S.flipped ? 7 - rr : rr;
  const col = S.flipped ? 7 - rc : rc;
  return { x: col*SQ + SQ/2, y: row*SQ + SQ/2 };
}

// Dessine les flèches/cercles ([%cal]/[%csl]) sur le canvas principal
function _drawBoardShapes(ctx, shapes) {
  ctx.save();
  shapes.forEach(sh => {
    const col = _SHAPE_COL[sh.color] || _SHAPE_COL.green;
    if (sh.type === 'circle') {
      const p = _sqCenter(sh.square); if (!p) return;
      ctx.globalAlpha = 0.85; ctx.strokeStyle = col; ctx.lineWidth = SQ*0.07;
      ctx.beginPath(); ctx.arc(p.x, p.y, SQ*0.42, 0, Math.PI*2); ctx.stroke();
    } else {
      const a = _sqCenter(sh.from), b = _sqCenter(sh.to); if (!a || !b) return;
      const dx = b.x-a.x, dy = b.y-a.y, len = Math.hypot(dx,dy)||1, ux = dx/len, uy = dy/len, ang = Math.atan2(dy,dx);
      const head = SQ*0.34;
      const tip = { x: b.x-ux*SQ*0.10, y: b.y-uy*SQ*0.10 };
      const lineEnd = { x: tip.x-ux*head*0.85, y: tip.y-uy*head*0.85 };
      const sx = a.x+ux*SQ*0.28, sy = a.y+uy*SQ*0.28;
      ctx.globalAlpha = 0.8; ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = SQ*0.15; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lineEnd.x, lineEnd.y); ctx.stroke();
      const lx = tip.x-head*Math.cos(ang-0.5), ly = tip.y-head*Math.sin(ang-0.5);
      const rx = tip.x-head*Math.cos(ang+0.5), ry = tip.y-head*Math.sin(ang+0.5);
      ctx.beginPath(); ctx.moveTo(tip.x,tip.y); ctx.lineTo(lx,ly); ctx.lineTo(rx,ry); ctx.closePath(); ctx.fill();
    }
  });
  ctx.restore();
}

function sqFromXY(x,y){
  let c=Math.floor(x/SQ),r=Math.floor(y/SQ);
  if(S.flipped){c=7-c;r=7-r;}
  if(c<0||c>7||r<0||r>7) return null;
  return FILES[c]+(8-r);
}
function evXY(e){
  const t=(e.touches&&e.touches.length)?e.touches[0]:e.changedTouches?e.changedTouches[0]:e;
  const rect=document.getElementById('board').getBoundingClientRect();
  return{x:(t.clientX-rect.left)*(BSIZE/rect.width),y:(t.clientY-rect.top)*(BSIZE/rect.height)};
}

// Drag
const DR={active:false,from:null};
let _suppressNextClick=false;
let _reselect=false; // pièce déjà sélectionnée au moment du mousedown
let _lastMoveXY={x:0,y:0};
const ghost=document.getElementById('ghost-canvas');

function drawGhost(piece){
  ghost.width=SQ; ghost.height=SQ;
  const ctx=ghost.getContext('2d');
  ctx.clearRect(0,0,SQ,SQ);
  const img=getPieceImg(piece.color,piece.type);
  if(img){ ctx.globalAlpha=.85; ctx.drawImage(img,0,0,SQ,SQ); ctx.globalAlpha=1; }
  else{
    const sym=PIECES[piece.color][piece.type];
    ctx.font=`${SQ*.82}px 'Segoe UI Symbol','Apple Symbols',serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=piece.color==='w'?'rgba(0,0,0,.4)':'rgba(0,0,0,.5)';ctx.fillText(sym,SQ/2+SQ*.027,SQ/2+SQ*.038);
    ctx.fillStyle=piece.color==='w'?'#fefefe':'#131313';ctx.fillText(sym,SQ/2,SQ/2+SQ*.02);
  }
}
function posGhost(cx,cy){ghost.style.left=(cx-SQ/2)+'px';ghost.style.top=(cy-SQ/2)+'px';}

function canInteract() {
  if (S.phase === 'study') return window._studyGuessReady?.();   // interactif seulement en mode « devine le coup »
  if (S.phase === 'learn') return false;
  const g=currentGame();
  if(!g) return false;
  if(S.postTheory) return S.lineGame && !S.lineGame.game_over() && S.lineGame.turn()===S.drill.side;
  if(S.drill?.varmode === 'tree') return S.waitingForPlayer;
  if(isLineMode()) return S.waitingForPlayer;
  return S.posIdx < S.kps.length;
}

const cvs=document.getElementById('board');
cvs.addEventListener('mousedown',e=>{
  if(!canInteract()) return;
  const{x,y}=evXY(e); const sq=sqFromXY(x,y); if(!sq) return;
  const g=currentGame();
  const p=g.get(sq); if(!p||p.color!==g.turn()) return;
  _reselect=(S.sel===sq);
  DR.active=true; DR.from=sq; S.sel=sq;
  drawGhost(p); ghost.style.display='block'; posGhost(e.clientX,e.clientY); drawBoard();
});
cvs.addEventListener('touchstart',e=>{
  e.preventDefault();
  if(!canInteract()) return;
  const{x,y}=evXY(e); const sq=sqFromXY(x,y); if(!sq) return;
  const g=currentGame();
  const p=g.get(sq); if(!p||p.color!==g.turn()) return;
  _reselect=(S.sel===sq);
  DR.active=true; DR.from=sq; S.sel=sq;
  drawGhost(p); ghost.style.display='block'; posGhost(e.touches[0].clientX,e.touches[0].clientY); drawBoard();
},{passive:false});

document.addEventListener('mousemove',e=>{if(DR.active)posGhost(e.clientX,e.clientY);});
document.addEventListener('touchmove',e=>{if(DR.active){e.preventDefault();posGhost(e.touches[0].clientX,e.touches[0].clientY);}},{passive:false});

document.addEventListener('mouseup',e=>{
  if(!DR.active) return;
  ghost.style.display='none'; DR.active=false;
  const{x,y}=evXY(e); const sq=sqFromXY(x,y);
  const from=DR.from; S.sel=null;
  if(!sq||sq===from){S.sel=_reselect?null:from;_reselect=false;_suppressNextClick=true;drawBoard();return;}
  _reselect=false; _lastMoveXY={x:e.clientX,y:e.clientY}; tryMove(from,sq);
});
document.addEventListener('touchend',e=>{
  if(DR.active){
    ghost.style.display='none'; DR.active=false;
    const{x,y}=evXY(e); const sq=sqFromXY(x,y);
    const from=DR.from; S.sel=null;
    if(!sq||sq===from){S.sel=_reselect?null:from;_reselect=false;drawBoard();return;}
    _reselect=false; _lastMoveXY={x:e.changedTouches[0]?.clientX||0,y:e.changedTouches[0]?.clientY||0}; tryMove(from,sq);
    return;
  }
  // Tap-tap : second tap sur destination
  if(S.sel){
    const{x,y}=evXY(e); const sq=sqFromXY(x,y);
    if(!sq||sq===S.sel) return;
    const g=currentGame();
    const p2=g.get(sq);
    if(p2&&p2.color===g.turn()){S.sel=sq;drawBoard();return;}
    const from=S.sel; S.sel=null;
    _lastMoveXY={x:e.changedTouches[0]?.clientX||0,y:e.changedTouches[0]?.clientY||0};
    tryMove(from,sq);
  }
});

cvs.addEventListener('click',e=>{
  if(_suppressNextClick){_suppressNextClick=false;return;}
  if(!canInteract()) return;
  const{x,y}=evXY(e); const sq=sqFromXY(x,y); if(!sq) return;
  const g=currentGame();
  if(!S.sel){
    const p=g.get(sq);
    if(p&&p.color===g.turn()){S.sel=sq;drawBoard();}
    return;
  }
  if(sq===S.sel){S.sel=null;drawBoard();return;}
  const p2=g.get(sq);
  if(p2&&p2.color===g.turn()){S.sel=sq;drawBoard();return;}
  const from=S.sel; S.sel=null;
  _lastMoveXY={x:e.clientX,y:e.clientY};
  tryMove(from,sq);
});

function tryMove(from, to) {
  if(S.phase==='study') { window.tryStudyGuess?.(from,to); return; }
  if(S.sr && S.sr.active) { window.tryMoveInPositions?.(from,to); return; }   // session SR : toujours le flux « positions » (quel que soit le varmode)
  if(S.postTheory) tryMovePostTheory(from,to);
  else if(S.drill?.varmode==='tree') window.tryMoveInTree?.(from,to);
  else if(isLineMode()) window.tryMoveInLine?.(from,to);
  else window.tryMoveInPositions?.(from,to);
}

function flipBoard(){S.flipped=!S.flipped;drawCoords();drawBoard();}


function _getHintFrom(san,fen){
  const tmp=new Chess(fen);
  const norm=s=>s.replace(/[+#!?]/g,'');
  const found=tmp.moves({verbose:true}).find(m=>norm(m.san)===norm(san));
  return found?found.from:null;
}
function _pieceFr(color,type){
  return {p:'le Pion',n:'le Cavalier',b:'le Fou',r:'la Tour',q:'la Dame',k:'le Roi'}[type]||'la pièce';
}

function showHint(){
  if(isLineMode()){
    const mv=S.lineAllMoves[S.lineMoveIdx];
    if(!mv||!S.waitingForPlayer) return;
    if(!S.lineErrorCounted){
      S.ko++;S.lineErrorCounted=true;mv.result='ko';
      recordResult(false,{san:mv.san,comment:mv.comment,posIdx:Math.ceil((S.lineMoveIdx+1)/2)-1});
      updateScores();
    }
    const from=_getHintFrom(mv.san,S.lineGame.fen());
    S.hintSquare=from;
    const piece=from&&S.lineGame.get(from);
    const pname=piece?_pieceFr(piece.color,piece.type):'la pièce';
    setFeedback('hint','💡 Indice : bougez '+pname+(from?' depuis '+from:''),'');
    drawBoard();
  } else {
    const kp=S.kps[S.posIdx]; if(!kp) return;
    setFeedback('hint','💡 Indice : jouez vers '+kp.san.slice(-2),'');
  }
}

function skipPosition(){
  if(isLineMode()) { window.skipLinePosition?.(); return; }
  const kp=S.kps[S.posIdx]; if(!kp) return;
  if(S.sr && S.sr.active){ window._srAnswer?.(kp, null, false); return; }   // « voir la réponse » = raté
  kp.attempted=true; kp.correct=false;
  setFeedback('ko','→ Le coup était : '+fig(kp.san), S.drill.hideComments ? '' : kp.comment);
  S.ko++; updateScores(); window.renderPosStrip?.();
  recordResult(false,{san:kp.san,comment:kp.comment,posIdx:S.posIdx});
  setTimeout(()=>window.loadPosition?.(S.posIdx+1),1300);
}

// ══════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════
function setFeedback(type,msg,comment){
  const el=document.getElementById('feedback');
  el.className='feedback '+type;
  el.innerHTML=`<div>${escapeHtml(msg)}</div>`;
  if(comment) el.innerHTML+=`<div class="pgn-comment">💬 ${escapeHtml(comment)}</div>`;
  // Reflet sous l'échiquier
  setBoardComment(comment||'');
  if(type==='ok')       setBoardPrompt('ok','✓ '+msg);
  else if(type==='ko')  setBoardPrompt('ko', msg);
  else if(type==='hint'&&msg.startsWith('🎯')) setBoardPrompt('player', msg);
  else if(type==='hint'&&msg.startsWith('⟳')) setBoardPrompt('opponent', msg);
  else                  setBoardPrompt('');
}
function clearFeedback(){
  document.getElementById('feedback').className='feedback';
  setBoardComment('');
  setBoardPrompt('');
}

function updateScores(){
  const done=S.ok+S.ko;
  const pct=done?Math.round(S.ok/done*100):null;
  document.getElementById('sc-ok') .textContent=String(S.ok);
  document.getElementById('sc-ko') .textContent=String(S.ko);
  const pctEl=document.getElementById('sc-pct');
  pctEl.textContent=pct!==null?pct+'%':'—';
  pctEl.style.color=pct===null?'var(--cyan)':pct>=70?'var(--green)':pct>=50?'var(--gold)':'var(--red)';
}
function clearLog(){document.getElementById('hlog').innerHTML='<div style="color:var(--dim);font-size:.77rem">En attente…</div>';}
function addLog(san,ok,num){
  const el=document.getElementById('hlog');
  if(el.querySelector('div[style]')) el.innerHTML='';
  const e=document.createElement('div');
  e.className='hentry '+(ok?'ok':'ko');
  e.innerHTML=`<div class="dot"></div><span style="color:var(--dim)">${num}.</span> <strong>${fig(san)}</strong>`;
  el.appendChild(e); el.scrollTop=el.scrollHeight;
}
let _toastTimer;
function toast(msg,type){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast show '+(type||'');
  clearTimeout(_toastTimer); _toastTimer=setTimeout(()=>t.className='toast',2800);
}

// ══════════════════════════════════════════════════════
// ACCESSIBILITÉ — sémantique + clavier des modales
// ══════════════════════════════════════════════════════
const _A11Y_FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let _a11yLastFocus = null;

function _initA11y() {
  const overlays = Array.from(document.querySelectorAll('.overlay'));

  // 1) Sémantique : chaque modale = un dialog nommé par son titre.
  overlays.forEach(ov => {
    const box = ov.querySelector('.modal') || ov.firstElementChild;
    if (!box) return;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
    const title = box.querySelector('.modal-title');
    if (title) {
      if (!title.id) title.id = 'mt-' + (ov.id || Math.random().toString(36).slice(2));
      box.setAttribute('aria-labelledby', title.id);
    }
  });

  // 2) Focus à l'ouverture, restauration à la fermeture (la classe .on pilote l'affichage).
  const obs = new MutationObserver(muts => {
    muts.forEach(m => {
      const ov = m.target;
      if (!(ov instanceof Element) || !ov.classList.contains('overlay')) return;
      const isOpen  = ov.classList.contains('on');
      const wasOpen = (m.oldValue || '').split(/\s+/).includes('on');
      if (isOpen && !wasOpen) {
        _a11yLastFocus = document.activeElement;
        const box = ov.querySelector('.modal') || ov.firstElementChild;
        const target = (box && (box.querySelector(_A11Y_FOCUSABLE) || box)) || null;
        setTimeout(() => { try { target && target.focus(); } catch(e) {} }, 30);
      } else if (!isOpen && wasOpen && _a11yLastFocus) {
        try { _a11yLastFocus.focus(); } catch(e) {}
        _a11yLastFocus = null;
      }
    });
  });
  overlays.forEach(ov => obs.observe(ov, { attributes: true, attributeFilter: ['class'], attributeOldValue: true }));

  // 3) Échap ferme la modale ouverte ; Tab reste piégé dedans.
  document.addEventListener('keydown', e => {
    const open = document.querySelector('.overlay.on');
    if (!open) return;
    if (e.key === 'Escape') {
      open.classList.remove('on');
    } else if (e.key === 'Tab') {
      const box = open.querySelector('.modal') || open;
      const items = Array.from(box.querySelectorAll(_A11Y_FOCUSABLE)).filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  });
}

// Vue coach / suivi eleves (renderProfView, showStudentDetail, renderHeatmap,
// renderClassesTab, renderPartiesTab, exports CSV/PGN/JSON...) -> lib/coach.js
// (exposees sur window ; appelees via window.xxx?.() cote app.js)
// ── Promotion picker ──────────────────────────────────────
let _promoCallback = null;
function showPromoPicker(color, cx, cy, cb) {
  _promoCallback = cb;
  const pick = document.getElementById('promo-pick');
  const bd   = document.getElementById('promo-backdrop');
  pick.innerHTML = ['q','r','b','n'].map(p => {
    const k=color+p.toUpperCase(), img=pieceImgs[k], sz=54;
    return `<div onclick="pickPromo('${p}')" style="cursor:pointer;width:${sz}px;height:${sz}px;border-radius:6px;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;background:var(--surf2);box-sizing:border-box">`
      +(img?.complete?`<img src="${img.src}" width="${Math.round(sz*.88)}" height="${Math.round(sz*.88)}" draggable="false">`:p.toUpperCase())
      +`</div>`;
  }).join('');
  pick.style.display='flex';
  if(bd) bd.style.display='block';
  const pw=54*4+48, ph=54+20;
  pick.style.left=Math.max(8,Math.min(cx-pw/2,window.innerWidth-pw-8))+'px';
  pick.style.top =Math.max(8,Math.min(cy-ph/2,window.innerHeight-ph-8))+'px';
}
function pickPromo(p) {
  document.getElementById('promo-pick').style.display='none';
  const bd=document.getElementById('promo-backdrop'); if(bd) bd.style.display='none';
  if(_promoCallback){const cb=_promoCallback;_promoCallback=null;cb(p);}
}
function cancelPromo() {
  document.getElementById('promo-pick').style.display='none';
  const bd=document.getElementById('promo-backdrop'); if(bd) bd.style.display='none';
  _promoCallback=null; if(window._E) window._E.sel=null; S.sel=null;
  if(document.getElementById('board')) drawBoard();
  window.renderEditorBoard?.();
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
if (!ACCOUNTS_ON) {
  // Mode local : pas de Firebase, comportement original
  if (!G.drills.length && !localStorage.getItem('mc_demo_seen')) {
    injectDemoDrill();
    setTimeout(() => toast('👋 Bienvenue ! Un module Espagnole de démo a été chargé — cliquez ▶ Jouer pour essayer.', 'ok'), 500);
  }
  renderDrillList();
  renderClassList();
  renderClassModuleSelect();
  updateStudentBar();
  if (!G.drills.length) {
    document.getElementById('no-drill').style.display = 'block';
  } else {
    document.getElementById('no-drill').style.display = 'none';
    goPage('drill');
  }
} else {
  // Mode Firebase : attendre onAuthStateChanged (déjà positionné plus haut)
  goPage('login');
}
setTimeout(resizeBoard, 50);
_initA11y();


// ══════════════════════════════════════════════════════
// COUCHE SUPABASE (fusionnée depuis supabase-data.js)
// ══════════════════════════════════════════════════════

// Normalise un user Supabase vers la forme attendue par l'app (compat Firebase).
function _sbUser(u) {
  if (!u) return null;
  const meta = u.user_metadata || {};
  return { uid: u.id, email: u.email, displayName: meta.name || u.email };
}

// Messages d'erreur auth → français (équivalent de translateFirebaseError).
function _sbAuthError(e) {
  const m = (e && e.message) || '';
  if (/Invalid login/i.test(m))                 return 'Email ou mot de passe incorrect.';
  if (/already registered|already exists/i.test(m)) return 'Cet email est déjà utilisé.';
  if (/Email not confirmed/i.test(m))           return 'Email non confirmé — vérifiez votre boîte mail.';
  if (/at least 6|6 characters/i.test(m))       return 'Mot de passe trop court (6 caractères minimum).';
  if (/rate limit|too many/i.test(m))           return 'Trop de tentatives. Réessayez plus tard.';
  return 'Erreur : ' + m;
}

async function _sbLogin() {
  const email = (document.getElementById('login-email')?.value || '').trim();
  const pwd   =  document.getElementById('login-pwd')?.value   || '';
  if (!email || !pwd) { showLoginError('Remplissez tous les champs.'); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password: pwd });
  if (error) showLoginError(_sbAuthError(error));
  // succès → _sbInitAuth (onAuthStateChange) prend le relais
}

async function _sbRegister() {
  const name  = (document.getElementById('reg-name')?.value  || '').trim();
  const email = (document.getElementById('reg-email')?.value || '').trim();
  const pwd   =  document.getElementById('reg-pwd')?.value   || '';
  const role  =  document.getElementById('reg-role')?.value  || 'student';
  let pseudo  = (document.getElementById('reg-pseudo')?.value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!name || !email || !pwd) { showLoginError('Remplissez tous les champs.'); return; }
  if (pwd.length < 6) { showLoginError('Le mot de passe doit contenir au moins 6 caractères.'); return; }
  if (!pseudo) pseudo = email.split('@')[0].toLowerCase();

  // user_metadata transporte name/role/pseudo (le trigger crée la ligne profiles id+email).
  const { data, error } = await sb.auth.signUp({
    email, password: pwd, options: { data: { name, role, pseudo } }
  });
  if (error) { showLoginError(_sbAuthError(error)); return; }
  // Complète le profil (le trigger n'a posé que id+email).
  if (data.user) {
    await sb.from('profiles').update({ name, role, pseudo }).eq('id', data.user.id);
  }
  // Confirmation email activée ⇒ pas de session immédiate.
  if (!data.session) {
    showLoginError('Compte créé. Confirmez votre email puis connectez-vous.');
  }
}

async function _sbLogout() {
  await sb.auth.signOut();
}

// Envoie l'email de réinitialisation (lien de récupération renvoyant vers l'app).
async function _sbResetPassword(email) {
  if (!email) { showLoginError('Entrez d\'abord votre email ci-dessus.'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) { showLoginError(_sbAuthError(error)); return; }
  toast('📧 Email de réinitialisation envoyé — vérifiez vos mails (et les spams)', 'ok');
}

// Applique le nouveau mot de passe (session de récupération active). Renvoie un message FR ou null.
async function _sbUpdatePassword(pwd) {
  const { error } = await sb.auth.updateUser({ password: pwd });
  return error ? _sbAuthError(error) : null;
}

// Équivalent de fbAuth.onAuthStateChanged : pilote la session + le routage.
function _sbInitAuth() {
  sb.auth.onAuthStateChange(async (event, session) => {
    // Lien de réinitialisation cliqué → formulaire « nouveau mot de passe ».
    if (event === 'PASSWORD_RECOVERY') { showRecoveryForm(); return; }
    const u = session && session.user;
    G.currentUser = _sbUser(u);
    if (!u) { updateNav(); goPage('login'); return; }
    // rôle + pseudo depuis profiles
    try {
      const { data: prof } = await sb.from('profiles').select('role,pseudo').eq('id', u.id).maybeSingle();
      G.currentRole   = (prof && prof.role)   || 'student';
      G.currentPseudo = (prof && prof.pseudo) || null;
    } catch (e) { G.currentRole = 'student'; G.currentPseudo = null; }
    G.pendingRole = null;
    updateNav();
    await _sbLoadMastery();
    if (G.currentRole === 'teacher') { await _sbLoadTeacherModules(); goPage('coach'); }
    else { goPage('student-home'); await _sbLoadStudentModules(); }
  });
}

// ════════════════════════════════════════════════════════════
//  DONNÉES — modules & G.classes (côté enseignant)
//  Étape SUIVANTE : élève (loadStudentModules), résultats, pratique, parties.
// ════════════════════════════════════════════════════════════
async function _sbLoadTeacherModules() {
  if (!sb || !G.currentUser || G.currentRole !== 'teacher') return;
  try {
    const { data: mods, error: e1 } = await sb.from('modules').select('*').eq('teacher_id', G.currentUser.uid);
    if (e1) throw e1;
    G.drills = (mods || []).map(_sbRowToModule).sort((a, b) => (b.id || 0) - (a.id || 0));
    save();
    const { data: cls, error: e2 } = await sb.from('classes').select('*').eq('teacher_id', G.currentUser.uid);
    if (e2) throw e2;
    G.classes = (cls || []).map(_sbRowToClass);
    saveClasses();
    renderDrillList();
    renderClassList();
    renderClassModuleSelect();
    updateStudentBar();
  } catch (e) { console.error('_sbLoadTeacherModules', e); renderDrillList(); }
}

async function _sbSaveModule(drill) {
  if (!sb || !G.currentUser || G.currentRole !== 'teacher') return;
  try {
    const row = _sbModuleToRow(drill);
    row.teacher_id = G.currentUser.uid;   // garantir le propriétaire (RLS)
    const { error } = await sb.from('modules').upsert(row);
    if (error) throw error;
  } catch (e) { console.error('_sbSaveModule', e); }
}

async function _sbDeleteModule(drillId) {
  if (!sb || !G.currentUser || G.currentRole !== 'teacher') return;
  try {
    const { error } = await sb.from('modules').delete().eq('id', drillId);
    if (error) throw error;
  } catch (e) { console.error('_sbDeleteModule', e); }
}

async function _sbSaveClass(cls) {
  if (!sb || !G.currentUser || G.currentRole !== 'teacher') return;
  try {
    const row = _sbClassToRow(cls);
    row.teacher_id = G.currentUser.uid;
    const { error } = await sb.from('classes').upsert(row);
    if (error) throw error;
  } catch (e) { console.error('_sbSaveClass', e); }
}

async function _sbDeleteClass(id) {
  if (!sb || !G.currentUser) return;
  try {
    const { error } = await sb.from('classes').delete().eq('id', id);
    if (error) throw error;
  } catch (e) { console.error('_sbDeleteClass', e); }
}

// ════════════════════════════════════════════════════════════
//  DONNÉES — élève + résultats / pratique / parties + mastery
// ════════════════════════════════════════════════════════════
async function _sbLoadStudentModules() {
  if (!sb || !G.currentUser || G.currentRole !== 'student') return;
  const listEl = document.getElementById('sh-module-list');
  const nameEl = document.getElementById('sh-student-name');
  if (nameEl) nameEl.textContent = G.currentUser.displayName || G.currentUser.email;

  let assigned = [], personal = [];
  try {
    const ids = _myIdentifiers();
    // Toutes les G.classes (RLS : lecture aux connectés) → filtrage client par identifiants.
    const { data: allCls, error: ec } = await sb.from('classes').select('*');
    if (ec) throw ec;
    const myCls = (allCls || []).map(_sbRowToClass)
      .filter(c => (c.students || []).some(s => ids.includes(String(s).toLowerCase())));
    const moduleIds = new Set();
    myCls.forEach(c => (c.moduleIds || []).forEach(id => moduleIds.add(Number(id))));
    if (moduleIds.size) {
      const { data: mods } = await sb.from('modules').select('*').in('id', [...moduleIds]);
      assigned = (mods || []).map(_sbRowToModule);
    }
    // Noms des coachs (affichés si l'élève a plusieurs profs)
    const coachIds = [...new Set(assigned.map(m => m.teacherId).filter(Boolean))];
    const coachNames = {};
    if (coachIds.length) {
      const { data: profs } = await sb.from('profiles').select('id,name,pseudo,email').in('id', coachIds);
      (profs || []).forEach(p => coachNames[p.id] = p.name || p.pseudo || p.email || 'Coach');
    }
    const multiCoach = coachIds.length > 1;
    assigned.forEach(m => { m.coachName = coachNames[m.teacherId] || null; m._showCoach = multiCoach; });
    // Modules perso de l'élève
    const { data: pers } = await sb.from('modules').select('*').eq('owner_student_id', G.currentUser.uid);
    personal = (pers || []).map(_sbRowToModule);
    // Résultats + pratique de l'élève (dashboard multi-appareils)
    const { data: rs } = await sb.from('results').select('*').eq('student_id', G.currentUser.uid);
    G.results = (rs || []).map(_sbRowToResult); localStorage.setItem('mc_results', JSON.stringify(G.results));
    const { data: ps } = await sb.from('practice').select('*').eq('student_id', G.currentUser.uid);
    G.practiceLog = (ps || []).map(_sbRowToPractice); localStorage.setItem('mc_practice', JSON.stringify(G.practiceLog));
  } catch (e) {
    console.error('_sbLoadStudentModules', e);
    if (listEl) listEl.innerHTML = '<div style="color:var(--red);padding:20px;text-align:center;font-size:.85rem">Erreur de chargement. Vérifiez votre connexion.</div>';
    return;
  }
  G.drills = [...assigned, ...personal];
  save();
  renderStudentHome(assigned, personal);
}

async function _sbSaveStudentModule(d) {
  if (!sb || !G.currentUser) return;
  try {
    const row = _sbModuleToRow(d);
    row.owner_student_id = G.currentUser.uid;   // RLS : module perso de l'élève
    const { error } = await sb.from('modules').upsert(row);
    if (error) throw error;
  } catch (e) { console.error('_sbSaveStudentModule', e); }
}

async function _sbDeleteStudentModule(id) {
  if (!sb || !G.currentUser) return;
  try {
    const { error } = await sb.from('modules').delete().eq('id', id);
    if (error) throw error;
  } catch (e) { console.error('_sbDeleteStudentModule', e); }
}

async function _sbRecordResult(rec) {
  if (!sb || !G.currentUser) return;
  try { const { error } = await sb.from('results').insert(_sbResultToRow(rec)); if (error) throw error; }
  catch (e) { console.error('_sbRecordResult', e); }
}

async function _sbRecordPractice(rec) {
  if (!sb || !G.currentUser) return;
  try { const { error } = await sb.from('practice').insert(_sbPracticeToRow(rec)); if (error) throw error; }
  catch (e) { console.error('_sbRecordPractice', e); }
}

async function _sbSaveGame(rec) {
  if (!sb || !G.currentUser) return;
  try { const { error } = await sb.from('games').insert(_sbGameToRow(rec)); if (error) throw error; }
  catch (e) { console.error('_sbSaveGame', e); }
}

// Vue Prof : résultats / pratique / parties portant sur les modules du prof.
async function _sbLoadTeacherResults() {
  if (!sb || !G.currentUser || G.currentRole !== 'teacher') return;
  const ids = G.drills.map(d => String(d.id));
  if (!ids.length) { G.results = []; localStorage.setItem('mc_results', '[]'); return; }
  try {
    const { data } = await sb.from('results').select('*').in('drill_id', ids);
    G.results = (data || []).map(_sbRowToResult);
    localStorage.setItem('mc_results', JSON.stringify(G.results));
  } catch (e) { console.error('_sbLoadTeacherResults', e); }
}

async function _sbLoadTeacherPractice() {
  if (!sb || !G.currentUser || G.currentRole !== 'teacher') return;
  const ids = G.drills.map(d => String(d.id));
  if (!ids.length) { G.practiceLog = []; localStorage.setItem('mc_practice', '[]'); return; }
  try {
    const { data } = await sb.from('practice').select('*').in('drill_id', ids);
    G.practiceLog = (data || []).map(_sbRowToPractice);
    localStorage.setItem('mc_practice', JSON.stringify(G.practiceLog));
  } catch (e) { console.error('_sbLoadTeacherPractice', e); }
}

async function _sbLoadTeacherGames() {
  if (!sb || !G.currentUser || G.currentRole !== 'teacher') return;
  const ids = G.drills.map(d => String(d.id));
  if (!ids.length) { G.savedGames = []; return; }
  try {
    const { data } = await sb.from('games').select('*').in('drill_id', ids);
    G.savedGames = (data || []).map(_sbRowToGame);
  } catch (e) { console.error('_sbLoadTeacherGames', e); }
}

// Progression SM-2 (mastery) — stockée dans profiles.mastery (jsonb).
async function _sbSaveMastery() {
  const student = G.currentUser && (G.currentUser.displayName || G.currentUser.email);
  if (!sb || !G.currentUser || !student) return;
  const prefix = student + '_';
  const mine = {};
  for (const k in G.masteryData) if (k.startsWith(prefix)) mine[k] = G.masteryData[k];
  try { const { error } = await sb.from('profiles').update({ mastery: mine }).eq('id', G.currentUser.uid); if (error) throw error; }
  catch (e) { console.error('_sbSaveMastery', e); }
}

async function _sbLoadMastery() {
  if (!sb || !G.currentUser) return;
  try {
    const { data } = await sb.from('profiles').select('mastery').eq('id', G.currentUser.uid).maybeSingle();
    const m = data && data.mastery;
    if (m) {
      for (const k in m) if (!G.masteryData[k] || (m[k].due || 0) > (G.masteryData[k].due || 0)) G.masteryData[k] = m[k];
      localStorage.setItem('mc_mastery', JSON.stringify(G.masteryData));
    }
  } catch (e) { console.error('_sbLoadMastery', e); }
}


// ══════════════════════════════════════════════════════
// PONT window — expose les fonctions du module aux handlers inline onclick=""
// (genere : toutes les fonctions top-level du module ES)
// ══════════════════════════════════════════════════════
Object.assign(window, {
  _afterMaiaReady, _buildDrillTree, _checkPTEnd, 
  _commentDelay, _commentWithShapes, _computeStreak, 
  _drawBoardShapes, _drillSessions, _ensureOrt, _findNodeByFen, _getHintFrom, _getMaiaMove, _initA11y,
  _markModuleSeen, _markVersionSeen, _materialHint, _mirrorFen, _mirrorUci, _moduleStats,
  _myIdentifiers, _nagGroup, _parseShapes, _pieceFr, _renderRing, _sbAuthError, _sbDeleteClass,
  _sbDeleteModule, _sbDeleteStudentModule, _sbInitAuth, _sbLoadMastery, _sbLoadStudentModules,
  _sbLoadTeacherGames, _sbLoadTeacherModules, _sbLoadTeacherPractice, _sbLoadTeacherResults, _sbLogin,
  _sbLogout, _sbRecordPractice, _sbRecordResult, _sbRegister, _sbResetPassword, _sbSaveClass, _sbSaveGame,
  _sbSaveMastery, _sbSaveModule, _sbSaveStudentModule, _sbUpdatePassword, _sbUser, _scheduleMasterySync,
  _seenKey, _seenModules, _seenVerKey, _seenVersions, _shModuleCard, _shapesToPGN, _sqCenter,
  _syncHeatmapFilters, _syncPartiesFilter, _treePlayerPositions, addFromLibrary, addLog, addStudent, askName, autoFillFromPgn, canInteract, cancelDel, cancelEditClass, cancelPromo, clearFeedback, clearLog,
  closeModal, confirmDel, confirmName, countPlayerMoves, currentGame, currentSession, deleteClass, deleteDrill,
  deleteModuleFromFirestore, deleteStudentDrill, dismissOnboarding, drawBoard, drawCoords, drawGhost,
  editorTreeToPGN, enginePlay, escapeHtml, evXY, 
  fig, flipBoard, getPieceImg, goPage, importDrill,
  importStudentDrill, initDrillPage, injectDemoDrill, isLineMode, isPlayerMove, launchDrill, 
  loadExample, loadMaia, loadPgnFile, loadStudentModules, loadTeacherGames,
  loadTeacherModules, loadTeacherPractice, loadTeacherResults, loginUser, logoutUser, nagGlyphs, nextDrill,
  nextSession, openCreateDrillModal, openEditClass, openLibrary, openStudentImport,
  pgnToEditorTree, pickPromo, playVsMaia, posGhost, previewDrill, quitMaiaGame, recordPracticeSession,
  recordResult, registerUser, renderClassList, renderClassModuleSelect, 
  renderCoachOnboarding, renderDrillList, 
  renderLibrary, 
  renderStudentHome, 
  requestPasswordReset, resizeBoard, save, saveClass, saveClasses, saveGame,
  selectDrill, setBoardComment, setBoardPrompt, setFeedback, shareDrill, 
  showHint, showLoginError, showLoginTab, showPromoPicker, showRecoveryForm, 
  skipPosition, sm2Get, sm2Update, sqFromXY, startDrill,
  startPostTheory, startStudentDrill, submitNewPassword, switchCoachSection, syncModuleToFirestore, toast,
  toggleAdvOpts, toggleClassMode, toggleTheme,
  totalSessions, tryMove, tryMovePostTheory, updateNav, updateScores,
  updateSessionInfo, updateStudentBar, });
