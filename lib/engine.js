// ══════════════════════════════════════════════════════
// lib/engine.js — STOCKFISH WASM (assistant faiblesses).
//
// Build vendorée : vendor/stockfish/stockfish-18-lite-single.{js,wasm} —
// MONO-THREAD à dessein : GitHub Pages ne peut pas poser COOP/COEP, donc pas de
// SharedArrayBuffer, donc pas de build multi-thread. La lite-single (7 Mo,
// chargée UNE fois, en lazy) suffit largement à détecter des gaffes d'élèves à
// profondeur modérée. Ne jamais « upgrader » vers la build threads sans changer
// d'hébergeur.
//
// API : sfAnalyzeGame(pgn, {depth, onStep}) → l'enregistrement `analysis`
// persisté dans games.extra (forme documentée dans weakness-core.js).
// Les appels sont SÉRIALISÉS (un seul moteur, une seule PV à la fois).
// ══════════════════════════════════════════════════════
import { pgnMainlineSans, pgnStartFen } from './core.js';
import { computeFaults } from './weakness-core.js';

let _worker = null;         // Worker Stockfish (créé au 1er besoin, réutilisé)
let _chain = Promise.resolve();   // sérialise les analyses
const _MAX_PLIES = 200;     // garde-fou : au-delà, une « partie » est un collage

function _sfUrl() {
  // Vite : BASE_URL = '/' en dev, './' en build (base relative, Pages sous-répertoire).
  const env = /** @type {any} */ (import.meta).env;
  const base = (env && env.BASE_URL) || './';
  return base + 'vendor/stockfish/stockfish-18-lite-single.js';
}

// Démarre le moteur et attend `uciok`. Échec (vieux navigateur, fichier absent)
// → rejet : la file d'analyse abandonne proprement, l'app ne casse pas.
function _sfBoot() {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(_sfUrl()); } catch (e) { reject(e); return; }
    const t = setTimeout(() => { try { w.terminate(); } catch (e) {} reject(new Error('stockfish : uciok jamais reçu')); }, 20000);
    w.onerror = (e) => { clearTimeout(t); try { w.terminate(); } catch (x) {} reject(e.error || new Error('stockfish : worker en erreur')); };
    w.onmessage = (ev) => {
      if (String(ev.data).startsWith('uciok')) { clearTimeout(t); w.onerror = null; resolve(w); }
    };
    w.postMessage('uci');
  });
}

async function _sfGet() {
  if (!_worker) _worker = await _sfBoot();
  return _worker;
}

// Évalue UNE position : { cp | mate } (POV du camp AU TRAIT) + bestUci.
function _sfEval(w, fen, depth) {
  return new Promise((resolve, reject) => {
    let last = null;
    const t = setTimeout(() => { w.onmessage = null; reject(new Error('stockfish : position sans bestmove')); }, 30000);
    w.onmessage = (ev) => {
      const line = String(ev.data);
      if (line.startsWith('info ') && line.includes(' score ')) {
        const cp = / score cp (-?\d+)/.exec(line);
        const mate = / score mate (-?\d+)/.exec(line);
        const pv = / pv ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(line);
        last = { cp: cp ? parseInt(cp[1], 10) : null, mate: mate ? parseInt(mate[1], 10) : null, bestUci: pv ? pv[1] : null };
      } else if (line.startsWith('bestmove')) {
        clearTimeout(t); w.onmessage = null;
        const bm = /^bestmove (\S+)/.exec(line);
        resolve({ ...(last || {}), bestUci: (last && last.bestUci) || (bm && bm[1] !== '(none)' ? bm[1] : null) });
      }
    };
    w.postMessage('position fen ' + fen);
    w.postMessage('go depth ' + depth);
  });
}

// POV camp au trait → POV Blancs, dans la forme persistée (nombre ou 'Mn').
function _povWhite(r, turn) {
  const s = turn === 'w' ? 1 : -1;
  if (r.mate != null) return 'M' + (r.mate * s);
  if (r.cp != null) return r.cp * s;
  return null;
}

// Position terminale : pas besoin de moteur (et `go` y répond `(none)`).
function _terminalEval(chess) {
  if (!chess.game_over()) return undefined;
  if (chess.in_checkmate()) return chess.turn() === 'w' ? 'M-1' : 'M1';   // le camp au trait est maté
  return 0;   // pat, répétition, matériel insuffisant : nulle
}

// ── L'analyse d'une partie complète ─────────────────────────────────────────
// onStep(fait, total) : progression pour l'indicateur discret.
function sfAnalyzeGame(pgn, /** @type {{depth?: number, onStep?: Function}} */ { depth = 12, onStep } = {}) {
  // Sérialisée : deux analyses simultanées partageraient le même worker UCI.
  const run = async () => {
    const sans = pgnMainlineSans(pgn, _MAX_PLIES);
    const startFen = pgnStartFen(pgn);
    const chess = new Chess(startFen);
    const fens = [chess.fen()];
    for (const s of sans) {
      if (!chess.move(s, { sloppy: true })) break;
      fens.push(chess.fen());
    }
    if (fens.length < 3) throw new Error('partie trop courte pour une analyse');

    const w = await _sfGet();
    const evals = [], bests = [];
    for (let i = 0; i < fens.length; i++) {
      const g = new Chess(fens[i]);
      const term = _terminalEval(g);
      if (term !== undefined) { evals.push(term); bests.push(null); }
      else {
        const r = await _sfEval(w, fens[i], depth);
        evals.push(_povWhite(r, g.turn()));
        // bestUci → SAN dans la position (chess.js résout la promotion q/r/b/n).
        let bestSan = null;
        if (r.bestUci) {
          const mv = g.move({ from: r.bestUci.slice(0, 2), to: r.bestUci.slice(2, 4), promotion: r.bestUci[4] || 'q' });
          bestSan = mv ? mv.san : null;
        }
        bests.push(bestSan);
      }
      onStep?.(i + 1, fens.length);
    }
    const faults = computeFaults(evals, startFen.split(' ')[1] || 'w', bests);
    return { v: 1, depth, ts: Date.now(), evals, faults };
  };
  const p = _chain.then(run);
  _chain = p.then(() => {}, () => {});   // une analyse ratée ne bloque pas les suivantes
  return p;
}

// Le moteur est-il seulement disponible ? (Worker + WASM — vrai partout de moderne.)
function sfAvailable() {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

export { sfAnalyzeGame, sfAvailable };
