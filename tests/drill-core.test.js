import {
  oppSeenKey, _commentDelay, _drillSessions, countPlayerMoves,
  computeForcedPath, pickOppMove, treeUnseenCount
} from '../lib/drill-core.js';
import { _buildDrillTree } from '../lib/tree.js';
import { extractAllLines } from '../lib/core.js';

// `Chess` est injecté en global par tests/setup.js (comme dans le navigateur).

describe('oppSeenKey — clé « coup adverse déjà vu »', () => {
  test('format stable student__drill__fen__san', () => {
    expect(oppSeenKey('Bob', '7', 'FEN', 'e4')).toBe('Bob__7__FEN__e4');
  });
});

describe('_commentDelay — délai proportionnel au commentaire', () => {
  test('pas de commentaire → 180 ms', () => {
    expect(_commentDelay('')).toBe(180);
    expect(_commentDelay(null)).toBe(180);
    expect(_commentDelay(undefined)).toBe(180);
  });
  test('commentaire court → plancher 1500 ms', () => {
    expect(_commentDelay('ok')).toBe(1500);            // 2*45=90 < 1500
  });
  test('commentaire long → plafond 5000 ms', () => {
    expect(_commentDelay('x'.repeat(200))).toBe(5000); // 200*45=9000 > 5000
  });
  test('longueur intermédiaire → proportionnel (×45)', () => {
    expect(_commentDelay('y'.repeat(40))).toBe(1800);  // 40*45=1800 dans [1500,5000]
  });
});

describe('_drillSessions — liste des sessions (compat ancien format)', () => {
  test('drill avec sessions → renvoie les sessions', () => {
    const s = [{ kps: [{}] }, { kps: [{}] }];
    expect(_drillSessions({ sessions: s })).toBe(s);
  });
  test('sans sessions mais avec kps → session unique enveloppée', () => {
    const out = _drillSessions({ kps: [{ fen: 'x' }], startFen: 'F' });
    expect(out).toEqual([{ kps: [{ fen: 'x' }], startFen: 'F' }]);
  });
  test('ni sessions ni kps → tableau vide', () => {
    expect(_drillSessions({})).toEqual([]);
  });
});

describe('countPlayerMoves — nb de coups joueur / positions', () => {
  // Fabrique une suite de coups avec leur fenBefore réel.
  const g = new Chess();
  const moves = [];
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) {
    moves.push({ fenBefore: g.fen(), san });
    g.move(san);
  }
  test('mode ligne, côté blancs → compte les coups blancs', () => {
    expect(countPlayerMoves({ mode: 'line', side: 'w', moves })).toBe(2);
  });
  test('mode ligne, côté noirs → compte les coups noirs', () => {
    expect(countPlayerMoves({ mode: 'line', side: 'b', moves })).toBe(2);
  });
  test('mode ligne « les deux » → compte tous les coups', () => {
    expect(countPlayerMoves({ mode: 'line', side: 'both', moves })).toBe(4);
  });
  test('mode flash → compte les positions clés', () => {
    expect(countPlayerMoves({ mode: 'flash', kps: [{}, {}, {}] })).toBe(3);
  });
  test('multi-sessions → somme sur les sessions', () => {
    const drill = { mode: 'flash', sessions: [{ kps: [{}, {}] }, { kps: [{}] }] };
    expect(countPlayerMoves(drill)).toBe(3);
  });
});

describe('pickOppMove — choix pur du coup adverse', () => {
  const moves = [{ san: 'e5' }, { san: 'c5' }, { san: 'e6' }];

  test('forced path prioritaire s’il est jouable', () => {
    // rng renverrait le dernier, mais le forcé gagne.
    expect(pickOppMove(moves, {}, 'c5', () => 0.99)).toBe(moves[1]);
  });
  test('forced path ignoré s’il n’est pas dans la liste', () => {
    const chosen = pickOppMove(moves, {}, 'Nf6', () => 0);
    expect(chosen).toBe(moves[0]); // retombe sur le 1er non-vu
  });
  test('tous non-vus → tirage via rng', () => {
    expect(pickOppMove(moves, {}, null, () => 0)).toBe(moves[0]);
    expect(pickOppMove(moves, {}, null, () => 0.99)).toBe(moves[2]);
  });
  test('privilégie un coup non-vu face à des coups vus', () => {
    const seen = { e5: 1000, c5: 2000 }; // e6 non-vu
    expect(pickOppMove(moves, seen, null, () => 0)).toBe(moves[2]);
  });
  test('tous vus → LRU (timestamp le plus ancien)', () => {
    const seen = { e5: 3000, c5: 1000, e6: 2000 };
    expect(pickOppMove(moves, seen, null, () => 0)).toBe(moves[1]); // c5 le plus ancien
  });
});

describe('arbre — treeUnseenCount / computeForcedPath', () => {
  const tree = _buildDrillTree(extractAllLines('1. e4 e5 2. Nf3 Nc6 *'), 'w');
  const oppPairs = [];
  for (const [nf, node] of Object.entries(tree)) {
    for (const mv of node.opp) oppPairs.push([nf, mv.san]);
  }

  test('l’arbre contient bien des coups adverses (noirs)', () => {
    expect(oppPairs.length).toBeGreaterThan(0);
  });
  test('treeUnseenCount : rien vu → tous les coups adverses', () => {
    expect(treeUnseenCount(tree, 'Bob', '1', {})).toBe(oppPairs.length);
  });
  test('treeUnseenCount : un coup marqué vu → total − 1', () => {
    const seen = { [oppSeenKey('Bob', '1', oppPairs[0][0], oppPairs[0][1])]: Date.now() };
    expect(treeUnseenCount(tree, 'Bob', '1', seen)).toBe(oppPairs.length - 1);
  });

  test('computeForcedPath : rien vu → chemin vers un coup adverse non-vu', () => {
    const path = computeForcedPath('Bob', '1', tree, 'w', {});
    expect(path).toBeTruthy();
    expect(Object.values(path)).toContain('e5'); // 1re bifurcation adverse
  });
  test('computeForcedPath : tout vu → renvoie quand même un chemin (LRU)', () => {
    const seen = {};
    for (const [nf, san] of oppPairs) seen[oppSeenKey('Bob', '1', nf, san)] = 1000;
    expect(computeForcedPath('Bob', '1', tree, 'w', seen)).toBeTruthy();
  });
  test('computeForcedPath : arbre vide → null', () => {
    expect(computeForcedPath('Bob', '1', {}, 'w', {})).toBeNull();
  });
});
