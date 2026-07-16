// ════════════════════════════════════════════════════════════
//  state.js — ÉTAT GLOBAL MUTABLE PARTAGÉ (le « holder »).
//  But : permettre à de futurs modules `features/*` de LIRE et RÉASSIGNER
//  cet état. Un `import` ES est en lecture seule → on ne peut pas réassigner
//  un binding importé ; mais on peut muter les PROPRIÉTÉS d'un objet importé.
//  D'où ce conteneur unique `G` : partout `drills` devient `G.drills`, etc.
//  Initialisé depuis localStorage (comme avant), au chargement du module.
// ════════════════════════════════════════════════════════════
export const G = {
  // — Auth / session utilisateur —
  currentUser:   null,
  currentRole:   null,
  currentPseudo: null,
  pendingRole:   null,
  // — Données (miroir local de Supabase) —
  drills:      JSON.parse(localStorage.getItem('mc_drills')    || '[]'),
  results:     JSON.parse(localStorage.getItem('mc_results')   || '[]'),
  practiceLog: JSON.parse(localStorage.getItem('mc_practice')  || '[]'),
  savedGames:  JSON.parse(localStorage.getItem('mc_games')     || '[]'),
  masteryData: JSON.parse(localStorage.getItem('mc_mastery')   || '{}'),
  oppSeen:     JSON.parse(localStorage.getItem('mc_opp_seen')  || '{}'),
  classes:     JSON.parse(localStorage.getItem('mc_classes')   || '[]'),
  // — Pilier 1 : bases PGN personnelles de l'élève (dossiers { id, name, created }) —
  bases:       JSON.parse(localStorage.getItem('mc_bases')     || '[]'),
  // — Couches d'édition élève, vues par le COACH (lignes que ses élèves ont greffées sur
  //   ses modules). Non persistées : rechargées à chaque _coachLoad, jamais éditées ici.
  studentOverlays: [],
};
