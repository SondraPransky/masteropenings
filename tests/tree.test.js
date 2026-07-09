import { isPlayerMove, _buildDrillTree, _treePlayerPositions, _materialHint } from '../lib/tree.js';
import { extractAllLines } from '../lib/core.js';

// `Chess` est injecté en global par tests/setup.js (comme dans le navigateur).
const START = new Chess().fen();

describe('isPlayerMove — trait à jouer', () => {
  test('blancs au trait, module côté blancs → à jouer', () => {
    expect(isPlayerMove(START, 'w')).toBe(true);
  });
  test('blancs au trait, module côté noirs → pas à jouer', () => {
    expect(isPlayerMove(START, 'b')).toBe(false);
  });
  test('module « les deux » → toujours à jouer', () => {
    expect(isPlayerMove(START, 'both')).toBe(true);
  });
});

describe('_buildDrillTree — construction de l’arbre', () => {
  const lines = extractAllLines('1. e4 e5 2. Nf3 Nc6 *');
  const tree = _buildDrillTree(lines, 'w');
  const startNf = START.split(' ').slice(0, 4).join(' ');

  test('produit des positions', () => {
    expect(Object.keys(tree).length).toBeGreaterThan(0);
  });
  test('le 1er coup blanc (e4) est un coup « player » côté blancs', () => {
    expect(tree[startNf].player.some(m => m.san === 'e4')).toBe(true);
    expect(tree[startNf].opp.some(m => m.san === 'e4')).toBe(false);
  });
  test('la réponse noire (e5) est un coup « opp » côté blancs', () => {
    const afterE4 = new Chess(); afterE4.move('e4');
    const nf = afterE4.fen().split(' ').slice(0, 4).join(' ');
    expect(tree[nf].opp.some(m => m.san === 'e5')).toBe(true);
  });
});

describe('_treePlayerPositions — points de décision élève', () => {
  const lines = extractAllLines('1. e4 e5 2. Nf3 Nc6 *');
  const tree = _buildDrillTree(lines, 'w');
  const drill = { varmode: 'tree', tree, side: 'w', sessions: [{ startFen: START }] };
  const pos = _treePlayerPositions(drill);

  test('énumère au moins une position à jouer', () => {
    expect(pos.length).toBeGreaterThan(0);
  });
  test('chaque position porte une clé de maîtrise (FEN + SAN)', () => {
    expect(pos[0]).toHaveProperty('masteryKey');
    expect(pos[0].masteryKey).toContain('_' + pos[0].san);
  });
  test('un drill non-arbre renvoie une liste vide', () => {
    expect(_treePlayerPositions({ varmode: 'line' })).toEqual([]);
  });
});

describe('_materialHint — matériel en prise', () => {
  test('un coup d’ouverture sûr ne déclenche pas d’alerte', () => {
    expect(_materialHint(START, 'e4')).toBe('');
  });
  test('renvoie toujours une chaîne (jamais undefined)', () => {
    expect(typeof _materialHint(START, 'Nf3')).toBe('string');
    expect(typeof _materialHint('coup illégal ignoré', 'e4')).toBe('string');
  });
  test('une dame donnée gratuitement déclenche l’alerte', () => {
    // Dame blanche d1 → d8 : le roi noir e8 la capture gratuitement (aucune reprise).
    const fen = 'r3k3/8/8/8/8/8/8/3QK3 w - - 0 1';
    expect(_materialHint(fen, 'Qd8')).toMatch(/matériel/);
  });
});
