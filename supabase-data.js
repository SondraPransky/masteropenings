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
    // NOTE : chargement des modules/résultats = étape SUIVANTE (données).
    goPage(currentRole === 'student' ? 'student-home' : 'coach');
  });
}
