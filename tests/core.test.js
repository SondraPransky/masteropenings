import { _normFen, leitnerSchedule, DEFAULT_LADDER_HOURS, normalizeSAN, extractAllLines } from '../lib/core.js';

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
describe('leitnerSchedule — répétition espacée à échelons', () => {
  const NOW = 1_000_000_000_000;
  const H = 3600000;
  // Échelle par défaut (Chessable) en heures : 4h · 1j · 3j · 1sem · 2sem · 1mois · 3mois · 6mois
  const L = DEFAULT_LADDER_HOURS;

  it('échelle par défaut = les 8 paliers Chessable', () => {
    expect(L).toEqual([4, 24, 72, 168, 336, 720, 2160, 4320]);
  });

  it('1re bonne réponse (depuis rien) : niveau 1, due à +4h, reps 1', () => {
    const m = leitnerSchedule(null, true, NOW);
    expect(m.level).toBe(1);
    expect(m.reps).toBe(1);
    expect(m.due).toBe(NOW + 4 * H);
  });

  it('bonnes réponses successives : le niveau grimpe d’un cran, due suit l’échelle', () => {
    let m = leitnerSchedule(null, true, NOW);   // niv1 → 4h
    m = leitnerSchedule(m, true, NOW);          // niv2 → 1j
    expect(m.level).toBe(2);
    expect(m.due).toBe(NOW + 24 * H);
    m = leitnerSchedule(m, true, NOW);          // niv3 → 3j
    expect(m.level).toBe(3);
    expect(m.due).toBe(NOW + 72 * H);
  });

  it('mauvaise réponse : retour au niveau 1 (4h), quelle que soit la hauteur atteinte', () => {
    let m = null;
    for (let k = 0; k < 5; k++) m = leitnerSchedule(m, true, NOW);   // niveau 5
    expect(m.level).toBe(5);
    m = leitnerSchedule(m, false, NOW);
    expect(m.level).toBe(1);
    expect(m.due).toBe(NOW + 4 * H);
  });

  it('le niveau est plafonné au dernier palier de l’échelle', () => {
    let m = null;
    for (let k = 0; k < 20; k++) m = leitnerSchedule(m, true, NOW);
    expect(m.level).toBe(L.length);          // 8
    expect(m.due).toBe(NOW + L[L.length - 1] * H);
  });

  it('échelle personnalisée (coach) respectée', () => {
    const custom = [1, 48];                  // 1h puis 48h
    let m = leitnerSchedule(null, true, NOW, custom);
    expect(m.due).toBe(NOW + 1 * H);
    m = leitnerSchedule(m, true, NOW, custom);
    expect(m.level).toBe(2);
    expect(m.due).toBe(NOW + 48 * H);
    m = leitnerSchedule(m, true, NOW, custom);   // plafonné à 2 paliers
    expect(m.level).toBe(2);
  });

  it('now est injectable, y compris 0 (déterminisme)', () => {
    expect(leitnerSchedule(null, true, 0).due).toBe(4 * H);
  });

  it('est pure : ne mute pas l’objet précédent', () => {
    const prev = { level: 2, due: 123, reps: 2 };
    const next = leitnerSchedule(prev, true, NOW);
    expect(prev).toEqual({ level: 2, due: 123, reps: 2 });
    expect(next).not.toBe(prev);
    expect(next.level).toBe(3);
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

  it('extrait une ligne d’UN SEUL coup, avec ou sans résultat', () => {
    for (const pgn of ['1. e4', '1. e4 *', '1. e4 1-0']) {
      const main = extractAllLines(pgn).find(l => l.depth === 0);
      expect(main, pgn).toBeTruthy();
      expect(main.moves.map(m => m.san), pgn).toEqual(['e4']);
    }
  });

  it('garde une variante réduite à un seul coup', () => {
    const lines = extractAllLines('1. e4 e5 2. Nf3 (2. Bc4) Nc6 *');
    const variation = lines.find(l => l.depth > 0);
    expect(variation).toBeTruthy();
    expect(variation.moves.map(m => m.san)).toEqual(['Bc4']);
  });

  it('rejette une ligne sans aucun coup jouable', () => {
    expect(extractAllLines('*')).toEqual([]);
    expect(extractAllLines('1. Zz9 *')).toEqual([]);
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
