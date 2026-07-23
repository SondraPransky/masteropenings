import { _normFen, leitnerSchedule, DEFAULT_LADDER_HOURS, normalizeSAN, extractAllLines, fig, figurineTitle, drillSelectGroups } from '../lib/core.js';

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

// ─────────────────────────────────────────────────────────────
// `fig` vit dans core.js (et pas seulement derriere le pont window) parce que la
// liste des modules affiche la ligne d'ouverture en figurines des son PREMIER
// rendu, avant que app.js n'ait pose window.fig : la vue sortait en SAN brut et
// rien ne la re-rendait ensuite. Un import ES n'a pas cet ordonnancement.
describe('fig — notation figurine', () => {
  test('remplace la lettre de piece EN TETE, pas ailleurs', () => {
    expect(fig('Nf6')).toBe('♘f6');
    expect(fig('Qxh7#')).toBe('♕xh7#');
    expect(fig('Rad1')).toBe('♖ad1');
    expect(fig('Bb5+')).toBe('♗b5+');
    expect(fig('Kd2')).toBe('♔d2');
  });
  test('ne touche pas aux coups de pion ni au roque', () => {
    expect(fig('e4')).toBe('e4');
    expect(fig('exd5')).toBe('exd5');
    expect(fig('O-O')).toBe('O-O');
    expect(fig('e8=Q')).toBe('e8=Q');   // la promotion n'est pas en tete
  });
  test('traverse les valeurs vides sans crasher', () => {
    expect(fig('')).toBe('');
    expect(fig(null)).toBe(null);
    expect(fig(undefined)).toBe(undefined);
  });
});

// ─────────────────────────────────────────────────────────────
// Titres ecrits a la main par la coach : le fonds MELANGE les notations
// francaise (C=Cavalier, D=Dame, T=Tour, F=Fou) et anglaise (K,Q,B,N), et `R`
// est une collision (Rook anglais = ♖ / Roi francais = ♔). Cas reels du corpus.
describe('figurineTitle — titres en notation mixte FR/EN', () => {
  test('lettres francaises non ambigues', () => {
    expect(figurineTitle('4.Cc4!? vs Petroff')).toBe('4.♘c4!? vs Petroff');
    expect(figurineTitle('Sicilienne 2.d4 cd4 3.Dxd4!?')).toBe('Sicilienne 2.d4 cd4 3.♕xd4!?');
    expect(figurineTitle('Grunfeld Fc4 et Ce2')).toBe('Grunfeld ♗c4 et ♘e2');
  });
  test('lettres anglaises non ambigues', () => {
    expect(figurineTitle('Anti Najdorf 4.Nf3')).toBe('Anti Najdorf 4.♘f3');
    expect(figurineTitle('Petroff 5.Qe2')).toBe('Petroff 5.♕e2');
  });
  test('R tranche par une autre lettre ANGLAISE du meme titre → Tour', () => {
    expect(figurineTitle('Le gambit du centre — 8.Qe3-Rxe4'))
      .toBe('Le gambit du centre — 8.♕e3-♖xe4');
  });
  test('R tranche par une autre lettre FRANCAISE du meme titre → Roi', () => {
    expect(figurineTitle('Finale Cd4 puis Re2')).toBe('Finale ♘d4 puis ♔e2');
  });
  test('⚠ R SEUL reste une lettre : convertir au hasard ferait un titre FAUX', () => {
    // « Est Indienne — Re8 » : Re8 est une Tour, mais rien dans le titre ne le dit.
    expect(figurineTitle('Est Indienne — Re8')).toBe('Est Indienne — Re8');
  });
  test('ne touche pas aux mots ni aux coups de pion', () => {
    expect(figurineTitle('Gambit Mieses dans la Scandinave')).toBe('Gambit Mieses dans la Scandinave');
    expect(figurineTitle('Gambit danois 2.d4 exd4')).toBe('Gambit danois 2.d4 exd4');
    expect(figurineTitle('Spassky Breyer')).toBe('Spassky Breyer');
    expect(figurineTitle('Anti Marshall d3')).toBe('Anti Marshall d3');
  });
  test('valeurs vides', () => {
    expect(figurineTitle('')).toBe('');
    expect(figurineTitle(null)).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────
describe('drillSelectGroups — le <select> de modules de la page drill', () => {
  const M = (name, extra = {}) => ({ name, ...extra });

  test('separe les ouvertures des paquets d\'exercices', () => {
    const g = drillSelectGroups([
      M('Grunfeld'), M('Tactiques', { isExercise: true }), M('Petroff'),
    ]);
    expect(g.map(x => x.label)).toEqual(['Ouvertures', 'Exercices']);
    expect(g[0].items.map(i => i.label)).toEqual(['Grunfeld', 'Petroff']);
    expect(g[1].items.map(i => i.label)).toEqual(['Tactiques']);
  });

  test('un seul groupe -> liste plate, pas d\'en-tete inutile', () => {
    const g = drillSelectGroups([M('Grunfeld'), M('Petroff')]);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe('');
  });

  test('l\'index d\'origine est conserve malgre le tri (sel.value = S.idx)', () => {
    const g = drillSelectGroups([M('Zorro'), M('Alpha')]);
    expect(g[0].items.map(i => i.label)).toEqual(['Alpha', 'Zorro']);
    expect(g[0].items.find(i => i.label === 'Zorro').i).toBe(0);
    expect(g[0].items.find(i => i.label === 'Alpha').i).toBe(1);
  });

  test('homonymes desambigues par les mots du dossier (le numero saute)', () => {
    const g = drillSelectGroups([
      M('Gambit Koltanowski', { folder: '773 - Koltanowski - Noirs exd4' }),
      M('Gambit Koltanowski', { folder: '774 - Koltanowski - Noirs Fxd4' }),
    ]);
    // Collation FR : « exd4 » precede « Fxd4 » (e avant f, insensible a la casse).
    expect(g[0].items.map(i => i.label)).toEqual([
      'Gambit Koltanowski — Koltanowski - Noirs exd4',
      'Gambit Koltanowski — Koltanowski - Noirs Fxd4',
    ]);
  });

  test('un nom UNIQUE ne recoit jamais de suffixe de dossier', () => {
    const g = drillSelectGroups([M('Grunfeld', { folder: '760 - Grunfeld profond' })]);
    expect(g[0].items[0].label).toBe('Grunfeld');
  });

  test('un dossier qui repete le nom n\'apporte rien -> pas de suffixe', () => {
    const g = drillSelectGroups([
      M('Petroff', { folder: '762 - Petroff' }), M('Petroff', { folder: '762 - Petroff' }),
    ]);
    expect(g[0].items.map(i => i.label)).toEqual(['Petroff', 'Petroff']);
  });

  test('figurines appliquees, et cas vides sans explosion', () => {
    expect(drillSelectGroups([M('4.Cc4!? vs Petroff')])[0].items[0].label)
      .toBe('4.♘c4!? vs Petroff');
    expect(drillSelectGroups([])).toEqual([{ label: '', items: [] }]);
    expect(drillSelectGroups(null)).toEqual([{ label: '', items: [] }]);
    expect(drillSelectGroups([M('')])[0].items[0].label).toBe('(sans nom)');
  });
});
