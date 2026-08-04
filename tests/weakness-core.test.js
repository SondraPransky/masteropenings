import { evalCp, classifyLoss, computeFaults, phaseOfFen, gameFaults,
         aggregateExits, aggregateFaults, weaknessReport } from '../lib/weakness-core.js';
import { extractAllLines } from '../lib/core.js';
import { _buildDrillTree } from '../lib/tree.js';

// `Chess` est injecté en global par tests/setup.js (comme dans le navigateur).
const START = new Chess().fen();

describe('evalCp — normalisation des évaluations', () => {
  test('centipions plafonnés à ±1000', () => {
    expect(evalCp(150)).toBe(150);
    expect(evalCp(2500)).toBe(1000);
    expect(evalCp(-1800)).toBe(-1000);
  });
  test('mats convertis (M3 → +1000, M-2 → −1000)', () => {
    expect(evalCp('M3')).toBe(1000);
    expect(evalCp('M-2')).toBe(-1000);
  });
  test('entrée illisible → null', () => {
    expect(evalCp('xx')).toBe(null);
    expect(evalCp(null)).toBe(null);
  });
});

describe('classifyLoss — seuils pédagogiques', () => {
  test('≥300 = gaffe, ≥120 = erreur, en dessous = rien', () => {
    expect(classifyLoss(450)).toBe('blunder');
    expect(classifyLoss(150)).toBe('mistake');
    expect(classifyLoss(80)).toBe(null);
  });
});

describe('computeFaults — pertes du point de vue du camp qui joue', () => {
  test('gaffe blanche : +20 → −350 au ply 0', () => {
    const f = computeFaults([20, -350, -340], 'w');
    expect(f.length).toBe(1);
    expect(f[0]).toMatchObject({ ply: 0, sev: 'blunder', loss: 370 });
  });
  test('gaffe NOIRE : l\'éval monte côté Blancs au ply impair', () => {
    const f = computeFaults([20, 10, 420], 'w');
    expect(f.length).toBe(1);
    expect(f[0]).toMatchObject({ ply: 1, sev: 'blunder' });
  });
  test('position déjà perdue (≤ −600) : la faute suivante ne compte plus', () => {
    // Blancs à −700 avant leur coup : même une perte de 300 est ignorée.
    expect(computeFaults([-700, -1000], 'w')).toEqual([]);
  });
  test('partie qui part d\'une position aux Noirs : la parité suit startTurn', () => {
    // ply 0 = coup NOIR : l'éval monte côté Blancs = faute noire.
    const f = computeFaults([0, 350], 'b');
    expect(f[0].ply).toBe(0);
  });
  test('les meilleurs coups fournis suivent la faute', () => {
    const f = computeFaults([20, -350], 'w', ['Nf3', 'e5']);
    expect(f[0].best).toBe('Nf3');
  });
});

describe('phaseOfFen', () => {
  test('coup ≤ 10 = ouverture', () => {
    expect(phaseOfFen(START)).toBe('ouverture');
  });
  test('coup 25 avec tout le matériel = milieu', () => {
    const fen = 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 0 25';
    expect(phaseOfFen(fen)).toBe('milieu');
  });
  test('tours seules au coup 40 = finale', () => {
    const fen = '8/5pk1/8/8/8/8/R4PK1/4r3 w - - 0 40';
    expect(phaseOfFen(fen)).toBe('finale');
  });
});

describe('gameFaults — replay du PGN pour enrichir', () => {
  // 1.e4 e5 2.Qh5?? (faute fabriquée) — la faute au ply 2 est un coup BLANC du coup 2.
  const g = {
    id: 'g1', ts: 1000,
    pgn: '1. e4 e5 2. Qh5 Nc6 *',
    analysis: { v: 1, depth: 12, ts: 1, evals: [20, 15, 18, -320, -310], faults: [{ ply: 2, loss: 338, sev: 'blunder', best: 'Nf3' }] },
  };
  test('la faute retrouve son SAN, sa position et sa phase', () => {
    const f = gameFaults(g);
    expect(f.length).toBe(1);
    expect(f[0]).toMatchObject({ ply: 2, san: 'Qh5', sev: 'blunder', best: 'Nf3', moveNo: 2, color: 'w', phase: 'ouverture' });
    expect(f[0].fenBefore).toContain('w'); // Blancs au trait avant Qh5
  });
  test('partie sans analyse → []', () => {
    expect(gameFaults({ pgn: '1. e4 *' })).toEqual([]);
  });
});

describe('aggregateExits — la MÊME sortie dans plusieurs parties se cumule', () => {
  const lines = extractAllLines('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
  const drill = { id: 'd1', name: 'Espagnole', varmode: 'tree', side: 'w',
                  tree: _buildDrillTree(lines, 'w'), sessions: [{ startFen: START }] };
  const g = (id, pgn, ts) => ({ id, pgn, ts });
  test('2 parties qui sortent au même endroit → 1 entrée, count 2', () => {
    const games = [
      g('a', '1. e4 e5 2. Nf3 Nc6 3. Bc4 a6 *', 100),   // sortie : Bc4 au lieu de Bb5
      g('b', '1. e4 e5 2. Nf3 Nc6 3. d4 a6 *', 200),     // même position, autre coup
      g('c', '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *', 300),    // dans le livre, pas de sortie
    ];
    const ex = aggregateExits(games, [drill]);
    expect(ex.length).toBe(1);
    expect(ex[0].count).toBe(2);
    expect(ex[0].played.sort()).toEqual(['Bc4', 'd4']);
    expect(ex[0].expected).toContain('Bb5');
    expect(ex[0].lastTs).toBe(200);
  });
  test('un compare mémoïsé injecté est bien utilisé', () => {
    let calls = 0;
    const ex = aggregateExits([g('a', 'x', 1)], [drill], () => { calls++; return null; });
    expect(calls).toBe(1);
    expect(ex).toEqual([]);
  });
});

describe('aggregateFaults + weaknessReport', () => {
  const gAna = {
    id: 'g1', ts: 5, pgn: '1. e4 e5 2. Qh5 Nc6 *',
    analysis: { v: 1, evals: [], faults: [{ ply: 2, loss: 338, sev: 'blunder', best: 'Nf3' }] },
  };
  const gSans = { id: 'g2', ts: 6, pgn: '1. d4 *' };
  test('compte analysées / total et range par phase', () => {
    const a = aggregateFaults([gAna, gSans]);
    expect(a.analyzed).toBe(1);
    expect(a.total).toBe(2);
    expect(a.blunders).toBe(1);
    expect(a.phases.ouverture.length).toBe(1);
    expect(a.phases.ouverture[0].gameId).toBe('g1');
  });
  test('weaknessReport assemble les deux natures', () => {
    const r = weaknessReport([gAna], []);
    expect(r).toHaveProperty('exits');
    expect(r.faults.blunders).toBe(1);
  });
});
