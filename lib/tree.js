// ════════════════════════════════════════════════════════════
//  lib/tree.js — LOGIQUE PURE des arbres d'ouverture (sans DOM, sans état app).
//  Construit/parcourt l'arbre de variantes d'un module. Testable en isolation.
//  `Chess` = global (CDN navigateur ; injecté via globalThis dans les tests).
// ════════════════════════════════════════════════════════════
import { _normFen } from './core.js';

// Le camp qui doit jouer dans cette position, d'après le trait (champ 2 du FEN).
function isPlayerMove(fenBefore, side) {
  const turn = fenBefore.split(' ')[1];
  return side === 'both' || turn === side;
}

// Construit l'arbre {normFen: {opp[], player[], startFen}} depuis les lignes extraites.
function _buildDrillTree(allLines, side) {
  const tree = {};
  for (const line of allLines) {
    const g = new Chess(line.startFen || new Chess().fen());
    for (const mv of line.moves) {
      const nf = _normFen(g.fen());
      if (!tree[nf]) tree[nf] = { opp: [], player: [], startFen: g.fen() };
      const isPlayer = isPlayerMove(g.fen(), side);
      const bucket   = isPlayer ? 'player' : 'opp';
      if (!tree[nf][bucket].find(m => m.san === mv.san)) {
        tree[nf][bucket].push({ san: mv.san, comment: mv.comment || '' });
      }
      g.move(mv.san);
    }
  }
  return tree;
}

// Énumère les positions où l'élève doit jouer (points de décision), pour la SM-2.
function _treePlayerPositions(drill) {
  const out = [];
  if (drill.varmode !== 'tree' || !drill.tree) return out;
  const side = drill.side;
  const startFen = drill.sessions?.[0]?.startFen || new Chess().fen();
  const seen = new Set();
  const queue = [new Chess(startFen)];
  while (queue.length) {
    const g  = queue.shift();
    const nf = _normFen(g.fen());
    if (seen.has(nf)) continue;
    seen.add(nf);
    const node = drill.tree[nf];
    if (!node) continue;
    if (isPlayerMove(g.fen(), side) && node.player && node.player.length) {
      const canon = node.player[0];
      out.push({
        fen: g.fen(),
        masteryKey: nf + '_' + canon.san,
        san: canon.san,
        altSans: node.player.map(m => m.san),
        comment: canon.comment || ''
      });
    }
    [...(node.player || []), ...(node.opp || [])].forEach(mv => {
      const g2 = new Chess(g.fen());
      if (g2.move(mv.san)) queue.push(g2);
    });
  }
  return out;
}

// Heuristique « ce coup laisse-t-il du matériel en prise ? » (1 coup, seuil ≥2 pts).
function _materialHint(fenBefore, moveSan) {
  try {
    const g = new Chess(fenBefore);
    if (!g.move(moveSan)) return '';
    const val = { p:1, n:3, b:3, r:5, q:9, k:0 };
    let worst = 0;
    for (const c of g.moves({ verbose:true }).filter(m => m.captured)) {
      const g2 = new Chess(g.fen()); g2.move(c.san);
      const recap = g2.moves({ verbose:true }).some(m => m.to === c.to && m.captured);
      const net = val[c.captured] - (recap ? val[c.piece] : 0);
      if (net > worst) worst = net;
    }
    return worst >= 2 ? '⚠ ce coup semble laisser du matériel en prise' : '';
  } catch(e) { return ''; }
}

export { isPlayerMove, _buildDrillTree, _treePlayerPositions, _materialHint };
