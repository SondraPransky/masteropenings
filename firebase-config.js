// ════════════════════════════════════════════════════════════
//  CONFIGURATION FIREBASE — à remplir une seule fois
//  1. Allez sur console.firebase.google.com
//  2. Créez un projet (ex : "eecoach")
//  3. Activez Authentication → Email/Mot de passe
//  4. Activez Firestore Database (mode Production, région europe-west1)
//  5. Paramètres du projet → Applications → Web → copiez le bloc ci-dessous
// ════════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAuXxUZ8M8dtAgMgPidNDex4440xGzByb0",
  authDomain:        "masteropenings-e1855.firebaseapp.com",
  projectId:         "masteropenings-e1855",
  storageBucket:     "masteropenings-e1855.firebasestorage.app",
  messagingSenderId: "19882800133",
  appId:             "1:19882800133:web:a278a8d680574e4903d86c"
};

// Collections Firestore
const C_USERS    = 'users';
const C_MODULES  = 'modules';
const C_CLASSES  = 'classes';
const C_RESULTS  = 'results';
const C_PRACTICE = 'practice';
const C_GAMES    = 'games';
