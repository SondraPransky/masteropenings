import {
  NAG_GLYPH, _parseShapes, _shapesToPGN, _commentWithShapes, nagGlyphs, _nagGroup,
  _findNodeByFen, pgnToEditorTree, editorTreeToPGN
} from '../lib/editor-core.js';

// `Chess` est injecté en global par tests/setup.js (comme dans le navigateur).
const START = new Chess().fen();

// Réduit un arbre éditeur à une forme comparable (sans les réf. `parent` circulaires).
function flatten(node) {
  return node.children.map(c => ({
    san: c.san,
    comment: c.comment || '',
    nags: c.nags || [],
    shapes: (c.shapes || []).map(s => s.type === 'arrow'
      ? `${s.color}:${s.from}${s.to}` : `${s.color}:o${s.square}`),
    kids: flatten(c),
  }));
}

describe('_parseShapes — flèches/cercles dans un commentaire', () => {
  test('extrait flèches [%cal], cercle [%csl] et texte libre', () => {
    const r = _parseShapes('[%cal Gd1d4,Re1e4][%csl Yf5] hello');
    expect(r.text).toBe('hello');
    expect(r.shapes).toEqual([
      { type: 'arrow', from: 'd1', to: 'd4', color: 'green' },
      { type: 'arrow', from: 'e1', to: 'e4', color: 'red' },
      { type: 'circle', square: 'f5', color: 'yellow' },
    ]);
  });
  test('commentaire sans annotation → texte seul, aucune forme', () => {
    const r = _parseShapes('juste du texte');
    expect(r.text).toBe('juste du texte');
    expect(r.shapes).toEqual([]);
  });
  test('ignore les autres annotations (%clk)', () => {
    const r = _parseShapes('[%clk 0:03:00] fin');
    expect(r.text).toBe('fin');
    expect(r.shapes).toEqual([]);
  });
});

describe('_shapesToPGN — sérialisation inverse', () => {
  test('flèches puis cercles regroupés en [%cal]/[%csl]', () => {
    const s = _shapesToPGN({ shapes: [
      { type: 'arrow', from: 'd1', to: 'd4', color: 'green' },
      { type: 'circle', square: 'f5', color: 'yellow' },
    ] });
    expect(s).toBe('[%cal Gd1d4][%csl Yf5]');
  });
  test('nœud sans forme → chaîne vide', () => {
    expect(_shapesToPGN({ shapes: [] })).toBe('');
    expect(_shapesToPGN({})).toBe('');
  });
  test('round-trip formes : parse(sérialise(x)) préserve x', () => {
    const shapes = [
      { type: 'arrow', from: 'b5', to: 'c6', color: 'green' },
      { type: 'circle', square: 'e4', color: 'red' },
    ];
    expect(_parseShapes(_shapesToPGN({ shapes })).shapes).toEqual(shapes);
  });
});

describe('_commentWithShapes — formes + texte', () => {
  test('concatène formes et commentaire', () => {
    expect(_commentWithShapes({
      shapes: [{ type: 'arrow', from: 'b5', to: 'c6', color: 'green' }],
      comment: 'La ruy',
    })).toBe('[%cal Gb5c6] La ruy');
  });
  test('texte seul si aucune forme', () => {
    expect(_commentWithShapes({ comment: 'texte' })).toBe('texte');
  });
});

describe('nagGlyphs / _nagGroup', () => {
  test('mappe les NAG vers les glyphes', () => {
    expect(nagGlyphs({ nags: [3] })).toBe('!!');
    expect(nagGlyphs({ nags: [1, 14] })).toBe('!' + NAG_GLYPH[14]);
  });
  test('aucun NAG → chaîne vide', () => {
    expect(nagGlyphs({})).toBe('');
    expect(nagGlyphs({ nags: [] })).toBe('');
  });
  test('groupe : 1..9 = qualité, 10+ = évaluation', () => {
    expect(_nagGroup(3)).toBe('q');
    expect(_nagGroup(9)).toBe('q');
    expect(_nagGroup(10)).toBe('e');
    expect(_nagGroup(14)).toBe('e');
  });
});

describe('pgnToEditorTree ↔ editorTreeToPGN — round-trip', () => {
  const PGN = "1. e4 e5 2. Nf3 (2. Bc4 {L'italienne} Nf6) 2... Nc6 3. Bb5 {[%cal Gb5c6] La ruy} a6 $1 *";
  const tree1 = pgnToEditorTree(PGN, START);

  test('mainline correcte', () => {
    const mainSans = [];
    let n = tree1;
    while (n.children.length) { n = n.children[0]; mainSans.push(n.san); }
    expect(mainSans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
  });

  test('la variante 2. Bc4 est bien branchée en alternative de Nf3', () => {
    // racine → e4 → e5 : ce nœud a 2 enfants (Nf3 principal, Bc4 variante)
    const afterE5 = tree1.children[0].children[0];
    const sans = afterE5.children.map(c => c.san);
    expect(sans).toContain('Nf3');
    expect(sans).toContain('Bc4');
  });

  // Descend la ligne principale jusqu'au coup `san` et le renvoie.
  const findMain = (san) => {
    let n = tree1;
    while (n.children.length && n.children[0].san !== san) n = n.children[0];
    return n.children[0];
  };

  test('commentaire + forme préservés sur Bb5', () => {
    const bb5 = findMain('Bb5');
    expect(bb5.san).toBe('Bb5');
    expect(bb5.comment).toBe('La ruy');
    expect(bb5.shapes).toEqual([{ type: 'arrow', from: 'b5', to: 'c6', color: 'green' }]);
  });

  test('NAG préservé sur a6', () => {
    const a6 = findMain('a6');
    expect(a6.san).toBe('a6');
    expect(a6.nags).toEqual([1]);
  });

  test('stabilité : arbre → PGN → arbre identique (structure, commentaires, NAG, formes)', () => {
    const pgn2 = editorTreeToPGN(tree1);
    const tree2 = pgnToEditorTree(pgn2, START);
    expect(flatten(tree2)).toEqual(flatten(tree1));
  });
});

describe('_findNodeByFen — recherche par FEN', () => {
  const tree = pgnToEditorTree('1. e4 e5 2. Nf3 *', START);
  test('retrouve un nœud par sa FEN d’arrivée', () => {
    const e4 = tree.children[0];
    expect(_findNodeByFen(tree, e4.fenAfter)).toBe(e4);
  });
  test('FEN absente → null', () => {
    expect(_findNodeByFen(tree, 'position/inexistante w - - 0 1')).toBe(null);
  });
});
