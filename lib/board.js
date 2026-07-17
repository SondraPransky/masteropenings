// ══════════════════════════════════════════════════════
// ÉCHIQUIER DU DRILL — Chessground (le board de Lichess), même moteur que
// l'explorateur et l'outil OTKB original. Réécrit depuis le rendu canvas maison
// (juillet 2026) pour UNIFIER tous les échiquiers du site.
//
// ⚠️ L'API EXPOSÉE est PRÉSERVÉE (drawBoard/resizeBoard/drawCoords/flipBoard/
//    tryMove/canInteract/showPromoPicker…) : les ~56 appelants (drill, maia,
//    study, sr, app) sont INCHANGÉS. Seul le CORPS change : piloter une instance
//    Chessground au lieu de peindre un canvas.
//
// - Rendu : `drawBoard()` → `cg.set(...)` calculé depuis `currentGame()`, `S` et
//   `canInteract()` (gating inchangé). Coups légaux = `movable.dests` ; dernier
//   coup / échec = natifs ; formes d'étude + indice = `setAutoShapes`.
// - Entrée : `movable.events.after(orig,dest)` → `_lastMoveXY` (rect, lu par
//   maia.js pour le promo) → `tryMove(orig,dest)` (dispatch INCHANGÉ).
// - Taille : `resizeBoard()` garde TOUTE sa math (budget dérivé du DOM) ; elle
//   dimensionne le CONTENEUR `#board` puis `cg.redrawAll()`.
// - Sélection : Chessground la possède (S.sel n'est plus lu que remis à null par
//   le drill — vérifié : 0 lecteur externe, tous les writers l'effacent).
// - Couleur : le damier suit le thème via `otkb-cg-theme.css` (variables --board-*).
//
// Couleurs de cases = variables CSS (sélecteur de thème) ; pièces cburnett.
// `S` (session.js), Chessground via loader partagé (lib/chessground.js).
// `currentGame`/`isLineMode` (app.js) résolus via window.
// ══════════════════════════════════════════════════════
import { S } from './session.js';
import { loadChessground } from './chessground.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const currentGame = (...a) => window.currentGame?.(...a);
const isLineMode  = (...a) => window.isLineMode?.(...a);

let BSIZE=480, SQ=60;   // conservés pour la math de resizeBoard (budget/plafonds)
const FILES=['a','b','c','d','e','f','g','h'];

// ── Pièces cburnett bundlées en local — CONSERVÉ : l'éditeur (lib/editor.js)
//    lit `window.pieceImgs` pour son ghost de drag jusqu'à sa propre conversion
//    Chessground (étape C). Le drill, lui, n'en a plus besoin (Chessground rend
//    ses pièces via CSS). ──
const PIECE_CDN='https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/cburnett/';
const _importMetaEnv = /** @type {any} */ (import.meta).env;
const _PIECE_BASE=((_importMetaEnv && _importMetaEnv.BASE_URL) || './');
const PIECE_LOCAL=_PIECE_BASE+'pieces/cburnett/';
const pieceImgs={}; window.pieceImgs=pieceImgs; window.PIECE_CDN=PIECE_CDN;
['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'].forEach(k=>{
  const img=new Image(); img.crossOrigin='anonymous';
  img.onerror=()=>{ const cdn=PIECE_CDN+k+'.svg'; if(img.src!==cdn) img.src=cdn; };  // fallback CDN (une fois)
  img.src=PIECE_LOCAL+k+'.svg'; pieceImgs[k]=img;
});

// ── Instance Chessground ──────────────────────────────
// ⚠️ Chessground DOIT être créé quand `#board` est VISIBLE (dimensions non nulles) :
// créé sur un élément masqué (page-drill cachée), il ne calcule pas ses bornes et
// ne peint rien. On le monte donc PARESSEUSEMENT, au premier `drawBoard` qui
// survient alors que le plateau est visible (même contrainte que l'explorateur).
let _cg = null;
let _cgLoading = false;
function _ensureCg() {
  if (_cg) return true;
  const el = document.getElementById('board');
  if (!el || !el.clientWidth) return false;   // pas encore visible → réessaie au prochain draw
  if (_cgLoading) return false;
  _cgLoading = true;
  loadChessground().then(Cg => {
    const host = document.getElementById('board');
    if (!host) { _cgLoading = false; return; }
    _cg = Cg(host, {
      coordinates: true,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: { free: false, showDests: true, events: { after: _onMove } },
      drawable: { enabled: false },
    });
    _cgLoading = false;
    resizeBoard();
    drawBoard();
  }).catch(() => { _cgLoading = false; });
  return false;
}

// Centre-écran d'une case (orientation courante) — pour positionner le sélecteur
// de promo (maia.js lit `_lastMoveXY`).
function _sqScreenXY(sq) {
  const el = document.getElementById('board');
  if (!el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  const fi = FILES.indexOf(sq[0]);
  const rk = parseInt(sq[1], 10);
  const col = S.flipped ? 7 - fi : fi;
  const row = S.flipped ? rk - 1 : 8 - rk;
  return { x: r.left + (col + 0.5) * r.width / 8, y: r.top + (row + 0.5) * r.height / 8 };
}

// Coup joué SUR le plateau Chessground (drag ou clic-clic natif) → dispatch.
function _onMove(orig, dest) {
  const p = _sqScreenXY(dest);
  _lastMoveXY.x = p.x; _lastMoveXY.y = p.y;   // lu par maia.js pour le promo
  tryMove(orig, dest);
}

// Couleurs de formes d'étude → pinceaux Chessground (mêmes noms natifs).
const _CG_BRUSHES = new Set(['green', 'red', 'blue', 'yellow']);
function _brush(color) { return _CG_BRUSHES.has(color) ? color : 'green'; }

// ── Rendu : synchronise Chessground sur l'état courant (même NOM, corps neuf) ──
function drawBoard() {
  if (!_ensureCg()) return;
  const g = currentGame();
  if (!g) {
    _cg.set({ fen: '8/8/8/8/8/8/8/8', lastMove: undefined, check: false,
              movable: { color: undefined, dests: new Map() } });
    _cg.setAutoShapes([]);
    return;
  }
  const turn = g.turn() === 'w' ? 'white' : 'black';
  const inter = canInteract();
  const dests = new Map();
  if (inter) {
    for (const m of g.moves({ verbose: true })) {
      const arr = dests.get(m.from) || []; arr.push(m.to); dests.set(m.from, arr);
    }
  }
  const hist = g.history({ verbose: true });
  const last = hist.length ? [hist[hist.length - 1].from, hist[hist.length - 1].to] : undefined;
  _cg.set({
    fen: g.fen(),
    orientation: S.flipped ? 'black' : 'white',
    turnColor: turn,
    check: g.in_check(),
    lastMove: last,
    movable: { free: false, color: inter ? turn : undefined, dests },
  });
  // Indice (case source dorée) + flèches/cercles du PGN en phase étude.
  const shapes = [];
  if (S.hintSquare) shapes.push({ orig: S.hintSquare, brush: 'yellow' });
  if (S.phase === 'study' && S.studyNode && S.studyNode.shapes && S.studyNode.shapes.length) {
    for (const sh of S.studyNode.shapes) {
      const brush = _brush(sh.color);
      if (sh.type === 'circle') shapes.push({ orig: sh.square, brush });
      else shapes.push({ orig: sh.from, dest: sh.to, brush });
    }
  }
  _cg.setAutoShapes(shapes);
}

// ── Taille : math CONSERVÉE (budget dérivé du DOM), dimensionne le conteneur ──
function resizeBoard() {
  const wrap = document.getElementById('board-wrap');
  if (!wrap) return;
  if (!wrap.clientWidth) return;   // page masquée → ne pas rétrécir le plateau à son minimum
  // Budget hauteur DÉRIVÉ DU DOM (cf. historique : une constante ou une part de
  // innerHeight se trompent — le chrome dépend du titre, du wrap des contrôles, du
  // thème). above = ce qui précède le plateau ; below = ce qui le suit dans le wrap.
  const rect  = wrap.getBoundingClientRect();
  const above = rect.top + window.scrollY;
  const below = Math.max(0, rect.height - BSIZE);
  const PAD_BOTTOM = 24;

  // Sur écran court, c'est le panneau de notation qui pousse la hauteur, pas le
  // plateau → plancher = panneau - below, plafonné par « le plateau reste visible ».
  const side   = wrap.parentElement?.querySelector('.sidebar');
  const fitH   = window.innerHeight - above - below - PAD_BOTTOM;
  const floorH = side ? side.getBoundingClientRect().height - below : 0;
  const capH   = window.innerHeight - above - PAD_BOTTOM;
  const availH = Math.min(Math.max(fitH, floorH), capH);

  const avail = Math.min(wrap.clientWidth - 30, availH, 720);   // 720 = 90px/case
  // Ce qui tient dans la FENÊTRE (le wrap peut être plus étroit que la page sans
  // clipper ; ce qui coupe c'est la fenêtre). Chrome latéral MESURÉ, pas deviné.
  const outer      = document.querySelector('.board-outer');
  const sideChrome = outer ? Math.max(0, outer.getBoundingClientRect().width - BSIZE) : 0;
  const viewCap    = Math.floor((window.innerWidth - sideChrome) / 8) * 8;
  const floor      = Math.min(320, viewCap);
  const newSize    = Math.min(viewCap, Math.max(floor, Math.floor(avail / 8) * 8));
  BSIZE = newSize; SQ = BSIZE / 8;
  const el = document.getElementById('board');
  if (el) { el.style.width = BSIZE + 'px'; el.style.height = BSIZE + 'px'; }
  // redrawAll SYSTÉMATIQUE quand l'instance existe : au premier affichage la taille
  // peut déjà valoir BSIZE (calc à froid) mais le plateau n'a jamais été peint car
  // créé masqué → toujours re-peindre (opération rare, débouncée).
  if (_cg) _cg.redrawAll();
}

let _resizeTimer;
window.addEventListener('resize', ()=>{
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(resizeBoard, 120);
});

// Touches ← → pour naviguer en phase apprentissage (ligne) ET étude (arbre PGN)
document.addEventListener('keydown', e => {
  if (S.phase !== 'learn' && S.phase !== 'study') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'ArrowRight') { e.preventDefault(); window.learnNext?.(); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); window.learnPrev?.(); }
});

// Coordonnées : Chessground les dessine lui-même → no-op (conservé : 5 appelants).
function drawCoords() {}

// ── Gating de l'interaction (INCHANGÉ) ─────────────────
function canInteract() {
  if (S.preview) return false;                                   // aperçu lecture-seule (clic-navigation)
  if (S.srFlash) return false;                                   // phase « flash » d'une nouvelle position SR
  if (S.exWaiting) return false;                                 // exercice multi-coups : réplique adverse auto en cours
  if (S.phase === 'study') return window._studyGuessReady?.();   // interactif seulement en mode « devine le coup »
  if (S.phase === 'learn') return false;
  const g=currentGame();
  if(!g) return false;
  if(S.postTheory) return S.lineGame && !S.lineGame.game_over() && S.lineGame.turn()===S.drill.side;
  if(S.drill?.varmode === 'tree') return S.waitingForPlayer;
  if(isLineMode()) return S.waitingForPlayer;
  return S.posIdx < S.kps.length;
}

// _lastMoveXY : objet stable (muté en place) — lu par lib/maia.js pour positionner
// le sélecteur de promo.
const _lastMoveXY={x:0,y:0}; window._lastMoveXY=_lastMoveXY;

// ── Dispatch d'un coup (INCHANGÉ) ─────────────────────
function tryMove(from, to) {
  if(S.phase==='study') { window.tryStudyGuess?.(from,to); return; }
  if(S.sr && S.sr.active) { window.tryMoveInPositions?.(from,to); return; }   // session SR : flux « positions »
  if(S.postTheory) window.tryMovePostTheory?.(from,to);
  else if(S.drill?.varmode==='tree') window.tryMoveInTree?.(from,to);
  else if(isLineMode()) window.tryMoveInLine?.(from,to);
  else window.tryMoveInPositions?.(from,to);
}

function flipBoard(){ S.flipped=!S.flipped; drawBoard(); }

// ── Promotion picker (INCHANGÉ — partagé avec éditeur et Maia) ──────
let _promoCallback = null;
function showPromoPicker(color, cx, cy, cb) {
  _promoCallback = cb;
  const pick = document.getElementById('promo-pick');
  const bd   = document.getElementById('promo-backdrop');
  pick.innerHTML = ['q','r','b','n'].map(p => {
    const k=color+p.toUpperCase(), img=pieceImgs[k], sz=54;
    return `<div onclick="pickPromo('${p}')" style="cursor:pointer;width:${sz}px;height:${sz}px;border-radius:6px;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;background:var(--surf2);box-sizing:border-box">`
      +(img?.complete?`<img src="${img.src}" width="${Math.round(sz*.88)}" height="${Math.round(sz*.88)}" draggable="false">`:p.toUpperCase())
      +`</div>`;
  }).join('');
  pick.style.display='flex';
  if(bd) bd.style.display='block';
  const pw=54*4+48, ph=54+20;
  pick.style.left=Math.max(8,Math.min(cx-pw/2,window.innerWidth-pw-8))+'px';
  pick.style.top =Math.max(8,Math.min(cy-ph/2,window.innerHeight-ph-8))+'px';
}
function pickPromo(p) {
  document.getElementById('promo-pick').style.display='none';
  const bd=document.getElementById('promo-backdrop'); if(bd) bd.style.display='none';
  if(_promoCallback){const cb=_promoCallback;_promoCallback=null;cb(p);}
}
function cancelPromo() {
  document.getElementById('promo-pick').style.display='none';
  const bd=document.getElementById('promo-backdrop'); if(bd) bd.style.display='none';
  _promoCallback=null; if(window._E) window._E.sel=null; S.sel=null;
  drawBoard();
  window.renderEditorBoard?.();
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/lib.
Object.assign(window, {
  resizeBoard, drawCoords, drawBoard, canInteract, tryMove, flipBoard,
  showPromoPicker, pickPromo, cancelPromo,
});

// Pré-charge le module Chessground (chunk) sans monter l'instance — le montage est
// paresseux (_ensureCg), quand le plateau devient visible.
loadChessground();
