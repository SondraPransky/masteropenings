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
    if (currentRole === 'teacher') { await _sbLoadTeacherModules(); goPage('coach'); }
    else { goPage('student-home'); /* loadStudentModules : étape données suivante */ }
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
