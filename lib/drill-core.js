// ══════════════════════════════════════════════════════
// DRILL — CŒUR PUR (sessions, sélection de coups adverses, forced path)
// Zéro DOM, zéro état module, zéro accès localStorage : entrées → sorties,
// donc testable en isolation. Extrait d'app.js (étape 5.2a du découpage
// drill engine, cf. CLAUDE.md §5.2).
// Vendors : `Chess` (global CDN). Dépend de `_normFen` (lib/core.js) et
// `isPlayerMove` (lib/tree.js).
// ══════════════════════════════════════════════════════
import { _normFen } from './core.js';
import { isPlayerMove } from './tree.js';

// Clé unique d'un coup adverse « déjà vu » (miroir local G.oppSeen).
// Centralisée ici pour garantir une construction IDENTIQUE entre
// computeForcedPath / pickOppMove / treeUnseenCount (cf. piège §8 sur les
// collisions de chaînes).
export function oppSeenKey(student, drillId, nf, san) {
  return `${student}__${drillId}__${nf}__${san}`;
}

// Délai d'affichage d'un commentaire, proportionnel à sa longueur.
export function _commentDelay(comment) {
  return comment ? Math.min(5000, Math.max(1500, comment.length * 45)) : 180;
}

// Liste des sessions d'un drill (compat ancien format kps directs).
export function _drillSessions(d) {
  return d.sessions?.length ? d.sessions : (d.kps?.length ? [{ kps: d.kps, startFen: d.startFen }] : []);
}

// Nombre total de coups joueur (mode ligne) ou de positions clés (mode flash).
export function countPlayerMoves(drill) {
  const allSessions = drill.sessions ||
    [{ moves: drill.moves || [], kps: drill.kps || [] }];
  if (drill.mode === 'line') {
    return allSessions.reduce((sum, s) =>
      sum + (s.moves || []).filter(m => isPlayerMove(m.fenBefore, drill.side)).length, 0);
  }
  return allSessions.reduce((sum, s) => sum + (s.kps || []).length, 0);
}

// BFS depuis la racine : trouve le chemin de choix adverses menant au coup
// adverse non-vu (ou le moins récemment vu) le moins profond. Renvoie une map
// { normFen: san } utilisée par pickOppMove pour orienter l'adversaire de
// façon déterministe d'une session à l'autre. Pur : `oppSeen` en argument.
export function computeForcedPath(student, drillId, tree, drillSide, oppSeen) {
  if (!tree || !Object.keys(tree).length) return null;
  const startNf = _normFen(new Chess().fen());
  let bestTs = Infinity, bestPath = null;
  const q = [{ nf: startNf, g: new Chess(), oppPath: {} }];
  const visited = new Set();
  while (q.length) {
    const { nf, g, oppPath } = q.shift();
    if (visited.has(nf)) continue;
    visited.add(nf);
    const node = tree[nf];
    if (!node) continue;
    const playerTurn = isPlayerMove(g.fen(), drillSide);
    const moves = playerTurn ? (node.player || []) : (node.opp || []);
    if (!playerTurn) {
      for (const mv of moves) {
        const ts = oppSeen[oppSeenKey(student, drillId, nf, mv.san)] ?? 0;
        if (ts < bestTs) {
          bestTs = ts;
          bestPath = { ...oppPath, [nf]: mv.san };
          if (ts === 0) return bestPath; // non-vu trouvé — le chemin le plus court gagne
        }
      }
    }
    for (const mv of moves) {
      const g2 = new Chess(g.fen());
      if (!g2.move(mv.san)) continue;
      const nf2 = _normFen(g2.fen());
      if (!visited.has(nf2)) {
        q.push({
          nf: nf2,
          g: g2,
          oppPath: playerTurn ? oppPath : { ...oppPath, [nf]: mv.san }
        });
      }
    }
  }
  return bestTs < Infinity ? bestPath : null;
}

// Choix pur du coup adverse pour un point de décision.
//  - `seenTs` : map { san: timestamp } (0/undefined ⇒ non-vu)
//  - `forcedSan` : coup imposé par le forced path (prioritaire s'il existe)
//  - `rng` : générateur [0,1) injectable (défaut Math.random) pour tester
// Ne mute rien : l'appelant enregistre le choix dans G.oppSeen.
export function pickOppMove(moves, seenTs, forcedSan, rng = Math.random) {
  if (forcedSan) {
    const forced = moves.find(m => m.san === forcedSan);
    if (forced) return forced;
  }
  const tsOf = san => seenTs[san] || 0;
  const unseen = moves.filter(m => !tsOf(m.san));
  return unseen.length
    ? unseen[Math.floor(rng() * unseen.length)]
    : [...moves].sort((a, b) => tsOf(a.san) - tsOf(b.san))[0];
}

// Nombre de coups adverses jamais vus dans un arbre (jauge de progression).
export function treeUnseenCount(tree, student, drillId, oppSeen) {
  let n = 0;
  for (const [nf, node] of Object.entries(tree || {})) {
    for (const mv of node.opp) {
      if (!oppSeen[oppSeenKey(student, drillId, nf, mv.san)]) n++;
    }
  }
  return n;
}
