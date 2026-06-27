import core from '../lib/core.js';
const { _normFen, sm2Schedule, normalizeSAN, extractAllLines } = core;

// ─────────────────────────────────────────────────────────────
describe('_normFen — clé de transposition', () => {
  it('garde les 4 premiers champs du FEN', () => {
    expect(_normFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'))
      .toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });

  it('ignore les compteurs : 2 FENs ne différant que par halfmove/fullmove → même clé', () => {
    const a = _normFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
    const b = _normFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 9 15');
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────
describe('sm2Schedule — répétition espacée SM-2', () => {
  const NOW = 1_000_000_000_000;
  const DAY = 86400000;

  it('1re bonne réponse : interval 1j, reps 1, ef +0.1, due à +1j', () => {
    const m = sm2Schedule(null, true, NOW);
    expect(m.interval).toBe(1);
    expect(m.reps).toBe(1);
    expect(m.ef).toBeCloseTo(2.6, 6);
    expect(m.due).toBe(NOW + 1 * DAY);
  });

  it('2e bonne réponse : interval passe à 6j', () => {
    let m = sm2Schedule(null, true, NOW);   // reps1, i1
    m = sm2Schedule(m, true, NOW);          // reps2, i6
    expect(m.reps).toBe(2);
    expect(m.interval).toBe(6);
    expect(m.due).toBe(NOW + 6 * DAY);
  });

  it('3e bonne réponse : interval = round(interval * ef)', () => {
    let m = sm2Schedule(null, true, NOW);   // i1
    m = sm2Schedule(m, true, NOW);          // i6, ef2.7
    const efBefore = m.ef;
    m = sm2Schedule(m, true, NOW);          // i = round(6 * efBefore)
    expect(m.interval).toBe(Math.round(6 * efBefore));
    expect(m.reps).toBe(3);
  });

  it('mauvaise réponse : reps→0, interval→1, ef baisse', () => {
    let m = sm2Schedule(null, true, NOW);
    m = sm2Schedule(m, true, NOW);
    const efBefore = m.ef;
    m = sm2Schedule(m, false, NOW);
    expect(m.reps).toBe(0);
    expect(m.interval).toBe(1);
    expect(m.ef).toBeCloseTo(Math.max(1.3, efBefore - 0.54), 6);
  });

  it('ef ne descend jamais sous le plancher 1.3', () => {
    let m = null;
    for (let k = 0; k < 20; k++) m = sm2Schedule(m, false, NOW);
    expect(m.ef).toBeGreaterThanOrEqual(1.3);
    expect(m.ef).toBeCloseTo(1.3, 6);
  });

  it('now est injectable, y compris 0 (déterminisme, pas de fallback Date.now)', () => {
    expect(sm2Schedule(null, true, 0).due).toBe(1 * DAY);
  });

  it('est pure : ne mute pas l’objet précédent', () => {
    const prev = { ef: 2.5, interval: 1, reps: 0, due: 0 };
    const next = sm2Schedule(prev, true, NOW);
    expect(prev).toEqual({ ef: 2.5, interval: 1, reps: 0, due: 0 });
    expect(next).not.toBe(prev);
  });
});

// ─────────────────────────────────────────────────────────────
describe('extractAllLines — parsing PGN', () => {
  it('extrait la ligne principale dans l’ordre', () => {
    const lines = extractAllLines('1. e4 e5 2. Nf3 Nc6 *');
    const main = lines.find(l => l.depth === 0);
    expect(main).toBeTruthy();
    expect(main.moves.map(m => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('attache un commentaire {…} au coup précédent', () => {
    const lines = extractAllLines('1. e4 {meilleur début} e5 *');
    const main = lines.find(l => l.depth === 0);
    expect(main.moves[0].san).toBe('e4');
    expect(main.moves[0].comment).toBe('meilleur début');
  });

  it('gère une variante entre parenthèses → depth > 0', () => {
    const lines = extractAllLines('1. e4 e5 2. Nf3 (2. Bc4 Nf6 3. d3) Nc6 *');
    const variation = lines.find(l => l.depth > 0);
    expect(variation).toBeTruthy();
    expect(variation.moves.map(m => m.san)).toContain('Bc4');
  });

  it('ignore les en-têtes [Tag "…"] et le résultat', () => {
    const lines = extractAllLines('[Event "Test"]\n[White "x"]\n\n1. d4 d5 *');
    const main = lines.find(l => l.depth === 0);
    expect(main.moves.map(m => m.san)).toEqual(['d4', 'd5']);
  });
});

// ─────────────────────────────────────────────────────────────
describe('normalizeSAN — désambiguïsation tolérante', () => {
  it('laisse passer un SAN déjà valide', () => {
    const g = new Chess();
    expect(normalizeSAN('e4', g)).toBe('e4');
  });

  it('retire une désambiguïsation superflue (Ng1f3 → Nf3 en position initiale)', () => {
    const g = new Chess();
    // Un seul cavalier peut aller en f3 → "Ngf3" est sur-spécifié.
    expect(normalizeSAN('Ngf3', g)).toBe('Nf3');
  });
});
