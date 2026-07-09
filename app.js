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
let currentUser = null, currentRole = null, pendingRole = null, currentPseudo = null;

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

  const isTeacher = currentRole === 'teacher';
  const isStudent = currentRole === 'student';

  if (currentUser) {
    // Nom utilisateur
    navUser.textContent   = currentUser.displayName || currentUser.email;
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

// ── Données — modules + classes (enseignant) ──────────
async function loadTeacherModules()          { return _sbLoadTeacherModules(); }
async function syncModuleToFirestore(drill)   { return _sbSaveModule(drill); }
async function deleteModuleFromFirestore(drillId) { return _sbDeleteModule(drillId); }

// ── Identifiants de l'élève pour le matching des classes (pseudo, email, nom) ──
function _myIdentifiers() {
  return [...new Set([
    currentPseudo,
    (currentUser?.email || '').toLowerCase(),
    (currentUser?.displayName || '').toLowerCase()
  ].filter(Boolean))].slice(0, 10);
}

// ── Données — modules de l'élève (assignés + perso) ───
async function loadStudentModules() { return _sbLoadStudentModules(); }

function renderStudentHome(assigned, personal) {
  assigned = assigned || [];
  personal = personal || [];
  const first = currentUser ? (currentUser.displayName || currentUser.email).split(' ')[0] : '';
  if (currentUser) S.student = currentUser.displayName || currentUser.email;
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
  const dueN   = _srSessionSize('all');
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

  renderSrDashboard();   // tableau de bord répétition espacée (P3)

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
  const student = S.student || (currentUser ? (currentUser.displayName || currentUser.email) : '');
  const rs = results.filter(r => String(r.drillId) === String(m.id));
  const total   = rs.length;
  const correct = rs.filter(r => r.correct).length;
  let pct = total ? Math.round(correct / total * 100) : null;
  let due = 0, totalPos = 0, played = false;
  if (m.varmode === 'tree') {
    const positions = _treePlayerPositions(m);
    totalPos = positions.length;
    const did = String(m.id), now = Date.now();
    positions.forEach(p => {
      const mm = masteryData[`${student}_${did}_${p.masteryKey}`];
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
  results.forEach(r => add(r.ts));
  (typeof practiceLog !== 'undefined' ? practiceLog : []).forEach(p => add(p.ts));
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
  const st  = _moduleStats(m);
  const ringCol = st.state === 'mastered' ? 'var(--green)' : st.state === 'review' ? 'var(--gold)' : 'var(--cyan)';
  let chip;
  if (isNew)                      chip = '<span class="sh-chip sh-chip-gold">🔔 Nouveau</span>';
  else if (m._updated)            chip = '<span class="sh-chip sh-chip-cyan">✏️ Mis à jour</span>';
  else if (st.state === 'new')    chip = '<span class="sh-chip sh-chip-cyan">À découvrir</span>';
  else if (st.state === 'mastered') chip = '<span class="sh-chip sh-chip-green">✓ Maîtrisé</span>';
  else                            chip = `<span class="sh-chip sh-chip-gold">↻ À revoir${st.due ? ` · ${st.due}` : ''}</span>`;
  const coachBadge = (!isPersonal && m._showCoach && m.coachName) ? `<span class="sh-mod-side" style="background:var(--cyan-dim);color:var(--cyan)">👤 ${escapeHtml(m.coachName)}</span>` : '';
  const edit = isPersonal ? `<button class="sh-card-act" onclick="event.stopPropagation();openPgnEditor(${idx})" title="Éditer sur échiquier">🎹</button>` : '';
  const del  = isPersonal ? `<button class="sh-card-act" onclick="event.stopPropagation();deleteStudentDrill('${m.id}')" title="Supprimer">🗑</button>` : '';
  return `<div class="sh-mod${isNew ? ' sh-mod-new' : ''}" onclick="startStudentDrill(${idx})">
    ${_renderRing(st.pct, ringCol)}
    <div class="sh-mod-body">
      <div class="sh-mod-name">${escapeHtml(m.name)}</div>
      <div class="sh-mod-chips">${chip}<span class="sh-mod-side">${m.side==='w'?'Blancs':m.side==='b'?'Noirs':'Les deux'}</span>${coachBadge}</div>
    </div>
    ${edit}${del}
    <button class="sh-card-act" onclick="event.stopPropagation();playVsMaia(${idx})" title="Jouer contre Maia">🤖</button>
    <button class="sh-card-act sh-card-play" title="Réviser">▶</button>
  </div>`;
}

// ── Suivi "déjà vu" pour la notification (local par élève) ──
function _seenKey()    { return 'mc_seen_modules_' + (currentUser?.uid || 'anon'); }
function _seenModules(){ try { return JSON.parse(localStorage.getItem(_seenKey()) || '[]'); } catch(e){ return []; } }
function _markModuleSeen(id) {
  const seen = _seenModules();
  if (!seen.includes(String(id))) { seen.push(String(id)); localStorage.setItem(_seenKey(), JSON.stringify(seen)); }
}

// Suivi de la version vue — pour notifier les modules ÉDITÉS par le coach
function _seenVerKey()   { return 'mc_seen_versions_' + (currentUser?.uid || 'anon'); }
function _seenVersions() { try { return JSON.parse(localStorage.getItem(_seenVerKey()) || '{}'); } catch(e){ return {}; } }
function _markVersionSeen(id, ver) {
  const v = _seenVersions();
  v[String(id)] = ver || 0;
  localStorage.setItem(_seenVerKey(), JSON.stringify(v));
}

function startStudentDrill(idx) {
  S.student = currentUser?.displayName || currentUser?.email || 'Élève';
  localStorage.setItem('mc_student', S.student);
  const d = drills[idx];
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
    ownerStudentId: currentUser?.uid || null,
    created: new Date().toLocaleDateString('fr-FR')
  };
  drills.push(d);
  save();
  _sbSaveStudentModule(d);
  closeModal('modal-student-import');
  toast('✓ Révision perso créée', 'ok');
  loadStudentModules();
}

function deleteStudentDrill(id) {
  if (!confirm('Supprimer cette révision perso ?')) return;
  drills = drills.filter(d => String(d.id) !== String(id));
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
let drills      = JSON.parse(localStorage.getItem('mc_drills')    || '[]');
let results     = JSON.parse(localStorage.getItem('mc_results')   || '[]');
let practiceLog = JSON.parse(localStorage.getItem('mc_practice')  || '[]');
let savedGames  = JSON.parse(localStorage.getItem('mc_games')     || '[]');
let masteryData = JSON.parse(localStorage.getItem('mc_mastery')   || '{}');
let oppSeen     = JSON.parse(localStorage.getItem('mc_opp_seen')  || '{}');
let classes     = JSON.parse(localStorage.getItem('mc_classes')   || '[]');

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
// ÉTAT SESSION
// ══════════════════════════════════════════════════════
const S = {
  idx:      0,
  drill:    null,
  // Sessions (plusieurs lignes dans un drill)
  sessionIdx: 0,
  // Mode positions clés
  kps:      [],
  posIdx:   0,
  game:     null,
  // Mode ligne complète
  lineAllMoves:     [],
  lineMoveIdx:      0,
  lineGame:         null,
  waitingForPlayer: false,
  lineErrorCounted: false,
  postTheory: false,   // mode jeu libre après la théorie
  // Phase apprentissage (avant le test)
  phase:    'test',   // 'learn' | 'test'
  learnIdx: 0,        // coup actuel en phase apprentissage
  // Commun
  flipped:  false,
  sel:      null,
  ok:       0,
  ko:       0,
  student:  localStorage.getItem('mc_student') || 'Élève'
};

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
  if (sec==='eleves')  { Promise.all([loadTeacherResults(), loadTeacherPractice(), loadTeacherGames()]).then(()=>renderProfView()); }
  if (sec==='classes') { renderClassesTab(); renderClassModuleSelect(); }
  if (sec==='heatmap') { _syncHeatmapFilters(); renderHeatmap(); }
  if (sec==='parties') { loadTeacherGames().then(()=>{ _syncPartiesFilter(); renderPartiesTab(); }); }
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
  const verb = (currentRole === 'teacher') ? 'Ajouter' : 'Apprendre';
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
  const asStudent = (currentRole !== 'teacher');
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
  if (asStudent) { d.personal = true; d.ownerStudentId = currentUser?.uid || null; }
  drills.push(d);
  save();
  if (currentUser) {
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
  if (btnBack) btnBack.style.display = (ACCOUNTS_ON && currentRole === 'student' && name === 'drill') ? '' : 'none';
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
  drills.push(newDrill);
  S.idx = drills.length - 1;

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

function _drillSessions(d) {
  return d.sessions?.length ? d.sessions : (d.kps?.length ? [{kps:d.kps, startFen:d.startFen}] : []);
}

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

// ══════════════════════════════════════════════════════
// RÉPÉTITION ESPACÉE (SR) — session « comme Chess Tempo »
//   • Nouveaux (jamais vus) vs Révisions (dues) + quota de nouveaux/jour
//   • Coup raté → révélé puis remis plus loin dans la session (étape)
//   • Bilan de fin (révisé, rétention, nouveaux appris, prévision)
// ══════════════════════════════════════════════════════
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
  return scope === 'drill' ? (drills[drillIdx] ? [{ d: drills[drillIdx], i: drillIdx }] : [])
                           : drills.map((d, i) => ({ d, i }));
}

// File d'une session : révisions dues + quota de nouvelles, mélangées.
function _srBuildQueue(scopeList, student) {
  const now = Date.now();
  const reviews = [], news = [];
  scopeList.forEach(({ d, i }) => {
    const did = String(d.id);
    _srPositions(d).forEach(p => {
      const fullKey = `${student}_${did}_${p.masteryKey}`;
      if (_srIsSuspended(fullKey)) return;                  // position suspendue → ignorée
      const rec = masteryData[fullKey];
      const card = { ...p, _drill: d, _drillIdx: i, attempted: false, correct: false };
      if (!rec) news.push(card);
      else if (rec.due <= now) reviews.push(card);
    });
  });
  const shuffle = a => { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
  shuffle(reviews); shuffle(news);
  const cap = Math.max(0, _srNewLimit() - _srNewToday(student));
  const picked = news.slice(0, cap).map(c => ({ ...c, _srNew: true }));
  const combined = reviews.concat(picked);
  const queue = (localStorage.getItem('mc_sr_order') || 'mixed') === 'due' ? combined : shuffle(combined);
  return { queue, revTotal: reviews.length, newTotal: picked.length };
}

// Nombre de cartes qu'une session contiendrait maintenant (compteurs hero/badge).
function _srSessionSize(scope, drillIdx) {
  const student = S.student || (currentUser ? (currentUser.displayName || currentUser.email) : '');
  if (!student) return 0;
  return _srBuildQueue(_srScopeList(scope, drillIdx), student).queue.length;
}

// Lance une session de répétition espacée. scope = 'all' | 'drill'.
function srStart(scope, drillIdx) {
  if (!S.student) { toast('⚠ Identifiez-vous d\'abord', 'ko'); return; }
  const student = S.student;
  const { queue, revTotal, newTotal } = _srBuildQueue(_srScopeList(scope, drillIdx), student);
  if (!queue.length) { toast('✓ Rien à réviser pour le moment !', 'ok'); return; }
  S.sr = { active: true, scope, drillIdx, student, scopeList: _srScopeList(scope, drillIdx),
           graded: new Set(), passed: new Set(),
           newTotal, revTotal, newRemaining: newTotal, revRemaining: revTotal, total: queue.length,
           stats: { reviewed: 0, correct: 0, again: 0, newLearned: 0 } };
  S.drill = queue[0]._drill; S.idx = queue[0]._drillIdx;
  S.ok = 0; S.ko = 0; S.sel = null; S.sessionIdx = 0; S.postTheory = false;
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
  clearFeedback(); clearLog(); updateScores(); drawCoords(); resizeBoard();
  loadPosition(0);
  goPage('drill');
  toast(`↻ ${revTotal} révision${revTotal > 1 ? 's' : ''} · ${newTotal} nouveau${newTotal > 1 ? 'x' : ''}`, 'ok');
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
    + `</div>`;
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
    setTimeout(() => loadPosition(S.posIdx + 1), 850);
  } else {
    const matHint = played ? _materialHint(S.game.fen(), played.san) : '';
    setFeedback('ko', '✗ Le coup était : ' + fig(kp.san) + (matHint ? ' · ' + matHint : '') + '  ↻ revu plus tard', S.drill?.hideComments ? '' : kp.comment);
    addLog((played ? played.san : '?') + ' ✗', false, S.posIdx + 1);
    const insertAt = Math.min(S.posIdx + 3, S.kps.length);   // étape : remis plus loin dans la session
    S.kps.splice(insertAt, 0, { ...kp, attempted: false, correct: false, _requeued: true });
    drawBoard(); _srUpdateBar();
    setTimeout(() => loadPosition(S.posIdx + 1), 1400);
  }
}

// Prévision : nb de positions dues par jour (offsets 1..days) pour le périmètre.
function _srForecast(scopeList, student, days) {
  const counts = new Array(days).fill(0);
  const t0 = new Date(); t0.setHours(0, 0, 0, 0); const startToday = t0.getTime();
  scopeList.forEach(({ d }) => {
    const did = String(d.id);
    _srPositions(d).forEach(p => {
      const rec = masteryData[`${student}_${did}_${p.masteryKey}`];
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
  if (nextBtn) { nextBtn.style.display = ''; nextBtn.className = 'btn btn-gold'; nextBtn.style.color = ''; nextBtn.textContent = '✓ Terminer'; nextBtn.onclick = () => { closeModal('modal-end'); goPage('student-home'); }; }
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
  loadPosition(S.posIdx + 1);
}

// ── Réglages de la révision (P4) ──
function openSrSettings() {
  const ni = document.getElementById('sr-set-newlimit'); if (ni) ni.value = _srNewLimit();
  const or = document.getElementById('sr-set-order'); if (or) or.value = localStorage.getItem('mc_sr_order') || 'mixed';
  const su = document.getElementById('sr-set-suspended');
  if (su) { const n = _srSuspendedCount(); su.innerHTML = n ? `${n} · <a href="#" onclick="event.preventDefault();_srClearSuspended()" style="color:var(--cyan)">réactiver tout</a>` : 'aucune'; }
  document.getElementById('modal-sr-settings').classList.add('on');
}
function _srClearSuspended() { try { localStorage.setItem('mc_sr_suspended', '{}'); } catch (e) {} openSrSettings(); renderSrDashboard(); updateReviserToutBadge(); }
function saveSrSettings() {
  const ni = document.getElementById('sr-set-newlimit'), lim = Math.max(0, Math.min(100, parseInt(ni && ni.value, 10) || 0));
  try { localStorage.setItem('mc_sr_newlimit', String(lim)); } catch (e) {}
  const or = document.getElementById('sr-set-order'); try { localStorage.setItem('mc_sr_order', (or && or.value) || 'mixed'); } catch (e) {}
  closeModal('modal-sr-settings');
  renderSrDashboard(); updateReviserToutBadge();
  toast('✓ Réglages enregistrés', 'ok');
}

// ── Tableau de bord élève : métriques + prévision 14 j (P3) ──
function _srMyResults() {
  const id = S.student, email = currentUser && currentUser.email;
  return results.filter(r => r.student === id || (email && r.studentEmail === email));
}
function renderSrDashboard() {
  const el = document.getElementById('sh-dashboard'); if (!el) return;
  const student = S.student;
  if (!student) { el.innerHTML = ''; return; }
  const recKeys = Object.keys(masteryData).filter(k => k.startsWith(student + '_'));
  const seen = recKeys.length, dueNow = _srSessionSize('all');
  if (!seen && !dueNow) { el.innerHTML = ''; return; }
  const mature = recKeys.filter(k => (masteryData[k].interval || 0) >= 21).length;
  const cutoff = Date.now() - 30 * 86400000;
  const rr = _srMyResults().filter(r => r.ts >= cutoff);
  const retention = rr.length ? Math.round(rr.filter(r => r.correct).length / rr.length * 100) : null;
  const fc = _srForecast(drills.map((d, i) => ({ d, i })), student, 13);
  const series = [dueNow].concat(fc), maxV = Math.max(1, ...series);
  const lbl = i => i === 0 ? 'auj.' : i === 7 ? '+7j' : i === 13 ? '+13j' : '';
  const bars = series.map((c, i) => `<div class="srdash-bar-col" title="${c} due${c > 1 ? 's' : ''}">`
    + `<div class="srdash-bar" style="height:${Math.round(4 + c / maxV * 42)}px;background:${i === 0 ? 'var(--gold)' : 'var(--cyan)'};opacity:${c ? 1 : .25}"></div>`
    + `<span class="srdash-bar-lbl">${lbl(i)}</span></div>`).join('');
  el.innerHTML =
    `<div class="srdash"><div class="srdash-head">`
    + `<span class="srdash-title">↻ Ma répétition espacée</span>`
    + `<button class="btn btn-ghost btn-sm" style="font-size:.72rem" title="Réglages" onclick="openSrSettings()">⚙</button></div>`
    + `<div class="srdash-metrics">`
    + `<div class="srdash-m"><div class="srdash-v" style="color:var(--cyan)">${dueNow}</div><div class="srdash-l">À réviser</div></div>`
    + `<div class="srdash-m"><div class="srdash-v" style="color:var(--green)">${retention != null ? retention + '%' : '—'}</div><div class="srdash-l">Rétention 30j</div></div>`
    + `<div class="srdash-m"><div class="srdash-v" style="color:var(--gold)">${mature}</div><div class="srdash-l">Maîtrisées</div></div>`
    + `<div class="srdash-m"><div class="srdash-v">${seen}</div><div class="srdash-l">Cartes vues</div></div>`
    + `</div>`
    + `<div class="srdash-fc-lbl">Prévision des révisions (14 j)</div>`
    + `<div class="srdash-fc">${bars}</div></div>`;
}

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
  const toDel = drills.find(d=>d.id===id);
  if (toDel && toDel.demo) localStorage.setItem('mc_demo_seen','1');
  drills      = drills.filter(d=>String(d.id)!==String(id));
  results     = results.filter(r=>String(r.drillId)!==String(id));
  practiceLog = practiceLog.filter(l=>String(l.drillId)!==String(id));
  savedGames  = savedGames.filter(g=>String(g.drillId)!==String(id));
  for (const k of Object.keys(masteryData)) {
    if (k.includes(`_${id}_`)) delete masteryData[k];
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
  localStorage.setItem('mc_drills',   JSON.stringify(drills));
  localStorage.setItem('mc_results',  JSON.stringify(results));
  localStorage.setItem('mc_practice', JSON.stringify(practiceLog));
  localStorage.setItem('mc_games',    JSON.stringify(savedGames));
  localStorage.setItem('mc_mastery',  JSON.stringify(masteryData));
  localStorage.setItem('mc_opp_seen', JSON.stringify(oppSeen));
}
function saveClasses() {
  localStorage.setItem('mc_classes', JSON.stringify(classes));
}

function countPlayerMoves(drill) {
  const allSessions = drill.sessions ||
    [{ moves: drill.moves||[], kps: drill.kps||[] }];
  if (drill.mode==='line') {
    return allSessions.reduce((sum, s) =>
      sum + (s.moves||[]).filter(m=>isPlayerMove(m.fenBefore, drill.side)).length, 0);
  }
  return allSessions.reduce((sum, s) => sum + (s.kps||[]).length, 0);
}

// ── Drill de démo : injecté automatiquement au premier lancement ──────────
function injectDemoDrill() {
  const pgn = `1. e4 {Contrôle du centre avec le pion e} e5 2. Nf3 {Développement et attaque sur e5} Nc6 3. Bb5 {L'ouverture espagnole : clouage du cavalier} a6 4. Ba4 {Le fou recule pour maintenir la pression} Nf6 5. O-O {Mise en sécurité du roi — moment clé !} Be7 6. Re1 {La tour soutient le centre} b5 7. Bb3 {Le fou se repositionne sur une diagonale active} d6 8. c3 {Prépare d4 — plan de rupture centrale} O-O 9. h3 {Prévient Bg4 qui épinglerait le cavalier f3} Nb8 10. d4 {La rupture centrale tant préparée !} Nbd7 *`;
  try {
    const allLines = extractAllLines(pgn);
    if (!allLines.length) return;
    const line = allLines[0];
    drills.push({
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
  const nbModules = drills.filter(d => !d.personal && !d.demo).length;
  const nbClasses = (typeof classes !== 'undefined' ? classes : []).length;
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
  const n    = drills.length;

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
  grid.innerHTML = drills.map((d,i) => {
    const ns = d.sessions?.length || 1;
    const count = d.varmode==='tree' ? Object.keys(d.tree||{}).length+' pos.' : countPlayerMoves(d)+(countPlayerMoves(d)===1?' coup':' coups');
    const side  = d.side==='w' ? '♔ Blancs' : d.side==='b' ? '♚ Noirs' : '⇄ Les deux';

    const dueCount = Object.keys(masteryData).filter(k=>k.includes(`_${d.id}_`)&&masteryData[k].due<=now).length;
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
      _deadlinePill(d),
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
// Il ne reste au prof qu'à saisir les élèves puis valider (l'assignation passe par les classes).
function shareDrill(i) {
  const d = drills[i];
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
// (Partage par code retiré — l'assignation se fait uniquement via les classes,
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

  let cls = (_editingClassId != null) ? classes.find(c => c.id === _editingClassId) : null;
  const isEdit = !!cls;
  if (cls) {
    cls.name = name; cls.moduleIds = selectedIds; cls.studentEmails = studentEmails; cls.students = studentEmails; cls.individual = individual;
  } else {
    cls = { id: Date.now(), name, moduleIds: selectedIds, moduleCodes: [], studentEmails, students: studentEmails, individual, created: new Date().toLocaleDateString('fr-FR') };
    classes.push(cls);
  }
  saveClasses();
  await _sbSaveClass(cls);
  cancelEditClass();
  renderClassList();
  renderClassesTab();
  toast('✓ ' + (individual ? 'Cours particulier' : 'Classe') + (isEdit ? ' mis à jour' : ' enregistré'), 'ok');
}

function openEditClass(id) {
  const cls = classes.find(c => c.id === id);
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
  classes = classes.filter(c=>c.id!==id);
  saveClasses();
  _sbDeleteClass(id);
  if (_editingClassId === id) cancelEditClass();
  renderClassList();
  renderClassesTab();
  toast('Classe supprimée');
}

function renderClassList() {
  renderCoachOnboarding();
  const el = document.getElementById('cls-list');
  if (!el) return;
  if (!classes.length) { el.innerHTML=''; return; }
  el.innerHTML = classes.map(cls => {
    const modNames = (cls.moduleIds || []).map(id => { const d = drills.find(x => String(x.id) === String(id)); return d ? d.name : '— supprimé —'; });
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
  if (!drills.length) {
    el.innerHTML = '<div style="padding:8px;font-size:.8rem;color:var(--dim)">Aucun module créé</div>';
    return;
  }
  el.innerHTML = drills.map(d =>
    `<label><input type="checkbox" value="${d.id}"${prev.includes(String(d.id))?' checked':''}> ${escapeHtml(d.name)}</label>`
  ).join('');
}


// ══════════════════════════════════════════════════════
// PRÉNOM ÉLÈVE
// ══════════════════════════════════════════════════════
function askName(restrictedStudents) {
  // Avec Firebase : le nom vient du compte, pas d'un prompt
  if (ACCOUNTS_ON && currentUser) {
    S.student = currentUser.displayName || currentUser.email;
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
  updateReviserToutBadge();
}

// ══════════════════════════════════════════════════════
// PAGE DRILL — INIT
// ══════════════════════════════════════════════════════
function initDrillPage() {
  if (!drills.length) {
    document.getElementById('no-drill').style.display='block';
    document.getElementById('drill-ui').style.display='none';
    return;
  }
  document.getElementById('no-drill').style.display='none';
  document.getElementById('drill-ui').style.display='block';

  const sel = document.getElementById('drill-sel');
  sel.innerHTML = drills.map((d,i)=>`<option value="${i}">${escapeHtml(d.name)}</option>`).join('');
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
  const d = drills[i];
  if (!d) return;
  document.getElementById('btn-quit-maia').style.display = 'none';   // aucune partie Maia en cours en mode drill
  S.sr = null;   // sortie d'une éventuelle session de révision espacée
  // Avec Firebase : le nom vient du compte
  if (ACCOUNTS_ON && currentUser && !S.student) {
    S.student = currentUser.displayName || currentUser.email;
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
  _setStudyLayout(false);   // reset propre (réactivé par startStudyPhase si arbre)

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
    startStudyPhase();
  } else if (d.mode==='line' && sess?.moves?.length) {
    document.getElementById('learn-card').style.display='none';
    document.getElementById('notation-card').style.display='none';
    document.getElementById('pos-card').style.display='none';
    document.getElementById('test-btns').style.display='none';
    startLearnPhase();
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
    renderPosStrip();
    loadPosition(0);
  }
}

function nextSession() {
  S.sessionIdx++;
  S.ok = 0; S.ko = 0;
  updateScores(); clearLog(); clearFeedback();
  const sess = currentSession();
  if (S.drill.mode === 'line' && sess?.moves?.length) {
    startLearnPhase();
  } else {
    const kps = sess?.kps || [];
    S.kps = kps.map(p=>({...p, attempted:false, correct:false}));
    S.posIdx = 0;
    updateSessionInfo();
    renderPosStrip();
    loadPosition(0);
  }
}

// ══════════════════════════════════════════════════════
// MODE POSITIONS CLÉS
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
// MODE LIGNE COMPLÈTE
// ══════════════════════════════════════════════════════
function _commentDelay(c){ return c ? Math.min(5000, Math.max(1500, c.length * 45)) : 180; }

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

function _pickOppMove(nf, moves) {
  const st  = S.student || '';
  const did = String(S.drill?.id ?? '');
  // Forced path: drive opp toward the shallowest unseen branch
  if (S._forcedPath?.[nf]) {
    const forcedSan = S._forcedPath[nf];
    const forced = moves.find(m => m.san === forcedSan);
    if (forced) {
      oppSeen[`${st}__${did}__${nf}__${forced.san}`] = Date.now();
      localStorage.setItem('mc_opp_seen', JSON.stringify(oppSeen));
      return forced;
    }
  }
  // Normal LRU fallback
  const tsOf  = san => oppSeen[`${st}__${did}__${nf}__${san}`] || 0;
  const unseen = moves.filter(m => !tsOf(m.san));
  const chosen = unseen.length
    ? unseen[Math.floor(Math.random() * unseen.length)]
    : [...moves].sort((a, b) => tsOf(a.san) - tsOf(b.san))[0];
  oppSeen[`${st}__${did}__${nf}__${chosen.san}`] = Date.now();
  localStorage.setItem('mc_opp_seen', JSON.stringify(oppSeen));
  return chosen;
}

function _treeUnseenCount() {
  if (S.drill?.varmode !== 'tree') return 0;
  const st  = S.student || '';
  const did = String(S.drill?.id ?? '');
  let n = 0;
  for (const [nf, node] of Object.entries(S.drill.tree || {})) {
    for (const mv of node.opp) {
      if (!oppSeen[`${st}__${did}__${nf}__${mv.san}`]) n++;
    }
  }
  return n;
}

// ── Répétition espacée pour les modules arbre ──────────
// Énumère chaque point de décision du joueur comme une flashcard stable (clé = FEN normalisé).
// _treePlayerPositions → lib/tree.js

// BFS from root to find the path of opp choices that leads to the
// shallowest unseen (or LRU) opp move. Returns {normFen: san} map
// used by _pickOppMove to deterministically steer the opp each session.
function _computeForcedPath(student, drillId, tree, drillSide) {
  if (!tree || !Object.keys(tree).length) return null;
  const initFen = new Chess().fen();
  const startNf = _normFen(initFen);
  let bestTs = Infinity, bestPath = null;
  const q = [{ nf: startNf, g: new Chess(), oppPath: {} }];
  const visited = new Set();
  while (q.length) {
    const { nf, g, oppPath } = q.shift();
    if (visited.has(nf)) continue;
    visited.add(nf);
    const node = tree[nf];
    if (!node) continue;
    const playerTurn = isPlayerMove(g.fen(), drillSide);
    const moves = playerTurn ? (node.player || []) : (node.opp || []);
    if (!playerTurn) {
      for (const mv of moves) {
        const ts = oppSeen[`${student}__${drillId}__${nf}__${mv.san}`] ?? 0;
        if (ts < bestTs) {
          bestTs = ts;
          bestPath = { ...oppPath, [nf]: mv.san };
          if (ts === 0) return bestPath; // unseen found — shortest path wins
        }
      }
    }
    for (const mv of moves) {
      const g2 = new Chess(g.fen());
      if (!g2.move(mv.san)) continue;
      const nf2 = _normFen(g2.fen());
      if (!visited.has(nf2)) {
        q.push({
          nf: nf2,
          g: g2,
          oppPath: playerTurn ? oppPath : { ...oppPath, [nf]: mv.san }
        });
      }
    }
  }
  return bestTs < Infinity ? bestPath : null;
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
// PHASE APPRENTISSAGE — Navigation libre avant le test
// ══════════════════════════════════════════════════════
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
  const student = S.student || currentUser?.displayName || currentUser?.email || 'Anonyme';
  const did = String(S.drill?.id ?? '');
  const m = masteryData[`${student}_${did}_${_normFen(node.fenBefore)}_${node.san}`];
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

function startLearnPhase() {
  const d    = S.drill;
  const sess = currentSession();
  const startFen = sess.startFen || new Chess().fen();
  S.phase    = 'learn';
  S.learnIdx = 0;

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

function renderLearnNotation() {
  const el = document.getElementById('learn-notation');
  if (!el) return;
  if (!S.lineAllMoves.length) { el.innerHTML = '<span style="color:var(--dim)">—</span>'; return; }

  const rows = [];
  let cur = null;
  S.lineAllMoves.forEach((mv, i) => {
    const turn = mv.fenBefore.split(' ')[1];
    const num  = mv.fenBefore.split(' ')[5];
    if (turn === 'w') { cur = { num, white:{mv,i}, black:null }; rows.push(cur); }
    else if (i === 0) { cur = { num: num+'…', white:null, black:{mv,i} }; rows.push(cur); }
    else if (cur) cur.black = {mv,i};
  });

  const cell = (entry) => {
    if (!entry) return '<td style="padding:2px 6px 2px 0"></td>';
    const {mv, i} = entry;
    let style;
    if (i === S.learnIdx - 1) {
      // Coup courant : une seule surbrillance, sobre, sans bordure (pas de saut de hauteur)
      style = 'background:var(--cyan-dim);color:var(--cyan);padding:0 7px;border-radius:5px;font-weight:600;display:inline-block';
    } else if (i < S.learnIdx) {
      // Déjà joués : poids CONSTANT, distinction du camp par la couleur seulement
      style = `color:${mv.isPlayer ? 'var(--text)' : 'var(--text-2)'};font-weight:500`;
    } else {
      // Pas encore atteints : estompés, même poids (plus de gras/non-gras qui saute)
      style = 'color:var(--dim);opacity:.5;font-weight:500';
    }
    return `<td style="padding:2px 6px 2px 0"><span style="${style}">${fig(mv.san)}</span></td>`;
  };

  const activeRowIdx = S.learnIdx > 0 ? rows.findIndex(r =>
    (r.white && r.white.i === S.learnIdx - 1) || (r.black && r.black.i === S.learnIdx - 1)
  ) : -1;

  el.innerHTML = '<table style="border-collapse:collapse;width:100%;font-size:.82rem">' +
    rows.map((r, ri) => `<tr${ri === activeRowIdx ? ' id="learn-notation-active"' : ''}>
      <td style="color:var(--dim);font-size:.7rem;padding:2px 6px 2px 0;white-space:nowrap;min-width:24px;user-select:none">${r.num}.</td>
      ${cell(r.white)}${cell(r.black)}
    </tr>`).join('') + '</table>';

  requestAnimationFrame(() => {
    const a = document.getElementById('learn-notation-active');
    if (a) a.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });
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
  const testBtn = document.querySelector('#learn-card .btn-gold');
  if (testBtn) {
    const done = S.learnIdx >= total;
    testBtn.textContent = done ? '🚀 Commencer le test' : '🎯 Je connais la ligne — Tester';
    testBtn.style.opacity = done ? '1' : '0.75';
    testBtn.style.transform = done ? 'scale(1.02)' : '';
    testBtn.style.boxShadow = done ? '0 0 12px var(--cyan-glow)' : '';
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
  if (pauseBtn) { pauseBtn.style.display = ''; pauseBtn.textContent = S.pauseAdversary ? '▶ Adv.' : '⏸ Auto'; }
  resizeBoard();
  startLineDrill();
}

// ══════════════════════════════════════════════════════
// FIN DE DRILL (commun)
// ══════════════════════════════════════════════════════
function showEndModal(pct) {
  const _et = document.getElementById('end-title'); if (_et) _et.textContent = '🏁 Module terminé !';
  const msg = pct>=85?'🌟 Excellent ! Maîtrise parfaite.':pct>=60?'👍 Bon travail, continuez !':'💪 Persistez, vous progressez !';
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
    <div class="scores-row" style="margin-bottom:14px">
      <div class="score-box"><div class="score-val" style="color:var(--green)">${S.ok}</div><div class="score-lbl">Corrects</div></div>
      <div class="score-box"><div class="score-val" style="color:var(--red)">${S.ko}</div><div class="score-lbl">Erreurs</div></div>
      <div class="score-box"><div class="score-val" style="color:var(--cyan)">${pct}%</div><div class="score-lbl">Réussite</div></div>
    </div>
    <p style="font-size:.84rem;color:var(--dim)">${msg}</p>
    ${errRecap}
    ${showContinue?`<button class="btn" onclick="startPostTheory()" style="margin-top:10px;width:100%;background:var(--cyan);color:#000;font-weight:600">▶ Continuer la partie</button>`:''}`;
  const errBtn = document.getElementById('btn-replay-errors');
  const hasTreeErrors = S.drill?.varmode === 'tree' && S._treeErrors?.length > 0;
  const hasLineErrors = isLineMode() && S.ko > 0;
  if (errBtn) {
    errBtn.style.display = (hasLineErrors || hasTreeErrors) ? '' : 'none';
    if (hasTreeErrors) {
      const n = S._treeErrors.length;
      errBtn.textContent = `🔄 Réviser les erreurs (${n})`;
    } else {
      errBtn.textContent = '↩ Erreurs seules';
    }
  }
  const nextBtn   = document.getElementById('btn-next-drill');
  const replayBtn = document.getElementById('btn-replay');
  if (S.drill?.varmode === 'tree') {
    const unseen = _treeUnseenCount();
    if (replayBtn) {
      replayBtn.textContent = '▶ Poursuivre la révision';
      replayBtn.className   = 'btn btn-blue';
      replayBtn.onclick     = () => { closeModal('modal-end'); startDrill(S.idx); };
    }
    if (nextBtn) {
      if (unseen > 0) {
        nextBtn.textContent = `${unseen} variante${unseen > 1 ? 's' : ''} restante${unseen > 1 ? 's' : ''}`;
        nextBtn.className   = 'btn btn-ghost';
        nextBtn.style.color = 'var(--dim)';
        nextBtn.onclick     = () => { closeModal('modal-end'); startDrill(S.idx); };
      } else {
        nextBtn.textContent = drills.length > 1 ? 'Module suivant →' : '✅ Tout revu';
        nextBtn.className   = drills.length > 1 ? 'btn btn-gold' : 'btn btn-ghost';
        nextBtn.style.color = '';
        nextBtn.onclick     = drills.length > 1 ? () => { closeModal('modal-end'); nextDrill(); } : null;
      }
    }
  } else {
    if (replayBtn) {
      replayBtn.textContent = '↺ Rejouer';
      replayBtn.className   = 'btn btn-ghost';
      replayBtn.onclick     = () => { closeModal('modal-end'); startDrill(S.idx); };
    }
    if (nextBtn) {
      if (drills.length <= 1) {
        nextBtn.textContent = '↺ Rejouer';
        nextBtn.onclick = () => { closeModal('modal-end'); startDrill(S.idx); };
      } else {
        nextBtn.textContent = 'Module suivant →';
        nextBtn.onclick = () => { closeModal('modal-end'); nextDrill(); };
      }
      nextBtn.className   = 'btn btn-gold';
      nextBtn.style.color = '';
    }
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

function closeModal(id){document.getElementById(id).classList.remove('on');}
function nextDrill(){S.idx=(S.idx+1)%drills.length; initDrillPage();}

// ── SM-2 spaced repetition ────────────────────────────
// ── Synchronisation SM-2 multi-appareils (profiles.mastery, Supabase) ──
let _masterySyncTimer = null;
function _scheduleMasterySync() {
  if (!sb || !currentUser) return;
  clearTimeout(_masterySyncTimer);
  _masterySyncTimer = setTimeout(_sbSaveMastery, 2500);
}

function sm2Update(student, drillId, posKey, correct) {
  const key = `${student}_${drillId}_${posKey}`;
  masteryData[key] = sm2Schedule(masteryData[key], correct, Date.now());
  _scheduleMasterySync();
}

function sm2Get(student, drillId, posKey) {
  return masteryData[`${student}_${drillId}_${posKey}`] || null;
}

// ── Enregistrement de session ─────────────────────────
function recordPracticeSession(pct) {
  const rec = {
    drillId:      String(S.drill.id),
    drillName:    S.drill.name,
    student:      S.student || currentUser?.displayName || currentUser?.email || 'Anonyme',
    studentEmail:  currentUser?.email || null,
    studentPseudo: currentPseudo      || null,
    studentId:     currentUser?.uid   || null,
    pct,
    sessionIdx:   S.sessionIdx,
    ts: Date.now()
  };
  practiceLog.push(rec);
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
    student:   S.student || currentUser?.displayName || currentUser?.email || 'Anonyme',
    studentEmail: currentUser?.email || null,
    studentId:    currentUser?.uid   || null,
    level:     S.drill.level,
    side:      S.drill.side,
    pgn,
    result:    res,
    ts:        Date.now()
  };
  savedGames.push(rec);
  save();
  _sbSaveGame(rec);
}

function recordResult(correct, kp) {
  const student = S.student || currentUser?.displayName || currentUser?.email || 'Anonyme';
  const posKey  = kp.masteryKey || (kp.posIdx + '_' + (kp.san||''));
  sm2Update(student, S.drill.id, posKey, correct);
  const rec = {
    drillId:      String(S.drill.id),
    drillName:    S.drill.name,
    student,
    studentEmail:  currentUser?.email  || null,
    studentPseudo: currentPseudo       || null,
    studentId:     currentUser?.uid    || null,
    posIdx:       kp.posIdx,
    san:          kp.san,
    comment:      kp.comment,
    correct,
    ts: Date.now()
  };
  results.push(rec);
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
const pieceImgs={};
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
  if (e.key === 'ArrowRight') { e.preventDefault(); learnNext(); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); learnPrev(); }
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

let _pendingAdversaryMv = null;

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
  goPage(currentRole === 'teacher' ? 'coach' : 'student-home');
}

// Jouer une partie contre Maia depuis une ouverture (accès direct, 1 clic)
function playVsMaia(idx) {
  const d = drills[idx];
  if (!d) return;
  S.student = currentUser?.displayName || currentUser?.email || S.student || 'Élève';
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
  if (S.phase === 'study') return _studyGuessReady();   // interactif seulement en mode « devine le coup »
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
  if(S.phase==='study') { tryStudyGuess(from,to); return; }
  if(S.sr && S.sr.active) { tryMoveInPositions(from,to); return; }   // session SR : toujours le flux « positions » (quel que soit le varmode)
  if(S.postTheory) tryMovePostTheory(from,to);
  else if(S.drill?.varmode==='tree') tryMoveInTree(from,to);
  else if(isLineMode()) tryMoveInLine(from,to);
  else tryMoveInPositions(from,to);
}

function flipBoard(){S.flipped=!S.flipped;drawCoords();drawBoard();}

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
  if(isLineMode()) { skipLinePosition(); return; }
  const kp=S.kps[S.posIdx]; if(!kp) return;
  if(S.sr && S.sr.active){ _srAnswer(kp, null, false); return; }   // « voir la réponse » = raté
  kp.attempted=true; kp.correct=false;
  setFeedback('ko','→ Le coup était : '+fig(kp.san), S.drill.hideComments ? '' : kp.comment);
  S.ko++; updateScores(); renderPosStrip();
  recordResult(false,{san:kp.san,comment:kp.comment,posIdx:S.posIdx});
  setTimeout(()=>loadPosition(S.posIdx+1),1300);
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

// ══════════════════════════════════════════════════════
// VUE PROF — tabbed
// ══════════════════════════════════════════════════════
let selectedStudent=null, selectedDrillFilter='all', _profTab='presence';

function _masteryBadge(name) {
  const now = Date.now();
  const keys = Object.keys(masteryData).filter(k=>k.startsWith(name+'_'));
  if (!keys.length) return '';
  const due = keys.filter(k=>masteryData[k].due<=now).length;
  const learned = keys.filter(k=>masteryData[k].interval>=7).length;
  if (due > 0) return `<span class="mastery-pill low">⚠ ${due} à réviser</span>`;
  if (learned === keys.length) return `<span class="mastery-pill ok">✓ Maîtrisé</span>`;
  return `<span class="mastery-pill mid">${learned}/${keys.length} appris</span>`;
}

function _deadlinePill(drill) {
  if (!drill.deadline) return '';
  const today = new Date().toISOString().slice(0,10);
  const diff  = (new Date(drill.deadline).getTime() - new Date(today).getTime()) / 86400000;
  if (diff < 0)  return `<span class="deadline-pill late">⚠ En retard</span>`;
  if (diff <= 3) return `<span class="deadline-pill soon">⏰ Dans ${Math.round(diff)}j</span>`;
  return `<span class="deadline-pill ok">📅 ${drill.deadline}</span>`;
}

// Points faibles de la classe : positions qui font échouer le plus d'élèves.
function _classWeakSpots(arr) {
  const byPos = {};
  arr.forEach(r => {
    const key = r.drillId + '|' + (r.san || '');
    if (!byPos[key]) byPos[key] = { drillName: r.drillName, san: r.san, comment: r.comment || '', attempts: 0, fails: 0, failStudents: new Set() };
    const p = byPos[key];
    p.attempts++;
    if (!r.correct) { p.fails++; p.failStudents.add(r.student || r.studentName || 'Anonyme'); }
    if (r.comment && !p.comment) p.comment = r.comment;
  });
  return Object.values(byPos)
    .filter(p => p.fails > 0)
    .map(p => ({ ...p, failStudentCount: p.failStudents.size, rate: Math.round(p.fails / p.attempts * 100) }))
    .sort((a, b) => b.failStudentCount - a.failStudentCount || b.rate - a.rate)
    .slice(0, 6);
}

function renderClassWeakSpots(arr) {
  const el = document.getElementById('prof-weakspots');
  if (!el) return;
  const spots = _classWeakSpots(arr || []);
  if (!spots.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="ws-card">
    <div class="ws-head" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <span>🎯 Points faibles de la classe</span>
      <button onclick="switchCoachSection('heatmap')" style="background:none;border:none;color:var(--cyan);font-size:.74rem;font-weight:600;cursor:pointer;padding:0;white-space:nowrap">Analyse complète →</button>
    </div>
    <div class="ws-sub">Aperçu des positions qui font le plus échouer tes élèves — à revoir en cours.</div>
    ${spots.map(s => `<div class="ws-row">
      <span class="ws-move">${fig(s.san)}</span>
      <div class="ws-info">
        <div class="ws-name">${escapeHtml(s.drillName || 'Module')}${s.comment ? ` · <span class="ws-comment">${escapeHtml(s.comment.slice(0,42))}</span>` : ''}</div>
        <div class="ws-bar"><div class="ws-fill" style="width:${s.rate}%"></div></div>
      </div>
      <span class="ws-stat">${s.failStudentCount} élève${s.failStudentCount > 1 ? 's' : ''} · ${s.rate}%</span>
    </div>`).join('')}
  </div>`;
}

// Roster unifié pour la Vue Prof : élèves des classes (pseudo/email) + élèves avec résultats, dédupliqués.
function _buildProfRoster(filtered) {
  const rosterIds = [...new Set(classes.flatMap(c => (c.studentEmails || c.students || [])))];
  const keysOf = r => [(r.studentEmail||'').toLowerCase(), (r.studentPseudo||'').toLowerCase(), (r.student||'').toLowerCase()].filter(Boolean);
  const map = {};
  rosterIds.forEach(id => { map[id] = { key:id, label:id, total:0, correct:0, lastTs:0, played:false }; });
  const attach = (r, isResult) => {
    const keys = keysOf(r);
    let target = rosterIds.find(id => keys.includes(id));
    if (!target) { target = keys[0] || (r.student||'anonyme').toLowerCase(); if (!map[target]) map[target] = { key:target, label:r.student||target, total:0, correct:0, lastTs:0, played:false }; }
    const s = map[target];
    if (r.student) s.label = r.student;
    if ((r.ts||0) > s.lastTs) s.lastTs = r.ts;
    s.played = true;
    if (isResult) { s.total++; if (r.correct) s.correct++; }
  };
  filtered.forEach(r => attach(r, true));
  practiceLog.forEach(l => attach(l, false));
  return Object.values(map).sort((a,b) => b.lastTs - a.lastTs);
}

function renderProfView(){
  selectedDrillFilter = document.getElementById('prof-drill-filter').value;

  // Des élèves inscrits (via classes) suffisent à afficher le panneau, même sans résultat encore.
  const hasStudents = classes.some(c => (c.studentEmails || c.students || []).length);
  const hasAny = results.length || practiceLog.length || savedGames.length || hasStudents;
  document.getElementById('prof-empty').style.display = hasAny ? 'none' : 'block';
  document.getElementById('prof-ui').style.display    = hasAny ? ''     : 'none';
  if (!hasAny) return;

  // Update drill filter options
  const filterEl = document.getElementById('prof-drill-filter');
  const prev = filterEl.value;
  filterEl.innerHTML = '<option value="all">Tous les modules</option>' +
    drills.map(d=>`<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  filterEl.value = prev;

  let filtered = selectedDrillFilter==='all' ? results : results.filter(r=>String(r.drillId)===selectedDrillFilter);

  // KPIs
  const students   = _buildProfRoster(filtered);
  const totalRes   = filtered.length;
  const correct    = filtered.filter(r=>r.correct).length;
  const avgPct     = totalRes ? Math.round(correct/totalRes*100) : 0;
  const sessions   = selectedDrillFilter==='all' ? practiceLog : practiceLog.filter(l=>String(l.drillId)===selectedDrillFilter);
  document.getElementById('prof-kpis').innerHTML=`
    <div class="cs-kpi"><div class="cs-kpi-val" style="color:var(--blue)">${students.length}</div><div class="cs-kpi-lbl">Élèves</div></div>
    <div class="cs-kpi"><div class="cs-kpi-val" style="color:var(--cyan)">${sessions.length}</div><div class="cs-kpi-lbl">Sessions</div></div>
    <div class="cs-kpi"><div class="cs-kpi-val" style="color:${avgPct>=70?'var(--green)':'var(--red)'}">${avgPct}%</div><div class="cs-kpi-lbl">Réussite</div></div>
    <div class="cs-kpi"><div class="cs-kpi-val" style="color:var(--blue)">${savedGames.length}</div><div class="cs-kpi-lbl">Parties Maia</div></div>`;

  // Points faibles de la classe (insight actionnable)
  renderClassWeakSpots(filtered);

  // Update sidebar eleves badge
  const eleveBadge = document.getElementById('csnav-count-eleves');
  if (eleveBadge) eleveBadge.textContent = String(students.length);
  const eleveCount2 = document.getElementById('csnav-count-eleves2');
  if (eleveCount2) eleveCount2.textContent = students.length + ' élève' + (students.length>1?'s':'');

  // Liste élèves : roster complet (depuis les classes) + élèves ayant joué
  const _now = Date.now();
  const _wkAgo = _now - 7 * 86400000;
  const _activeWk = students.filter(s => s.lastTs >= _wkAgo).length;
  const _inactive = students.filter(s => s.played && s.lastTs < _wkAgo).length;
  const _srSummary = students.length ? `<div class="sr-coach-summary"><i class="ti ti-refresh" aria-hidden="true"></i> Révisions — <strong>${_activeWk}</strong> actif${_activeWk>1?'s':''} cette semaine · <strong>${_inactive}</strong> inactif${_inactive>1?'s':''} (&gt;7j) · rétention moyenne ${avgPct}%</div>` : '';
  document.getElementById('student-list').innerHTML = _srSummary + students.map(s => {
    const pct = s.total ? Math.round(s.correct/s.total*100) : 0;
    const since = s.lastTs ? Math.floor((_now-s.lastTs)/86400000) : null;
    const dueCount = Object.keys(masteryData).filter(k => k.startsWith(s.label+'_') && masteryData[k].due<=_now).length;
    const alertCls = dueCount > 0 ? ' alert' : '';
    const dotColor = !s.played ? 'var(--dim)' : since===0 ? 'var(--green)' : since<=7 ? '#d97706' : 'var(--dim)';
    const isOn = s.key===selectedStudent ? ' on' : '';
    return `<div class="eleve-item${isOn}${alertCls}" data-sname="${escapeHtml(s.key)}" onclick="showStudentDetail(this.dataset.sname)">
      <div class="eleve-name">
        <span>${s.played?'👤':'⚪'} ${escapeHtml(s.label)}</span>
        <div style="display:flex;align-items:center;gap:5px">
          <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};display:inline-block;flex-shrink:0"></span>
          ${s.played ? _masteryBadge(s.label) : ''}
        </div>
      </div>
      <div class="eleve-meta">${s.played ? (since===0?'Aujourd\'hui':since+'j')+' · '+pct+'% · '+s.total+' coup'+(s.total>1?'s':'') : 'Pas encore commencé'}</div>
      <div class="eleve-progbar"><div class="eleve-progfill" style="width:${pct}%;background:${pct>=70?'var(--green)':pct>=50?'#facc15':'var(--red)'}"></div></div>
    </div>`;
  }).join('') || '<div style="color:var(--dim);font-size:.82rem;text-align:center;padding:24px">Aucun élève. Clique sur « ➕ Ajouter un élève » en haut.</div>';

  if (selectedStudent) showStudentDetail(selectedStudent);
}

function showStudentDetail(id) {
  selectedStudent = id;
  document.querySelectorAll('.eleve-item').forEach(el =>
    el.classList.toggle('on', el.dataset.sname === id)
  );

  const idLower = (id||'').toLowerCase();
  let sr = results.filter(r =>
    [(r.studentEmail||'').toLowerCase(), (r.studentPseudo||'').toLowerCase(), (r.student||'').toLowerCase()].includes(idLower)
    || (r.student||r.studentName) === id
  );
  const name = (sr[0] && sr[0].student) || id;   // nom affichable (sinon l'identifiant)
  if (selectedDrillFilter !== 'all') sr = sr.filter(r => String(r.drillId) === selectedDrillFilter);

  const byDrill = {};
  sr.forEach(r => {
    if (!byDrill[r.drillName]) byDrill[r.drillName] = { id: r.drillId, positions: {} };
    const key = r.posIdx + '_' + (r.san||'');
    if (!byDrill[r.drillName].positions[key])
      byDrill[r.drillName].positions[key] = { posIdx: r.posIdx, san: r.san, comment: r.comment, attempts: [], correct: false };
    byDrill[r.drillName].positions[key].attempts.push(r);
    if (r.correct) byDrill[r.drillName].positions[key].correct = true;
  });

  const total = sr.length, correctN = sr.filter(r => r.correct).length;
  const pct = total ? Math.round(correctN / total * 100) : 0;
  const lastDate = total ? new Date(Math.max(...sr.map(r => r.ts))).toLocaleDateString('fr-FR') : '—';
  const sessCount = practiceLog.filter(l => l.student === name).length;
  const drillCount = Object.keys(byDrill).length;

  // ── Header ──
  let html = `<div class="eleve-detail-header">
    <div style="font-size:1.05rem;font-weight:700">👤 ${escapeHtml(name)}</div>
    <div style="font-size:.73rem;color:var(--dim);margin-top:3px">Dernière activité : ${lastDate} · ${sessCount} session${sessCount>1?'s':''}</div>
  </div>
  <div class="eleve-detail-body">`;

  if (!sr.length) {
    html += '<div style="padding:20px;color:var(--dim);font-size:.83rem">Cet élève n\'a pas encore commencé.</div></div>';
    document.getElementById('prof-detail').innerHTML = html; return;
  }

  // ── KPI row ──
  html += `<div class="ed-kpi-row">
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:${pct>=70?'var(--green)':'var(--red)'}">${pct}%</div><div class="ed-kpi-l">Réussite</div></div>
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:var(--cyan)">${sessCount}</div><div class="ed-kpi-l">Sessions</div></div>
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:var(--blue)">${drillCount}</div><div class="ed-kpi-l">Modules</div></div>
  </div>`;

  // ── Onglets ──
  html += `<div class="ed-tabs">
    <button class="ed-tab on" onclick="_edTab(this,'resume')">📊 Résumé</button>
    <button class="ed-tab" onclick="_edTab(this,'positions')">📖 Positions</button>
    <button class="ed-tab" onclick="_edTab(this,'progression')">📈 Progression</button>
  </div>`;

  // ══ TAB 1 : Résumé ══
  const now = Date.now();
  let resumeHtml = '';
  for (const [drillName, ddata] of Object.entries(byDrill)) {
    const posArr = Object.values(ddata.positions).sort((a,b) => a.posIdx - b.posIdx);
    const dc = posArr.filter(p => p.correct).length;
    const dp = posArr.length ? Math.round(dc / posArr.length * 100) : 0;
    const drillSessions = practiceLog
      .filter(l => l.student === name && String(l.drillId) === String(ddata.id))
      .sort((a,b) => a.ts - b.ts).slice(-12);
    const n = drillSessions.length;
    let trendHtml = '';
    if (n >= 2) {
      const halfA = drillSessions.slice(0, Math.ceil(n/2)).reduce((s,l) => s+l.pct, 0) / Math.ceil(n/2);
      const halfB = drillSessions.slice(Math.ceil(n/2)).reduce((s,l) => s+l.pct, 0) / Math.max(1, n - Math.ceil(n/2));
      const diff = Math.round(halfB - halfA);
      trendHtml = diff > 5
        ? `<span style="color:var(--green);font-size:.67rem;flex-shrink:0">📈 +${diff}%</span>`
        : diff < -5
          ? `<span style="color:var(--red);font-size:.67rem;flex-shrink:0">📉 ${diff}%</span>`
          : `<span style="color:var(--dim);font-size:.67rem;flex-shrink:0">→ stable</span>`;
    }
    const bars = drillSessions.map(s => {
      const h = Math.max(4, Math.round(s.pct * 0.24));
      const col = s.pct>=70?'var(--green)':s.pct>=50?'#facc15':'var(--red)';
      const dt = new Date(s.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
      return `<div class="ed-mini-bar" title="${dt} — ${s.pct}%" style="height:${h}px;background:${col};opacity:.85"></div>`;
    }).join('');
    const drill = drills.find(d => d.id === ddata.id);
    resumeHtml += `<div class="ed-mod-row">
      <div class="ed-mod-name" title="${escapeHtml(drillName)}">${escapeHtml(drillName)}</div>
      <div class="ed-mini-bars">${bars}</div>
      <span class="badge ${dp>=70?'badge-green':'badge-red'}" style="flex-shrink:0">${dp}%</span>
      ${trendHtml}
      ${drill ? _deadlinePill(drill) : ''}
    </div>`;
  }

  // Top erreurs dans le résumé
  const errMap = {};
  sr.forEach(r => {
    const key = `${r.drillId}_${r.posIdx}_${r.san||''}`;
    if (!errMap[key]) errMap[key] = { drillName: r.drillName, san: r.san, fails: 0, attempts: 0 };
    errMap[key].attempts++;
    if (!r.correct) errMap[key].fails++;
  });
  const topErrors = Object.values(errMap).filter(e => e.fails > 0)
    .sort((a,b) => b.fails - a.fails || b.fails/b.attempts - a.fails/a.attempts).slice(0, 5);
  if (topErrors.length) {
    resumeHtml += `<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px">
      <div style="font-size:.72rem;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📉 Positions difficiles</div>
      <table class="pos-table" style="font-size:.78rem"><thead><tr><th>Module</th><th>Coup</th><th>Échecs</th><th>Taux</th></tr></thead><tbody>`;
    topErrors.forEach(e => {
      const rate = Math.round(e.fails / e.attempts * 100);
      const rc = rate>=60?'var(--red)':rate>=30?'#facc15':'var(--green)';
      resumeHtml += `<tr>
        <td style="color:var(--dim);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(e.drillName)}">${escapeHtml(e.drillName)}</td>
        <td><span style="font-family:'JetBrains Mono',monospace;font-weight:700">${escapeHtml(e.san||'?')}</span></td>
        <td style="color:var(--red);font-weight:700">${e.fails}×</td>
        <td style="color:${rc};font-weight:700">${rate}%</td>
      </tr>`;
    });
    resumeHtml += '</tbody></table></div>';
  }
  html += `<div class="ed-tab-body" id="edt-resume">${resumeHtml}</div>`;

  // ══ TAB 2 : Positions ══
  let posHtml = '';
  for (const [drillName, ddata] of Object.entries(byDrill)) {
    const posArr = Object.entries(ddata.positions)
      .sort((a,b) => a[1].posIdx - b[1].posIdx)
      .map(([key,p]) => ({ ...p, key, sm2: sm2Get(name, ddata.id, key) }));
    const dc = posArr.filter(p => p.correct).length;
    const dp = posArr.length ? Math.round(dc / posArr.length * 100) : 0;
    const drill = drills.find(d => d.id === ddata.id);
    posHtml += `<div style="margin-bottom:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
        <div style="font-weight:700;font-size:.88rem">📖 ${escapeHtml(drillName)}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${dp>=70?'badge-green':'badge-red'}">${dp}%</span>
          ${drill ? _deadlinePill(drill) : ''}
        </div>
      </div>
      <table class="pos-table">
        <thead><tr><th>#</th><th>Coup</th><th>Résultat</th><th>SM-2</th></tr></thead>
        <tbody>${posArr.map(p => {
          const nW = p.attempts.filter(a => !a.correct).length;
          const due = p.sm2 ? (p.sm2.due<=now ? '<span class="mastery-pill low">due</span>' : `<span class="mastery-pill ok">+${Math.ceil((p.sm2.due-now)/86400000)}j</span>`) : '<span style="color:var(--dim)">—</span>';
          return `<tr>
            <td style="color:var(--dim)">${p.posIdx+1}</td>
            <td><span style="font-family:'JetBrains Mono',monospace;font-weight:700">${escapeHtml(p.san||'')}</span></td>
            <td>${p.correct ? `<span class="ok-pill">✓${nW>0?' ('+nW+'x)':''}</span>` : `<span class="error-pill">✗ (${p.attempts.length})</span>`}</td>
            <td>${due}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }
  html += `<div class="ed-tab-body" id="edt-positions" style="display:none">${posHtml}</div>`;

  // ══ TAB 3 : Progression ══
  html += `<div class="ed-tab-body" id="edt-progression" style="display:none">${_buildProgressionHTML(name)}</div>`;

  html += '</div>'; // close eleve-detail-body
  document.getElementById('prof-detail').innerHTML = html;
}

function _edTab(btn, tab) {
  const detail = document.getElementById('prof-detail');
  detail.querySelectorAll('.ed-tab-body').forEach(b => b.style.display = 'none');
  detail.querySelectorAll('.ed-tab').forEach(b => b.classList.remove('on'));
  const body = detail.querySelector('#edt-' + tab);
  if (body) body.style.display = '';
  btn.classList.add('on');
}

function _buildProgressionHTML(name) {
  const log = practiceLog.filter(l=>l.student===name &&
    (selectedDrillFilter==='all'||String(l.drillId)===selectedDrillFilter)
  ).sort((a,b)=>a.ts-b.ts);

  const errMap = {};
  results.filter(r=>(r.student||r.studentName)===name &&
    (selectedDrillFilter==='all'||String(r.drillId)===selectedDrillFilter)
  ).forEach(r=>{
    const key = `${r.drillId}_${r.posIdx}_${r.san||''}`;
    if (!errMap[key]) errMap[key]={drillName:r.drillName,drillId:r.drillId,posIdx:r.posIdx,san:r.san,fails:0,attempts:0,lastFailTs:0};
    errMap[key].attempts++;
    if (!r.correct){ errMap[key].fails++; if(r.ts>errMap[key].lastFailTs) errMap[key].lastFailTs=r.ts; }
  });
  const topErrors = Object.values(errMap).filter(e=>e.fails>0)
    .sort((a,b)=>b.fails-a.fails||b.fails/b.attempts-a.fails/a.attempts).slice(0,10);

  if (!log.length && !topErrors.length) return '';

  let html = `<div style="border-top:1px solid var(--border);margin-top:22px;padding-top:18px">`;

  if (log.length) {
    const byDrill = {};
    log.forEach(l=>{ if(!byDrill[l.drillName]) byDrill[l.drillName]=[]; byDrill[l.drillName].push(l); });
    html += `<div style="font-weight:700;font-size:.88rem;margin-bottom:12px">📈 Progression</div>`;
    for (const [drillName, sessions] of Object.entries(byDrill)) {
      const maxPct = Math.max(...sessions.map(s=>s.pct));
      const minPct = Math.min(...sessions.map(s=>s.pct));
      const n = sessions.length;
      const halfA = sessions.slice(0,Math.ceil(n/2)).reduce((a,s)=>a+s.pct,0)/Math.ceil(n/2);
      const halfB = sessions.slice(Math.ceil(n/2)).reduce((a,s)=>a+s.pct,0)/Math.max(1,n-Math.ceil(n/2));
      const trend = n<2 ? '' : halfB-halfA>5 ? '📈 +'+Math.round(halfB-halfA)+'%' : halfA-halfB>5 ? '📉 '+Math.round(halfB-halfA)+'%' : '→ stable';
      html += `<div style="background:var(--surf2);border-radius:var(--rs);padding:12px 14px;margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:.82rem;font-weight:600">📖 ${escapeHtml(drillName)}</div>
          <div style="display:flex;gap:6px;align-items:center">
            ${trend ? `<span style="font-size:.7rem;color:var(--dim)">${trend}</span>` : ''}
            <span class="badge ${maxPct>=70?'badge-green':'badge-red'}">max ${maxPct}%</span>
          </div>
        </div>
        <div style="position:relative;height:64px">
          <div style="position:absolute;inset:0;display:flex;align-items:flex-end;gap:2px">
            ${sessions.map(s=>{
              const h=Math.max(3,Math.round(s.pct*0.64));
              const col=s.pct>=70?'var(--green)':s.pct>=50?'#facc15':'var(--red)';
              const dt=new Date(s.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
              return `<div title="${dt} — ${s.pct}%" style="flex:1;min-width:5px;height:${h}px;background:${col};border-radius:2px 2px 0 0;opacity:.85"></div>`;
            }).join('')}
          </div>
          <div style="position:absolute;left:0;right:0;top:${Math.round(64-70*0.64)}px;border-top:1px dashed rgba(5,150,105,.4);pointer-events:none"></div>
        </div>
        <div style="font-size:.62rem;color:var(--dim);margin-top:5px">${n} session${n>1?'s':''} · min ${minPct}% · max ${maxPct}%</div>
      </div>`;
    }
  }

  if (topErrors.length) {
    const now = Date.now();
    html += `<div style="font-weight:700;font-size:.88rem;margin:${log.length?'16px 0':'0 0'} 10px">📉 Positions difficiles</div>`;
    html += `<table class="pos-table" style="font-size:.78rem"><thead><tr><th>Module</th><th>Coup</th><th>Échecs</th><th>Taux</th></tr></thead><tbody>`;
    topErrors.forEach(e=>{
      const rate = Math.round(e.fails/e.attempts*100);
      const rateCol = rate>=60?'var(--red)':rate>=30?'#facc15':'var(--green)';
      html += `<tr>
        <td style="color:var(--dim);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(e.drillName)}">${escapeHtml(e.drillName)}</td>
        <td><span style="font-family:'JetBrains Mono',monospace;font-weight:700">${escapeHtml(e.san||'?')}</span></td>
        <td style="color:var(--red);font-weight:700">${e.fails}×</td>
        <td style="color:${rateCol};font-weight:700">${rate}%</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  return html + '</div>';
}

// ══════════════════════════════════════════════════════
// HEATMAP DES ERREURS
// ══════════════════════════════════════════════════════
function renderHeatmap() {
  const el = document.getElementById('prof-heatmap-content');
  const drillId = (document.getElementById('hm-drill-filter') || document.getElementById('prof-drill-filter'))?.value || 'all';

  let filtered = drillId === 'all' ? results : results.filter(r=>String(r.drillId)===drillId);

  if (!filtered.length) {
    el.innerHTML = '<div class="empty" style="padding:40px"><div class="empty-ico">🔥</div>Sélectionnez un module pour voir la heatmap des erreurs</div>';
    return;
  }

  // Grouper par position (drillName + posIdx + san)
  const byPos = {};
  filtered.forEach(r => {
    const key = `${r.drillId||r.drillName}_${r.posIdx}_${r.san}`;
    if (!byPos[key]) byPos[key] = { drillName:r.drillName, posIdx:r.posIdx, san:r.san||'—', comment:r.comment||'', attempts:0, correct:0, students:new Set() };
    byPos[key].attempts++;
    if (r.correct) byPos[key].correct++;
    byPos[key].students.add(r.student);
  });

  const entries = Object.values(byPos)
    .filter(p=>p.attempts>0)
    .sort((a,b)=>(a.correct/a.attempts)-(b.correct/b.attempts));

  const totalPos = entries.length;
  const hotCount = entries.filter(p=>p.correct/p.attempts<0.5).length;

  const grid = entries.map(p => {
    const rate = Math.round(p.correct/p.attempts*100);
    const bg = rate>=75?'var(--green-dim)':rate>=50?'rgba(250,204,21,.12)':rate>=25?'rgba(251,146,60,.12)':'var(--red-dim)';
    const col = rate>=75?'var(--green)':rate>=50?'#ca8a04':rate>=25?'#ea580c':'var(--red)';
    const stuList = [...p.students].join(', ');
    return `<div style="background:${bg};border:1px solid ${col};border-radius:var(--r);padding:14px 16px;cursor:default"
        title="${escapeHtml(stuList)}">
      <div style="font-size:1.3rem;font-weight:800;color:${col};line-height:1;margin-bottom:6px">${rate}%</div>
      <div style="font-size:.92rem;font-weight:700;font-family:'JetBrains Mono',monospace;margin-bottom:4px">${escapeHtml(p.san)}</div>
      <div style="font-size:.72rem;color:var(--dim)">${p.correct}/${p.attempts} correct${p.students.size>1?' · '+p.students.size+' élèves':''}</div>
      ${p.comment?`<div style="font-size:.7rem;color:var(--text-2);margin-top:5px;line-height:1.4;font-style:italic">${escapeHtml(p.comment.slice(0,60))}${p.comment.length>60?'…':''}</div>`:''}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div class="kpi"><div class="kpi-val" style="color:var(--cyan)">${totalPos}</div><div class="kpi-lbl">Positions</div></div>
      <div class="kpi"><div class="kpi-val" style="color:var(--red)">${hotCount}</div><div class="kpi-lbl">Points chauds</div></div>
      <div class="kpi"><div class="kpi-val" style="color:var(--green)">${totalPos-hotCount}</div><div class="kpi-lbl">Bien maîtrisées</div></div>
    </div>
    <div style="font-size:.75rem;color:var(--dim);margin-bottom:12px">🔥 Positions triées par taux d'erreur — les plus difficiles en premier. Survolez pour voir les élèves concernés.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">${grid}</div>`;
}

// ══════════════════════════════════════════════════════
// ONGLET CLASSES
// ══════════════════════════════════════════════════════
function renderClassesTab() {
  const el = document.getElementById('prof-classes-content');
  if (!el) return;
  if (!classes.length) {
    el.innerHTML = '<div class="empty" style="padding:40px;border:1px dashed var(--border);border-radius:var(--r)"><div class="empty-ico">🏫</div>Aucune classe.<br>Créez-en une à gauche pour suivre vos élèves.</div>';
    return;
  }
  const now = Date.now();
  el.innerHTML = classes.map(cls => {
    const modIds = (cls.moduleIds || []).map(String);
    const roster = (cls.studentEmails || cls.students || []);
    const clsResults = results.filter(r => modIds.includes(String(r.drillId)));
    let activeCount = 0;
    const rows = roster.length ? roster.map(email => {
      const sr = clsResults.filter(r => [(r.studentEmail||'').toLowerCase(), (r.studentPseudo||'').toLowerCase(), (r.student||'').toLowerCase()].includes(email));
      const played = sr.length > 0;
      if (played) activeCount++;
      const pct = played ? Math.round(sr.filter(r => r.correct).length / sr.length * 100) : 0;
      const lastTs = played ? Math.max(...sr.map(r => r.ts || 0)) : 0;
      const since = lastTs ? Math.floor((now - lastTs) / 86400000) : null;
      const status = !played
        ? '<span style="color:var(--dim);font-size:.78rem">Pas encore commencé</span>'
        : `<span style="font-weight:700;color:${pct>=70?'var(--green)':pct>=50?'var(--gold)':'var(--red)'}">${pct}%</span> <span style="color:var(--dim);font-size:.72rem">· ${since===0?'auj.':since+'j'}</span>`;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);gap:8px">
        <span style="font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${played?'🟢':'⚪'} ${escapeHtml(email)}</span>
        <span style="flex-shrink:0">${status}</span>
      </div>`;
    }).join('') : '<div style="color:var(--dim);font-size:.8rem;padding:8px 0">Aucun élève dans cette classe.</div>';
    return `<div class="card" style="margin-bottom:14px">
      <div style="font-size:1rem;font-weight:700">🏫 ${escapeHtml(cls.name)}</div>
      <div style="font-size:.73rem;color:var(--dim);margin:2px 0 12px">${activeCount}/${roster.length} actif${activeCount>1?'s':''} · ${modIds.length} module${modIds.length>1?'s':''}</div>
      ${rows}
    </div>`;
  }).join('');
}

function renderPartiesTab() {
  const el = document.getElementById('prof-parties-content');
  const partiesFilter = (document.getElementById('parties-drill-filter') || document.getElementById('prof-drill-filter'))?.value || 'all';
  const games = partiesFilter==='all' ? savedGames
    : savedGames.filter(g=>String(g.drillId)===partiesFilter);
  if (!games.length) {
    el.innerHTML='<div class="empty" style="padding:40px"><div class="empty-ico">♟</div>Aucune partie enregistrée</div>'; return;
  }
  const sorted = [...games].sort((a,b)=>b.ts-a.ts);
  el.innerHTML = sorted.map((g,i)=>{
    const resClass = g.result==='1-0'?(g.side==='w'?'win':'loss'):g.result==='0-1'?(g.side==='b'?'win':'loss'):'draw';
    const dt = new Date(g.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});
    const side = g.side==='w'?'♔ Blancs':g.side==='b'?'♚ Noirs':'⇄';
    return `<div class="game-row" onclick="togglePGN(${i})">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="game-result ${resClass}">${g.result}</span>
          <div>
            <div style="font-weight:600;font-size:.85rem">👤 ${escapeHtml(g.student)} — ${escapeHtml(g.drillName)}</div>
            <div style="font-size:.72rem;color:var(--dim)">${side} · ${g.level} · ${dt}</div>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();exportPGN(${i})">⬇ PGN</button>
      </div>
      <div id="pgn-view-${i}" style="display:none;margin-top:10px;padding:10px;background:var(--bg);border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:.7rem;line-height:1.7;color:var(--dim);white-space:pre-wrap;word-break:break-all">${escapeHtml(g.pgn)}</div>
    </div>`;
  }).join('');
}

function togglePGN(i) {
  const el = document.getElementById(`pgn-view-${i}`);
  if (el) el.style.display = el.style.display==='none' ? 'block' : 'none';
}

// ── Exports ───────────────────────────────────────────
function _download(filename, content, mime='text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type:mime}));
  a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function exportCSV() {
  const header = 'étudiant,drill,position,coup,correct,horodatage\n';
  const rows   = results.map(r=>
    [r.student,r.drillName,r.posIdx+1,r.san||'',r.correct?'1':'0',new Date(r.ts).toISOString()].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  _download('results.csv', header+rows, 'text/csv');
}

function exportPracticeCSV() {
  const header = 'étudiant,drill,session,score%,horodatage\n';
  const rows   = practiceLog.map(l=>
    [l.student,l.drillName,l.sessionIdx+1,l.pct,new Date(l.ts).toISOString()].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  _download('sessions.csv', header+rows, 'text/csv');
}

function exportPGN(idx) {
  const sorted = [...savedGames].sort((a,b)=>b.ts-a.ts);
  const games  = idx===null ? sorted : [sorted[idx]].filter(Boolean);
  if (!games.length) { toast('Aucune partie à exporter','ko'); return; }
  const out = games.map(g=>`[Event "${g.drillName}"]\n[White "${g.side==='w'?g.student:'Maia'}"]\n[Black "${g.side==='b'?g.student:'Maia'}"]\n[Result "${g.result}"]\n[Date "${new Date(g.ts).toISOString().slice(0,10)}"]\n\n${g.pgn}\n`).join('\n\n');
  _download(idx===null?'parties.pgn':`partie_${idx+1}.pgn`, out);
}

function exportAll() {
  const data = { drills, results, practiceLog, savedGames, masteryData, exportedAt: new Date().toISOString() };
  _download('backup.json', JSON.stringify(data,null,2), 'application/json');
}

// ══════════════════════════════════════════════════════
// ÉDITEUR DE VARIANTES
// ══════════════════════════════════════════════════════
const EP = { wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙', bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟' };
const _E = { drillIdx:-1, root:null, path:[], node:null, startFen:'', flipped:false, sel:null, lastFrom:null, lastTo:null };
let _eSQ = 48;

function _findNodeByFen(node, fen) {
  if (node.fenAfter === fen) return node;
  for (const child of node.children) {
    const found = _findNodeByFen(child, fen);
    if (found) return found;
  }
  return null;
}

// Reconstruit l'arbre éditeur depuis un PGN (préserve toutes les variantes, y compris courtes)
function pgnToEditorTree(pgn, startFen) {
  const root = { san:null, fenBefore:null, fenAfter:startFen, comment:'', children:[] };
  const text = pgn.replace(/\[[A-Za-z]\w*\s+"[^"]*"\]/g, '');   // retire les en-têtes PGN, garde [%cal]/[%csl] dans les commentaires
  const re = /\{([^}]*)\}|\(|\)|([^\s(){}]+)/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) {
      const ps = _parseShapes(m[1]);
      if (ps.text || ps.shapes.length) tokens.push({type:'comment', text:ps.text, shapes:ps.shapes});
    } else if (m[0]==='(') tokens.push({type:'open'});
    else if (m[0]===')') tokens.push({type:'close'});
    else tokens.push({type:'move', text:m[2]});
  }
  function parse(toks, node) {
    const g = new Chess(node.fenAfter);
    let cur = node, i = 0;
    while (i < toks.length) {
      const tok = toks[i];
      if (tok.type === 'open') {
        let d=1, vt=[];
        i++;
        while (i < toks.length && d > 0) {
          if (toks[i].type==='open') d++;
          if (toks[i].type==='close') { d--; if (d===0) break; }
          vt.push(toks[i]); i++;
        }
        // La variante est une alternative au dernier coup joué → brancher depuis son parent
        if (cur.parent) parse(vt, cur.parent);
        i++; continue;
      }
      if (tok.type === 'close') { i++; continue; }
      if (tok.type === 'comment') {
        if (cur !== node) {
          if (tok.text && !cur.comment) cur.comment = tok.text;
          if (tok.shapes && tok.shapes.length) cur.shapes = (cur.shapes||[]).concat(tok.shapes);
        }
        i++; continue;
      }
      const t = tok.text;
      if (/^\$\d+$/.test(t)) { if (cur !== node) { cur.nags = cur.nags || []; const _n=+t.slice(1); if(!cur.nags.includes(_n)) cur.nags.push(_n); } i++; continue; }
      if (/^\d+\.+$/.test(t)||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) { i++; continue; }
      const fenBefore = g.fen();
      const san = normalizeSAN(t, g);
      const r = g.move(san);
      if (!r) { i++; continue; }
      let ch = cur.children.find(c => c.san===r.san && c.fenBefore===fenBefore);
      if (!ch) {
        ch = {san:r.san, fenBefore, fenAfter:g.fen(), comment:'', children:[], parent:cur};
        cur.children.push(ch);
      }
      cur = ch; i++;
    }
  }
  parse(tokens, root);
  return root;
}

function openPgnEditor(i) {
  const d = drills[i];
  _E.drillIdx = i;
  _E.startFen = d.sessions?.[0]?.startFen || new Chess().fen();
  _E.flipped  = (d.side === 'b');
  _E.sel = _E.lastFrom = _E.lastTo = null;
  // Préférer d.pgn (contient toutes les variantes) aux sessions filtrées par varmode
  if (d.pgn) {
    try { _E.root = pgnToEditorTree(d.pgn, _E.startFen); }
    catch(e) { _E.root = null; }
  }
  if (!_E.root) {
    // Fallback : reconstruire depuis les sessions
    _E.root = { san:null, fenBefore:null, fenAfter:_E.startFen, comment:'', children:[] };
    (d.sessions||[]).forEach(sess => {
      let node = _E.root;
      if (sess.startFen && sess.startFen !== _E.startFen) {
        const par = _findNodeByFen(_E.root, sess.startFen);
        if (par) node = par;
      }
      (sess.moves||[]).forEach(mv => {
        let ch = node.children.find(c => c.san===mv.san && c.fenBefore===mv.fenBefore);
        if (!ch) {
          const g2 = new Chess(mv.fenBefore); const r = g2.move(mv.san);
          ch = { san:mv.san, fenBefore:mv.fenBefore, fenAfter:r?g2.fen():mv.fenBefore, comment:mv.comment||'', children:[] };
          node.children.push(ch);
        }
        node = ch;
      });
    });
  }
  _E.path = []; _E.node = _E.root;
  _E.createRole = null;
  document.getElementById('editor-drill-name').value = d.name;
  document.getElementById('editor-side').value = d.side || 'w';
  document.getElementById('editor-side').style.display = 'none';   // côté déjà défini → inutile en édition
  document.getElementById('editor-level').value = d.level || 'Intermédiaire';
  document.getElementById('editor-comment').value = '';
  document.getElementById('modal-pgn-editor').classList.add('on');
  _eResize(); renderEditorBoard(); renderEditorNotation(); renderEditorNagBar(); _ensureEditorArrowHandlers();
}

// Créer un module à partir d'un échiquier vide (role: 'teacher' | 'student')
function openPgnEditorNew(role) {
  _E.drillIdx   = -1;
  _E.createRole = role;
  _E.startFen   = new Chess().fen();
  _E.flipped    = false;
  _E.sel = _E.lastFrom = _E.lastTo = null;
  _E.root = { san:null, fenBefore:null, fenAfter:_E.startFen, comment:'', children:[] };
  _E.path = []; _E.node = _E.root;
  document.getElementById('editor-drill-name').value = '';
  document.getElementById('editor-side').value = 'w';
  document.getElementById('editor-side').style.display = '';        // création : on choisit le camp
  document.getElementById('editor-level').value = 'Intermédiaire';
  document.getElementById('editor-comment').value = '';
  document.getElementById('modal-pgn-editor').classList.add('on');
  _eResize(); renderEditorBoard(); renderEditorNotation(); renderEditorNagBar(); _ensureEditorArrowHandlers();
}

function closeEditorModal() { document.getElementById('modal-pgn-editor').classList.remove('on'); }

function _eResize() {
  const vw = window.innerWidth;
  _eSQ = vw < 500 ? 34 : vw < 750 ? 42 : 48;
  const g = document.getElementById('editor-board-grid');
  if (g) g.style.gridTemplateColumns = `repeat(8,${_eSQ}px)`;
}

let _eDragSq = null;

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
  _promoCallback=null; _E.sel=null; S.sel=null;
  if(document.getElementById('board')) drawBoard();
  renderEditorBoard();
}

// ── Logique click éditeur (partagée click souris + tap tactile) ──
function editorClickSqLogic(sq, ex, ey) {
  const g=new Chess(_E.node.fenAfter);
  if(_E.sel){
    if(_E.sel===sq){_E.sel=null;renderEditorBoard();return;}
    const from=_E.sel, mp=g.get(from);
    if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===sq&&m.flags.includes('p'))){
      const fen=_E.node.fenAfter;
      showPromoPicker(mp.color,ex,ey,pr=>{
        const g2=new Chess(fen),mv2=g2.move({from,to:sq,promotion:pr});
        if(mv2){_E.lastFrom=from;_E.lastTo=sq;_E.sel=null;editorApplyMove(mv2,g2.fen());}
        else{_E.sel=null;renderEditorBoard();}
      });
      return;
    }
    const mv=g.move({from,to:sq,promotion:'q'});
    if(mv){_E.lastFrom=from;_E.lastTo=sq;_E.sel=null;editorApplyMove(mv,g.fen());return;}
    const p=g.get(sq);
    _E.sel=(p&&p.color===g.turn())?sq:null;
    renderEditorBoard(); return;
  }
  const p=g.get(sq);
  if(p&&p.color===g.turn()){_E.sel=sq;renderEditorBoard();}
}

// ── Flèches & cases colorées (annotations PGN [%cal]/[%csl]) ──
let _eArrowFrom = null, _eArrowColor = null, _eArrowHandlers = false;
const _SHAPE_COL = { green:'#15803d', red:'#b91c1c', yellow:'#ca8a04', blue:'#1d4ed8' };

function _parseShapes(raw) {
  const COL = { G:'green', R:'red', Y:'yellow', B:'blue' };
  const shapes = [];
  let s = raw;
  s = s.replace(/\[%cal\s+([^\]]+)\]/gi, (mm, list) => {
    list.split(',').forEach(tk => { tk = tk.trim(); const c = COL[(tk[0]||'').toUpperCase()] || 'green'; const f = tk.slice(1,3), t = tk.slice(3,5); if (f.length===2 && t.length===2) shapes.push({type:'arrow', from:f, to:t, color:c}); });
    return '';
  });
  s = s.replace(/\[%csl\s+([^\]]+)\]/gi, (mm, list) => {
    list.split(',').forEach(tk => { tk = tk.trim(); const c = COL[(tk[0]||'').toUpperCase()] || 'green'; const sq = tk.slice(1,3); if (sq.length===2) shapes.push({type:'circle', square:sq, color:c}); });
    return '';
  });
  s = s.replace(/\[%[^\]]*\]/g, '');   // autres annotations (%evp, %clk…) ignorées
  return { text: s.replace(/\s+/g,' ').trim(), shapes };
}

function _editorShapesSVG(files, ranks) {
  const shapes = (_E.node && _E.node.shapes) || [];
  if (!shapes.length) return '';
  const S = _eSQ, N = 8*S;
  const ctr = sq => { const c = files.indexOf(sq[0]), r = ranks.indexOf(sq[1]); return (c<0||r<0) ? null : { x:(c+0.5)*S, y:(r+0.5)*S }; };
  let body = '';
  shapes.forEach(sh => {
    const col = _SHAPE_COL[sh.color] || _SHAPE_COL.green;
    if (sh.type === 'circle') {
      const p = ctr(sh.square); if (!p) return;
      body += `<circle cx="${p.x}" cy="${p.y}" r="${S*0.42}" fill="none" stroke="${col}" stroke-width="${S*0.07}" opacity="0.85"/>`;
    } else {
      const a = ctr(sh.from), b = ctr(sh.to); if (!a || !b) return;
      const dx = b.x-a.x, dy = b.y-a.y, len = Math.hypot(dx,dy)||1, ux = dx/len, uy = dy/len, ang = Math.atan2(dy,dx);
      const head = S*0.34;
      const tip = { x:b.x-ux*S*0.10, y:b.y-uy*S*0.10 };
      const lineEnd = { x:tip.x-ux*head*0.85, y:tip.y-uy*head*0.85 };
      const sx = a.x+ux*S*0.28, sy = a.y+uy*S*0.28;
      const lx = tip.x-head*Math.cos(ang-0.5), ly = tip.y-head*Math.sin(ang-0.5);
      const rx = tip.x-head*Math.cos(ang+0.5), ry = tip.y-head*Math.sin(ang+0.5);
      body += `<line x1="${sx}" y1="${sy}" x2="${lineEnd.x}" y2="${lineEnd.y}" stroke="${col}" stroke-width="${S*0.15}" stroke-linecap="round" opacity="0.8"/>`;
      body += `<polygon points="${tip.x},${tip.y} ${lx},${ly} ${rx},${ry}" fill="${col}" opacity="0.8"/>`;
    }
  });
  return `<svg width="${N}" height="${N}" viewBox="0 0 ${N} ${N}" style="position:absolute;left:0;top:0;pointer-events:none;z-index:5">${body}</svg>`;
}

function _ensureEditorArrowHandlers() {
  if (_eArrowHandlers) return;
  const grid = document.getElementById('editor-board-grid'); if (!grid) return;
  grid.addEventListener('mousedown', e => {
    if (e.button !== 0) return;                            // bouton gauche uniquement
    if (!(e.ctrlKey || e.shiftKey || e.altKey)) return;    // sans touche = jouer un coup
    const c = e.target.closest('[data-sq]'); if (!c) return;
    _eArrowFrom  = c.dataset.sq;
    _eArrowColor = e.ctrlKey ? 'green' : e.shiftKey ? 'red' : 'yellow';
    e.preventDefault();                                    // empêche sélection / glisser de pièce
  });
  grid.addEventListener('mouseup', e => {
    if (!_eArrowFrom) return;
    const c = e.target.closest('[data-sq]');
    if (c) editorToggleShape(_eArrowFrom, c.dataset.sq, _eArrowColor);
    _eArrowFrom = null; _eArrowColor = null;
  });
  window.addEventListener('mouseup', () => { _eArrowFrom = null; _eArrowColor = null; });
  _eArrowHandlers = true;
}

function editorToggleShape(from, to, color) {
  if (!_E.node || !_E.node.san) { toast('Place-toi sur un coup pour annoter', 'ko'); return; }
  color = color || 'green';
  const arr = _E.node.shapes = _E.node.shapes || [];
  if (from === to) {
    const i = arr.findIndex(s => s.type==='circle' && s.square===from);
    if (i>=0) { if (arr[i].color===color) arr.splice(i,1); else arr[i].color=color; } else arr.push({type:'circle', square:from, color});
  } else {
    const i = arr.findIndex(s => s.type==='arrow' && s.from===from && s.to===to);
    if (i>=0) { if (arr[i].color===color) arr.splice(i,1); else arr[i].color=color; } else arr.push({type:'arrow', from, to, color});
  }
  renderEditorBoard();
}
function editorClearShapes() { if (_E.node) { _E.node.shapes = []; renderEditorBoard(); } }

function _shapesToPGN(node) {
  if (!node.shapes || !node.shapes.length) return '';
  const INV = { green:'G', red:'R', yellow:'Y', blue:'B' };
  const a = node.shapes.filter(s=>s.type==='arrow').map(s => (INV[s.color]||'G')+s.from+s.to);
  const c = node.shapes.filter(s=>s.type==='circle').map(s => (INV[s.color]||'G')+s.square);
  let o = ''; if (a.length) o += '[%cal '+a.join(',')+']'; if (c.length) o += '[%csl '+c.join(',')+']';
  return o;
}
function _commentWithShapes(node) {
  const sh = _shapesToPGN(node), cm = node.comment || '';
  return sh ? (sh + (cm ? ' ' + cm : '')) : cm;
}

function renderEditorBoard() {
  const grid = document.getElementById('editor-board-grid'); if (!grid) return;
  const g = new Chess(_E.node.fenAfter);
  const files = _E.flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = _E.flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
  const turn = g.turn();
  const legal = new Set();
  if (_E.sel) g.moves({square:_E.sel,verbose:true}).forEach(m=>legal.add(m.to));
  let html = '';
  ranks.forEach((rank, ri) => {
    files.forEach((file, fi) => {
      const sq = file+rank, isLight = (fi+ri)%2===0, piece = g.get(sq);
      let bg = isLight ? '#f0d9b5' : '#b58863';
      if (sq===_E.sel) bg='#f6f669';
      else if (sq===_E.lastFrom||sq===_E.lastTo) bg=isLight?'#cdd26e':'#aaa23a';
      const pk = piece ? (piece.color+piece.type.toUpperCase()) : null;
      const canDrag = pk && piece.color===turn;
      const pcHtml = pk ? `<img src="${PIECE_CDN}${pk}.svg" width="${Math.round(_eSQ*.9)}" height="${Math.round(_eSQ*.9)}" draggable="false" style="pointer-events:none;display:block">` : '';
      const drag = canDrag ? `draggable="true" ondragstart="editorDragStart(event,'${sq}')"` : '';
      let dotHtml='';
      if(legal.has(sq)){
        dotHtml=piece
          ?`<div style="position:absolute;inset:0;border-radius:50%;border:3px solid rgba(0,0,0,.28);pointer-events:none"></div>`
          :`<div style="position:absolute;width:${Math.round(_eSQ*.32)}px;height:${Math.round(_eSQ*.32)}px;border-radius:50%;background:rgba(0,0,0,.19);top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none"></div>`;
      }
      html += `<div data-sq="${sq}" ${drag} onclick="editorClickSq(event,'${sq}')" ontouchstart="editorTouchStart(event,'${sq}')" ondragover="event.preventDefault()" ondrop="editorDrop(event,'${sq}')" ondragend="editorDragEnd()" style="position:relative;width:${_eSQ}px;height:${_eSQ}px;background:${bg};display:flex;align-items:center;justify-content:center;cursor:${canDrag?'grab':'default'};user-select:none;box-sizing:border-box">${pcHtml}${dotHtml}</div>`;
    });
  });
  grid.style.position = 'relative';
  grid.innerHTML = html + _editorShapesSVG(files, ranks);
  const re=document.getElementById('editor-ranks');
  if(re) re.innerHTML=ranks.map(r=>`<div style="height:${_eSQ}px;width:16px;font-size:.58rem;color:var(--dim);display:flex;align-items:center;justify-content:flex-end;padding-right:2px">${r}</div>`).join('');
  const fe=document.getElementById('editor-files');
  if(fe) fe.innerHTML=files.map(f=>`<div style="width:${_eSQ}px;font-size:.58rem;color:var(--dim);text-align:center;margin-top:2px">${f}</div>`).join('');
}

function editorDragStart(e, sq) {
  if (e.ctrlKey || e.shiftKey || e.altKey) { e.preventDefault(); return; }   // touche tenue = flèche, pas déplacement
  _eDragSq = sq; _E.sel = sq;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', sq);
  // Ghost = juste la pièce (pas toute la case)
  const p = new Chess(_E.node.fenAfter).get(sq);
  if (p) {
    const gc = document.getElementById('ghost-canvas');
    gc.width = _eSQ; gc.height = _eSQ;
    const ctx = gc.getContext('2d');
    ctx.clearRect(0, 0, _eSQ, _eSQ);
    const img = pieceImgs[p.color + p.type.toUpperCase()];
    if (img?.complete) ctx.drawImage(img, 0, 0, _eSQ, _eSQ);
    gc.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;display:block;z-index:9999';
    e.dataTransfer.setDragImage(gc, _eSQ / 2, _eSQ / 2);
    requestAnimationFrame(() => { gc.style.display = 'none'; });
  }
}
function editorDrop(e, sq) {
  e.preventDefault();
  const from = _eDragSq; _eDragSq = null;
  if (!from || from===sq) { _E.sel=null; renderEditorBoard(); return; }
  const g = new Chess(_E.node.fenAfter);
  const mp=g.get(from);
  if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===sq&&m.flags.includes('p'))){
    const fen=_E.node.fenAfter;
    showPromoPicker(mp.color,e.clientX,e.clientY,pr=>{
      const g2=new Chess(fen),mv2=g2.move({from,to:sq,promotion:pr});
      if(mv2){_E.lastFrom=from;_E.lastTo=sq;_E.sel=null;editorApplyMove(mv2,g2.fen());}
      else{_E.sel=null;renderEditorBoard();}
    });
    return;
  }
  const mv = g.move({from, to:sq, promotion:'q'});
  if (mv) { _E.lastFrom=from; _E.lastTo=sq; _E.sel=null; editorApplyMove(mv, g.fen()); }
  else { _E.sel=null; renderEditorBoard(); }
}
function editorDragEnd() { _eDragSq=null; _E.sel=null; renderEditorBoard(); }

let _eTouchFrom=null, _eTouchStartXY={x:0,y:0};
function editorTouchStart(e,sq){
  if(_promoCallback) return;
  e.preventDefault();
  const t=e.touches[0]; if(!t) return;
  _eTouchFrom=sq; _eTouchStartXY={x:t.clientX,y:t.clientY};
  const g=new Chess(_E.node.fenAfter), p=g.get(sq);
  if(p&&p.color===g.turn()){
    const gc=document.getElementById('ghost-canvas');
    gc.width=_eSQ; gc.height=_eSQ;
    const ctx=gc.getContext('2d');
    ctx.clearRect(0,0,_eSQ,_eSQ);
    const img=pieceImgs[p.color+p.type.toUpperCase()];
    if(img?.complete){ctx.globalAlpha=.85;ctx.drawImage(img,0,0,_eSQ,_eSQ);ctx.globalAlpha=1;}
    gc.style.cssText=`position:fixed;left:${t.clientX-_eSQ/2}px;top:${t.clientY-_eSQ/2}px;width:${_eSQ}px;height:${_eSQ}px;pointer-events:none;display:block;z-index:9999`;
  }
}
document.addEventListener('touchmove',e=>{
  if(!_eTouchFrom) return;
  e.preventDefault();
  const t=e.touches[0]; if(!t) return;
  const gc=document.getElementById('ghost-canvas');
  gc.style.left=(t.clientX-_eSQ/2)+'px'; gc.style.top=(t.clientY-_eSQ/2)+'px';
},{passive:false});
document.addEventListener('touchend',e=>{
  if(!_eTouchFrom) return;
  const gc=document.getElementById('ghost-canvas'); gc.style.display='none';
  const t=e.changedTouches[0]; if(!t){_eTouchFrom=null;return;}
  const dx=t.clientX-_eTouchStartXY.x, dy=t.clientY-_eTouchStartXY.y;
  const from=_eTouchFrom; _eTouchFrom=null;
  if(Math.sqrt(dx*dx+dy*dy)<8){
    editorClickSqLogic(from,t.clientX,t.clientY);
    return;
  }
  // Drag : destination par elementFromPoint
  const el=document.elementFromPoint(t.clientX,t.clientY);
  const cell=el?.closest('[data-sq]');
  const toSq=cell?.dataset.sq;
  if(!toSq||toSq===from){_E.sel=null;renderEditorBoard();return;}
  const fen=_E.node.fenAfter, g=new Chess(fen), mp=g.get(from);
  _E.sel=null;
  if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===toSq&&m.flags.includes('p'))){
    showPromoPicker(mp.color,t.clientX,t.clientY,pr=>{
      const g2=new Chess(fen),mv2=g2.move({from,to:toSq,promotion:pr});
      if(mv2){_E.lastFrom=from;_E.lastTo=toSq;editorApplyMove(mv2,g2.fen());}
      else renderEditorBoard();
    });
    return;
  }
  const mv=g.move({from,to:toSq,promotion:'q'});
  if(mv){_E.lastFrom=from;_E.lastTo=toSq;editorApplyMove(mv,g.fen());}
  else renderEditorBoard();
});

function editorClickSq(e, sq) {
  if (e && (e.ctrlKey || e.shiftKey || e.altKey)) return;   // touche tenue = annotation, pas un coup
  editorClickSqLogic(sq, e?.clientX||0, e?.clientY||0);
}

function editorApplyMove(mv, fenAfter) {
  const idx = _E.node.children.findIndex(c=>c.san===mv.san);
  if (idx>=0) { editorGoPath([..._E.path, idx]); return; }
  const newNode = { san:mv.san, fenBefore:_E.node.fenAfter, fenAfter, comment:'', children:[] };
  _E.node.children.push(newNode);
  editorGoPath([..._E.path, _E.node.children.length-1]);
}

function editorGoPath(path) {
  let node=_E.root;
  for (const idx of path) { if (!node.children[idx]) break; node=node.children[idx]; }
  _E.path=path; _E.node=node; _E.sel=null;
  renderEditorBoard(); renderEditorNotation(); renderEditorNagBar();
  document.getElementById('editor-comment').value = node.san ? node.comment : '';
}

function editorPrev() { if (_E.path.length) editorGoPath(_E.path.slice(0,-1)); }
function editorNext() { if (_E.node.children.length) editorGoPath([..._E.path, 0]); }
function flipEditorBoard() { _E.flipped=!_E.flipped; renderEditorBoard(); }
function editorSaveComment() { if (_E.node.san) _E.node.comment=document.getElementById('editor-comment').value; }

function editorDeleteNode() {
  if (!_E.path.length) { toast('Impossible de supprimer la position de départ','ko'); return; }
  let parent=_E.root;
  for (const idx of _E.path.slice(0,-1)) parent=parent.children[idx];
  parent.children.splice(_E.path[_E.path.length-1], 1);
  editorGoPath(_E.path.slice(0,-1));
}

function editorPromoteMain() {
  if (_E.path.length<1) return;
  let parent=_E.root;
  for (const idx of _E.path.slice(0,-1)) parent=parent.children[idx];
  const li=_E.path[_E.path.length-1];
  if (li===0) return;
  const node=parent.children.splice(li,1)[0];
  parent.children.unshift(node);
  editorGoPath([..._E.path.slice(0,-1), 0]);
}

// ── Annotations NAG (!, ?, !?, ±, ⩲, …) ───────────────────
const NAG_GLYPH = {1:'!',2:'?',3:'!!',4:'??',5:'!?',6:'?!',10:'=',13:'∞',14:'⩲',15:'⩱',16:'±',17:'∓',18:'+−',19:'−+'};
const NAG_QUALITY = [3,1,5,6,2,4];          // !! ! !? ?! ? ??
const NAG_EVAL    = [10,13,14,15,16,17,18,19];
function nagGlyphs(node) {
  return (node && node.nags && node.nags.length) ? node.nags.map(n => NAG_GLYPH[n] || ('$'+n)).join('') : '';
}
function _nagGroup(n) { return (n>=1 && n<=9) ? 'q' : 'e'; }   // qualité du coup vs évaluation
function editorToggleNag(n) {
  if (!_E.node || !_E.node.san) return;
  const had = (_E.node.nags||[]).includes(n);
  // un seul NAG par groupe (qualité / évaluation) → cliquer remplace
  _E.node.nags = (_E.node.nags||[]).filter(x => _nagGroup(x) !== _nagGroup(n));
  if (!had) _E.node.nags.push(n);
  _E.node.nags.sort((a,b)=>a-b);
  renderEditorNotation(); renderEditorNagBar();
}
function editorClearNags() {
  if (!_E.node || !_E.node.san) return;
  _E.node.nags = [];
  renderEditorNotation(); renderEditorNagBar();
}
function renderEditorNagBar() {
  const el = document.getElementById('editor-nag-bar'); if (!el) return;
  const dis = !(_E.node && _E.node.san);
  const active = (_E.node && _E.node.nags) ? _E.node.nags : [];
  const b = (n) => {
    const on = active.includes(n);
    return `<button type="button" onclick="editorToggleNag(${n})"${dis?' disabled':''} title="$${n}" `
      + `style="min-width:28px;padding:3px 6px;font-size:.82rem;font-weight:700;border-radius:var(--rs);`
      + `cursor:${dis?'default':'pointer'};border:1px solid ${on?'var(--cyan)':'var(--border)'};`
      + `background:${on?'var(--cyan-dim)':'var(--surf)'};color:${on?'var(--cyan)':'var(--text-2)'};opacity:${dis?'.4':'1'}">${NAG_GLYPH[n]}</button>`;
  };
  const sep = '<span style="width:8px;display:inline-block"></span>';
  const clr = `<button type="button" onclick="editorClearNags()"${(dis||!active.length)?' disabled':''} title="Effacer l'annotation" `
    + `style="min-width:28px;padding:3px 6px;font-size:.82rem;border-radius:var(--rs);cursor:${(dis||!active.length)?'default':'pointer'};`
    + `border:1px solid var(--border);background:var(--surf);color:var(--red);opacity:${(dis||!active.length)?'.4':'1'}">✕</button>`;
  el.innerHTML = NAG_QUALITY.map(b).join('') + sep + NAG_EVAL.map(b).join('') + sep + clr;
}

function renderEditorNotation() {
  const el=document.getElementById('editor-notation'); if (!el) return;
  // forceNum: afficher le numéro même pour un coup noir (après une variante)
  function nodeHTML(node, path, forceNum) {
    if (!node.children.length) return '';
    const main=node.children[0], vars=node.children.slice(1);
    const mainPath=[...path,0];
    const isCur=JSON.stringify(mainPath)===JSON.stringify(_E.path);
    const isOnPath=_E.path.length>path.length && _E.path.slice(0,path.length+1).join()===mainPath.join();
    const turn=main.fenBefore.split(' ')[1], num=main.fenBefore.split(' ')[5];
    let h='';
    // 1. Coup principal avec numéro
    if (turn==='w'||forceNum) h+=`<span style="color:var(--dim);font-size:.72rem">${num}${turn==='w'?'.':'…'}</span> `;
    const s=isCur?'background:var(--cyan);color:#111;padding:1px 6px;border-radius:3px;font-weight:700':
      isOnPath?'color:var(--text);font-weight:600':'color:var(--text-2)';
    h+=`<span onclick="editorGoPath(${JSON.stringify(mainPath)})" style="cursor:pointer;${s};padding:1px 4px;border-radius:3px">${fig(main.san)}${nagGlyphs(main)}</span>`;
    if (main.comment) h+=` <span style="color:var(--dim);font-style:italic;font-family:Inter,system-ui,sans-serif;font-size:.8rem">${escapeHtml(main.comment)}</span> `;
    // 2. Variantes immédiatement après le coup principal
    vars.forEach((v,vi) => {
      const vPath=[...path,vi+1];
      const isCurV=JSON.stringify(vPath)===JSON.stringify(_E.path);
      const isOnV=_E.path.length>path.length && _E.path.slice(0,path.length+1).join()===vPath.join();
      const vTurn=v.fenBefore.split(' ')[1], vNum=v.fenBefore.split(' ')[5];
      const vs=isCurV?'background:var(--cyan);color:#111;padding:1px 6px;border-radius:3px;font-weight:700':
        isOnV?'color:var(--text);font-weight:600':'color:var(--dim)';
      h+=` <span style="color:var(--dim)">(</span><span style="color:var(--dim);font-size:.72rem">${vNum}${vTurn==='w'?'.':'…'}</span> `;
      h+=`<span onclick="editorGoPath(${JSON.stringify(vPath)})" style="cursor:pointer;${vs};padding:1px 4px;border-radius:3px">${fig(v.san)}${nagGlyphs(v)}</span>`;
      if (v.comment) h+=` <span style="color:var(--dim);font-style:italic;font-family:Inter,system-ui,sans-serif;font-size:.8rem">${escapeHtml(v.comment)}</span> `;
      h+=nodeHTML(v,vPath,false);
      h+=`<span style="color:var(--dim)">)</span>`;
    });
    // 3. Continuation ligne principale (avec numéro si des variantes ont été affichées)
    h+=' '+nodeHTML(main, mainPath, vars.length>0);
    return h;
  }
  el.innerHTML = nodeHTML(_E.root,[],false) || '<span style="color:var(--dim);font-size:.8rem">Aucun coup — jouez sur l\'échiquier pour commencer</span>';
}

function editorTreeToPGN() {
  function ser(node, forceNum) {
    if (!node.children.length) return '';
    const main=node.children[0], vars=node.children.slice(1);
    const turn=main.fenBefore.split(' ')[1], num=main.fenBefore.split(' ')[5];
    const pre=(turn==='w'||forceNum) ? num+(turn==='w'?'. ':'... ') : '';
    let s=pre+main.san;
    if (main.nags && main.nags.length) s+=' '+main.nags.map(n=>'$'+n).join(' ');
    { const _cm=_commentWithShapes(main); if (_cm) s+=' {'+_cm+'}'; }
    vars.forEach(v => {
      const vt=v.fenBefore.split(' ')[1], vn=v.fenBefore.split(' ')[5];
      s+=' ('+vn+(vt==='w'?'. ':'... ')+v.san;
      if (v.nags && v.nags.length) s+=' '+v.nags.map(n=>'$'+n).join(' ');
      { const _cm=_commentWithShapes(v); if (_cm) s+=' {'+_cm+'}'; }
      s+=ser(v, vt==='b'); s+=')';
    });
    s+=ser(main, vars.length>0);
    return ' '+s.trimStart();
  }
  return ser(_E.root, false).trim()+' *';
}

function saveEditorDrill() {
  const pgn  = editorTreeToPGN();
  const name = (document.getElementById('editor-drill-name').value || '').trim();
  const side =  document.getElementById('editor-side').value || 'w';
  const level = document.getElementById('editor-level').value || 'Intermédiaire';
  if (!name) { toast('⚠ Donne un nom au module', 'ko'); return; }
  let allLines;
  try { allLines = extractAllLines(pgn); } catch(e) { toast('❌ PGN invalide : ' + e.message, 'ko'); return; }
  if (!allLines.some(l => l.moves.length)) { toast('⚠ Joue au moins un coup sur l\'échiquier', 'ko'); return; }

  const tree = _buildDrillTree(allLines, side);
  if (!Object.keys(tree).length) { toast('⚠ Aucun coup à enregistrer', 'ko'); return; }
  const sessions = [{ label: 'Arbre complet', startFen: new Chess().fen(), moves: [], kps: [] }];

  let d, isNew = false;
  if (_E.drillIdx < 0) {
    // Création
    isNew = true;
    d = {
      id: Date.now(),
      name, level, side, pgn,
      mode: 'line', varmode: 'tree', tree, sessions,
      hideComments: false, deadline: null, personal: false, ownerStudentId: null,
      created: new Date().toLocaleDateString('fr-FR'),
      updatedAt: Date.now()
    };
    if (_E.createRole === 'student') { d.personal = true; d.ownerStudentId = currentUser?.uid || null; }
    drills.push(d);
  } else {
    // Modification
    d = drills[_E.drillIdx];
    d.name = name; d.side = side; d.pgn = pgn; d.level = level;
    d.varmode = 'tree'; d.mode = 'line';
    d.tree = tree; d.sessions = sessions;
    d.updatedAt = Date.now();
  }

  save(); closeEditorModal();

  // Persistance selon la propriété du module
  if (currentUser) {
    if (d.personal) _sbSaveStudentModule(d);
    else if (currentRole === 'teacher') syncModuleToFirestore(d);
  }

  // Rafraîchir la bonne vue
  if (currentRole === 'student') loadStudentModules();
  else { renderDrillList(); renderClassModuleSelect(); }

  toast(isNew ? '✓ Module créé' : '✓ Module mis à jour', 'ok');
}

// Touches ← → dans l'éditeur
document.addEventListener('keydown', e => {
  if (!document.getElementById('modal-pgn-editor')?.classList.contains('on')) return;
  const tag=document.activeElement?.tagName;
  if (tag==='TEXTAREA'||tag==='INPUT') return;
  if (e.key==='ArrowRight') { e.preventDefault(); editorNext(); }
  if (e.key==='ArrowLeft')  { e.preventDefault(); editorPrev(); }
});

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
if (!ACCOUNTS_ON) {
  // Mode local : pas de Firebase, comportement original
  if (!drills.length && !localStorage.getItem('mc_demo_seen')) {
    injectDemoDrill();
    setTimeout(() => toast('👋 Bienvenue ! Un module Espagnole de démo a été chargé — cliquez ▶ Jouer pour essayer.', 'ok'), 500);
  }
  renderDrillList();
  renderClassList();
  renderClassModuleSelect();
  updateStudentBar();
  if (!drills.length) {
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
    currentUser = _sbUser(u);
    if (!u) { updateNav(); goPage('login'); return; }
    // rôle + pseudo depuis profiles
    try {
      const { data: prof } = await sb.from('profiles').select('role,pseudo').eq('id', u.id).maybeSingle();
      currentRole   = (prof && prof.role)   || 'student';
      currentPseudo = (prof && prof.pseudo) || null;
    } catch (e) { currentRole = 'student'; currentPseudo = null; }
    pendingRole = null;
    updateNav();
    await _sbLoadMastery();
    if (currentRole === 'teacher') { await _sbLoadTeacherModules(); goPage('coach'); }
    else { goPage('student-home'); await _sbLoadStudentModules(); }
  });
}

// ════════════════════════════════════════════════════════════
//  DONNÉES — modules & classes (côté enseignant)
//  Étape SUIVANTE : élève (loadStudentModules), résultats, pratique, parties.
// ════════════════════════════════════════════════════════════
async function _sbLoadTeacherModules() {
  if (!sb || !currentUser || currentRole !== 'teacher') return;
  try {
    const { data: mods, error: e1 } = await sb.from('modules').select('*').eq('teacher_id', currentUser.uid);
    if (e1) throw e1;
    drills = (mods || []).map(_sbRowToModule).sort((a, b) => (b.id || 0) - (a.id || 0));
    save();
    const { data: cls, error: e2 } = await sb.from('classes').select('*').eq('teacher_id', currentUser.uid);
    if (e2) throw e2;
    classes = (cls || []).map(_sbRowToClass);
    saveClasses();
    renderDrillList();
    renderClassList();
    renderClassModuleSelect();
    updateStudentBar();
  } catch (e) { console.error('_sbLoadTeacherModules', e); renderDrillList(); }
}

async function _sbSaveModule(drill) {
  if (!sb || !currentUser || currentRole !== 'teacher') return;
  try {
    const row = _sbModuleToRow(drill);
    row.teacher_id = currentUser.uid;   // garantir le propriétaire (RLS)
    const { error } = await sb.from('modules').upsert(row);
    if (error) throw error;
  } catch (e) { console.error('_sbSaveModule', e); }
}

async function _sbDeleteModule(drillId) {
  if (!sb || !currentUser || currentRole !== 'teacher') return;
  try {
    const { error } = await sb.from('modules').delete().eq('id', drillId);
    if (error) throw error;
  } catch (e) { console.error('_sbDeleteModule', e); }
}

async function _sbSaveClass(cls) {
  if (!sb || !currentUser || currentRole !== 'teacher') return;
  try {
    const row = _sbClassToRow(cls);
    row.teacher_id = currentUser.uid;
    const { error } = await sb.from('classes').upsert(row);
    if (error) throw error;
  } catch (e) { console.error('_sbSaveClass', e); }
}

async function _sbDeleteClass(id) {
  if (!sb || !currentUser) return;
  try {
    const { error } = await sb.from('classes').delete().eq('id', id);
    if (error) throw error;
  } catch (e) { console.error('_sbDeleteClass', e); }
}

// ════════════════════════════════════════════════════════════
//  DONNÉES — élève + résultats / pratique / parties + mastery
// ════════════════════════════════════════════════════════════
async function _sbLoadStudentModules() {
  if (!sb || !currentUser || currentRole !== 'student') return;
  const listEl = document.getElementById('sh-module-list');
  const nameEl = document.getElementById('sh-student-name');
  if (nameEl) nameEl.textContent = currentUser.displayName || currentUser.email;

  let assigned = [], personal = [];
  try {
    const ids = _myIdentifiers();
    // Toutes les classes (RLS : lecture aux connectés) → filtrage client par identifiants.
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
    const { data: pers } = await sb.from('modules').select('*').eq('owner_student_id', currentUser.uid);
    personal = (pers || []).map(_sbRowToModule);
    // Résultats + pratique de l'élève (dashboard multi-appareils)
    const { data: rs } = await sb.from('results').select('*').eq('student_id', currentUser.uid);
    results = (rs || []).map(_sbRowToResult); localStorage.setItem('mc_results', JSON.stringify(results));
    const { data: ps } = await sb.from('practice').select('*').eq('student_id', currentUser.uid);
    practiceLog = (ps || []).map(_sbRowToPractice); localStorage.setItem('mc_practice', JSON.stringify(practiceLog));
  } catch (e) {
    console.error('_sbLoadStudentModules', e);
    if (listEl) listEl.innerHTML = '<div style="color:var(--red);padding:20px;text-align:center;font-size:.85rem">Erreur de chargement. Vérifiez votre connexion.</div>';
    return;
  }
  drills = [...assigned, ...personal];
  save();
  renderStudentHome(assigned, personal);
}

async function _sbSaveStudentModule(d) {
  if (!sb || !currentUser) return;
  try {
    const row = _sbModuleToRow(d);
    row.owner_student_id = currentUser.uid;   // RLS : module perso de l'élève
    const { error } = await sb.from('modules').upsert(row);
    if (error) throw error;
  } catch (e) { console.error('_sbSaveStudentModule', e); }
}

async function _sbDeleteStudentModule(id) {
  if (!sb || !currentUser) return;
  try {
    const { error } = await sb.from('modules').delete().eq('id', id);
    if (error) throw error;
  } catch (e) { console.error('_sbDeleteStudentModule', e); }
}

async function _sbRecordResult(rec) {
  if (!sb || !currentUser) return;
  try { const { error } = await sb.from('results').insert(_sbResultToRow(rec)); if (error) throw error; }
  catch (e) { console.error('_sbRecordResult', e); }
}

async function _sbRecordPractice(rec) {
  if (!sb || !currentUser) return;
  try { const { error } = await sb.from('practice').insert(_sbPracticeToRow(rec)); if (error) throw error; }
  catch (e) { console.error('_sbRecordPractice', e); }
}

async function _sbSaveGame(rec) {
  if (!sb || !currentUser) return;
  try { const { error } = await sb.from('games').insert(_sbGameToRow(rec)); if (error) throw error; }
  catch (e) { console.error('_sbSaveGame', e); }
}

// Vue Prof : résultats / pratique / parties portant sur les modules du prof.
async function _sbLoadTeacherResults() {
  if (!sb || !currentUser || currentRole !== 'teacher') return;
  const ids = drills.map(d => String(d.id));
  if (!ids.length) { results = []; localStorage.setItem('mc_results', '[]'); return; }
  try {
    const { data } = await sb.from('results').select('*').in('drill_id', ids);
    results = (data || []).map(_sbRowToResult);
    localStorage.setItem('mc_results', JSON.stringify(results));
  } catch (e) { console.error('_sbLoadTeacherResults', e); }
}

async function _sbLoadTeacherPractice() {
  if (!sb || !currentUser || currentRole !== 'teacher') return;
  const ids = drills.map(d => String(d.id));
  if (!ids.length) { practiceLog = []; localStorage.setItem('mc_practice', '[]'); return; }
  try {
    const { data } = await sb.from('practice').select('*').in('drill_id', ids);
    practiceLog = (data || []).map(_sbRowToPractice);
    localStorage.setItem('mc_practice', JSON.stringify(practiceLog));
  } catch (e) { console.error('_sbLoadTeacherPractice', e); }
}

async function _sbLoadTeacherGames() {
  if (!sb || !currentUser || currentRole !== 'teacher') return;
  const ids = drills.map(d => String(d.id));
  if (!ids.length) { savedGames = []; return; }
  try {
    const { data } = await sb.from('games').select('*').in('drill_id', ids);
    savedGames = (data || []).map(_sbRowToGame);
  } catch (e) { console.error('_sbLoadTeacherGames', e); }
}

// Progression SM-2 (mastery) — stockée dans profiles.mastery (jsonb).
async function _sbSaveMastery() {
  const student = currentUser && (currentUser.displayName || currentUser.email);
  if (!sb || !currentUser || !student) return;
  const prefix = student + '_';
  const mine = {};
  for (const k in masteryData) if (k.startsWith(prefix)) mine[k] = masteryData[k];
  try { const { error } = await sb.from('profiles').update({ mastery: mine }).eq('id', currentUser.uid); if (error) throw error; }
  catch (e) { console.error('_sbSaveMastery', e); }
}

async function _sbLoadMastery() {
  if (!sb || !currentUser) return;
  try {
    const { data } = await sb.from('profiles').select('mastery').eq('id', currentUser.uid).maybeSingle();
    const m = data && data.mastery;
    if (m) {
      for (const k in m) if (!masteryData[k] || (m[k].due || 0) > (masteryData[k].due || 0)) masteryData[k] = m[k];
      localStorage.setItem('mc_mastery', JSON.stringify(masteryData));
    }
  } catch (e) { console.error('_sbLoadMastery', e); }
}


// ══════════════════════════════════════════════════════
// PONT window — expose les fonctions du module aux handlers inline onclick=""
// (genere : toutes les fonctions top-level du module ES)
// ══════════════════════════════════════════════════════
Object.assign(window, {
  _afterMaiaReady, _buildDrillTree, _buildProfRoster, _buildProgressionHTML, _checkPTEnd, _classWeakSpots,
  _commentDelay, _commentWithShapes, _computeForcedPath, _computeStreak, _deadlinePill, _download,
  _drawBoardShapes, _drillSessions, _eResize, _edTab, _editorShapesSVG, _ensureEditorArrowHandlers,
  _ensureOrt, _findNodeByFen, _getHintFrom, _getMaiaMove, _initA11y, _markModuleSeen, _markVersionSeen,
  _masteryBadge, _materialHint, _mirrorFen, _mirrorUci, _moduleStats, _myIdentifiers, _nagGroup,
  _parseShapes, _pickOppMove, _pieceFr, _renderRing, _sbAuthError, _sbDeleteClass, _sbDeleteModule,
  _sbDeleteStudentModule, _sbInitAuth, _sbLoadMastery, _sbLoadStudentModules, _sbLoadTeacherGames,
  _sbLoadTeacherModules, _sbLoadTeacherPractice, _sbLoadTeacherResults, _sbLogin, _sbLogout,
  _sbRecordPractice, _sbRecordResult, _sbRegister, _sbResetPassword, _sbSaveClass, _sbSaveGame,
  _sbSaveMastery, _sbSaveModule, _sbSaveStudentModule, _sbUpdatePassword, _sbUser, _scheduleMasterySync,
  _seenKey, _seenModules, _seenVerKey, _seenVersions, _setStudyLayout, _shModuleCard, _shapesToPGN,
  _sqCenter, _srAnswer, _srBilan, _srBuildQueue, _srBumpNewToday, _srClearSuspended, _srForecast,
  _srIsSuspended, _srMyResults, _srNewLimit, _srNewToday, _srPositions, _srScopeList, _srSessionSize,
  _srSetSuspended, _srSuspendedCount, _srSuspendedMap, _srTodayKey, _srToggleBar, _srUpdateBar,
  _studyGuessPrompt, _studyGuessReady, _studyGuessSync, _studyMastery, _syncHeatmapFilters, _syncPartiesFilter,
  _treeEnd, _treePlayerPositions, _treeUnseenCount, addFromLibrary, addLog, addStudent, advanceLine,
  advanceTree, askName, autoFillFromPgn, canInteract, cancelDel, cancelEditClass, cancelPromo,
  clearFeedback, clearLog, closeEditorModal, closeModal, confirmDel, confirmName, countPlayerMoves,
  currentGame, currentSession, deleteClass, deleteDrill, deleteModuleFromFirestore, deleteStudentDrill,
  dismissOnboarding, drawBoard, drawCoords, drawGhost, editorApplyMove, editorClearNags, editorClearShapes,
  editorClickSq, editorClickSqLogic, editorDeleteNode, editorDragEnd, editorDragStart, editorDrop,
  editorGoPath, editorNext, editorPrev, editorPromoteMain, editorSaveComment, editorToggleNag,
  editorToggleShape, editorTouchStart, editorTreeToPGN, endLineDrill, endPositionsDrill, enginePlay,
  enterTestPhase, escapeHtml, evXY, exportAll, exportCSV, exportPGN, exportPracticeCSV, fig,
  flipBoard, flipEditorBoard, getPieceImg, goPage, importDrill, importStudentDrill, initDrillPage,
  injectDemoDrill, isLineMode, isPlayerMove, launchDrill, learnNext, learnPrev, loadExample,
  loadMaia, loadPgnFile, loadPosition, loadStudentModules, loadTeacherGames, loadTeacherModules,
  loadTeacherPractice, loadTeacherResults, loginUser, logoutUser, nagGlyphs, nextDrill, nextSession,
  openCreateDrillModal, openEditClass, openLibrary, openPgnEditor, openPgnEditorNew, openSrSettings,
  openStudentImport, pgnToEditorTree, pickPromo, playVsMaia, posGhost, previewDrill, quitMaiaGame,
  recordPracticeSession, recordResult, registerUser, renderClassList, renderClassModuleSelect,
  renderClassWeakSpots, renderClassesTab, renderCoachOnboarding, renderDrillList, renderEditorBoard,
  renderEditorNagBar, renderEditorNotation, renderHeatmap, renderLearnComment, renderLearnNotation,
  renderLearnState, renderLibrary, renderNotation, renderPartiesTab, renderPosStrip, renderProfView,
  renderSrDashboard, renderStudentHome, renderStudyBubble, renderStudyGuessLine, renderStudyTree,
  replayErrors, requestPasswordReset, resizeBoard, reviserDrill, reviserTout, save, saveClass,
  saveClasses, saveEditorDrill, saveGame, saveSrSettings, selectDrill, setBoardComment, setBoardPrompt,
  setFeedback, shareDrill, showEndModal, showHint, showLoginError, showLoginTab, showPromoPicker,
  showRecoveryForm, showStudentDetail, skipLinePosition, skipPosition, sm2Get, sm2Update, sqFromXY,
  srStart, srSuspendCurrent, startDrill, startLearnPhase, startLineDrill, startPostTheory, startStudentDrill,
  startStudyPhase, startTreeDrill, studyGoPath, studyNext, studyPrev, submitNewPassword, switchCoachSection,
  syncModuleToFirestore, toast, toggleAdvOpts, toggleClassMode, togglePGN, togglePauseAdversary,
  toggleStudyGuess, toggleTheme, totalSessions, tryMove, tryMoveInLine, tryMoveInPositions, tryMoveInTree,
  tryMovePostTheory, tryStudyGuess, updateLearnProgress, updateLinePosInfo, updateNav, updatePosInfo,
  updateReviserToutBadge, updateScores, updateSessionInfo, updateStudentBar, updateStudyProgress,
});
