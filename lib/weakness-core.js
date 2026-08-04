// ══════════════════════════════════════════════════════
// lib/weakness-core.js — ASSISTANT FAIBLESSES : cœur pur (testé Vitest).
//
// Deux natures de faiblesse (arbitrage 04/08) :
//   1. SORTIES DE RÉPERTOIRE RÉCURRENTES — agrège ce que compareGameToRepertoire
//      trouve partie par partie : « il sort 3× au même endroit du même module ».
//   2. FAUTES TACTIQUES — lit l'analyse moteur persistée dans `g.analysis`
//      (posée par lib/analysis-queue.js : Stockfish WASM côté navigateur).
//
// Forme persistée (games.extra.analysis, migration-free) :
//   { v:1, depth, ts,
//     evals:  [e0 … eN]                        // une entrée PAR POSITION (N coups → N+1),
//                                              // nombre = centipions POV BLANCS, ou 'M3'/'M-2' (mat)
//     faults: [{ ply, san, loss, sev, best }] } // sev: 'blunder'|'mistake' ; best = SAN moteur
//
// Ce module ne touche ni le DOM ni le réseau. `Chess` est le global habituel.
// ══════════════════════════════════════════════════════
import { pgnMainlineSans, pgnStartFen, _normFen, moveLabel } from './core.js';
import { compareGameToRepertoire } from './tree.js';

// ── Évaluations ─────────────────────────────────────────────────────────────
// Un mat vaut ±1000 cp plafonnés : au-delà, la différence n'apprend rien sur la
// faute (passer de +12 à +8 n'est pas une gaffe pédagogique).
const _CP_CAP = 1000;
function evalCp(e) {
  if (e == null) return null;
  if (typeof e === 'number') return Math.max(-_CP_CAP, Math.min(_CP_CAP, e));
  const m = /^M(-?\d+)$/.exec(String(e));
  if (!m) return null;
  return parseInt(m[1], 10) >= 0 ? _CP_CAP : -_CP_CAP;
}

// Seuils pédagogiques (élèves de club) : gaffe ≥ 300 cp perdus, erreur ≥ 120.
// Les imprécisions (< 120) sont volontairement ignorées — du bruit pour un enfant.
function classifyLoss(loss) {
  if (loss >= 300) return 'blunder';
  if (loss >= 120) return 'mistake';
  return null;
}

// Position déjà perdue (≤ −600 pour le camp au trait) : les fautes suivantes ne
// comptent plus — on n'accable pas un élève déjà noyé, et ça fausserait les stats.
const _LOST = -600;

// ── Fautes d'une partie depuis ses évaluations brutes ───────────────────────
// evals = POV Blancs, une par position. startTurn = camp au trait à la position 0.
// bests = SAN moteur par position (optionnel, même longueur que evals).
// → [{ ply, loss, sev, best }] (le SAN joué et la phase sont posés par gameFaults).
function computeFaults(evals, startTurn = 'w', bests = null) {
  const out = [];
  for (let i = 0; i + 1 < evals.length; i++) {
    const before = evalCp(evals[i]), after = evalCp(evals[i + 1]);
    if (before == null || after == null) continue;
    const mover = ((startTurn === 'w') === (i % 2 === 0)) ? 'w' : 'b';
    const pov = mover === 'w' ? 1 : -1;
    if (before * pov <= _LOST) continue;
    const loss = before * pov - after * pov;
    const sev = classifyLoss(loss);
    if (sev) out.push({ ply: i, loss: Math.round(loss), sev, best: bests?.[i] || null });
  }
  return out;
}

// ── Phase de jeu d'une position ─────────────────────────────────────────────
// Ouverture : ≤ 10 coups pleins. Finale : matériel lourd/léger (hors pions/rois)
// des DEUX camps ≤ 12 points. Milieu sinon. Simple à dessein — la phase sert à
// RANGER les fautes, pas à trancher une théorie.
const _VAL = { n: 3, b: 3, r: 5, q: 9 };
function phaseOfFen(fen) {
  const f = String(fen || '').split(' ');
  const moveNo = parseInt(f[5], 10) || 1;
  if (moveNo <= 10) return 'ouverture';
  let mat = 0;
  for (const c of (f[0] || '')) { const v = _VAL[c.toLowerCase()]; if (v) mat += v; }
  return mat <= 12 ? 'finale' : 'milieu';
}

// ── Fautes ENRICHIES d'une partie (replay du PGN pour SAN, FEN, phase) ──────
// → [{ ply, san, loss, sev, best, fenBefore, phase, moveNo, color }] ou [].
function gameFaults(g) {
  const a = g && g.analysis;
  if (!a || !Array.isArray(a.faults) || !a.faults.length) return [];
  const sans = pgnMainlineSans(g.pgn || '');
  const startFen = pgnStartFen(g.pgn || '');
  let chess;
  try { chess = new Chess(startFen); } catch (e) { return []; }
  const byPly = new Map(a.faults.map(ft => [ft.ply, ft]));
  const out = [];
  for (let i = 0; i < sans.length; i++) {
    const fenBefore = chess.fen();
    const mv = chess.move(sans[i], { sloppy: true });
    if (!mv) break;
    const ft = byPly.get(i);
    if (!ft) continue;
    const fp = fenBefore.split(' ');
    out.push({ ply: i, san: mv.san, loss: ft.loss, sev: ft.sev, best: ft.best || null,
               fenBefore, phase: phaseOfFen(fenBefore),
               moveNo: parseInt(fp[5], 10) || 1, color: fp[1] });
  }
  return out;
}

// ── Agrégat 1 : sorties de répertoire récurrentes ───────────────────────────
// Regroupe les sorties par (module + position) : la MÊME position ratée dans
// plusieurs parties est LA faiblesse d'ouverture actionnable.
// compare(g) est injectable (le caller passe sa version mémoïsée, cf. _pgRep).
function aggregateExits(games, drills, compare) {
  const cmp = compare || ((g) => { try { return compareGameToRepertoire(g.pgn, drills); } catch (e) { return null; } });
  const byPos = new Map();
  for (const g of games || []) {
    const r = cmp(g);
    if (!r?.exit) continue;
    const key = String(r.d.id) + '|' + _normFen(r.exit.fenBefore);   // la clé de transposition du projet
    let e = byPos.get(key);
    if (!e) {
      e = { key, drillId: r.d.id, drillName: r.d.name, fenBefore: r.exit.fenBefore,
            moveNo: r.exit.moveNo, color: r.exit.color, expected: r.exit.expected,
            played: [], count: 0, lastTs: 0, gameIds: [] };
      byPos.set(key, e);
    }
    e.count++;
    if (!e.played.includes(r.exit.played)) e.played.push(r.exit.played);
    e.lastTs = Math.max(e.lastTs, g.ts || 0);
    e.gameIds.push(g.id);
  }
  // Récurrent d'abord (le cœur de la demande), puis le plus récent.
  return [...byPos.values()].sort((a, b) => b.count - a.count || b.lastTs - a.lastTs);
}

// ── Agrégat 2 : fautes tactiques ────────────────────────────────────────────
// UNE liste `all`, triée par coût décroissant (les consommateurs — bilan, chips,
// synthèse IA — veulent tous « les N plus coûteuses »), + de simples COMPTEURS
// par phase. ⚠ Ne pas re-ranger les fautes en tableaux par phase : personne
// n'itère une phase, et la forme obligeait chaque appelant à tout remettre à
// plat puis retrier (deux copies de la même expression avant le 04/08).
function aggregateFaults(games) {
  const all = [];
  let analyzed = 0;
  for (const g of games || []) {
    if (g.analysis) analyzed++;
    for (const ft of gameFaults(g)) all.push({ ...ft, gameId: g.id, gameTs: g.ts || 0, white: g.white, black: g.black });
  }
  all.sort((a, b) => b.loss - a.loss);
  const byPhase = { ouverture: 0, milieu: 0, finale: 0 };
  let blunders = 0, mistakes = 0;
  for (const ft of all) {
    byPhase[ft.phase] = (byPhase[ft.phase] || 0) + 1;
    if (ft.sev === 'blunder') blunders++; else mistakes++;
  }
  return { analyzed, total: (games || []).length, blunders, mistakes, all, byPhase };
}

// ── Le rapport complet d'un élève (consommé par la page profil + la synthèse IA)
function weaknessReport(games, drills, compare) {
  return { exits: aggregateExits(games, drills, compare), faults: aggregateFaults(games) };
}

// ── Payload de la synthèse IA (Edge Function `student-brief`) ───────────────
// Pur et testable : c'est de la mise en forme du rapport, pas du rendu de page.
// Compact À DESSEIN — la fonction refuse au-delà de 20 Ko, et un bilan se paie.
function briefPayload(report, student) {
  const { exits, faults } = report;
  return {
    student,
    games: faults.total, analyzed: faults.analyzed,
    exits: exits.slice(0, 8).map(e => ({
      module: e.drillName,
      coup: `${moveLabel(e.moveNo, e.color)} ${e.played.join('/')}`,
      attendu: e.expected.join(' ou '),
      parties: e.count,
    })),
    fautes: {
      gaffes: faults.blunders, erreurs: faults.mistakes,
      parPhase: { ...faults.byPhase },
      top: faults.all.slice(0, 8).map(ft => ({
        coup: `${moveLabel(ft.moveNo, ft.color)} ${ft.san}`,
        phase: ft.phase, pions: Math.round(ft.loss) / 100, mieux: ft.best || null,
      })),
    },
  };
}

export { evalCp, classifyLoss, computeFaults, phaseOfFen, gameFaults,
         aggregateExits, aggregateFaults, weaknessReport, briefPayload };
