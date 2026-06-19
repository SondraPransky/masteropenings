// ════════════════════════════════════════════════════════════
//  CONFIGURATION FIREBASE — à remplir une seule fois
//  1. Allez sur console.firebase.google.com
//  2. Créez un projet (ex : "eecoach")
//  3. Activez Authentication → Email/Mot de passe
//  4. Activez Firestore Database (mode Production, région europe-west1)
//  5. Paramètres du projet → Applications → Web → copiez le bloc ci-dessous
// ════════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey:            "VOTRE_API_KEY",
  authDomain:        "VOTRE_PROJET.firebaseapp.com",
  projectId:         "VOTRE_PROJET_ID",
  storageBucket:     "VOTRE_PROJET.appspot.com",
  messagingSenderId: "VOTRE_SENDER_ID",
  appId:             "VOTRE_APP_ID"
};

// Collections Firestore
const C_USERS   = 'users';
const C_MODULES = 'modules';
const C_CLASSES = 'classes';
const C_RESULTS = 'results';
