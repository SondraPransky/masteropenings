// ══════════════════════════════════════════════════════
// L'ÉTABLI de « Ma bibliothèque » — échiquier de saisie ET de recherche.
// (Transposition de la maquette europe échecs : « saisir et chercher sont le
// même geste » — les coups posés composent une partie ET interrogent la base.)
//
//  - SAISIE RAPIDE : on joue la partie coup après coup sur l'échiquier de la
//    page (clic-clic + drag Chessground, promotion via le sélecteur partagé),
//    puis « Enregistrer… » ouvre le modal Nouvelle partie pré-rempli du PGN —
//    les métadonnées restent saisies à UNE place (le modal, patron P1.1b).
//  - ÉCHIQUIER-REQUÊTE : chaque position filtre la liste aux parties qui
//    PASSENT par là (`_normFen`), et le panneau des suites montre ce qui a été
//    joué d'ici dans la base, avec compte et bilan par coup.
//
// ⚠ Pièges Chessground (mémoire du projet) : instance détruite par chaque
// innerHTML de renderMyLibrary → on REMONTE après chaque rendu (_qeMount,
// appelé par renderMyLibrary) ; créé sur un élément masqué = 0 pièce → on ne
// monte que si #lib-qe-board existe (donc visible dans le détail d'une base).
// La partie en cours (_qeGame), elle, SURVIT aux re-rendus et à la navigation.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { _normFen, fig, pgnMainlineSans, pgnStartFen } from './core.js';
import { loadChessground } from './chessground.js';

const toast      = (...a) => window.toast?.(...a);
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

let _qeGame = null;      // partie en cours de saisie (chess.js) — survit aux re-rendus
let _qeCg = null;        // instance Chessground courante (morte à chaque innerHTML)
let _qeCgEl = null;      // l'élément sur lequel elle a été créée (détecte le remplacement)

function _game() {
  if (!_qeGame) _qeGame = new Chess();
  return _qeGame;
}

// ── Index de positions d'une partie ─────────────────────────────────────────
// normFen (avant le coup) → SAN joué. Ligne principale seule, rejouée une fois
// par partie et mémoïsée : la requête retourne alors en O(1) par partie.
// Une position répétée n'est comptée qu'une fois (la première traversée).
const _idxCache = new Map();
function _gamePosIndex(g) {
  const key = g.id + ':' + (g.pgn || '').length;
  const hit = _idxCache.get(key);
  if (hit) return hit;
  if (_idxCache.size > 300) _idxCache.clear();
  const idx = new Map();
  try {
    const c = new Chess(pgnStartFen(g.pgn));
    for (const san of pgnMainlineSans(g.pgn)) {
      const nf = _normFen(c.fen());
      const mv = c.move(san, { sloppy: true });
      if (!mv) break;                            // notation illisible : on garde ce qui précède
      if (!idx.has(nf)) idx.set(nf, mv.san);
    }
  } catch (e) { /* FEN invalide : index vide */ }
  _idxCache.set(key, idx);
  return idx;
}

// ── Le plateau ──────────────────────────────────────────────────────────────
function _qeCfg() {
  const g = _game();
  const turn = g.turn() === 'w' ? 'white' : 'black';
  const dests = new Map();
  for (const m of g.moves({ verbose: true })) {
    const arr = dests.get(m.from) || [];
    arr.push(m.to);
    dests.set(m.from, arr);
  }
  const hist = g.history({ verbose: true });
  const last = hist.length ? [hist[hist.length - 1].from, hist[hist.length - 1].to] : undefined;
  return {
    fen: g.fen(), orientation: 'white', turnColor: turn,
    lastMove: last, check: g.in_check(),
    movable: { free: false, color: turn, dests },
  };
}

// Remonte l'échiquier si le détail d'une base est rendu. Appelé par
// renderMyLibrary après CHAQUE innerHTML (l'ancien nœud Chessground est mort).
async function _qeMount() {
  const el = document.getElementById('lib-qe-board');
  if (!el) { _qeCg = null; _qeCgEl = null; return; }
  if (_qeCg && _qeCgEl === el) { _qeCg.set(_qeCfg()); _qeRenderPanels(); return; }
  const Cg = await loadChessground();
  // Le rendu a pu repasser pendant l'await : on re-résout l'élément courant.
  const host = document.getElementById('lib-qe-board');
  if (!host) return;
  _qeCg = Cg(host, {
    coordinates: true,
    animation: { enabled: true, duration: 200 },
    highlight: { lastMove: true, check: true },
    movable: { free: false, showDests: true, events: { after: (o, d) => _qeAfterMove(o, d) } },
    drawable: { enabled: false },
  });
  _qeCgEl = host;
  _qeCg.set(_qeCfg());
  _qeRenderPanels();
}

// Coup joué SUR le plateau (patron _expAfterMove de l'explorateur, promotion
// via le sélecteur partagé showPromoPicker).
function _qeAfterMove(from, to) {
  const g = _game();
  const apply = (promotion) => {
    const mv = g.move({ from, to, promotion });
    _qeSync();                                   // resynchronise même si coup refusé
  };
  const mp = g.get(from);
  const isPromo = mp?.type === 'p' &&
    g.moves({ square: from, verbose: true }).some(m => m.to === to && m.flags.includes('p'));
  if (isPromo) {
    _qeSync();                                   // remet le pion avant que le sélecteur tranche
    const rect = document.getElementById('lib-qe-board')?.getBoundingClientRect();
    window.showPromoPicker?.(mp.color === 'w' ? 'w' : 'b',
      rect ? rect.left + rect.width / 2 : 0, rect ? rect.top + rect.height / 2 : 0,
      pr => apply(pr));
    return;
  }
  apply('q');                                    // 'q' ignoré par chess.js hors promotion
}

function _qeSync() {
  if (_qeCg) _qeCg.set(_qeCfg());
  _qeRenderPanels();
}

// ── Panneaux : fil de coups + suites de la base + filtre de liste ───────────
function _qeRenderPanels() {
  const g = _game();
  const sans = g.history();

  const movesEl = document.getElementById('lib-qe-moves');
  if (movesEl) {
    movesEl.innerHTML = sans.map((san, i) =>
      (i % 2 === 0 ? `<span class="mv-num">${i / 2 + 1}.</span>` : '') + fig(escapeHtml(san))
    ).join(' ') || '<span class="lib-qe-start">Position de départ</span>';
  }
  const hint = document.getElementById('lib-qe-hint');
  if (hint) hint.style.display = sans.length ? 'none' : '';

  // La requête : parties de la base passant par la position courante, et ce
  // qu'elles ont joué d'ici. À la position de départ, pas de filtre.
  const games = window._libOpenBaseGames?.() || [];
  const nf = _normFen(g.fen());
  const treeEl = document.getElementById('lib-qe-tree');

  if (!sans.length) {
    window._libSetPosFilter?.(null);
    if (treeEl) treeEl.innerHTML = _suitesHTML(games, nf);
    return;
  }
  const through = games.filter(x => _gamePosIndex(x).has(nf) || _endsAt(x, nf));
  window._libSetPosFilter?.(new Set(through.map(x => String(x.id))));
  if (treeEl) treeEl.innerHTML = _suitesHTML(through, nf);
}

// Une partie dont la position courante est la DERNIÈRE passe aussi par là
// (l'index ne porte que les positions suivies d'un coup).
const _endCache = new Map();
function _endsAt(g, nf) {
  const key = g.id + ':' + (g.pgn || '').length;
  let end = _endCache.get(key);
  if (end === undefined) {
    if (_endCache.size > 300) _endCache.clear();
    try {
      const c = new Chess(pgnStartFen(g.pgn));
      for (const san of pgnMainlineSans(g.pgn)) if (!c.move(san, { sloppy: true })) break;
      end = _normFen(c.fen());
    } catch (e) { end = ''; }
    _endCache.set(key, end);
  }
  return end === nf;
}

// Suites jouées depuis la position, avec compte et bilan gains/nulles/pertes.
// Les segments du bilan sont proportionnels ; le texte du title porte la même
// information (la couleur seule ne dit rien à qui ne la distingue pas).
function _suitesHTML(games, nf) {
  const bySan = new Map();
  for (const g of games) {
    const san = _gamePosIndex(g).get(nf);
    if (!san) continue;
    const e = bySan.get(san) || { n: 0, w: 0, d: 0, l: 0 };
    e.n++;
    if (g.result === '1-0') e.w++;
    else if (g.result === '0-1') e.l++;
    else if (g.result === '1/2-1/2' || g.result === '½-½') e.d++;
    bySan.set(san, e);
  }
  if (!bySan.size) return '';
  const rows = [...bySan.entries()].sort((a, b) => b[1].n - a[1].n).map(([san, e]) => {
    const pct = k => (100 * k / e.n).toFixed(1) + '%';
    const bilan = `${e.w} gain${e.w > 1 ? 's' : ''}, ${e.d} nulle${e.d > 1 ? 's' : ''}, ${e.l} défaite${e.l > 1 ? 's' : ''}`;
    return `<button class="lib-qe-suite" onclick="qePlaySan('${escapeHtml(san)}')"
              title="Jouer ${escapeHtml(san)} — ${bilan}">
      <span class="lib-qe-suite-mv">${fig(escapeHtml(san))}</span>
      <span class="lib-qe-suite-n">${e.n}</span>
      <span class="lib-qe-suite-bar" aria-hidden="true">
        <i class="w" style="width:${pct(e.w)}"></i><i class="d" style="width:${pct(e.d)}"></i><i class="l" style="width:${pct(e.l)}"></i>
      </span>
      <span class="sr-only">${bilan}</span>
    </button>`;
  }).join('');
  return `<div class="lib-qe-tree-head">Joué d'ici dans cette base</div>${rows}`;
}

// ── Actions ─────────────────────────────────────────────────────────────────
function qeUndo()  { _game().undo(); _qeSync(); }
function qeReset() { _qeGame = new Chess(); _qeSync(); }

// Un coup depuis le panneau des suites (retrouvé parmi les coups légaux).
function qePlaySan(san) {
  const mv = _game().move(san, { sloppy: true });
  if (mv) _qeSync();
}

// « Enregistrer… » : le PGN des coups joués part dans le modal Nouvelle partie
// (une seule place pour les métadonnées — patron de openBoardEntry/P1.1b).
function qeSave() {
  const g = _game();
  if (!g.history().length) { toast('⚠ Joue d\'abord les coups de la partie sur l\'échiquier', 'ko'); return; }
  const pgn = g.pgn();
  window.openNewGameModal?.();
  const ta = document.getElementById('ng-pgn');
  if (ta) ta.value = pgn;
  window._ngPrefillFromPgn?.();
}

Object.assign(window, { _qeMount, qeUndo, qeReset, qePlaySan, qeSave });

export { _qeMount, qeUndo, qeReset, qePlaySan, qeSave };
