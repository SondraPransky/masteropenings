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

// Firebase 10 (compat, global) — https://www.gstatic.com/firebasejs/...
declare const firebase: any;

// onnxruntime-web (global) — https://cdn.jsdelivr.net/npm/onnxruntime-web/...
declare const ort: any;

// @supabase/supabase-js (global `supabase` exposé par le CDN)
declare const supabase: any;

// Node/Vitest : `module` n'existe que côté Node (export de lib/core.js),
// gardé par `typeof module !== 'undefined'` → undefined et inerte dans le navigateur.
declare var module: any;

// ════════════════════════════════════════════════════════════
//  lib/core.js expose ces fonctions en GLOBALES dans le navigateur
//  (script classique chargé avant app.js). Comme lib/core.js a un
//  `module.exports`, TS le voit comme un module → ces déclarations
//  ambiantes rendent ses fonctions visibles à app.js.
// ════════════════════════════════════════════════════════════
declare function _normFen(fen: string): string;
declare function sm2Schedule(
  prev: { ef?: number; interval?: number; reps?: number; due?: number } | null,
  correct: any,
  now?: number
): { ef: number; interval: number; reps: number; due: number };
declare function normalizeSAN(san: string, g: any): string;
declare function extractAllLines(
  pgn: string
): Array<{ label: string; depth: number; startFen: string; moves: any[] }>;

// lib/dbmap.js — mappers objet app ↔ ligne SQL (globaux dans le navigateur)
declare function _sbModuleToRow(d: any): any;
declare function _sbRowToModule(r: any): any;
declare function _sbClassToRow(c: any): any;
declare function _sbRowToClass(r: any): any;
declare function _sbResultToRow(r: any): any;
declare function _sbRowToResult(r: any): any;
declare function _sbPracticeToRow(r: any): any;
declare function _sbRowToPractice(r: any): any;
declare function _sbGameToRow(r: any): any;
declare function _sbRowToGame(r: any): any;

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
