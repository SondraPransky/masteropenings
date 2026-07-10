// ════════════════════════════════════════════════════════════
//  Déclarations ambiantes pour les libs chargées par <script> (CDN)
//  But : que le type-check résolve ces globals sans les typer finement.
//  (On type NOTRE code, pas les libs tierces.)
// ════════════════════════════════════════════════════════════

// chess.js 0.10.3 — https://cdnjs.cloudflare.com/.../chess.min.js
declare class Chess {
  constructor(fen?: string);
  move(move: string | { from: string; to: string; promotion?: string }): any;
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

  // — Helpers / vues (app.js) —
  fig?: (...a: any[]) => any;
  escapeHtml?: (...a: any[]) => any;
  toast?: (...a: any[]) => any;
  save?: (...a: any[]) => any;
  showPromoPicker?: (...a: any[]) => any;
  renderDrillList?: (...a: any[]) => any;
  renderClassModuleSelect?: (...a: any[]) => any;
  loadStudentModules?: (...a: any[]) => any;
  syncModuleToFirestore?: (...a: any[]) => any;
  _sbSaveStudentModule?: (...a: any[]) => any;
  renderEditorBoard?: (...a: any[]) => any;

  // — Board / feedback / score (app.js) —
  drawBoard?: (...a: any[]) => any;
  setFeedback?: (...a: any[]) => any;
  clearFeedback?: (...a: any[]) => any;
  setBoardComment?: (...a: any[]) => any;
  setBoardPrompt?: (...a: any[]) => any;
  addLog?: (...a: any[]) => any;
  updateScores?: (...a: any[]) => any;

  // — Sessions / enregistrement (app.js) —
  currentSession?: (...a: any[]) => any;
  totalSessions?: (...a: any[]) => any;
  updateSessionInfo?: (...a: any[]) => any;
  resizeBoard?: (...a: any[]) => any;
  recordResult?: (...a: any[]) => any;
  recordPracticeSession?: (...a: any[]) => any;
  showEndModal?: (...a: any[]) => any;
  updateReviserToutBadge?: (...a: any[]) => any;

  // — Répétition espacée (SR, app.js → futur lib/sr.js) —
  _srToggleBar?: (...a: any[]) => any;
  _srUpdateBar?: (...a: any[]) => any;
  _srAnswer?: (...a: any[]) => any;
  _srBilan?: (...a: any[]) => any;

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
}
