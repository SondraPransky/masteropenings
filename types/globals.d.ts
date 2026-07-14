// ════════════════════════════════════════════════════════════
//  Déclarations ambiantes pour les libs chargées par <script> (CDN)
//  But : que le type-check résolve ces globals sans les typer finement.
//  (On type NOTRE code, pas les libs tierces.)
// ════════════════════════════════════════════════════════════

// chess.js 0.10.3 — https://cdnjs.cloudflare.com/.../chess.min.js
declare class Chess {
  constructor(fen?: string);
  move(move: string | { from: string; to: string; promotion?: string }, opts?: any): any;
  moves(opts?: any): any;
  fen(): string;
  load(fen: string): boolean;
  reset(): void;
  turn(): "w" | "b";
  in_check(): boolean;
  in_checkmate(): boolean;
  in_stalemate(): boolean;
  in_draw(): boolean;
  game_over(): boolean;
  history(opts?: any): any;
  undo(): any;
  get(square: string): any;
  put(piece: any, square: string): boolean;
  remove(square: string): any;
  pgn(opts?: any): string;
  load_pgn(pgn: string, opts?: any): boolean;
  header(...args: string[]): any;
  square_color(square: string): "light" | "dark" | null;
  [key: string]: any;
}

// onnxruntime-web (global) — https://cdn.jsdelivr.net/npm/onnxruntime-web/...
declare const ort: any;

// @supabase/supabase-js (global `supabase` exposé par le CDN)
declare const supabase: any;

// lib/core.js et lib/dbmap.js sont désormais des MODULES ES importés par app.js
// (plus de globals ni de `module.exports`). Leurs types proviennent de leurs `export` :
// aucune déclaration ambiante nécessaire ici.

// ════════════════════════════════════════════════════════════
//  Augmentations DOM pragmatiques (code vanilla "legacy")
//  getElementById() → HTMLElement, querySelector() → Element,
//  event.target → EventTarget : aucun n'expose .value/.checked/.style/etc.
//  On les ajoute en OPTIONNEL pour supprimer le bruit connu du type-check,
//  SANS masquer les vraies fautes de frappe sur NOS propres objets.
// ════════════════════════════════════════════════════════════
interface HTMLElement {
  value?: any;
  checked?: boolean;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  selectedIndex?: number;
  width?: number;
  height?: number;
  getContext?(contextId: string, options?: any): any;
}
interface Element {
  style?: any;
  dataset?: any;
  value?: any;
  focus?(): void;
  offsetParent?: any;
}
interface EventTarget {
  closest?(selectors: string): any;
  value?: any;
  checked?: boolean;
  dataset?: any;
}

// ════════════════════════════════════════════════════════════
//  Pont `window` — fonctions/assets partagés entre modules ES.
//  `app.js` expose ses fonctions via Object.assign(window, {…}) ; les modules
//  `lib/*` les résolvent au runtime (`window.foo?.(…)`) et exposent en retour
//  leurs propres fonctions. On les DÉCLARE ici (optionnelles, assignées au
//  runtime) pour supprimer le bruit du type-check SANS index signature
//  `[key:string]:any` — ainsi une vraie faute de frappe sur `window.xxx`
//  reste détectée. À compléter au fil des extractions.
// ════════════════════════════════════════════════════════════
interface Window {
  // — Assets partagés (données) —
  PIECE_CDN?: string;
  pieceImgs?: any;
  _E?: any;            // état éditeur (lib/editor.js)
  _lastMoveXY?: { x: number; y: number };   // dernières coords pointeur (board → lib/maia.js promo)

  // — Helpers / vues (app.js) —
  fig?: (...a: any[]) => any;
  escapeHtml?: (...a: any[]) => any;
  toast?: (...a: any[]) => any;
  save?: (...a: any[]) => any;
  showPromoPicker?: (...a: any[]) => any;
  renderDrillList?: (...a: any[]) => any;
  renderClassModuleSelect?: (...a: any[]) => any;
  loadStudentModules?: (...a: any[]) => any;
  saveModule?: (...a: any[]) => any;
  _sbSaveStudentModule?: (...a: any[]) => any;
  openPositionSetupForExercise?: (...a: any[]) => any;   // lib/setup.js (exercices)
  _exOnPositionReady?: (...a: any[]) => any;             // lib/exercises.js (retour position)
  renderEditorBoard?: (...a: any[]) => any;

  // — Board / feedback / score (app.js) —
  drawBoard?: (...a: any[]) => any;
  setFeedback?: (...a: any[]) => any;
  clearFeedback?: (...a: any[]) => any;
  setBoardComment?: (...a: any[]) => any;
  setBoardPrompt?: (...a: any[]) => any;
  addLog?: (...a: any[]) => any;
  clearLog?: (...a: any[]) => any;
  drawCoords?: (...a: any[]) => any;
  updateScores?: (...a: any[]) => any;
  goPage?: (...a: any[]) => any;
  closeModal?: (...a: any[]) => any;
  isLineMode?: (...a: any[]) => any;
  currentGame?: (...a: any[]) => any;   // reste dans app.js, consommé par lib/board.js
  startDrill?: (...a: any[]) => any;
  nextDrill?: (...a: any[]) => any;
  switchCoachSection?: (...a: any[]) => any;
  sm2Get?: (...a: any[]) => any;

  // — Vue coach / suivi élèves (lib/coach.js) —
  retryCoachLoad?: (...a: any[]) => any;
  _eleveListKey?: (...a: any[]) => any;
  renderProfView?: (...a: any[]) => any;
  renderHeatmap?: (...a: any[]) => any;
  pgnToEditorTree?: (...a: any[]) => any;
  openWeakspotPosition?: (...a: any[]) => any;
  wsTip?: (...a: any[]) => any;
  wsTipHide?: (...a: any[]) => any;
  hmSelectMod?: (...a: any[]) => any;
  pgSearch?: (...a: any[]) => any;
  pgFilterStatus?: (...a: any[]) => any;
  _updatePartiesBadge?: (...a: any[]) => any;
  modSearch?: (...a: any[]) => any;
  modFilterType?: (...a: any[]) => any;
  modSortBy?: (...a: any[]) => any;
  modSelectFolder?: (...a: any[]) => any;
  renameModFolder?: (...a: any[]) => any;
  moveDrillToFolder?: (...a: any[]) => any;
  figurineText?: (s: string) => string;
  renderOverview?: (...a: any[]) => any;
  ovOpenStudent?: (...a: any[]) => any;
  renderClassesPage?: (...a: any[]) => any;
  openClassDetail?: (...a: any[]) => any;
  closeClassDetail?: (...a: any[]) => any;
  renderPartiesTab?: (...a: any[]) => any;
  _deadlinePill?: (...a: any[]) => any;

  // — Accueil élève (lib/student.js) —
  _myIdentifiers?: (...a: any[]) => any;
  renderStudentHome?: (...a: any[]) => any;
  _sbDeleteStudentModule?: (...a: any[]) => any;

  // — Sessions / enregistrement (app.js) —
  currentSession?: (...a: any[]) => any;
  totalSessions?: (...a: any[]) => any;
  updateSessionInfo?: (...a: any[]) => any;
  resizeBoard?: (...a: any[]) => any;
  recordResult?: (...a: any[]) => any;
  recordPracticeSession?: (...a: any[]) => any;
  showEndModal?: (...a: any[]) => any;
  updateReviserToutBadge?: (...a: any[]) => any;

  // — Répétition espacée (lib/sr.js) —
  _srToggleBar?: (...a: any[]) => any;
  _srUpdateBar?: (...a: any[]) => any;
  _srAnswer?: (...a: any[]) => any;
  _srBilan?: (...a: any[]) => any;
  _srSessionSize?: (...a: any[]) => any;
  renderSrDashboard?: (...a: any[]) => any;
  _srGetLadder?: (...a: any[]) => any;
  _srSetLadder?: (...a: any[]) => any;
  _srApplyPreset?: (...a: any[]) => any;
  _srLadderAddRung?: (...a: any[]) => any;
  _srLadderRemoveRung?: (...a: any[]) => any;
  srFlashDone?: (...a: any[]) => any;

  // — Drill (lib/drill.js) —
  startLineDrill?: (...a: any[]) => any;
  tryMoveInLine?: (...a: any[]) => any;
  skipLinePosition?: (...a: any[]) => any;
  loadPosition?: (...a: any[]) => any;
  renderPosStrip?: (...a: any[]) => any;
  tryMoveInPositions?: (...a: any[]) => any;
  // arbre/étude
  startTreeDrill?: (...a: any[]) => any;
  tryMoveInTree?: (...a: any[]) => any;
  _treeUnseenCount?: (...a: any[]) => any;
  startStudyPhase?: (...a: any[]) => any;
  _setStudyLayout?: (...a: any[]) => any;
  studyGoPath?: (...a: any[]) => any;
  studyNext?: (...a: any[]) => any;
  studyPrev?: (...a: any[]) => any;
  toggleStudyGuess?: (...a: any[]) => any;
  tryStudyGuess?: (...a: any[]) => any;
  _studyGuessReady?: (...a: any[]) => any;
  // phases apprentissage/test
  startLearnPhase?: (...a: any[]) => any;
  learnNext?: (...a: any[]) => any;
  learnPrev?: (...a: any[]) => any;
  enterTestPhase?: (...a: any[]) => any;
  showEndModal?: (...a: any[]) => any;
  replayErrors?: (...a: any[]) => any;

  // — Gestion modules & classes (lib/modules.js) —
  injectDemoDrill?: (...a: any[]) => any;
  renderClassList?: (...a: any[]) => any;
  _studentDisplayName?: (email: string) => string;
  saveClasses?: (...a: any[]) => any;
  deleteModule?: (...a: any[]) => any;
  _sbSaveClass?: (...a: any[]) => any;
  _sbDeleteClass?: (...a: any[]) => any;

  // — Mastery & enregistrement (lib/mastery.js) — writers Supabase restés dans app.js —
  _sbRecordResult?: (...a: any[]) => any;
  _sbRecordPractice?: (...a: any[]) => any;
  _sbSaveGame?: (...a: any[]) => any;
  _sbUpdateGame?: (...a: any[]) => any;      // UPDATE partie (partage/annotation, app.js)
  _sbDeleteGame?: (...a: any[]) => any;      // DELETE partie (app.js)
  _sbLoadStudentGames?: (...a: any[]) => any; // charge les parties de l'élève connecté (app.js)
  _sbSaveMastery?: (...a: any[]) => any;

  // — Ma bibliothèque / bases PGN (lib/library.js + app.js) — Pilier 1 —
  renderMyLibrary?: (...a: any[]) => any;
  _sbSaveBases?: (...a: any[]) => any;
  _sbLoadBases?: (...a: any[]) => any;
  openGameEditor?: (...a: any[]) => any;   // éditeur en mode saisie de partie (lib/editor.js)
  openPgnEditorNew?: (...a: any[]) => any;  // éditeur module vierge, startFen optionnel (lib/editor.js)
  openPositionSetup?: (...a: any[]) => any; // éditeur de position module (tranche C, lib/setup.js)
  openPositionSetupForGame?: (...a: any[]) => any; // éditeur de position partie (lib/setup.js)
  _boardEntryDone?: (...a: any[]) => any;  // callback retour éditeur → modal (lib/library.js)
  openReviewEditor?: (...a: any[]) => any; // éditeur en mode revue coach (P1.4, lib/editor.js)
  _reviewSaveDone?: (...a: any[]) => any;  // callback retour revue → bibliothèque (P1.4, lib/library.js)
  toggleShareGame?: (...a: any[]) => any;  // partager une partie au coach (P1.3, lib/library.js)
  openGameReview?: (...a: any[]) => any;   // élève ouvre sa partie annotée (P1.5, lib/library.js)
  annotateSharedGame?: (...a: any[]) => any; // coach annote une partie partagée (P1.4, lib/coach.js)

  // — Moteur Maia (lib/maia.js) —
  saveGame?: (...a: any[]) => any;   // reste dans app.js, appelé par maia.js (défini dans lib/mastery.js)
  loadMaia?: (...a: any[]) => any;
  enginePlay?: (...a: any[]) => any;
  startPostTheory?: (...a: any[]) => any;
  quitMaiaGame?: (...a: any[]) => any;
  playVsMaia?: (...a: any[]) => any;
  tryMovePostTheory?: (...a: any[]) => any;
  _afterMaiaReady?: (...a: any[]) => any;
  _checkPTEnd?: (...a: any[]) => any;
}
