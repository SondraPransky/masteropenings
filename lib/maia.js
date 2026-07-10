// ══════════════════════════════════════════════════════
// MOTEUR MAIA — ONNX Runtime Web — extrait d'app.js (§5.3)
// Modèle : maiachess.com/maia3/maia3_simplified.onnx
// ELO interpolé selon le niveau du drill. Runtime ONNX chargé à la demande.
// Données : `G` (state.js) + `S` (session.js). `Chess`/`ort` = globals CDN.
// Board/feedback/persistance résolus au runtime via le pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { S } from './session.js';
import { _normFen } from './core.js';
import { isPlayerMove } from './tree.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const drawBoard       = (...a) => window.drawBoard?.(...a);
const setFeedback     = (...a) => window.setFeedback?.(...a);
const saveGame        = (...a) => window.saveGame?.(...a);
const closeModal      = (...a) => window.closeModal?.(...a);
const toast           = (...a) => window.toast?.(...a);
const goPage          = (...a) => window.goPage?.(...a);
const resizeBoard     = (...a) => window.resizeBoard?.(...a);
const showPromoPicker = (...a) => window.showPromoPicker?.(...a);

const MAIA_MODEL_URL = 'https://www.maiachess.com/maia3/maia3_simplified.onnx';
const MAIA_MOVES_URL = 'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/main/src/lib/engine/data/all_moves_maia3.json';
const MAIA_ELO = { 'Débutant':900, 'Intermédiaire':1300, 'Avancé':1600, 'Expert':1900, 'Maître':2200, 'Grand-Maître':2500 };

let _maiaSession  = null;
let _maiaUci2Idx  = null;   // "e2e4" → 1234
let _maiaIdx2Uci  = null;   // 1234   → "e2e4"
let _maiaState    = 'idle'; // idle | loading | ready | error
let _maiaThinking = false;

// Charge onnxruntime-web À LA DEMANDE (1re partie vs Maia), pas au démarrage de la page.
// Le <script> n'est plus dans le <head> → l'app démarre sans télécharger le runtime ONNX.
let _ortPromise = null;
function _ensureOrt() {
  if (typeof ort !== 'undefined') return Promise.resolve();
  if (_ortPromise) return _ortPromise;
  _ortPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.wasm.min.js';
    s.onload  = () => resolve();
    s.onerror = () => { _ortPromise = null; reject(new Error('Échec du chargement de onnxruntime-web')); };
    document.head.appendChild(s);
  });
  return _ortPromise;
}

async function loadMaia(onProgress) {
  if (_maiaState === 'ready')   return;
  if (_maiaState === 'loading') return;
  _maiaState = 'loading';
  try {
    // Runtime ONNX chargé à la demande (lazy) — accélère le démarrage de l'app
    onProgress?.('Chargement du runtime…', 2);
    await _ensureOrt();

    // Config WASM
    ort.env.wasm.wasmPaths  = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
    ort.env.wasm.numThreads = 1;

    // Carte des coups UCI ↔ index
    onProgress?.('Chargement des données…', 5);
    const r = await fetch(MAIA_MOVES_URL);
    _maiaUci2Idx = await r.json();
    _maiaIdx2Uci = {};
    for (const [uci, idx] of Object.entries(_maiaUci2Idx)) _maiaIdx2Uci[idx] = uci;

    // Téléchargement du modèle avec progression
    onProgress?.('Téléchargement du moteur Maia…', 10);
    const resp  = await fetch(MAIA_MODEL_URL);
    const total = parseInt(resp.headers.get('content-length') || '45683686');
    const reader = resp.body.getReader();
    let loaded = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress?.(
        `Moteur Maia — ${Math.round(loaded/1e6)} / ${Math.round(total/1e6)} Mo`,
        10 + Math.round(loaded / total * 80)
      );
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }

    onProgress?.('Initialisation…', 93);
    _maiaSession = await ort.InferenceSession.create(buf.buffer, { executionProviders: ['wasm'] });
    _maiaState   = 'ready';
    onProgress?.('✓ Maia prêt', 100);
  } catch(e) {
    _maiaState = 'error';
    console.error('[Maia]', e);
    throw e;
  }
}

// Miroir de FEN (côté noir → perspective blancs)
function _mirrorFen(fen) {
  const [pos, turn, cast, ep, h, f] = fen.split(' ');
  const newPos  = pos.split('/').reverse()
    .map(r => [...r].map(c =>
      c>='a'&&c<='z' ? c.toUpperCase() :
      c>='A'&&c<='Z' ? c.toLowerCase() : c
    ).join('')).join('/');
  const newCast = cast==='-' ? '-' : [...cast].map(c => ({K:'k',Q:'q',k:'K',q:'Q'}[c]||c)).join('');
  const newEp   = ep==='-'   ? '-' : ep[0] + (ep[1]==='3' ? '6' : '3');
  return `${newPos} ${turn==='w'?'b':'w'} ${newCast} ${newEp} ${h} ${f}`;
}

// Miroir d'un coup UCI (rangs 1↔8, 2↔7 …)
function _mirrorUci(uci) {
  const mr = r => String(9 - parseInt(r));
  return uci[0]+mr(uci[1])+uci[2]+mr(uci[3])+(uci[4]||'');
}

// Inférence Maia sur un FEN, renvoie le meilleur coup UCI
async function _getMaiaMove(fen, level) {
  const g       = new Chess(fen);
  const isBlack = g.turn() === 'b';
  const wg      = isBlack ? new Chess(_mirrorFen(fen)) : g;

  // tokens [1, 64, 12] — encodage one-hot position/piece
  const tokens = new Float32Array(64 * 12);
  const CH = { w:{p:0,n:1,b:2,r:3,q:4,k:5}, b:{p:6,n:7,b:8,r:9,q:10,k:11} };
  wg.board().forEach((row, ri) => row.forEach((pc, fi) => {
    if (!pc) return;
    tokens[((7-ri)*8+fi)*12 + CH[pc.color][pc.type]] = 1.0;
  }));

  // masque des coups légaux [4352]
  const mask = new Float32Array(4352);
  wg.moves({ verbose:true }).forEach(m => {
    const idx = _maiaUci2Idx[m.from + m.to + (m.promotion||'')];
    if (idx !== undefined) mask[idx] = 1.0;
  });

  const eloSelf = MAIA_ELO[level] || 1300;
  const feeds = {
    tokens:   new ort.Tensor('float32', tokens, [1, 64, 12]),
    elo_self: new ort.Tensor('float32', new Float32Array([eloSelf]), [1]),
    elo_oppo: new ort.Tensor('float32', new Float32Array([1500]),    [1])
  };

  const out = await _maiaSession.run(feeds);

  // Récupérer les logits de coups (tenseur de dim 4352)
  let logits = null;
  for (const t of Object.values(out)) { if (t.data.length === 4352) { logits = t.data; break; } }
  if (!logits) return null;

  // Meilleur coup légal selon les logits
  let bestIdx = -1, bestScore = -Infinity;
  for (let i = 0; i < 4352; i++) {
    if (mask[i] > 0 && logits[i] > bestScore) { bestScore = logits[i]; bestIdx = i; }
  }
  if (bestIdx < 0) return null;

  const uci = _maiaIdx2Uci[bestIdx];
  return (uci && isBlack) ? _mirrorUci(uci) : uci;
}

async function enginePlay() {
  if (_maiaThinking) return;
  const g = S.lineGame;
  if (!g || g.game_over() || !S.postTheory) return;

  _maiaThinking = true;
  try {
    const uci = await _getMaiaMove(g.fen(), S.drill?.level);
    if (!uci || !S.postTheory) { _maiaThinking = false; return; }

    const mv = g.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4]||'q' });
    if (!mv) { _maiaThinking = false; _checkPTEnd(); return; }

    S.last = { from: uci.slice(0,2), to: uci.slice(2,4) };
    drawBoard();
    _checkPTEnd();
  } catch(e) {
    console.error('[Maia]', e);
    setFeedback('hint', '⚠️ Erreur du moteur Maia.', '');
  }
  _maiaThinking = false;
}

function _checkPTEnd() {
  const g = S.lineGame;
  if (g.game_over()) {
    S.postTheory = false;
    saveGame();
    document.getElementById('test-btns').style.display = 'none';
    document.getElementById('btn-quit-maia').style.display = 'none';
    let msg = '🏁 Partie terminée — enregistrée dans Vue Prof.';
    if (g.in_checkmate()) msg = g.turn()==='w' ? '⚔️ Mat — les Noirs gagnent !' : '🏆 Mat — les Blancs gagnent !';
    else if (g.in_draw() || g.in_stalemate()) msg = '🤝 Partie nulle.';
    setFeedback('hint', msg, '');
    drawBoard(); return;
  }
  setFeedback('hint', '🎯 À vous — partie libre !', '');
}

function _afterMaiaReady() {
  if (!S.postTheory) return;
  if (S.lineGame.turn() !== S.drill.side) {
    setFeedback('hint', '⚙️ Maia réfléchit…', '');
    setTimeout(enginePlay, 400);
  } else {
    setFeedback('hint', '🎯 La théorie est terminée — jouez librement !', '');
  }
}

function startPostTheory() {
  closeModal('modal-end');
  S.postTheory = true; S.sel = null; _maiaThinking = false;
  S._ptStartPly = (S.lineGame && S.lineGame.history) ? S.lineGame.history().length : 0;   // coups déjà joués (théorie) → pour détecter si l'élève joue vraiment
  document.getElementById('test-btns').style.display = 'inline-flex';
  document.getElementById('btn-quit-maia').style.display = '';   // bouton « Arrêter la partie »
  document.getElementById('pos-card').style.display  = 'none';
  drawBoard();

  if (_maiaState === 'ready') {
    _afterMaiaReady();
  } else {
    setFeedback('hint', '⏳ Chargement du moteur Maia (43 Mo)…', '');
    loadMaia((msg, pct) => {
      if (S.postTheory) setFeedback('hint', `⏳ ${msg} (${pct}%)`, '');
    })
    .then(() => { if (S.postTheory) _afterMaiaReady(); })
    .catch(()  => { if (S.postTheory) setFeedback('hint', '⚠️ Moteur indisponible — vérifiez votre connexion.', ''); });
  }
}

// Arrêter une partie contre Maia : on l'enregistre (si l'élève a joué au moins
// un coup depuis la théorie) puis on revient à son espace.
function quitMaiaGame() {
  const played = S.lineGame && S.lineGame.history && S.lineGame.history().length > (S._ptStartPly || 0);
  if (played) saveGame();          // résultat '*' (partie inachevée) — visible dans Vue Prof
  S.postTheory = false;
  _maiaThinking = false;
  document.getElementById('btn-quit-maia').style.display = 'none';
  document.getElementById('test-btns').style.display = 'none';
  toast(played ? '✓ Partie enregistrée dans Vue Prof' : 'Partie quittée', 'ok');
  goPage(G.currentRole === 'teacher' ? 'coach' : 'student-home');
}

// Jouer une partie contre Maia depuis une ouverture (accès direct, 1 clic)
function playVsMaia(idx) {
  const d = G.drills[idx];
  if (!d) return;
  S.student = G.currentUser?.displayName || G.currentUser?.email || S.student || 'Élève';
  S.drill = d; S.idx = idx;
  S.flipped = (d.side === 'b');
  // Jouer la ligne principale jusqu'à la sortie du répertoire
  const g = new Chess(d.sessions?.[0]?.startFen || new Chess().fen());
  if (d.varmode === 'tree' && d.tree) {
    let guard = 0;
    while (guard++ < 300) {
      const node = d.tree[_normFen(g.fen())];
      if (!node) break;
      const mv = isPlayerMove(g.fen(), d.side) ? node.player?.[0] : node.opp?.[0];
      if (!mv || !g.move(mv.san)) break;
    }
  } else {
    (d.sessions?.[0]?.moves || []).forEach(m => { try { g.move(m.san); } catch(e) {} });
  }
  S.lineGame = g;
  document.getElementById('s-name').textContent  = d.name + ' — Partie vs Maia';
  document.getElementById('s-level').textContent = d.level || '';
  document.getElementById('s-side').textContent  = d.side==='w'?'♔ Blancs':d.side==='b'?'♚ Noirs':'⇄ Les deux';
  document.getElementById('s-mode-badge').textContent = '🤖 vs Maia';
  document.getElementById('learn-card').style.display    = 'none';
  document.getElementById('notation-card').style.display = 'none';
  document.getElementById('score-card').style.display    = 'none';
  document.getElementById('history-card').style.display  = 'none';
  S._reviewMode = true;            // empêche initDrillPage de relancer startDrill
  goPage('drill');
  resizeBoard();
  startPostTheory();               // active le mode partie libre + Maia
}

function tryMovePostTheory(from, to, promo) {
  if (_maiaThinking) return;
  const g = S.lineGame;
  if (!g || g.game_over() || g.turn() !== S.drill.side) return;
  if (!promo) {
    const mp=g.get(from);
    if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===to&&m.flags.includes('p'))){
      showPromoPicker(mp.color,window._lastMoveXY?.x||0,window._lastMoveXY?.y||0,pr=>tryMovePostTheory(from,to,pr));
      return;
    }
    promo='q';
  }
  const move = g.move({ from, to, promotion:promo });
  if (!move) { S.sel=null; drawBoard(); return; }
  S.last = { from, to }; S.sel = null; drawBoard();
  if (g.game_over()) { _checkPTEnd(); return; }
  setFeedback('hint', '⚙️ Maia réfléchit…', '');
  setTimeout(enginePlay, 300);
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/lib.
Object.assign(window, {
  _ensureOrt, loadMaia, _mirrorFen, _mirrorUci, _getMaiaMove, enginePlay,
  _checkPTEnd, _afterMaiaReady, startPostTheory, quitMaiaGame, playVsMaia, tryMovePostTheory,
});
