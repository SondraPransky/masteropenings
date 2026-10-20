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
// bilan rédigé — veulent tous « les N plus coûteuses »), + de simples COMPTEURS
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

// ── Le rapport complet d'un élève (consommé par la page profil + le bilan rédigé)
function weaknessReport(games, drills, compare) {
  return { exits: aggregateExits(games, drills, compare), faults: aggregateFaults(games) };
}

// ── Bilan rédigé, GRATUIT et local (remplace la synthèse IA payante) ───────
// Décision utilisatrice (oct. 2026) : pas de clé API payante. Le bilan est écrit
// par des règles à partir du rapport + des motifs tactiques (lib/motifs-core.js).
// Pur et testable. Même cahier des charges que l'ancien prompt : pour le COACH,
// 3 à 6 phrases, la faiblesse la plus récurrente/coûteuse d'abord, 1 ou 2 axes
// de travail précis, et l'aveu simple quand les données sont maigres.
const _PHASE_TXT = { ouverture: "l'ouverture", milieu: 'le milieu de jeu', finale: 'la finale' };
function writeBrief(report, student, explain) {
  const { exits, faults } = report;
  const who = student || "L'élève";
  if (!faults.total) return `${who} n'a encore envoyé aucune partie : rien à analyser pour l'instant.`;
  if (!faults.analyzed) return `Les parties de ${who} sont en cours d'analyse ; reviens dans un moment.`;

  const out = [];
  const recurrent = exits.filter(e => e.count >= 2);
  const exit = recurrent[0] || exits[0] || null;
  const exitTxt = (e) => `dans « ${e.drillName} », au coup ${moveLabel(e.moveNo, e.color)} il joue ${e.played.join(' ou ')} au lieu de ${e.expected.join(' ou ')}`;

  // Motifs des fautes les plus coûteuses (au plus 10, l'explication rejoue la position).
  const motifs = { prise: 0, fourchette: 0, mat: 0 };
  const top = faults.all.slice(0, 10);
  const whys = top.map(ft => (explain ? explain(ft.fenBefore, ft.san, ft.best) : []));
  whys.forEach(w => {
    const t = w.join(' ');
    if (/en prise|gagnait/.test(t)) motifs.prise++;
    if (/fourchette/.test(t)) motifs.fourchette++;
    if (/mat/.test(t)) motifs.mat++;
  });
  const topMotif = Object.entries(motifs).sort((a, b) => b[1] - a[1])[0];

  // 1. Le plus récurrent / le plus coûteux d'abord.
  if (recurrent.length) {
    out.push(`Sa faiblesse la plus récurrente est en ouverture : ${exitTxt(exit)} (${exit.count} parties).`);
  }
  const g = faults.blunders, m = faults.mistakes;
  if (g + m) {
    const phases = Object.entries(faults.byPhase).sort((a, b) => b[1] - a[1]);
    const ph = phases[0][1] ? ` surtout dans ${_PHASE_TXT[phases[0][0]]}` : '';
    out.push(`Sur ${faults.analyzed} partie${faults.analyzed > 1 ? 's' : ''} analysée${faults.analyzed > 1 ? 's' : ''}, le moteur relève ${g} gaffe${g > 1 ? 's' : ''} et ${m} erreur${m > 1 ? 's' : ''}${ph}.`);
    const worst = top[0];
    const why = whys[0] && whys[0].length ? ` : ${whys[0].join(' ; ')}` : (worst.best ? ` (${worst.best} était meilleur)` : '');
    out.push(`La plus coûteuse est ${moveLabel(worst.moveNo, worst.color)} ${worst.san}${why}.`);
  } else {
    out.push(`Aucune gaffe ni erreur nette dans ses ${faults.analyzed} partie${faults.analyzed > 1 ? 's' : ''} analysée${faults.analyzed > 1 ? 's' : ''}.`);
  }
  if (!recurrent.length && exit) out.push(`En ouverture, à surveiller : ${exitTxt(exit)}.`);
  if (topMotif && topMotif[1] >= 2) {
    const lib = { prise: 'des pièces laissées en prise', fourchette: 'des fourchettes', mat: 'des mats' }[topMotif[0]];
    out.push(`Le motif qui revient : ${lib} (${topMotif[1]} fois parmi ses fautes les plus lourdes).`);
  }

  // 2. Axes de travail (1 ou 2).
  const axes = [];
  if (exit) axes.push(`réviser « ${exit.drillName} » jusqu'au coup ${moveLabel(exit.moveNo, exit.color).replace(/[.…]+$/, '')}`);
  if (topMotif && topMotif[1] >= 2) {
    axes.push({ prise: 'des exercices « pièce en prise » (vérifier chaque pièce attaquée avant de jouer)',
                fourchette: 'des exercices de fourchettes', mat: 'des exercices de mat en 1 et 2' }[topMotif[0]]);
  } else if (g + m) {
    const ph = Object.entries(faults.byPhase).sort((a, b) => b[1] - a[1])[0][0];
    axes.push(`des exercices tactiques sur ${_PHASE_TXT[ph]}`);
  }
  if (axes.length) out.push(`À travailler : ${axes.slice(0, 2).join(', puis ')}.`);

  if (faults.analyzed < 3) out.push(`À prendre avec prudence : seulement ${faults.analyzed} partie${faults.analyzed > 1 ? 's' : ''} analysée${faults.analyzed > 1 ? 's' : ''}.`);
  return out.slice(0, 6).join(' ');
}

export { evalCp, classifyLoss, computeFaults, phaseOfFen, gameFaults,
         aggregateExits, aggregateFaults, weaknessReport, writeBrief };
