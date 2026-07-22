import { isPlayerMove, _buildDrillTree, _treePlayerPositions, _treePositionsScan, _materialHint,
         _mergeStudentLayer, _diffAgainstCoach, _countLayerMoves, _editorTreeToDrillTree,
         buildTreeModule, gameModuleName, chapterCount, chapterPgn, applyChapTitles } from '../lib/tree.js';
import { extractAllLines, splitPgnGames, pgnStartFen, replacePgnGame } from '../lib/core.js';

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

describe('_treePositionsScan — balayage O(n) ≡ BFS sur un arbre sans orphelin', () => {
  const keysOf = list => list.map(p => p.masteryKey).sort();

  test('même ensemble de clés que _treePlayerPositions (module simple)', () => {
    const lines = extractAllLines('1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. Nxe5 d6) 3. Bb5 *');
    const tree = _buildDrillTree(lines, 'w');
    const drill = { id: 1, varmode: 'tree', tree, side: 'w', sessions: [{ startFen: START }] };
    expect(keysOf(_treePositionsScan(drill))).toEqual(keysOf(_treePlayerPositions(drill)));
  });

  test('même ensemble sur un module à chapitres (multi-parties)', () => {
    const pgn = '[Event "A"]\n[White "Ch. 1"]\n\n1. e4 e5 2. Nf3 *\n\n[Event "B"]\n[White "Ch. 2"]\n\n1. d4 d5 2. c4 *';
    const m = buildTreeModule({ id: 2, name: 'x', pgn, side: 'w' });
    expect(keysOf(_treePositionsScan(m))).toEqual(keysOf(_treePlayerPositions(m)));
    expect(_treePositionsScan(m).length).toBeGreaterThan(0);
  });

  test('mémoïsation : invalidée par updatedAt', () => {
    const lines = extractAllLines('1. e4 e5 *');
    const tree = _buildDrillTree(lines, 'w');
    const drill = { id: 3, varmode: 'tree', tree, side: 'w', updatedAt: 1 };
    const a = _treePositionsScan(drill);
    expect(_treePositionsScan(drill)).toBe(a);            // même clé → même référence
    drill.updatedAt = 2;
    expect(_treePositionsScan(drill)).not.toBe(a);        // édition → recalcul
    expect(keysOf(_treePositionsScan(drill))).toEqual(keysOf(a));
  });

  test('un drill non-arbre renvoie une liste vide', () => {
    expect(_treePositionsScan({ varmode: 'line' })).toEqual([]);
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

// ════════════════════════════════════════════════════════════
//  Couche d'édition élève (additive) — greffe / diff
//  Le module du coach doit rester intact, les ajouts de l'élève survivre à ses
//  corrections, et un élève ne jamais s'approprier une ligne du coach.
// ════════════════════════════════════════════════════════════

const coachTree = () => _buildDrillTree(extractAllLines('1. e4 e5 2. Nf3 Nc6 3. Bb5 *'), 'w');

describe('_mergeStudentLayer — greffe des ajouts de l’élève', () => {
  test('un ajout de l’élève apparaît dans l’arbre fusionné, tagué student', () => {
    const coach = coachTree();
    // L'élève ajoute 3. Bc4 (l'Italienne) là où le coach n'a que 3. Bb5.
    const fen3 = Object.keys(coach).find(f => coach[f].player.some(m => m.san === 'Bb5'));
    const overlay = { [fen3]: { player: [{ san: 'Bc4', comment: 'ma ligne' }], opp: [], startFen: coach[fen3].startFen } };
    const merged = _mergeStudentLayer(coach, overlay);
    const sans = merged[fen3].player.map(m => m.san);
    expect(sans).toContain('Bb5');   // la ligne du coach survit
    expect(sans).toContain('Bc4');   // celle de l'élève est greffée
    expect(merged[fen3].player.find(m => m.san === 'Bc4').author).toBe('student');
    expect(merged[fen3].player.find(m => m.san === 'Bb5').author).toBeUndefined();
  });

  test('le coach fait autorité : un même SAN des deux côtés n’est pas dupliqué ni retagué', () => {
    const coach = coachTree();
    const fen3 = Object.keys(coach).find(f => coach[f].player.some(m => m.san === 'Bb5'));
    const overlay = { [fen3]: { player: [{ san: 'Bb5', comment: 'je me l’approprie' }], opp: [], startFen: '' } };
    const merged = _mergeStudentLayer(coach, overlay);
    expect(merged[fen3].player.filter(m => m.san === 'Bb5')).toHaveLength(1);
    expect(merged[fen3].player.find(m => m.san === 'Bb5').author).toBeUndefined();
  });

  test('l’arbre du coach n’est JAMAIS muté par la fusion', () => {
    const coach = coachTree();
    const avant = JSON.stringify(coach);
    const fen3 = Object.keys(coach).find(f => coach[f].player.some(m => m.san === 'Bb5'));
    _mergeStudentLayer(coach, { [fen3]: { player: [{ san: 'Bc4' }], opp: [], startFen: '' } });
    expect(JSON.stringify(coach)).toBe(avant);
  });

  test('une correction du coach DESCEND vers l’élève, qui garde ses ajouts', () => {
    const overlayFen = Object.keys(coachTree()).find(f => coachTree()[f].player.some(m => m.san === 'Bb5'));
    const overlay = { [overlayFen]: { player: [{ san: 'Bc4' }], opp: [], startFen: '' } };
    // Le coach corrige : il ajoute 3...a6 4. Ba4 après Bb5.
    const coachV2 = _buildDrillTree(extractAllLines('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *'), 'w');
    const merged = _mergeStudentLayer(coachV2, overlay);
    const fenBa4 = Object.keys(coachV2).find(f => coachV2[f].player.some(m => m.san === 'Ba4'));
    expect(merged[fenBa4].player.map(m => m.san)).toContain('Ba4');            // la correction est arrivée
    expect(merged[overlayFen].player.map(m => m.san)).toContain('Bc4');        // l'ajout de l'élève a survécu
  });

  test('un auteur déjà porté est conservé (le coach répond dans la copie de l’élève)', () => {
    const merged = _mergeStudentLayer({}, { X: { player: [{ san: 'Bc4', author: 'coach' }], opp: [], startFen: '' } });
    expect(merged.X.player[0].author).toBe('coach');
  });
});

describe('_diffAgainstCoach — ne persiste que les ajouts', () => {
  test('les coups du coach sont exclus du diff', () => {
    const coach = coachTree();
    const fen3 = Object.keys(coach).find(f => coach[f].player.some(m => m.san === 'Bb5'));
    const full = _mergeStudentLayer(coach, { [fen3]: { player: [{ san: 'Bc4' }], opp: [], startFen: '' } });
    const diff = _diffAgainstCoach(full, coach);
    expect(_countLayerMoves(diff)).toBe(1);
    expect(diff[fen3].player.map(m => m.san)).toEqual(['Bc4']);
    // Aucune position purement « coach » ne doit subsister dans le diff.
    expect(Object.keys(diff)).toEqual([fen3]);
  });

  test('greffe puis diff = identité (aller-retour stable)', () => {
    const coach = coachTree();
    const fen3 = Object.keys(coach).find(f => coach[f].player.some(m => m.san === 'Bb5'));
    const overlay = { [fen3]: { player: [{ san: 'Bc4', comment: 'ma ligne' }], opp: [], startFen: coach[fen3].startFen } };
    const rt = _diffAgainstCoach(_mergeStudentLayer(coach, overlay), coach);
    expect(rt[fen3].player.map(m => m.san)).toEqual(['Bc4']);
    expect(rt[fen3].player[0].comment).toBe('ma ligne');
  });

  test('un élève ne peut pas s’approprier une ligne du coach via le diff', () => {
    const coach = coachTree();
    const fen3 = Object.keys(coach).find(f => coach[f].player.some(m => m.san === 'Bb5'));
    // L'élève tente de re-soumettre Bb5 comme sien.
    const diff = _diffAgainstCoach({ [fen3]: { player: [{ san: 'Bb5', author: 'student' }], opp: [], startFen: '' } }, coach);
    expect(_countLayerMoves(diff)).toBe(0);
  });

  test('diff vide quand l’élève n’a rien ajouté', () => {
    const coach = coachTree();
    expect(_diffAgainstCoach(coach, coach)).toEqual({});
    expect(_countLayerMoves({})).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
//  _editorTreeToDrillTree — l'AUTEUR doit survivre à la sauvegarde.
//  La chaîne editorTreeToPGN → extractAllLines → _buildDrillTree le perd :
//  core.js jette tout commentaire commençant par `[%`, donc [%author coach]
//  n'y survit pas. D'où cette conversion directe depuis l'arbre de l'éditeur.
// ════════════════════════════════════════════════════════════
describe('_editorTreeToDrillTree — conversion sans perte d’auteur', () => {
  // Arbre éditeur : 1.e4 e5 2.Nf3 — Nf3 tagué comme une réponse du coach.
  const mkEditorTree = () => {
    const START = new Chess().fen();
    const g1 = new Chess(START); g1.move('e4');
    const g2 = new Chess(g1.fen()); g2.move('e5');
    const g3 = new Chess(g2.fen()); g3.move('Nf3');
    const n3 = { san:'Nf3', fenBefore:g2.fen(), fenAfter:g3.fen(), comment:'ma réponse', author:'coach', children:[] };
    const n2 = { san:'e5',  fenBefore:g1.fen(), fenAfter:g2.fen(), comment:'', author:'student', children:[n3] };
    const n1 = { san:'e4',  fenBefore:START,    fenAfter:g1.fen(), comment:'', children:[n2] };
    return { san:null, fenBefore:null, fenAfter:START, comment:'', children:[n1] };
  };
  const find = (t, san) => Object.values(t).flatMap(n => [...n.player, ...n.opp]).find(m => m.san === san);

  test('l’auteur coach survit à la conversion', () => {
    expect(find(_editorTreeToDrillTree(mkEditorTree(), 'w'), 'Nf3').author).toBe('coach');
  });
  test('l’auteur élève survit à la conversion', () => {
    expect(find(_editorTreeToDrillTree(mkEditorTree(), 'w'), 'e5').author).toBe('student');
  });
  test('un coup sans auteur n’en reçoit pas', () => {
    expect(find(_editorTreeToDrillTree(mkEditorTree(), 'w'), 'e4').author).toBeUndefined();
  });
  test('le commentaire est conservé', () => {
    expect(find(_editorTreeToDrillTree(mkEditorTree(), 'w'), 'Nf3').comment).toBe('ma réponse');
  });
  test('même découpage player/opp que _buildDrillTree (côté blancs)', () => {
    const t = _editorTreeToDrillTree(mkEditorTree(), 'w');
    const ref = _buildDrillTree(extractAllLines('1. e4 e5 2. Nf3 *'), 'w');
    // Mêmes positions, et e4/Nf3 côté player, e5 côté opp — dans les deux.
    expect(Object.keys(t).sort()).toEqual(Object.keys(ref).sort());
    for (const fen of Object.keys(ref)) {
      expect(t[fen].player.map(m => m.san)).toEqual(ref[fen].player.map(m => m.san));
      expect(t[fen].opp.map(m => m.san)).toEqual(ref[fen].opp.map(m => m.san));
    }
  });

  test('la réponse du coach traverse diff PUIS greffe sans être re-taguée élève', () => {
    // Scénario tranche C : l'élève a greffé 2.Nf3, le coach lui répond 3.Bb5 dans SA copie.
    // ⚠ Le PGN du coach doit faire ≥ 2 coups : extractAllLines rend [] sur un PGN à un
    // seul coup ('1. e4', '1. e4 *', '1. e4 1-0') — bug latent de core.js, hors scope ici.
    const START = new Chess().fen();
    const g1 = new Chess(START);    g1.move('e4');
    const g2 = new Chess(g1.fen()); g2.move('e5');
    const g3 = new Chess(g2.fen()); g3.move('Nf3');
    const g4 = new Chess(g3.fen()); g4.move('Nc6');
    const g5 = new Chess(g4.fen()); g5.move('Bb5');
    const nBb5 = { san:'Bb5', fenBefore:g4.fen(), fenAfter:g5.fen(), comment:'plutôt ça', author:'coach', children:[] };
    const nNc6 = { san:'Nc6', fenBefore:g3.fen(), fenAfter:g4.fen(), comment:'', children:[nBb5] };
    const nNf3 = { san:'Nf3', fenBefore:g2.fen(), fenAfter:g3.fen(), comment:'', author:'student', children:[nNc6] };
    const nE5  = { san:'e5',  fenBefore:g1.fen(), fenAfter:g2.fen(), comment:'', children:[nNf3] };
    const nE4  = { san:'e4',  fenBefore:START,    fenAfter:g1.fen(), comment:'', children:[nE5] };
    const root = { san:null, fenBefore:null, fenAfter:START, comment:'', children:[nE4] };

    const coachTree = _buildDrillTree(extractAllLines('1. e4 e5 *'), 'w');
    const diff   = _diffAgainstCoach(_editorTreeToDrillTree(root, 'w'), coachTree);
    const merged = _mergeStudentLayer(coachTree, diff);

    expect(find(diff, 'Nf3').author).toBe('student');
    expect(find(diff, 'Bb5').author).toBe('coach');
    expect(find(merged, 'Nf3').author).toBe('student');
    expect(find(merged, 'Bb5').author).toBe('coach');          // PAS re-tagué 'student' par la greffe
    expect(find(merged, 'e4').author).toBeUndefined();         // les lignes du coach restent neutres
    expect(find(merged, 'e5').author).toBeUndefined();
  });
});

// ── Import : les 2 defauts trouves sur le fonds reel (juillet 2026) ──────────
// Contenu de test = la forme exacte des exports ChessBase de l'academie :
// plusieurs parties par fichier, chacune partant d'une position [SetUp]/[FEN].
const FEN_MID = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const PGN_POS = `[Event "?"]
[White "Italienne"]
[Black "Gestion du coup Bg5"]
[SetUp "1"]
[FEN "${FEN_MID}"]

1. d3 h6 2. c3 *`;
const PGN_MULTI = `[Event "?"]
[White "Le Gambit Danois"]
[Black "Les Noirs refusent"]

1. e4 e5 2. d4 exd4 3. c3 d5 *

[Event "?"]
[White "Le Gambit Danois"]
[Black "Les Noirs acceptent"]
[SetUp "1"]
[FEN "${FEN_MID}"]

1. Ng5 d5 *`;

describe('buildTreeModule — startFen = racine reelle de l’arbre', () => {
  test('PGN partant d’une position : sessions[0].startFen suit le [FEN], pas la position initiale', () => {
    const m = buildTreeModule({ id: 1, name: 'x', pgn: PGN_POS, side: 'w' });
    expect(m.sessions[0].startFen).toBe(FEN_MID);
    expect(m.sessions[0].startFen).not.toBe(START);
  });

  test('le module est REELLEMENT jouable (regression : 0 position a reviser)', () => {
    const m = buildTreeModule({ id: 1, name: 'x', pgn: PGN_POS, side: 'w' });
    expect(_treePlayerPositions(m).length).toBeGreaterThan(0);
    // ce que faisait l’import avant le correctif : startFen force a la position initiale
    const broken = { ...m, sessions: [{ startFen: START }] };
    expect(_treePlayerPositions(broken).length).toBe(0);
  });

  test('PGN standard : comportement inchange', () => {
    const m = buildTreeModule({ id: 1, name: 'x', pgn: '1. e4 e5 2. Nf3 *', side: 'w' });
    expect(m.sessions[0].startFen).toBe(START);
    expect(_treePlayerPositions(m).length).toBeGreaterThan(0);
  });

  test('rien d’extractible → null (l’appelant decide du message)', () => {
    expect(buildTreeModule({ id: 1, name: 'x', pgn: '[Event "?"]\n\n*', side: 'w' })).toBe(null);
  });
});

describe('splitPgnGames — une partie = un module', () => {
  test('decoupe sur les en-tetes [Event]', () => {
    expect(splitPgnGames(PGN_MULTI)).toHaveLength(2);
  });

  test('chaque partie garde SA position de depart', () => {
    const [g1, g2] = splitPgnGames(PGN_MULTI);
    expect(pgnStartFen(g1)).toBe(START);
    expect(pgnStartFen(g2)).toBe(FEN_MID);
  });

  test('coller les parties bout a bout perd des coups ; les separer les conserve', () => {
    const ensemble = extractAllLines(PGN_MULTI).reduce((a, l) => a + l.moves.length, 0);
    const separe = splitPgnGames(PGN_MULTI)
      .reduce((a, c) => a + extractAllLines(c).reduce((b, l) => b + l.moves.length, 0), 0);
    expect(separe).toBeGreaterThan(ensemble);
  });

  test('PGN a une seule partie : une seule entree', () => {
    expect(splitPgnGames('[Event "?"]\n\n1. e4 *')).toHaveLength(1);
  });
});

describe('gameModuleName — nommage depuis les en-tetes du coach', () => {
  test('White + Black', () => {
    expect(gameModuleName(splitPgnGames(PGN_MULTI)[1], 'fallback', 1))
      .toBe('Le Gambit Danois — Les Noirs acceptent');
  });
  test('en-tetes vides ou "?" → nom de repli numerote', () => {
    expect(gameModuleName('[Event "?"]\n[White "?"]\n\n1. e4 *', 'Mon fichier', 2)).toBe('Mon fichier (3)');
  });
});

// ── B2 : un fichier multi-parties = un module a CHAPITRES ────────────────────
describe('buildTreeModule — module a chapitres (B2)', () => {
  test('PGN a 2 parties → UN module, 2 sessions aux bons labels/startFen, arbre fusionne', () => {
    const m = buildTreeModule({ id: 1, name: 'Danois', pgn: PGN_MULTI, side: 'w' });
    expect(m.sessions).toHaveLength(2);
    expect(m.sessions[0].label).toBe('Le Gambit Danois — Les Noirs refusent');
    expect(m.sessions[1].label).toBe('Le Gambit Danois — Les Noirs acceptent');
    expect(m.sessions[0].startFen).toBe(START);
    expect(m.sessions[1].startFen).toBe(FEN_MID);
    // arbre fusionne : il contient des noeuds des DEUX parties
    expect(m.tree[START.split(' ').slice(0, 4).join(' ')]).toBeTruthy();
    expect(m.tree[FEN_MID.split(' ').slice(0, 4).join(' ')]).toBeTruthy();
  });

  test('mono-partie : une session « Arbre complet », comportement inchange', () => {
    const m = buildTreeModule({ id: 1, name: 'x', pgn: '1. e4 e5 2. Nf3 *', side: 'w' });
    expect(m.sessions).toHaveLength(1);
    expect(m.sessions[0].label).toBe('Arbre complet');
  });

  test('une partie sans coup jouable ne cree pas de chapitre, gameIdx garde l alignement', () => {
    const withEmpty = `[Event "?"]\n[White "Vide"]\n\n*\n\n` + PGN_MULTI;
    const m = buildTreeModule({ id: 1, name: 'x', pgn: withEmpty, side: 'w' });
    expect(m.sessions).toHaveLength(2);                    // la partie vide est sautee
    expect(m.sessions[0].gameIdx).toBe(1);
    // chapterPgn suit gameIdx, pas l index de session
    expect(chapterPgn(m, 0)).toContain('Les Noirs refusent');
    expect(chapterPgn(m, 1)).toContain('Les Noirs acceptent');
  });
});

describe('chapterCount / chapterPgn', () => {
  test('compte et decoupe', () => {
    const m = buildTreeModule({ id: 1, name: 'x', pgn: PGN_MULTI, side: 'w' });
    expect(chapterCount(m)).toBe(2);
    expect(chapterPgn(m, 1)).toContain('1. Ng5 d5');
  });
  test('module mono-partie ou non-arbre → 1', () => {
    expect(chapterCount(buildTreeModule({ id: 1, name: 'x', pgn: '1. e4 *', side: 'w' }))).toBe(1);
    expect(chapterCount({ varmode: 'line', pgn: PGN_MULTI })).toBe(1);
  });
});

describe('_treePlayerPositions — UNION des chapitres', () => {
  test('2 chapitres DISJOINTS : les positions des deux sont comptees', () => {
    // chapitre 2 depuis une position que le chapitre 1 n atteint jamais
    const FEN_ILE = '8/8/4k3/8/8/4K3/4P3/8 w - - 0 1';
    const pgn = `[Event "?"]\n[White "Ch1"]\n\n1. e4 e5 *\n\n[Event "?"]\n[White "Ch2"]\n[SetUp "1"]\n[FEN "${FEN_ILE}"]\n\n1. e3 Kd6 2. Kd4 *`;
    const m = buildTreeModule({ id: 1, name: 'x', pgn, side: 'w' });
    const pos = _treePlayerPositions(m);
    const fens = pos.map(p => p.fen.split(' ')[0]);
    expect(fens).toContain(START.split(' ')[0]);           // e4 du chapitre 1
    expect(fens).toContain(FEN_ILE.split(' ')[0]);         // e3 du chapitre 2 (perdu sans union)
  });

  test('module mono-session : resultat identique a avant', () => {
    const m = buildTreeModule({ id: 1, name: 'x', pgn: '1. e4 e5 2. Nf3 *', side: 'w' });
    expect(_treePlayerPositions(m).length).toBe(2);        // e4, Nf3
  });
});

describe('replacePgnGame — edition d un chapitre sans toucher les autres', () => {
  test('remplace la partie 2, la partie 1 est intacte octet pour octet', () => {
    const games0 = splitPgnGames(PGN_MULTI);
    const nouveau = games0[1].replace('1. Ng5 d5', '1. Ng5 d5 2. exd5');
    const out = replacePgnGame(PGN_MULTI, 1, nouveau);
    const games1 = splitPgnGames(out);
    expect(games1).toHaveLength(2);
    expect(games1[0]).toBe(games0[0]);
    expect(games1[1]).toContain('2. exd5');
  });
  test('index hors bornes : PGN rendu tel quel', () => {
    expect(replacePgnGame(PGN_MULTI, 5, 'x')).toBe(PGN_MULTI);
  });
});

describe('gameModuleName — un titre peut contenir « ?! » (annotation d echecs)', () => {
  test('« 5.g4!? » n est pas un placeholder', () => {
    const g = '[Event "?"]\n[White "On va plus loin : 4...a6 5.g4!?"]\n[Black "?"]\n\n1. e4 *';
    expect(gameModuleName(g, 'x', 2)).toBe('On va plus loin : 4...a6 5.g4!?');
  });
  test('le placeholder « ? » seul reste rejete', () => {
    const g = '[Event "?"]\n[White "?"]\n[Black "?"]\n\n1. e4 *';
    expect(gameModuleName(g, 'Repli', 2)).toBe('Repli (3)');
  });
});

describe('applyChapTitles — surcouche des titres de chapitres édités', () => {
  test('le titre édité prime sur le libellé dérivé du PGN, clé par gameIdx', () => {
    const sessions = [
      { label: 'Blancs — théorie', gameIdx: 0 },
      { label: 'Chapitre (2)', gameIdx: 2 },   // gameIdx décalé (partie 1 sans coup jouable)
    ];
    applyChapTitles(sessions, { '2': 'L\'antidote (ma version)' });
    expect(sessions[0].label).toBe('Blancs — théorie');
    expect(sessions[1].label).toBe('L\'antidote (ma version)');
  });
  test('sans surcouche, ou session sans gameIdx : repli sur l\'index, rien de cassé', () => {
    const sessions = [{ label: 'Arbre complet' }];
    expect(applyChapTitles(sessions, null)[0].label).toBe('Arbre complet');
    applyChapTitles(sessions, { '0': 'Mon titre' });
    expect(sessions[0].label).toBe('Mon titre');
  });
});
