// ══════════════════════════════════════════════════════
// MODULES ES (Vite) + vendors CDN
// ══════════════════════════════════════════════════════
// Vendors (chess.js, @supabase/supabase-js) restent chargés en CDN dans index.html.
// Dans un module ES, un identifiant non déclaré (Chess, supabase) se résout sur
// globalThis → `new Chess()` et `supabase.createClient` marchent sans import vendor.
import { _normFen, normalizeSAN, extractAllLines } from './lib/core.js';
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
import './lib/student.js';
import './lib/modules.js';
import './lib/maia.js';
import './lib/board.js';
import './lib/mastery.js';
import './lib/library.js';
import './lib/setup.js';
import './lib/exercises.js';

// ── Configuration Supabase (client `sb`) ──────────────────
// Clé « publishable » PUBLIQUE (protégée par RLS) → OK committée. Jamais de clé « secret » ici.
const SUPABASE_URL = 'https://smoftbuyejoyxlonhjcu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Bn0asUgcNYPYA1wnl9bokw_k1xshFC4';
const SUPABASE_CONFIGURED = (typeof supabase !== 'undefined') && !!supabase.createClient;
// ── DEV : sur localhost on saute la connexion et on coupe tout trafic Supabase ──
// (app 100% locale via localStorage). En prod (GitHub Pages) : auth normale.
// Pour tester le chemin connecté en local (gate), mettre DEV_SKIP_AUTH à false.
const DEV_SKIP_AUTH = (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const sb = (SUPABASE_CONFIGURED && !DEV_SKIP_AUTH) ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;

// ══════════════════════════════════════════════════════
// ÉTAT GLOBAL — auth Supabase
// ══════════════════════════════════════════════════════
// « Mode comptes » : login obligatoire + backend distant (Supabase).
const ACCOUNTS_ON = (typeof SUPABASE_CONFIGURED !== 'undefined') && SUPABASE_CONFIGURED;

// DEV_SKIP_AUTH est défini plus haut (au niveau de la config Supabase).
let DEV_GUEST_ROLE = 'teacher';   // rôle de départ de l'invité dev : 'teacher' | 'student'
// G.currentUser / G.currentRole / G.pendingRole / G.currentPseudo → state.js (G)

// ── Mise à jour de la nav selon le rôle ───────────────
function updateNav() {
  const acctMenu     = document.getElementById('acct-menu');
  const acctName     = document.getElementById('acct-name');
  const acctAvatar   = document.getElementById('acct-avatar');
  const acctDdName   = document.getElementById('acct-dd-name');
  const navRoleChip  = document.getElementById('nav-role-chip');
  const navTabs      = document.getElementById('nav-tabs');
  const btnBack      = document.getElementById('btn-back-student');

  // En mode Firebase, le chip nav-student (mode local) est inutile
  const navStudentChip = document.getElementById('nav-student');
  if (navStudentChip) navStudentChip.style.display = ACCOUNTS_ON ? 'none' : '';

  if (!ACCOUNTS_ON) return;

  const isTeacher = G.currentRole === 'teacher';
  const isStudent = G.currentRole === 'student';

  if (G.currentUser) {
    // Menu compte : avatar (initiale) + prénom + nom complet dans le dropdown
    const full  = G.currentUser.displayName || G.currentUser.email || '';
    const first = full.split(' ')[0] || full;
    if (acctName)   acctName.textContent   = first;
    if (acctAvatar) acctAvatar.textContent = (first[0] || '?').toUpperCase();
    if (acctDdName) acctDdName.textContent = full;
    if (acctMenu)   acctMenu.style.display = '';
    // Badge rôle (dans le dropdown)
    if (navRoleChip) {
      navRoleChip.className   = 'role-chip ' + (isTeacher ? 'teacher' : 'student');
      navRoleChip.innerHTML = isTeacher ? '<i class="ti ti-clipboard-text" aria-hidden="true"></i> Prof' : '<i class="ti ti-user" aria-hidden="true"></i> Élève';
      navRoleChip.style.display = '';
    }
    // Onglets du haut : réservés à l'élève (Réviser | Ma bibliothèque).
    // Le coach n'a PAS d'onglets du haut → sa nav unique est la sidebar ; il atteint
    // l'échiquier via « Jouer » sur une carte de module, et en revient par le bouton retour.
    if (navTabs) navTabs.style.display = '';
    document.querySelectorAll('.tab-teacher').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.tab-student').forEach(t => t.style.display = isStudent ? '' : 'none');
    // Bouton retour (page-drill) : visibilité/label pilotés par goPage selon le rôle.
    if (btnBack) btnBack.style.display = 'none';
  } else {
    // Non connecté
    if (acctMenu)    acctMenu.style.display     = 'none';
    if (navRoleChip) navRoleChip.style.display  = 'none';
    if (navTabs)     navTabs.style.display      = 'none';
    if (btnBack)     btnBack.style.display      = 'none';
  }
}

// Menu compte (dropdown) : ouverture/fermeture + clic-extérieur.
function toggleAcctMenu(ev) {
  if (ev) ev.stopPropagation();
  const dd  = document.getElementById('acct-dropdown');
  const btn = document.getElementById('acct-btn');
  if (!dd) return;
  const open = dd.classList.toggle('on');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  // Position fixe (le <nav> a overflow:hidden qui rognerait un dropdown absolu) : on ancre sous le bouton.
  if (open && btn) {
    const r = btn.getBoundingClientRect();
    dd.style.top   = Math.round(r.bottom + 8) + 'px';
    dd.style.right = Math.round(window.innerWidth - r.right) + 'px';
  }
}
document.addEventListener('click', function(e) {
  const menu = document.getElementById('acct-menu');
  const dd   = document.getElementById('acct-dropdown');
  if (dd && dd.classList.contains('on') && menu && !menu.contains(/** @type {Node} */ (e.target))) {
    dd.classList.remove('on');
    document.getElementById('acct-btn')?.setAttribute('aria-expanded', 'false');
  }
});

// ── Fonctions d'authentification ─────────────────────
async function loginUser() { return _sbLogin(); }

async function registerUser() { return _sbRegister(); }

async function logoutUser() { return _sbLogout(); }

// Connexion / inscription via Google (OAuth). `applyRole=true` mémorise le rôle
// choisi dans le formulaire d'inscription (appliqué au retour dans onAuthStateChange).
// Prérequis : provider Google activé dans Supabase + URL de redirection autorisée.
async function signInGoogle(applyRole) {
  if (!sb) return;
  try {
    if (applyRole) localStorage.setItem('mc_pending_role', document.getElementById('reg-role')?.value || 'student');
    else localStorage.removeItem('mc_pending_role');
  } catch (e) {}
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname }
  });
  if (error) showLoginError(_sbAuthError(error));
}

// Afficher / masquer un champ mot de passe (bouton œil).
function togglePwd(id, btn) {
  const inp = /** @type {HTMLInputElement} */ (document.getElementById(id));
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  if (btn) { btn.innerHTML = show ? '<i class="ti ti-eye-off" aria-hidden="true"></i>' : '<i class="ti ti-eye" aria-hidden="true"></i>'; btn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'); }
}

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
async function saveModule(drill)   { return _sbSaveModule(drill); }
async function deleteModule(drillId) { return _sbDeleteModule(drillId); }

// Accueil eleve (renderStudentHome, _moduleStats, _shModuleCard, _seen*,
// startStudentDrill, importStudentDrill...) + _myIdentifiers -> lib/student.js

// ── Données — modules de l'élève (assignés + perso) ───
async function loadStudentModules() { return _sbLoadStudentModules(); }


// ── Données — Vue Prof (résultats / pratique / parties) ──
async function loadTeacherResults()  { return _sbLoadTeacherResults(); }
async function loadTeacherPractice() { return _sbLoadTeacherPractice(); }
async function loadTeacherGames()    { return _sbLoadTeacherGames(); }

// ── Auth state (Supabase) — sb est null en mode DEV_SKIP_AUTH ──
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
  if (S.preview && S.preview.game) return S.preview.game;   // aperçu lecture-seule (clic-navigation)
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
  if (sec==='eleves')  {
    // Suivi & progression des élèves (les classes ont leur propre section, cf. refonte T4).
    Promise.all([loadTeacherResults(), loadTeacherPractice(), loadTeacherGames()]).then(()=>window.renderProfView?.());
  }
  if (sec==='classes') {
    // Gestion & assignation : formulaire + liste des classes + suivi par module.
    window.renderClassList?.(); window.renderClassModuleSelect?.();
    Promise.all([loadTeacherResults(), loadTeacherPractice()]).then(()=>window.renderClassesTab?.());
  }
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

// Modules : création, bibliothèque d ouvertures, cartes coach -> lib/modules.js

function goPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('nav .tab').forEach(t => t.classList.remove('on'));
  const pageEl = document.getElementById('page-' + name);
  if (pageEl) pageEl.classList.add('on');
  const tabMap = { coach: 'tab-coach', drill: 'tab-drill', 'student-home': 'tab-revision', library: 'tab-library' };
  if (tabMap[name]) document.getElementById(tabMap[name])?.classList.add('on');
  if (name === 'drill') initDrillPage();
  if (name === 'coach') { window.renderClassModuleSelect?.(); }
  if (name === 'library') { window.renderMyLibrary?.(); }
  // Bouton retour sur la page drill : élève → « Mes modules », coach → « Tableau de bord ».
  const btnBack = document.getElementById('btn-back-student');
  if (btnBack) {
    const onDrill = ACCOUNTS_ON && name === 'drill' && (G.currentRole === 'student' || G.currentRole === 'teacher');
    btnBack.style.display = onDrill ? '' : 'none';
    if (onDrill) {
      const isT = G.currentRole === 'teacher';
      const lbl = document.getElementById('btn-back-label');
      if (lbl) lbl.textContent = isT ? 'Tableau de bord' : 'Mes modules';
      btnBack.title = isT ? 'Retour au tableau de bord' : 'Retour à mes modules';
    }
  }
}

// Retour depuis l'échiquier (page-drill) vers l'accueil du rôle courant.
function goBackFromDrill() { goPage(G.currentRole === 'teacher' ? 'coach' : 'student-home'); }

// ══════════════════════════════════════════════════════
// PARSING PGN + Leitner (cœur) + _normFen → déplacés dans lib/core.js
// (normalizeSAN, extractAllLines, leitnerSchedule, _normFen), chargé avant app.js
// et testés via Vitest (tests/core.test.js).
// ══════════════════════════════════════════════════════

// Détecte si un coup laisse du matériel en prise (heuristique 1 coup, prudente).
// _materialHint + _buildDrillTree → lib/tree.js

// Import/création de modules (preview, PGN, suppression) -> lib/modules.js

// Miroir local d'une tranche de G (source de verite = Supabase en connecte).
// Chemin UNIQUE et garde : localStorage peut jeter (mode prive/quota) sans que
// ce soit fatal. Toute ecriture de cache d'une tranche de G passe par ici.
function _cache(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { /* cache best-effort */ }
}

function save() {
  _cache('mc_drills',   G.drills);
  _cache('mc_results',  G.results);
  _cache('mc_practice', G.practiceLog);
  _cache('mc_games',    G.savedGames);
  _cache('mc_mastery',  G.masteryData);
  _cache('mc_opp_seen', G.oppSeen);
  _cache('mc_bases',    G.bases);
}
function saveClasses() {
  _cache('mc_classes', G.classes);
}

// countPlayerMoves → lib/drill-core.js

// Gestion des modules & classes (démo, onboarding, cartes, classes) -> lib/modules.js


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

  clearFeedback(); clearLog(); updateScores(); window.drawCoords?.();
  window.resizeBoard?.();

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

// SM-2 + enregistrement (sm2Update/Get, recordResult, recordPracticeSession, saveGame, sync mastery) -> lib/mastery.js

// ══════════════════════════════════════════════════════
// ÉCHIQUIER
// ══════════════════════════════════════════════════════
// Constantes plateau, pièces SVG (cburnett), getPieceImg -> lib/board.js

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

// resizeBoard + nav clavier + drawCoords -> lib/board.js

// Moteur Maia (ONNX) : chargement lazy, inference, partie libre vs Maia -> lib/maia.js

// Rendu + interaction échiquier (drawBoard, drag, listeners, canInteract, tryMove, flipBoard) -> lib/board.js


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
      window.recordResult?.(false,{san:mv.san,comment:mv.comment,posIdx:Math.ceil((S.lineMoveIdx+1)/2)-1});
      updateScores();
    }
    const from=_getHintFrom(mv.san,S.lineGame.fen());
    S.hintSquare=from;
    const piece=from&&S.lineGame.get(from);
    const pname=piece?_pieceFr(piece.color,piece.type):'la pièce';
    setFeedback('hint','💡 Indice : bougez '+pname+(from?' depuis '+from:''),'');
    window.drawBoard?.();
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
  window.recordResult?.(false,{san:kp.san,comment:kp.comment,posIdx:S.posIdx});
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
// Sélecteur de promotion (showPromoPicker/pickPromo/cancelPromo) -> lib/board.js

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
if (!ACCOUNTS_ON) {
  // Mode local : pas de Firebase, comportement original
  if (!G.drills.length && !localStorage.getItem('mc_demo_seen')) {
    window.injectDemoDrill?.();
    setTimeout(() => toast('👋 Bienvenue ! Un module Espagnole de démo a été chargé — cliquez ▶ Jouer pour essayer.', 'ok'), 500);
  }
  window.renderDrillList?.();
  window.renderClassList?.();
  window.renderClassModuleSelect?.();
  updateStudentBar();
  if (!G.drills.length) {
    document.getElementById('no-drill').style.display = 'block';
  } else {
    document.getElementById('no-drill').style.display = 'none';
    goPage('drill');
  }
} else if (DEV_SKIP_AUTH) {
  // Mode dev local : entrée directe sans login (voir DEV_SKIP_AUTH ci-dessus)
  _devGuestEnter(DEV_GUEST_ROLE);
} else {
  // Mode Firebase : attendre onAuthStateChanged (déjà positionné plus haut)
  goPage('login');
}
setTimeout(()=>window.resizeBoard?.(), 50);
_initA11y();

// ── DEV : entrée invité + bascule de rôle (localhost uniquement) ──
function _devGuestEnter(role) {
  DEV_GUEST_ROLE = (role === 'student') ? 'student' : 'teacher';
  G.currentUser   = { uid: 'dev-guest', email: 'dev@local', displayName: 'Invité (dev)' };
  G.currentRole   = DEV_GUEST_ROLE;
  G.currentPseudo = 'dev';
  updateNav();
  if (DEV_GUEST_ROLE === 'teacher') {
    window.renderDrillList?.(); window.renderClassList?.(); window.renderClassModuleSelect?.();
    window.renderProfView?.();
    goPage('coach');
  } else {
    goPage('student-home');
    window.renderStudentHome?.(
      (G.drills || []).filter(d => !d.personal),
      (G.drills || []).filter(d => d.personal)
    );
  }
  _devRoleSwitch();
}
// Petit bouton flottant pour basculer Prof/Élève sans repasser par le login.
function _devRoleSwitch() {
  let b = document.getElementById('dev-role-switch');
  if (!b) {
    b = document.createElement('button');
    b.id = 'dev-role-switch';
    b.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9999;font:600 12px/1 var(--font-ui,sans-serif);background:#18181b;color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;opacity:.82;box-shadow:0 4px 12px rgba(0,0,0,.25)';
    b.title = 'Dev : basculer le rôle (localhost)';
    b.onclick = () => _devGuestEnter(G.currentRole === 'teacher' ? 'student' : 'teacher');
    document.body.appendChild(b);
  }
  b.textContent = '🛠 ' + (G.currentRole === 'teacher' ? 'Vue Prof → Élève' : 'Vue Élève → Prof');
}


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

// Désactive un bouton auth + libellé d'attente pendant la requête ; renvoie la fonction de restauration.
function _authBusy(sel, busyLabel) {
  const btn = document.querySelector(sel);
  if (!btn) return () => {};
  const prev = btn.textContent, wasDisabled = btn.disabled;
  btn.disabled = true; btn.textContent = busyLabel;
  return () => { btn.disabled = wasDisabled; btn.textContent = prev; };
}

async function _sbLogin() {
  const email = (document.getElementById('login-email')?.value || '').trim();
  const pwd   =  document.getElementById('login-pwd')?.value   || '';
  if (!email || !pwd) { showLoginError('Remplissez tous les champs.'); return; }
  const restore = _authBusy('#login-form button.btn-primary', 'Connexion…');
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password: pwd });
    if (error) showLoginError(_sbAuthError(error));
    // succès → _sbInitAuth (onAuthStateChange) prend le relais
  } finally { restore(); }
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

  const restore = _authBusy('#register-form button.btn-primary', 'Création…');
  try {
    // user_metadata transporte name/role/pseudo (le trigger crée la ligne profiles id+email).
    const { data, error } = await sb.auth.signUp({
      email, password: pwd, options: { data: { name, role, pseudo } }
    });
    if (error) { showLoginError(_sbAuthError(error)); return; }
    // Complète le profil (le trigger n'a posé que id+email).
    if (data.user) {
      await sb.from('profiles').update({ name, role, pseudo }).eq('id', data.user.id);
    }
    // Confirmation email activée ⇒ pas de session immédiate (succès avec session ⇒ routage auto).
    if (!data.session) {
      showLoginError('Compte créé. Confirmez votre email puis connectez-vous.');
    }
  } finally { restore(); }
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
    // Rôle choisi avant une connexion Google (OAuth ne passe pas par le formulaire) — usage unique.
    let pendingRole = null;
    try { pendingRole = localStorage.getItem('mc_pending_role'); if (pendingRole) localStorage.removeItem('mc_pending_role'); } catch (e) {}
    // rôle + pseudo depuis profiles
    let prof = null;
    try {
      ({ data: prof } = await sb.from('profiles').select('role,pseudo,name').eq('id', u.id).maybeSingle());
      G.currentRole   = (prof && prof.role)   || 'student';
      G.currentPseudo = (prof && prof.pseudo) || null;
    } catch (e) { G.currentRole = 'student'; G.currentPseudo = null; }
    // Nouveau compte Google : pas de pseudo → dérive de l'email ; applique le rôle choisi avant redirection.
    const patch = {};
    if (pendingRole && pendingRole !== G.currentRole) { G.currentRole = pendingRole; patch.role = pendingRole; }
    if (!G.currentPseudo) { G.currentPseudo = (u.email || '').split('@')[0].toLowerCase().replace(/\s+/g, ''); patch.pseudo = G.currentPseudo; }
    if (!(prof && prof.name)) { const nm = (u.user_metadata && u.user_metadata.name) || null; if (nm) patch.name = nm; }
    if (Object.keys(patch).length) { try { await sb.from('profiles').update(patch).eq('id', u.id); } catch (e) {} }
    G.pendingRole = null;
    updateNav();
    // Router IMMÉDIATEMENT (avant tout réseau) → retour visuel instantané ; les données se chargent ensuite.
    goPage(G.currentRole === 'teacher' ? 'coach' : 'student-home');
    await _sbLoadMastery();
    if (G.currentRole === 'teacher') {
      await _sbLoadTeacherModules();
      // Résultats / pratique / parties des élèves (incl. parties partagées) → dashboard coach.
      await _sbLoadTeacherResults(); await _sbLoadTeacherPractice(); await _sbLoadTeacherGames();
      window.renderProfView?.();
    }
    else { await _sbLoadBases(); await _sbLoadStudentModules(); await _sbLoadStudentGames(); }
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
    window.renderDrillList?.();
    window.renderClassList?.();
    window.renderClassModuleSelect?.();
    updateStudentBar();
  } catch (e) { console.error('_sbLoadTeacherModules', e); window.renderDrillList?.(); }
}

// Exécuteur commun de la couche CRUD Supabase : factorise la garde de
// précondition + le try/catch/log uniformes répétés par chaque `_sb*`.
// `guardOk` est évalué au call-site (short-circuit sur sb/currentUser/rôle),
// donc l'accès à `G.currentUser.uid` dans `fn` est sûr quand fn s'exécute.
async function _sbRun(label, guardOk, fn) {
  if (!guardOk) return;
  try { return await fn(); }
  catch (e) { console.error(label, e); }
}

async function _sbSaveModule(drill) {
  return _sbRun('_sbSaveModule', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const row = _sbModuleToRow(drill);
    row.teacher_id = G.currentUser.uid;   // garantir le propriétaire (RLS)
    const { error } = await sb.from('modules').upsert(row);
    if (error) throw error;
  });
}

async function _sbDeleteModule(drillId) {
  return _sbRun('_sbDeleteModule', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const { error } = await sb.from('modules').delete().eq('id', drillId);
    if (error) throw error;
  });
}

async function _sbSaveClass(cls) {
  return _sbRun('_sbSaveClass', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const row = _sbClassToRow(cls);
    row.teacher_id = G.currentUser.uid;
    const { error } = await sb.from('classes').upsert(row);
    if (error) throw error;
  });
}

async function _sbDeleteClass(id) {
  return _sbRun('_sbDeleteClass', sb && G.currentUser, async () => {
    const { error } = await sb.from('classes').delete().eq('id', id);
    if (error) throw error;
  });
}

// ════════════════════════════════════════════════════════════
//  DONNÉES — élève + résultats / pratique / parties + mastery
// ════════════════════════════════════════════════════════════
// Classes de l'élève connecté.
// RLS : la policy `classes_read` (migration-005, VÉRIFIÉE appliquée sur le live
// 12/07/2026) restreint déjà `select *` aux classes dont l'élève est membre
// (`students ?| my_identifiers()`). Le `select('*')` ne ramène donc QUE ses
// classes ; le `.filter` client ci-dessous est une ceinture-bretelles redondante.
async function _sbFetchStudentClasses() {
  const ids = window._myIdentifiers?.() || [];
  const { data: allCls, error } = await sb.from('classes').select('*');
  if (error) throw error;
  return (allCls || []).map(_sbRowToClass)
    .filter(c => (c.students || []).some(s => ids.includes(String(s).toLowerCase())));
}

// Échéance d'assignation la plus proche par module, parmi les classes de
// l'élève. Dates 'YYYY-MM-DD' → comparaison lexicographique = chronologique. Pur.
function _assignDeadlinesFrom(classes) {
  const out = {};
  classes.forEach(c => {
    const dls = c.moduleDeadlines || {};
    Object.keys(dls).forEach(mid => {
      const d = dls[mid]; if (!d) return;
      if (!out[mid] || d < out[mid]) out[mid] = d;
    });
  });
  return out;
}

// Modules assignés à l'élève (via ses classes) : échéance d'assignation (prime
// sur celle du module) + noms de coachs pour l'affichage multi-profs.
async function _sbFetchAssignedModules(classes) {
  const moduleIds = new Set();
  classes.forEach(c => (c.moduleIds || []).forEach(id => moduleIds.add(Number(id))));
  if (!moduleIds.size) return [];
  const { data: mods } = await sb.from('modules').select('*').in('id', [...moduleIds]);
  const assigned = (mods || []).map(_sbRowToModule);
  const deadlines = _assignDeadlinesFrom(classes);
  assigned.forEach(m => { const d = deadlines[String(m.id)]; if (d) m.deadline = d; });
  await _sbApplyCoachNames(assigned);
  return assigned;
}

// Renseigne coachName/_showCoach sur les modules assignés (badge si ≥ 2 profs).
async function _sbApplyCoachNames(assigned) {
  const coachIds = [...new Set(assigned.map(m => m.teacherId).filter(Boolean))];
  const names = {};
  if (coachIds.length) {
    const { data: profs } = await sb.from('profiles').select('id,name,pseudo,email').in('id', coachIds);
    (profs || []).forEach(p => names[p.id] = p.name || p.pseudo || p.email || 'Coach');
  }
  const multiCoach = coachIds.length > 1;
  assigned.forEach(m => { m.coachName = names[m.teacherId] || null; m._showCoach = multiCoach; });
}

// Modules perso de l'élève.
async function _sbFetchPersonalModules() {
  const { data: pers } = await sb.from('modules').select('*').eq('owner_student_id', G.currentUser.uid);
  return (pers || []).map(_sbRowToModule);
}

// Résultats + pratique de l'élève (dashboard multi-appareils) → G + cache.
async function _sbFetchStudentActivity() {
  const { data: rs } = await sb.from('results').select('*').eq('student_id', G.currentUser.uid);
  G.results = (rs || []).map(_sbRowToResult); _cache('mc_results', G.results);
  const { data: ps } = await sb.from('practice').select('*').eq('student_id', G.currentUser.uid);
  G.practiceLog = (ps || []).map(_sbRowToPractice); _cache('mc_practice', G.practiceLog);
}

// Orchestration : mêmes étapes séquentielles qu'avant, découpées par rôle.
async function _sbLoadStudentModules() {
  if (!sb || !G.currentUser || G.currentRole !== 'student') return;
  const listEl = document.getElementById('sh-module-list');
  const nameEl = document.getElementById('sh-student-name');
  if (nameEl) nameEl.textContent = G.currentUser.displayName || G.currentUser.email;

  let assigned = [], personal = [];
  try {
    const myCls = await _sbFetchStudentClasses();
    assigned = await _sbFetchAssignedModules(myCls);
    personal = await _sbFetchPersonalModules();
    await _sbFetchStudentActivity();
  } catch (e) {
    console.error('_sbLoadStudentModules', e);
    if (listEl) listEl.innerHTML = '<div style="color:var(--red);padding:20px;text-align:center;font-size:.85rem">Erreur de chargement. Vérifiez votre connexion.</div>';
    return;
  }
  G.drills = [...assigned, ...personal];
  save();
  window.renderStudentHome?.(assigned, personal);
}

async function _sbSaveStudentModule(d) {
  return _sbRun('_sbSaveStudentModule', sb && G.currentUser, async () => {
    const row = _sbModuleToRow(d);
    row.owner_student_id = G.currentUser.uid;   // RLS : module perso de l'élève
    const { error } = await sb.from('modules').upsert(row);
    if (error) throw error;
  });
}

async function _sbDeleteStudentModule(id) {
  return _sbRun('_sbDeleteStudentModule', sb && G.currentUser, async () => {
    const { error } = await sb.from('modules').delete().eq('id', id);
    if (error) throw error;
  });
}

async function _sbRecordResult(rec) {
  return _sbRun('_sbRecordResult', sb && G.currentUser, async () => {
    const { error } = await sb.from('results').insert(_sbResultToRow(rec)); if (error) throw error;
  });
}

async function _sbRecordPractice(rec) {
  return _sbRun('_sbRecordPractice', sb && G.currentUser, async () => {
    const { error } = await sb.from('practice').insert(_sbPracticeToRow(rec)); if (error) throw error;
  });
}

async function _sbSaveGame(rec) {
  return _sbRun('_sbSaveGame', sb && G.currentUser, async () => {
    const { error } = await sb.from('games').insert(_sbGameToRow(rec)); if (error) throw error;
  });
}

// Mise à jour d'une partie existante (partage P1.3, annotation coach P1.4).
// UPDATE et non insert → pas de conflit de PK ; RLS games_update autorise
// l'élève (les siennes) ou le prof (parties partagées de ses élèves).
async function _sbUpdateGame(rec) {
  return _sbRun('_sbUpdateGame', sb && G.currentUser, async () => {
    const row = _sbGameToRow(rec); delete row.id;   // ne pas réécrire la clé
    const { error } = await sb.from('games').update(row).eq('id', rec.id);
    if (error) throw error;
  });
}

async function _sbDeleteGame(id) {
  return _sbRun('_sbDeleteGame', sb && G.currentUser, async () => {
    const { error } = await sb.from('games').delete().eq('id', id); if (error) throw error;
  });
}

// Parties de l'élève connecté (Maia + bibliothèque) → multi-appareils.
async function _sbLoadStudentGames() {
  return _sbRun('_sbLoadStudentGames', sb && G.currentUser && G.currentRole === 'student', async () => {
    const { data } = await sb.from('games').select('*').eq('student_id', G.currentUser.uid);
    G.savedGames = (data || []).map(_sbRowToGame);
    _cache('mc_games', G.savedGames);
  });
}

// Vue Prof : résultats / pratique / parties portant sur les modules du prof.
async function _sbLoadTeacherResults() {
  return _sbRun('_sbLoadTeacherResults', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const ids = G.drills.map(d => String(d.id));
    if (!ids.length) { G.results = []; _cache('mc_results', []); return; }
    const { data } = await sb.from('results').select('*').in('drill_id', ids);
    G.results = (data || []).map(_sbRowToResult);
    _cache('mc_results', G.results);
  });
}

async function _sbLoadTeacherPractice() {
  return _sbRun('_sbLoadTeacherPractice', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const ids = G.drills.map(d => String(d.id));
    if (!ids.length) { G.practiceLog = []; _cache('mc_practice', []); return; }
    const { data } = await sb.from('practice').select('*').in('drill_id', ids);
    G.practiceLog = (data || []).map(_sbRowToPractice);
    _cache('mc_practice', G.practiceLog);
  });
}

async function _sbLoadTeacherGames() {
  return _sbRun('_sbLoadTeacherGames', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const ids = G.drills.map(d => String(d.id));
    // 1) Parties Maia liées aux modules du prof (drill_id).
    let maia = [];
    if (ids.length) {
      const { data } = await sb.from('games').select('*').in('drill_id', ids);
      maia = (data || []).map(_sbRowToGame);
    }
    // 2) Parties bibliothèque partagées (drill_id null) — RLS games_read filtre aux élèves du prof.
    const { data: libRows } = await sb.from('games').select('*').is('drill_id', null);
    const lib = (libRows || []).map(_sbRowToGame).filter(g => g.shared);
    // Fusion dédoublonnée par id.
    const byId = {};
    [...maia, ...lib].forEach(g => { byId[g.id] = g; });
    G.savedGames = Object.values(byId);
    _cache('mc_games', G.savedGames);
  });
}

// Progression SM-2 (mastery) — stockée dans profiles.mastery (jsonb).
async function _sbSaveMastery() {
  const student = G.currentUser && (G.currentUser.displayName || G.currentUser.email);
  return _sbRun('_sbSaveMastery', sb && G.currentUser && student, async () => {
    const prefix = student + '_';
    const mine = {};
    for (const k in G.masteryData) if (k.startsWith(prefix)) mine[k] = G.masteryData[k];
    const { error } = await sb.from('profiles').update({ mastery: mine }).eq('id', G.currentUser.uid);
    if (error) throw error;
  });
}

async function _sbLoadMastery() {
  return _sbRun('_sbLoadMastery', sb && G.currentUser, async () => {
    const { data } = await sb.from('profiles').select('mastery').eq('id', G.currentUser.uid).maybeSingle();
    const m = data && data.mastery;
    if (m) {
      for (const k in m) if (!G.masteryData[k] || (m[k].due || 0) > (G.masteryData[k].due || 0)) G.masteryData[k] = m[k];
      _cache('mc_mastery', G.masteryData);
    }
  });
}

// ── Bases PGN personnelles (Pilier 1) — stockées dans profiles.extra.bases (jsonb) ──
// Défensif : si la colonne `extra` n'existe pas encore, l'erreur est catchée sans
// casser le reste (migration idempotente : alter table profiles add column if not exists extra jsonb default '{}';).
async function _sbSaveBases() {
  return _sbRun('_sbSaveBases', sb && G.currentUser && G.currentRole === 'student', async () => {
    const { error } = await sb.from('profiles').update({ extra: { bases: G.bases } }).eq('id', G.currentUser.uid);
    if (error) throw error;
  });
}

async function _sbLoadBases() {
  if (!sb || !G.currentUser) return;
  try {
    const { data } = await sb.from('profiles').select('extra').eq('id', G.currentUser.uid).maybeSingle();
    G.bases = (data && data.extra && data.extra.bases) || [];
    _cache('mc_bases', G.bases);
  } catch (e) { console.warn('_sbLoadBases (colonne extra manquante ?)', e); }
}


// ══════════════════════════════════════════════════════
// PONT window — expose les fonctions du module aux handlers inline onclick=""
// (genere : toutes les fonctions top-level du module ES)
// ══════════════════════════════════════════════════════
// Nettoyé (audit #6) : seuls les noms réellement résolus au runtime par un
// onclick="" (index.html ou HTML généré) ou par un autre module via window.X
// restent exposés. Les fonctions appelées uniquement en interne (app.js les a
// déjà dans sa portée) ne sont plus sur le pont (32 exports morts retirés).
Object.assign(window, {
  _buildDrillTree, _commentDelay, _commentWithShapes, _drillSessions, _findNodeByFen,
  _materialHint, _nagGroup, _parseShapes, _sbDeleteClass, _sbDeleteStudentModule,
  _sbRecordPractice, _sbRecordResult, _sbSaveClass, _sbSaveGame, _sbUpdateGame, _sbDeleteGame,
  _sbSaveMastery, _sbSaveBases, _sbSaveStudentModule, _shapesToPGN, _treePlayerPositions,
  addLog, clearFeedback, clearLog, closeModal, confirmName, countPlayerMoves, currentGame,
  currentSession, deleteModule, editorTreeToPGN, escapeHtml, fig, goPage, goBackFromDrill, initDrillPage,
  isLineMode, isPlayerMove, loadStudentModules, loginUser, logoutUser, nagGlyphs, nextDrill,
  nextSession, pgnToEditorTree, registerUser, requestPasswordReset, save, saveClasses,
  selectDrill, setBoardComment, setBoardPrompt, setFeedback, showHint, signInGoogle,
  togglePwd, showLoginTab, skipPosition, startDrill, submitNewPassword, switchCoachSection,
  saveModule, toast, toggleTheme, toggleAcctMenu, totalSessions, updateScores, updateSessionInfo,
});
