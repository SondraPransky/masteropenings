// ══════════════════════════════════════════════════════
// lib/session.js — ÉTAT SESSION DE DRILL (le « holder » `S`).
// Partagé entre app.js (couche board, dispatch) et lib/drill.js (moteur drill).
// Comme `G` (state.js) : on ne RÉASSIGNE jamais `S` (un `import` ES est en
// lecture seule), on mute uniquement ses PROPRIÉTÉS (`S.drill = …`).
// D'autres champs sont ajoutés dynamiquement au runtime (`S.sr`, `S._forcedPath`,
// `S.pauseAdversary`, `S.hintSquare`, `S.errorOnlySet`, `S.studyNode`…).
// ══════════════════════════════════════════════════════
export const S = {
  idx:      0,
  drill:    null,
  // Sessions (plusieurs lignes dans un drill)
  sessionIdx: 0,
  // Mode positions clés
  kps:      [],
  posIdx:   0,
  game:     null,
  // Exercices multi-coups (mat en N / combinaison forcée) : index du demi-coup
  // courant dans kp.line, + verrou pendant la réplique adverse auto-jouée.
  exPly:    0,
  exWaiting: false,
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
