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
