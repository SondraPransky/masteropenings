// ════════════════════════════════════════════════════════════
//  supabase-data.js — couche d'accès Supabase (MIGRATION INCRÉMENTALE)
//
//  Activé UNIQUEMENT si USE_SUPABASE = true. Tant que c'est false,
//  l'app tourne 100 % sur Firebase, ce fichier ne fait QUE définir des
//  fonctions (aucun effet). On bascule quand chaque étape est portée.
//
//  Étape EN COURS : AUTHENTIFICATION (login / register / logout / session).
//  À venir : modules, classes, résultats, pratique, parties.
// ════════════════════════════════════════════════════════════
const USE_SUPABASE = false;   // ← mettre true pour basculer l'authentification sur Supabase

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

// Équivalent de fbAuth.onAuthStateChanged : pilote la session + le routage.
function _sbInitAuth() {
  sb.auth.onAuthStateChange(async (_event, session) => {
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
