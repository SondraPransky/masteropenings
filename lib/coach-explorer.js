// ══════════════════════════════════════════════════════
// VUE COACH — Explorateur de puzzles (pont OTKB local).
//
// Transposition de l'outil coach OTKB (`otkb ui`, compo « Flux » validée le
// 16/07) : colonne GAUCHE = l'atelier (échiquier drag & drop, fil de coups,
// ouverture, FEN/UCI, Départ/Annuler + flèches ← →, carte thermique) ; colonne
// DROITE = le héros (suites les plus jouées en pastilles soulignées → puzzles
// qui SUIVENT la position, calibrés par niveaux élève FIDE, avec aperçu épinglé
// au survol et solveur au clic). S'y ajoute le geste propre à EECoach : cocher
// des puzzles → « Créer un paquet » d'exercices (Leitner, assignable).
//
// Le pont est un serveur HTTP `localhost` (cf. otkb/bridge.py) : EECoach déployé
// sur Pages a le droit de le fetch (localhost = origine « potentially
// trustworthy », mesuré 200 depuis le vrai site HTTPS). La section est MASQUÉE
// si le pont ne répond pas.
//
// L'échiquier est CHESSGROUND (le board de Lichess) — le même que l'outil OTKB
// original, dont les assets sont vendus dans le repo (otkb/ui/static/, CSS en
// data-URIs → aucune requête externe). Import DYNAMIQUE : Vite en fait un chunk
// chargé à l'ouverture de la section seulement — le bundle élève ne bouge pas.
// La validation des coups reste chess.js (movable.free=false + dests calculées),
// la promotion passe par le sélecteur PARTAGÉ (showPromoPicker, comme partout).
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { fig, escapeHtml } from './coach-core.js';

const ODP_BRIDGE_URL = 'http://localhost:8127';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const _TH_PAGE = 45;   // même page que l'outil OTKB (_TH_PAGE)

// ── État local (rien ne traverse d'autres modules coach → pas dans CS) ──
let _expGame = null;          // chess.js : position d'exploration
let _expUci = [];             // coups UCI joués (source de vérité de la position)
let _expRedo = [];            // coups annulés (←), rejouables (→) tant qu'on ne bifurque pas
let _expSelSq = null;         // case source sélectionnée (clic-à-clic)
let _expRows = [];            // page courante des puzzles « à travers »
let _expNfen = null;
let _expTotal = 0;
let _expOffset = 0;           // pagination du tableau
let _expCtx = null;           // dernier /context (suites, thermique, compteurs)
const _expSel = new Set();    // ids cochés (→ Créer un paquet)
let _expOpeningsLoaded = false;
let _expOpeningsMap = new Map();
// Niveaux élève FIDE (mêmes pastilles que l'outil OTKB — la vérité vit dans
// otkb/ui/levels.py, servie par /levels). « all » = exclusif.
let _expLevels = ['all'];
let _expLevelDefs = [];
// Tri : difficulté croissante par défaut (comme l'outil) ; l'en-tête inverse.
let _expSort = 'rating_asc';
// ── Solveur (mode puzzle, comme _PuzzleSession dans l'outil OTKB) ──
let _expPz = null;
let _expHintSq = null;
let _expFlip = false;         // plateau vu des Noirs (solveur noir en bas)
let _expThermalMode = 'critical';

// ── Détection du pont ─────────────────────────────────
async function _expDetectBridge() {
  const btn = document.getElementById('csnav-explorer');
  if (!btn) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const r = await fetch(ODP_BRIDGE_URL + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    const ok = r.ok && (await r.json()).ok === true;
    btn.style.display = ok ? '' : 'none';
    return ok;
  } catch {
    btn.style.display = 'none';
    return false;
  }
}

// ── Entrée de section ─────────────────────────────────
function renderExplorer() {
  if (!_expGame) { _expGame = new Chess(); _expUci = []; }
  _expRenderBoard();
  _expLoadOpenings();
  _expLoadLevels();
  if (_expUci.length || _expCtx) _expGo();   // revient sur une position déjà explorée
  else _expGo();                              // position de départ : contexte (suites) quand même
}

// ── Niveaux élève FIDE ─────────────────────────────────
async function _expLoadLevels() {
  if (_expLevelDefs.length) { _expRenderLevels(); return; }
  try {
    const r = await fetch(ODP_BRIDGE_URL + '/levels');
    _expLevelDefs = (await r.json()).levels || [];
    _expRenderLevels();
  } catch { /* pont indisponible : pas de pastilles */ }
}

function _expRenderLevels() {
  const host = document.getElementById('exp-levelchips');
  if (!host) return;
  host.innerHTML = _expLevelDefs.map(lv =>
    `<button type="button" class="exp-levelchip${_expLevels.includes(lv.key) ? ' on' : ''}"
      title="${escapeHtml(lv.label)}" onclick="explorerToggleLevel('${escapeHtml(lv.key)}')">${escapeHtml(lv.short)}</button>`
  ).join('');
}

function explorerToggleLevel(key) {
  // Même règle que toggle_level (otkb/ui/levels.py) : « Tous » est exclusif.
  if (key === 'all') {
    _expLevels = ['all'];
  } else {
    let sel = _expLevels.filter(k => k !== 'all' && k !== key);
    if (!_expLevels.includes(key)) sel.push(key);
    const order = _expLevelDefs.map(l => l.key);
    sel.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    _expLevels = sel.length ? sel : ['all'];
  }
  _expOffset = 0;
  _expRenderLevels();
  _expLoadThrough();
}

function explorerToggleSort() {
  _expSort = _expSort === 'rating_asc' ? 'rating_desc' : 'rating_asc';
  _expOffset = 0;
  _expLoadThrough();
}

// ── Échiquier CHESSGROUND (le board de Lichess — même config que l'outil OTKB) ──
// Deux instances, comme l'original : le plateau principal (jouable) et l'aperçu
// épinglé (viewOnly). Chargées à la demande (chunk Vite lazy + CSS lazy).
let _cg = null;          // instance principale
let _cgPrev = null;      // instance d'aperçu (viewOnly)
let _cgLoad = null;      // promesse de chargement du module (une seule fois)

function _expLoadCg() {
  if (!_cgLoad) {
    _cgLoad = (async () => {
      // Sous VITE (dev/build) l'import de CSS produit des chunks lazy ; sous
      // `npx serve` (ESM brut, piège d'outillage connu) il échoue → repli en
      // <link> vers les mêmes fichiers statiques. Le JS, lui, est un vrai
      // module ES : il s'importe dans les deux mondes.
      try {
        await Promise.all([
          import('../otkb/ui/static/chessground.base.css'),
          import('../otkb/ui/static/chessground.brown.css'),
          import('../otkb/ui/static/chessground.cburnett.css'),
          // Override maison APRÈS brown : damier piloté par --board-* (thème).
          import('../otkb/ui/static/otkb-cg-theme.css'),
        ]);
      } catch {
        for (const f of ['chessground.base', 'chessground.brown', 'chessground.cburnett', 'otkb-cg-theme']) {
          const href = `/otkb/ui/static/${f}.css`;
          if (!document.querySelector(`link[href="${href}"]`)) {
            const l = document.createElement('link');
            l.rel = 'stylesheet'; l.href = href;
            document.head.appendChild(l);
          }
        }
      }
      return (await import('../otkb/ui/static/chessground.min.js')).Chessground;
    })();
  }
  return _cgLoad;
}

async function _expEnsureCg() {
  const Cg = await _expLoadCg();
  const el = document.getElementById('exp-board');
  if (!el) return null;
  if (!_cg) {
    // Config identique à otkbInit (otkb/ui/app.py, _CG_JS).
    _cg = Cg(el, {
      coordinates: true,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false, showDests: true,
        events: { after: (o, d) => _expAfterMove(o, d) },
      },
      drawable: { enabled: false },
    });
  }
  return _cg;
}

// Le _board_cfg de l'original, transposé : chess.js fournit fen/trait/dests/échec.
function _expBoardCfg() {
  const g = _expGame;
  const turn = g.turn() === 'w' ? 'white' : 'black';
  const locked = _expPz && _expPz.solved;
  const dests = new Map();
  if (!locked) {
    for (const m of g.moves({ verbose: true })) {
      const arr = dests.get(m.from) || [];
      arr.push(m.to);
      dests.set(m.from, arr);
    }
  }
  const hist = g.history({ verbose: true });
  const last = hist.length ? [hist[hist.length - 1].from, hist[hist.length - 1].to] : undefined;
  return {
    fen: g.fen(),
    orientation: _expFlip ? 'black' : 'white',
    turnColor: turn,
    lastMove: last,
    check: g.in_check(),
    movable: { free: false, color: turn, dests },
  };
}

async function _expRenderBoard() {
  const cg = await _expEnsureCg();
  if (!cg) return;
  cg.set(_expBoardCfg());
  cg.setAutoShapes(_expHintSq ? [{ orig: _expHintSq, brush: 'green' }] : []);
  _expRenderMoves();
}

// Un coup vient d'être joué SUR le plateau (drag ou clic-clic Chessground).
// Validation chess.js ; promotion via le sélecteur PARTAGÉ (showPromoPicker).
function _expAfterMove(from, to) {
  const g = _expGame;
  const apply = (promotion) => {
    const mv = g.move({ from, to, promotion });
    if (!mv) { _expRenderBoard(); return; }     // désync improbable : on resynchronise
    if (_expPz) { _expPzTried(mv); return; }
    _expUci.push(mv.from + mv.to + (mv.promotion || ''));
    _expRedo = [];                              // nouveau coup = branche morte
    _expSyncInput();
    _expRenderBoard();
    _expGo();
  };
  const mp = g.get(from);
  const isPromo = mp?.type === 'p' &&
    g.moves({ square: from, verbose: true }).some(m => m.to === to && m.flags.includes('p'));
  if (isPromo) {
    // le plateau montre déjà le pion déplacé : on le remet d'abord, puis le
    // sélecteur tranche (annuler laisse la position intacte).
    _expRenderBoard();
    const rect = document.getElementById('exp-board')?.getBoundingClientRect();
    window.showPromoPicker?.(mp.color === 'w' ? 'w' : 'b',
      rect ? rect.left + rect.width / 2 : 0, rect ? rect.top + rect.height / 2 : 0,
      pr => apply(pr));
    return;
  }
  apply('q');   // 'q' est ignoré par chess.js hors promotion
}

// Fil de coups en SAN figurines (le `moves_label` de l'original).
function _expRenderMoves() {
  const el = document.getElementById('exp-moves');
  if (!el) return;
  const sans = _expGame.history();
  el.innerHTML = sans.map((san, i) =>
    (i % 2 === 0 ? `<span class="exp-mvnum">${i / 2 + 1}.</span> ` : '') + escapeHtml(fig(san))
  ).join(' ');
}

// ── Navigation : Départ / Annuler / flèches ← → ───────
function explorerResetBoard() {
  _expPz = null; _expHintSq = null; _expFlip = false;
  _expSolverMode(false);
  _expGame = new Chess(); _expUci = []; _expRedo = []; _expSelSq = null;
  _expOffset = 0;
  _expSyncInput();
  _expRenderBoard();
  _expGo();
}

function explorerUndo() {
  if (_expPz || !_expUci.length) return;
  _expGame.undo();
  _expRedo.push(_expUci.pop());
  _expSelSq = null; _expOffset = 0;
  _expSyncInput();
  _expRenderBoard();
  _expGo();
}

function explorerRedo() {
  if (_expPz || !_expRedo.length) return;
  const u = _expRedo.pop();
  const mv = _expGame.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  if (!mv) { _expRedo = []; return; }
  _expUci.push(u);
  _expSelSq = null; _expOffset = 0;
  _expSyncInput();
  _expRenderBoard();
  _expGo();
}

// Flèches ← → : exploration seulement, jamais quand on tape dans un champ.
// (Le listener du drill est gardé par S.phase — aucun recouvrement.)
document.addEventListener('keydown', e => {
  const sec = document.getElementById('csec-explorer');
  if (!sec || sec.style.display === 'none' || _expPz) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); explorerUndo(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); explorerRedo(); }
});

function _expSyncInput() {
  const input = document.getElementById('exp-input');
  if (input) input.value = _expUci.join(' ');
  const op = document.getElementById('exp-opening');
  if (op) op.value = '';
}

// ── Sélecteur d'ouverture ──────────────────────────────
async function _expLoadOpenings() {
  if (_expOpeningsLoaded) return;
  try {
    const r = await fetch(ODP_BRIDGE_URL + '/openings');
    const data = await r.json();
    const dl = document.getElementById('exp-opening-list');
    if (dl && data.openings) {
      dl.innerHTML = data.openings
        .map(o => `<option value="${escapeHtml(o.name)}">`).join('');
      _expOpeningsMap = new Map(data.openings.map(o => [o.name, o.moves]));
      _expOpeningsLoaded = true;
    }
  } catch { /* pont indisponible */ }
}

function explorerPickOpening(name) {
  const moves = _expOpeningsMap.get(name);
  if (!moves) return;
  if (_expPz) { _expPz = null; _expHintSq = null; _expFlip = false; _expSolverMode(false); }
  const g = new Chess(); const uci = [];
  for (const m of moves.split(/\s+/)) {
    const mv = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    if (!mv) break;
    uci.push(m);
  }
  _expGame = g; _expUci = uci; _expRedo = []; _expSelSq = null; _expOffset = 0;
  const input = document.getElementById('exp-input'); if (input) input.value = uci.join(' ');
  _expRenderBoard();
  _expGo();
}

// Champ Position (« Aller ») : reconstruit l'échiquier depuis FEN ou coups UCI.
function explorerLoad() {
  const raw = (document.getElementById('exp-input')?.value || '').trim();
  if (!raw) { window.toast?.('⚠ Saisis une position (coups UCI ou FEN)', 'ko'); return; }
  if (_expPz) { _expPz = null; _expHintSq = null; _expFlip = false; _expSolverMode(false); }
  if (raw.includes('/')) {                     // FEN
    const g = new Chess();
    if (!g.load(raw)) { window.toast?.('❌ FEN invalide', 'ko'); return; }
    _expGame = g; _expUci = [];
  } else {                                     // coups UCI
    const g = new Chess(); const uci = [];
    for (const m of raw.split(/\s+/)) {
      const mv = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      if (!mv) { window.toast?.(`❌ Coup UCI invalide : ${m}`, 'ko'); return; }
      uci.push(m);
    }
    _expGame = g; _expUci = uci;
  }
  _expRedo = []; _expSelSq = null; _expOffset = 0;
  _expRenderBoard();
  _expGo();
}

// ── Orchestrateur : contexte + liste, comme `recompute` dans l'original ──
function _expPosParam() {
  if (_expUci.length) return 'moves=' + encodeURIComponent(_expUci.join(' '));
  return 'fen=' + encodeURIComponent(_expGame.fen());
}

async function _expGo() {
  const param = _expPosParam();
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/context?${param}`);
    const ctx = await r.json();
    if (!r.ok) throw new Error(ctx.error || 'Erreur du pont');
    _expCtx = ctx; _expNfen = ctx.nfen;
    _expRenderBanner(ctx);
    _expRenderSuites(ctx);
    _expRenderThermal(ctx);
    _expRenderAt(ctx);
    // le tableau n'apparaît qu'à partir de 2 demi-coups (1 coup complet) — avant,
    // « 1,2 M puzzles suivent » n'apprend rien (même seuil que l'original).
    const guard = document.getElementById('exp-guard');
    const through = document.getElementById('exp-through');
    if (ctx.ply >= 2) {
      if (guard) guard.style.display = 'none';
      if (through) through.style.display = '';
      _expLoadThrough();
    } else {
      if (guard) {
        guard.style.display = '';
        // Position de départ = INVITATION (l'état vide dit le geste de l'écran) ;
        // dès 1 demi-coup = la garde de l'original.
        guard.innerHTML = ctx.ply > 0
          ? 'Jouez au moins un coup complet pour voir les puzzles qui suivent la position.'
          : `<div class="exp-invite">
              <div class="exp-invite-title">Atteins une position d'ouverture</div>
              <p>L'explorateur montre les puzzles tactiques que tes élèves rencontreront à partir d'elle — et en fait un paquet d'exercices ou un dossier PGN.</p>
              <ul>
                <li>Joue des coups sur l'échiquier (ou clique une suite ci-dessus)</li>
                <li>Choisis une ouverture par son nom</li>
                <li>Colle une FEN ou des coups UCI</li>
              </ul>
            </div>`;
      }
      if (through) through.style.display = 'none';
      _expRows = []; _expSel.clear();
    }
  } catch (e) {
    const c = document.getElementById('exp-count');
    if (c) c.innerHTML = `<span class="exp-err">${escapeHtml(String(e.message || e))}</span>`;
  }
}

function _expRenderBanner(ctx) {
  const el = document.getElementById('exp-banner');
  if (!el) return;
  if (ctx.counts_missing) {
    el.style.display = '';
    el.textContent = 'Cache des compteurs absent — l\'explorateur sera lent. Le construire une fois : python -m otkb build-counts';
  } else if (ctx.stale) {
    el.style.display = '';
    el.textContent = 'Caches de positions périmés (la base a grossi) — compteurs et suites peuvent être faux. Rafraîchir : python -m otkb build-counts';
  } else {
    el.style.display = 'none';
  }
}

// « Suites les plus jouées » : pastilles soulignées (part relative au coup le
// plus joué), clic = jouer le coup. Le 1er tiers de la compo Flux.
function _expRenderSuites(ctx) {
  const el = document.getElementById('exp-suites');
  if (!el) return;
  const conts = ctx.continuations;
  let body;
  if (ctx.through <= 0) {
    body = '<span class="exp-hint">Index des parties vide pour cette position.</span>';
  } else if (conts === null) {
    body = `<span class="exp-hint">Position très fréquente (${ctx.through.toLocaleString('fr-FR')} parties) — lancez <code>python -m otkb build-counts</code> pour des suites instantanées.</span>`;
  } else if (!conts.length) {
    body = '<span class="exp-hint">Aucune suite indexée au-delà de cette position.</span>';
  } else {
    const top = conts[0].games || 1;
    body = conts.map(c => {
      const pct = ctx.through ? (100 * c.games / ctx.through) : 0;
      const rel = (c.games / top).toFixed(3);
      return `<button type="button" class="exp-mvpill" onclick="explorerPlayUci('${escapeHtml(c.uci)}')"
        title="${c.games.toLocaleString('fr-FR')} parties — jouer ${escapeHtml(fig(c.san))}">
        <span class="exp-mvpill-under" style="transform:scaleX(${rel})"></span>
        <span class="exp-mvpill-mv">${escapeHtml(fig(c.san))}</span>
        <span class="exp-mvpill-pc">${pct.toFixed(1)}%</span>
      </button>`;
    }).join('');
  }
  el.style.display = '';
  el.innerHTML = `<span class="exp-suites-lbl">Suites les plus jouées</span> ${body}`;
}

function explorerPlayUci(uci) {
  if (_expPz) return;
  const mv = _expGame.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  if (!mv) return;
  _expUci.push(uci);
  _expRedo = []; _expSelSq = null; _expOffset = 0;
  _expSyncInput();
  _expRenderBoard();
  _expGo();
}

// ── Carte thermique (cases critiques / sacrifices) ─────
// Même rampe froid→chaud que l'original (_HEAT_STOPS, otkb/ui/app.py).
const _HEAT_T = [0, .28, .62, 1];
const _HEAT_C = [[225, 230, 234], [244, 206, 94], [232, 129, 60], [206, 59, 46]];
function _expHeat(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < _HEAT_T.length; i++) {
    const a = _HEAT_T[i - 1], b = _HEAT_T[i];
    if (t <= b) {
      const k = b > a ? (t - a) / (b - a) : 0;
      const rgb = _HEAT_C[i - 1].map((v, j) => Math.round(v + (_HEAT_C[i][j] - v) * k));
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }
  }
  return 'rgb(206,59,46)';
}

function _expThermalBoard(squares) {
  const files = 'abcdefgh';
  const top = Math.max(1, ...Object.values(squares));
  let cells = '';
  for (let rank = 8; rank >= 1; rank--) {
    for (let f = 0; f < 8; f++) {
      const dark = (f + rank) % 2 === 0;
      const v = squares[files[f] + rank];
      let glow = '';
      if (v) {
        const t = v / top;
        const col = _expHeat(t);
        glow = `<span style="position:absolute;inset:0;background:radial-gradient(circle at 50% 45%,${col} 0%,${col} 55%,transparent 100%);opacity:${(0.35 + 0.65 * t).toFixed(2)}"></span>`;
      }
      cells += `<div style="position:relative;background:${dark ? 'var(--board-dark, #b58863)' : 'var(--board-light, #f0d9b5)'}">${glow}</div>`;
    }
  }
  return `<div class="exp-thermal-grid">${cells}</div>`;
}

function _expRenderThermal(ctx) {
  const el = document.getElementById('exp-thermal');
  if (!el) return;
  const crit = ctx.squares?.critical || {};
  const sac = ctx.squares?.sacrifice || {};
  const hasCrit = Object.keys(crit).length > 0, hasSac = Object.keys(sac).length > 0;
  if (!hasCrit && !hasSac) { el.style.display = 'none'; el.innerHTML = ''; return; }
  if (_expThermalMode === 'critical' && !hasCrit) _expThermalMode = 'sacrifice';
  if (_expThermalMode === 'sacrifice' && !hasSac) _expThermalMode = 'critical';
  const toggle = (hasCrit && hasSac)
    ? `<span class="exp-thermal-toggle">
        <button type="button" class="exp-levelchip${_expThermalMode === 'critical' ? ' on' : ''}" onclick="explorerThermalMode('critical')">Critiques</button>
        <button type="button" class="exp-levelchip${_expThermalMode === 'sacrifice' ? ' on' : ''}" onclick="explorerThermalMode('sacrifice')">Sacrifices</button>
      </span>` : '';
  el.style.display = '';
  el.innerHTML = `<div class="exp-thermal-head"><span class="exp-thermal-lbl">Carte thermique · cases disputées</span>${toggle}</div>`
    + _expThermalBoard(_expThermalMode === 'critical' ? crit : sac);
}

function explorerThermalMode(mode) {
  _expThermalMode = mode;
  if (_expCtx) _expRenderThermal(_expCtx);
}

// ── « Puzzles à résoudre ici » (démarrent exactement à la position) ──
let _expAtRows = [];
async function _expRenderAt(ctx) {
  const el = document.getElementById('exp-at');
  if (!el) return;
  if (!ctx.start) { el.style.display = 'none'; el.innerHTML = ''; return; }
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/at?${_expPosParam()}&limit=8`);
    const data = await r.json();
    const rows = data.puzzles || [];
    _expAtRows = rows;
    el.style.display = '';
    el.innerHTML = `<div class="exp-at-head">Puzzles à résoudre ici (${ctx.start.toLocaleString('fr-FR')})</div>`
      + rows.map((p, i) =>
        `<div class="exp-at-row">
          <button class="btn btn-blue btn-sm" onclick="explorerOpenAtPuzzle(${i})"><i class="ti ti-player-play" aria-hidden="true"></i> Résoudre</button>
          <span class="exp-rating">⚑ ${p.rating ?? '—'}</span>
          <span class="exp-at-themes">${escapeHtml(p.themes_fr || '')}</span>
        </div>`).join('');
  } catch { el.style.display = 'none'; }
}

function explorerOpenAtPuzzle(i) {
  if (_expAtRows[i]) _expEnterPuzzle(_expAtRows[i].id, _expAtRows.map(p => p.id), i);
}

// ── Liste « à travers » : tableau + aperçu + pager ─────
function _expRatingParam() {
  return _expLevels.includes('all') ? '' : `&levels=${_expLevels.join(',')}`;
}

async function _expLoadThrough() {
  const countEl = document.getElementById('exp-count');
  const resEl = document.getElementById('exp-results');
  const param = _expPosParam();
  if (countEl) countEl.innerHTML = '';
  // skeleton : 8 lignes shimmer (patron .skeleton du dashboard coach) plutôt
  // qu'un saut de 2 000px quand le tableau arrive d'un bloc.
  if (resEl && !_expRows.length) {
    resEl.innerHTML = `<div class="exp-skel">${'<div class="skeleton skel-line exp-skel-row"></div>'.repeat(8)}</div>`;
  }
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/through?${param}&limit=${_TH_PAGE}&offset=${_expOffset}&sort=${_expSort}${_expRatingParam()}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur du pont');
    _expTotal = data.total; _expRows = data.puzzles || [];
    _expSel.clear();
    const totalEl = document.getElementById('exp-th-total');
    if (totalEl) totalEl.textContent = _expTotal.toLocaleString('fr-FR');
    if (countEl) {
      countEl.innerHTML = _expTotal ? ''
        : 'Aucun puzzle de ce niveau ne suit cette position — élargis le niveau ou joue d\'autres coups.';
    }
    _expRenderTable();
    _expRenderPager();
    _expSyncActionbar();
  } catch (e) {
    if (countEl) countEl.innerHTML = `<span class="exp-err">${escapeHtml(String(e.message || e))}</span>`;
  }
}

// Tableau au FORMAT DE L'OUTIL COACH OTKB (_through_table_html) : Difficulté
// (⚑, en-tête cliquable) · Trait · Motifs FR. + case à cocher (propre à EECoach).
function _expRenderTable() {
  const resEl = document.getElementById('exp-results');
  if (!resEl) return;
  if (!_expRows.length) {
    resEl.innerHTML = '';
    const prev = document.getElementById('exp-preview');
    if (prev) prev.style.display = 'none';
    return;
  }
  const rows = _expRows.map((p, i) => {
    const trait = p.white ? 'Blancs' : 'Noirs';
    const traitCls = p.white ? 'exp-trait-w' : 'exp-trait-b';
    return `<tr data-i="${i}" tabindex="0" role="button"
      aria-label="Résoudre le puzzle, difficulté ${p.rating ?? 'inconnue'}, trait aux ${trait}"
      onmouseenter="_expPrev(${i})" onfocus="_expPrev(${i})"
      onclick="explorerOpenPuzzle(${i})"
      onkeydown="if(event.key==='Enter'){event.preventDefault();explorerOpenPuzzle(${i})}">
      <td class="exp-td-check" onclick="event.stopPropagation()"><input type="checkbox" class="exp-check" aria-label="Sélectionner le puzzle (difficulté ${p.rating ?? 'inconnue'}, trait aux ${trait})" onchange="_expToggleSel('${escapeHtml(p.id)}', this)"></td>
      <td class="exp-td-rating"><span class="exp-rating">⚑ ${p.rating ?? '—'}</span></td>
      <td class="exp-td-trait"><span class="exp-trait ${traitCls}"></span>${trait}</td>
      <td class="exp-td-themes">${escapeHtml(p.themes_fr || '')}</td>
    </tr>`;
  }).join('');
  const arrow = _expSort === 'rating_asc' ? '▲' : '▼';
  resEl.innerHTML = `<table class="exp-table" aria-label="Puzzles qui suivent la position">
    <thead><tr>
      <th class="exp-td-check"><input type="checkbox" id="exp-checkall" class="exp-check" aria-label="Sélectionner tous les puzzles de la page" onchange="_expToggleAll(this)"></th>
      <th class="exp-th-sort" role="button" tabindex="0" aria-sort="${_expSort === 'rating_asc' ? 'ascending' : 'descending'}"
        title="Inverser le tri par difficulté" onclick="explorerToggleSort()"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();explorerToggleSort()}">Difficulté ${arrow}</th>
      <th>Trait</th><th>Motifs</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  const prev = document.getElementById('exp-preview');
  if (prev) prev.style.display = '';
  _expPrev(0);
}

function _expRenderPager() {
  const el = document.getElementById('exp-pager');
  if (!el) return;
  if (_expTotal <= _TH_PAGE) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const from = _expOffset + 1;
  const to = Math.min(_expOffset + _expRows.length, _expTotal);
  el.style.display = '';
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" ${_expOffset <= 0 ? 'disabled' : ''} onclick="explorerPage(-1)">← Précédent</button>
    <span class="exp-pager-pos">${from}–${to} sur ${_expTotal.toLocaleString('fr-FR')}</span>
    <button class="btn btn-ghost btn-sm" ${to >= _expTotal ? 'disabled' : ''} onclick="explorerPage(1)">Suivant →</button>`;
}

function explorerPage(dir) {
  _expOffset = Math.max(0, _expOffset + dir * _TH_PAGE);
  _expLoadThrough();
}

// ── Aperçu épinglé (survol → échiquier à droite, côté solveur) ──
// Seconde instance Chessground viewOnly — mêmes cases, mêmes pièces que le
// plateau principal, par construction (cgPrev de l'original).
async function _expPrev(i) {
  const p = _expRows[i];
  const el = document.getElementById('exp-prev-board');
  const cap = document.getElementById('exp-prev-cap');
  if (!p || !el || !cap) return;
  const Cg = await _expLoadCg();
  if (!_cgPrev) {
    _cgPrev = Cg(el, {
      viewOnly: true, coordinates: false,
      animation: { enabled: true, duration: 120 },
      drawable: { enabled: false },
    });
  }
  _cgPrev.set({ fen: p.fen, orientation: p.white ? 'white' : 'black' });
  cap.textContent = `⚑ ${p.rating ?? '—'} — trait aux ${p.white ? 'Blancs' : 'Noirs'}`;
}

function _expToggleSel(id, el) {
  if (el.checked) _expSel.add(id); else _expSel.delete(id);
  _expSyncActionbar();
}

// « Tout cocher » (la PAGE courante — 45 puzzles max, pas les 300 000).
function _expToggleAll(el) {
  const on = el.checked;
  document.querySelectorAll('.exp-table tbody .exp-check').forEach(c => { c.checked = on; });
  if (on) _expRows.forEach(p => _expSel.add(p.id));
  else _expRows.forEach(p => _expSel.delete(p.id));
  _expSyncActionbar();
}

function _expSyncActionbar() {
  const bar = document.getElementById('exp-actionbar');
  const cnt = document.getElementById('exp-selcount');
  if (!bar || !cnt) return;
  const n = _expSel.size;
  bar.style.display = _expRows.length ? '' : 'none';
  cnt.textContent = `${n} sélectionné${n > 1 ? 's' : ''}`;
  // le compteur vit AUSSI dans le bouton : l'actionbar est collante, le geste
  // primaire dit toujours combien il emporte.
  const lbl = document.getElementById('exp-create-count');
  if (lbl) lbl.textContent = n ? ` (${n})` : '';
  bar.classList.toggle('exp-actionbar-live', n > 0);
}

// ── Solveur (transposition de _puzzle_try / show_solution / give_hint) ──
function _expSolverMode(on) {
  document.getElementById('exp-body')?.classList.toggle('exp-pz-on', on);
  const sol = document.getElementById('exp-solver');
  if (sol) sol.style.display = on ? '' : 'none';
  const ce = document.getElementById('exp-ctrl-explore');
  const cp = document.getElementById('exp-ctrl-puzzle');
  if (ce) ce.style.display = on ? 'none' : '';
  if (cp) cp.style.display = on ? '' : 'none';
}

function _expPzPanel() {
  const pz = _expPz;
  if (!pz) return;
  const title = document.getElementById('exp-sol-title');
  const rating = document.getElementById('exp-sol-rating');
  const msg = document.getElementById('exp-sol-msg');
  const next = document.getElementById('exp-sol-next');
  if (title) title.textContent = pz.queue.length > 1
    ? `Puzzle ${pz.queueIdx + 1}/${pz.queue.length}` : 'Puzzle';
  if (rating) rating.textContent = pz.rating != null ? `⚑ ${pz.rating}` : '';
  if (msg) {
    if (pz.solved) { msg.textContent = 'Résolu ✔'; msg.className = 'exp-sol-msg ok'; }
    else if (pz.feedback === 'wrong') { msg.textContent = 'Ce n\'est pas la solution — réessayez.'; msg.className = 'exp-sol-msg ko'; }
    else { msg.textContent = `Trait aux ${_expGame.turn() === 'w' ? 'Blancs' : 'Noirs'} — trouvez le meilleur coup.`; msg.className = 'exp-sol-msg'; }
  }
  if (next) next.style.display = (pz.queueIdx + 1 < pz.queue.length) ? '' : 'none';
}

async function _expEnterPuzzle(id, queue, queueIdx) {
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/puzzle?id=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error();
    const pd = await r.json();
    if (!pd.moves || pd.moves.length < 2) { window.toast?.('⚠ Puzzle indisponible', 'ko'); return; }
    const g = new Chess();
    if (!g.load(pd.fen)) throw new Error();
    const m0 = pd.moves[0];
    if (!g.move({ from: m0.slice(0, 2), to: m0.slice(2, 4), promotion: m0[4] })) throw new Error();
    // conserve l'exploration (position + coups) ; en enchaînant les puzzles on
    // transmet celle déjà mémorisée (comme l'original)
    const explore = _expPz ? _expPz.explore : { game: _expGame, uci: _expUci.slice(), redo: _expRedo.slice() };
    _expPz = {
      id: pd.id, rating: pd.rating, solution: pd.moves.slice(1), idx: 0,
      solved: false, feedback: '',
      queue: queue || [id], queueIdx: queueIdx || 0, explore,
    };
    _expGame = g;
    _expFlip = g.turn() === 'b';       // solveur en bas
    _expSelSq = null; _expHintSq = null;
    _expSolverMode(true);
    _expRenderBoard();
    _expPzPanel();
  } catch {
    window.toast?.('❌ Impossible de charger le puzzle', 'ko');
  }
}

function explorerOpenPuzzle(i) {
  const row = _expRows[i];
  if (row) _expEnterPuzzle(row.id, _expRows.map(p => p.id), i);
}

// Un coup vient d'être JOUÉ sur le plateau en mode solveur (déjà appliqué).
function _expPzTried(mv) {
  const pz = _expPz;
  _expHintSq = null;
  const uci = mv.from + mv.to + (mv.promotion || '');
  const expected = pz.solution[pz.idx];
  // bon coup, OU coup alternatif qui mate (règle Lichess reprise par l'original)
  if (uci === expected || _expGame.in_checkmate()) {
    pz.feedback = '';
    pz.idx += 1;
    if (pz.idx >= pz.solution.length || _expGame.in_checkmate()) {
      pz.solved = true;
    } else {                            // réponse adverse automatique
      const rep = pz.solution[pz.idx];
      _expGame.move({ from: rep.slice(0, 2), to: rep.slice(2, 4), promotion: rep[4] });
      pz.idx += 1;
      if (pz.idx >= pz.solution.length) pz.solved = true;
    }
  } else {                              // mauvais coup : on annule
    _expGame.undo();
    pz.feedback = 'wrong';
  }
  _expRenderBoard();
  _expPzPanel();
}

function explorerPuzzleHint() {
  const pz = _expPz;
  if (!pz || pz.solved || pz.idx >= pz.solution.length) return;
  _expHintSq = pz.solution[pz.idx].slice(0, 2);
  _expRenderBoard();
}

async function explorerPuzzleSolution() {
  const pz = _expPz;
  if (!pz) return;
  _expHintSq = null; pz.feedback = '';
  while (pz.idx < pz.solution.length) {
    const u = pz.solution[pz.idx];
    _expGame.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    pz.idx += 1;
    _expRenderBoard();
    await new Promise(r => setTimeout(r, 450));   // petite animation, comme l'original
  }
  pz.solved = true;
  _expPzPanel();
}

function explorerPuzzleNext() {
  const pz = _expPz;
  if (pz && pz.queueIdx + 1 < pz.queue.length) {
    _expEnterPuzzle(pz.queue[pz.queueIdx + 1], pz.queue, pz.queueIdx + 1);
  }
}

function explorerPuzzleExit() {
  // restaure l'exploration INTÉGRALE (position + fil de coups + redo)
  const explore = _expPz?.explore;
  _expPz = null; _expHintSq = null; _expSelSq = null; _expFlip = false;
  if (explore) { _expGame = explore.game; _expUci = explore.uci; _expRedo = explore.redo || []; }
  _expSolverMode(false);
  _expRenderBoard();
}

// ── Mapping OTKB → kp EECoach ──────────────────────────
// Un puzzle Lichess : `fen` = position AVANT moves[0] ; moves[0] = coup adverse
// qui ARME la tactique ; moves[1:] = la solution (élève au trait). kp.fen =
// position APRÈS moves[0], kp.line = SAN de moves[1:], longueur impaire
// (invariant moteur, cf. _exParseGameToKp dans lib/exercises.js).
function _uciToKp(fen, moves) {
  const g = new Chess();
  if (!g.load(fen)) return null;
  const play = (uci) => g.move({
    from: uci.slice(0, 2), to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  });
  if (!moves.length || !play(moves[0])) return null;   // coup d'armement
  const kpFen = g.fen();
  const line = [];
  for (const uci of moves.slice(1)) {
    const mv = play(uci);
    if (!mv) break;
    line.push(mv.san);
  }
  if (!line.length) return null;
  if (line.length % 2 === 0) line.pop();               // finir sur le coup de l'élève
  const kp = { fen: kpFen, san: line[0], comment: '' };
  if (line.length > 1) kp.line = line;
  return kp;
}

async function explorerCreatePacket() {
  if (!_expSel.size) { window.toast?.('⚠ Coche au moins un puzzle', 'ko'); return; }
  const name = (prompt('Nom du paquet d\'exercices :', 'Puzzles d\'ouverture') || '').trim();
  if (!name) return;
  const ids = [..._expSel];
  let kps = [];
  try {
    const puzzles = await Promise.all(ids.map(async id => {
      const r = await fetch(`${ODP_BRIDGE_URL}/puzzle?id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error('puzzle ' + id);
      return r.json();
    }));
    kps = puzzles.map(p => _uciToKp(p.fen, p.moves)).filter(Boolean);
  } catch {
    window.toast?.('❌ Erreur de chargement des puzzles', 'ko');
    return;
  }
  if (!kps.length) { window.toast?.('❌ Aucun puzzle convertible', 'ko'); return; }
  const firstTurn = (kps[0].fen.split(/\s+/)[1] === 'b') ? 'b' : 'w';
  const mod = {
    id: Date.now(),
    name, level: 'Intermédiaire',
    side: firstTurn,
    mode: 'flash', varmode: null, tree: {},
    sessions: [{ label: 'Exercices', startFen: START_FEN, moves: [], kps }],
    hideComments: false, deadline: null,
    isExercise: true, exType: 'tactique',
    students: [],
    created: new Date().toLocaleDateString('fr-FR'),
    updatedAt: Date.now(),
  };
  G.drills.push(mod);
  window.save?.();
  window.saveModule?.(mod);
  window.toast?.(`✓ Paquet « ${name} » créé (${kps.length} exercice${kps.length > 1 ? 's' : ''})`, 'ok');
  window.renderDrillList?.();
  window.renderClassModuleSelect?.();
}

// ── Dialogue « Dossier de puzzles à donner à un élève » ─────────────────
// Transposition de _open_download_dialog (otkb/ui/app.py) : niveaux élève
// (pré-réglés sur les pastilles cochées du tableau — un seul vocabulaire de
// calibrage), tri par difficulté seulement, taille du lot, partie complète
// [%start], compteur live + aperçu des 5 premiers.
const _expDl = { levels: ['all'] };

function explorerOpenExport() {
  if (!_expNfen) { window.toast?.('⚠ Explore d\'abord une position', 'ko'); return; }
  _expDl.levels = _expLevels.slice();          // pré-réglé sur le tableau
  _expDlRenderLevels();
  document.getElementById('modal-exp-export')?.classList.add('on');
  _expDlRefresh();
}

function _expDlRenderLevels() {
  const host = document.getElementById('expdl-levels');
  if (!host) return;
  host.innerHTML = _expLevelDefs.map(lv =>
    `<button type="button" class="exp-levelchip${_expDl.levels.includes(lv.key) ? ' on' : ''}"
      title="${escapeHtml(lv.label)}" onclick="explorerDlToggleLevel('${escapeHtml(lv.key)}')">${escapeHtml(lv.short)}</button>`
  ).join('');
}

function explorerDlToggleLevel(key) {
  if (key === 'all') {
    _expDl.levels = ['all'];
  } else {
    let sel = _expDl.levels.filter(k => k !== 'all' && k !== key);
    if (!_expDl.levels.includes(key)) sel.push(key);
    const order = _expLevelDefs.map(l => l.key);
    sel.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    _expDl.levels = sel.length ? sel : ['all'];
  }
  _expDlRenderLevels();
  _expDlRefresh();
}

function _expDlParams() {
  const sort = document.getElementById('expdl-sort')?.value || 'rating_asc';
  const levels = _expDl.levels.includes('all') ? '' : `&levels=${_expDl.levels.join(',')}`;
  return { sort, levels };
}

async function _expDlRefresh() {
  const countEl = document.getElementById('expdl-count');
  const prevEl = document.getElementById('expdl-preview');
  if (!countEl) return;
  const { sort, levels } = _expDlParams();
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/through?${_expPosParam()}&limit=5&sort=${sort}${levels}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'pont');
    countEl.textContent = `${(data.total || 0).toLocaleString('fr-FR')} puzzle(s) correspondent au filtre`;
    if (prevEl) prevEl.innerHTML = (data.puzzles || []).map(p =>
      `<div class="exp-dl-line">⚑ ${p.rating ?? '—'} · ${escapeHtml(p.themes_fr || '')}</div>`).join('');
  } catch (e) {
    countEl.textContent = '';
    if (prevEl) prevEl.innerHTML = `<span class="exp-err">${escapeHtml(String(e.message || e))}</span>`;
  }
}

async function explorerDlDownload() {
  const { sort, levels } = _expDlParams();
  const limit = Math.max(1, parseInt(document.getElementById('expdl-limit')?.value, 10) || 45);
  const full = document.getElementById('expdl-full')?.checked ? '&full=1' : '';
  try {
    const r = await fetch(`${ODP_BRIDGE_URL}/export?${_expPosParam()}&limit=${limit}&sort=${sort}${levels}${full}`);
    if (!r.ok) throw new Error('export');
    const pgn = await r.text();
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // même nom que l'original : puzzles_<fen court>_<niveaux>.pgn
    const fenPart = (_expNfen.split(/\s+/)[0] || 'position').slice(0, 12).replace(/\//g, '-');
    a.download = `puzzles_${fenPart}_${_expDl.levels.join('-')}.pgn`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    window.toast?.('✓ Dossier PGN téléchargé', 'ok');
    window.closeModal?.('modal-exp-export');
  } catch {
    window.toast?.('❌ Échec de l\'export PGN', 'ko');
  }
}

// Export direct conservé pour le pont window (compat).
async function explorerExportPgn() { explorerOpenExport(); }

Object.assign(window, {
  renderExplorer, explorerLoad, explorerCreatePacket, explorerExportPgn,
  explorerOpenExport, explorerDlToggleLevel, explorerDlDownload, _expDlRefresh,
  explorerResetBoard, explorerPickOpening,
  explorerToggleLevel, explorerToggleSort, explorerPage, explorerPlayUci,
  explorerUndo, explorerRedo, explorerThermalMode, explorerOpenAtPuzzle,
  explorerOpenPuzzle, explorerPuzzleHint, explorerPuzzleSolution,
  explorerPuzzleNext, explorerPuzzleExit,
  _expToggleSel, _expToggleAll, _expPrev, _expDetectBridge,
});

// Dev local (sb=null → _coachLoad ne tourne pas) : tenter la détection à l'import.
setTimeout(() => { _expDetectBridge(); }, 300);
