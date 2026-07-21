// ══════════════════════════════════════════════════════
// ÉDITEUR — CŒUR PUR (sérialisation PGN ↔ arbre, formes, NAG)
// Zéro DOM, zéro état module : entrées → sorties, donc testable en isolation.
// Extrait d'app.js (étape 1a du découpage éditeur, cf. CLAUDE.md §5.1).
// Vendors : `Chess` (global CDN). Dépend de `normalizeSAN` (lib/core.js).
// ══════════════════════════════════════════════════════
import { normalizeSAN } from './core.js';

// Glyphes NAG — annotations standard PGN (symboles Informator).
// La table couvre les codes rencontres dans le contenu reel des coachs
// ($11 egalite, $36 initiative, $132 contre-jeu... s'affichaient en "$n") ;
// un code vraiment inconnu garde le repli '$n' de nagGlyphs.
export const NAG_GLYPH = {
  1:'!', 2:'?', 3:'!!', 4:'??', 5:'!?', 6:'?!', 7:'□',
  10:'=', 11:'=', 12:'=', 13:'∞', 14:'⩲', 15:'⩱', 16:'±', 17:'∓', 18:'+−', 19:'−+',
  22:'⨀', 23:'⨀',            // zugzwang
  32:'⟳', 33:'⟳',            // avance de developpement
  36:'↑', 37:'↑',            // initiative
  40:'→', 41:'→',            // attaque
  44:'=∞', 45:'=∞',          // compensation
  132:'⇆', 133:'⇆',          // contre-jeu
  140:'∆', 146:'N',          // avec l'idee · nouveaute
};

// Palette de rendu des formes (flèches/cercles) — partagée entre le board principal et l'éditeur.
export const _SHAPE_COL = { green:'#15803d', red:'#b91c1c', yellow:'#ca8a04', blue:'#1d4ed8' };

// Parse le contenu d'un commentaire PGN : extrait flèches [%cal] et cercles [%csl],
// renvoie { text, shapes }. Ignore les autres annotations (%evp, %clk…).
export function _parseShapes(raw) {
  const COL = { G:'green', R:'red', Y:'yellow', B:'blue' };
  const shapes = [];
  let author = null, coachText = null;
  let s = raw;
  // Commentaire du COACH (couche additive P1.4) : tout ce qui suit [%coach] dans le même
  // bloc. Extrait en premier (avant le strip générique) — coexiste avec le texte de l'élève.
  const ci = s.search(/\[%coach\]/i);
  if (ci >= 0) {
    coachText = s.slice(ci).replace(/\[%coach\]/i, '').replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim() || null;
    s = s.slice(0, ci);
  }
  // Auteur du nœud (P1.4) : [%author coach] — extrait avant le strip générique ci-dessous.
  s = s.replace(/\[%author\s+(\w+)\]/gi, (mm, a) => { author = a.toLowerCase(); return ''; });
  s = s.replace(/\[%cal\s+([^\]]+)\]/gi, (mm, list) => {
    list.split(',').forEach(tk => { tk = tk.trim(); const c = COL[(tk[0]||'').toUpperCase()] || 'green'; const f = tk.slice(1,3), t = tk.slice(3,5); if (f.length===2 && t.length===2) shapes.push({type:'arrow', from:f, to:t, color:c}); });
    return '';
  });
  s = s.replace(/\[%csl\s+([^\]]+)\]/gi, (mm, list) => {
    list.split(',').forEach(tk => { tk = tk.trim(); const c = COL[(tk[0]||'').toUpperCase()] || 'green'; const sq = tk.slice(1,3); if (sq.length===2) shapes.push({type:'circle', square:sq, color:c}); });
    return '';
  });
  s = s.replace(/\[%[^\]]*\]/g, '');   // autres annotations (%evp, %clk…) ignorées
  return { text: s.replace(/\s+/g,' ').trim(), shapes, author, coachText };
}

// Sérialise les formes d'un nœud en annotations PGN ([%cal …][%csl …]).
export function _shapesToPGN(node) {
  if (!node.shapes || !node.shapes.length) return '';
  const INV = { green:'G', red:'R', yellow:'Y', blue:'B' };
  const a = node.shapes.filter(s=>s.type==='arrow').map(s => (INV[s.color]||'G')+s.from+s.to);
  const c = node.shapes.filter(s=>s.type==='circle').map(s => (INV[s.color]||'G')+s.square);
  let o = ''; if (a.length) o += '[%cal '+a.join(',')+']'; if (c.length) o += '[%csl '+c.join(',')+']';
  return o;
}

// Commentaire complet d'un nœud = formes (le cas échéant) + texte libre.
export function _commentWithShapes(node) {
  // Marque additive de l'auteur du nœud. Le parseur (_parseShapes) lit deja n'importe
  // quel [%author <mot>] ; ce serialiseur, lui, etait code en dur sur 'coach' (P1.4) —
  // author:'student' (couche d'edition eleve) disparaissait donc au round-trip PGN.
  // Liste blanche : l'auteur atterrit dans un bloc de commentaire PGN, on ne laisse pas
  // une valeur arbitraire s'y injecter.
  const au = (node.author === 'coach' || node.author === 'student') ? `[%author ${node.author}]` : '';
  const sh = _shapesToPGN(node), cm = node.comment || '';
  // Commentaire coach additif : encodé après [%coach] dans le même bloc — jamais fusionné
  // avec le texte de l'élève (les deux couches survivent au round-trip).
  const cc = node.coachComment ? '[%coach] ' + node.coachComment : '';
  return [au, sh, cm, cc].filter(Boolean).join(' ');
}

// Glyphes NAG concaténés d'un nœud (ex. [3] → "!!").
export function nagGlyphs(node) {
  return (node && node.nags && node.nags.length) ? node.nags.map(n => NAG_GLYPH[n] || ('$'+n)).join('') : '';
}

// Groupe d'un NAG : qualité du coup (1..9) vs évaluation de position (10+).
export function _nagGroup(n) { return (n>=1 && n<=9) ? 'q' : 'e'; }

// Recherche récursive d'un nœud par FEN d'arrivée dans un arbre éditeur.
export function _findNodeByFen(node, fen) {
  if (node.fenAfter === fen) return node;
  for (const child of node.children) {
    const found = _findNodeByFen(child, fen);
    if (found) return found;
  }
  return null;
}

// Reconstruit l'arbre éditeur depuis un PGN (préserve toutes les variantes, y compris courtes)
export function pgnToEditorTree(pgn, startFen) {
  const root = { san:null, fenBefore:null, fenAfter:startFen, comment:'', children:[] };
  const text = pgn.replace(/\[[A-Za-z]\w*\s+"[^"]*"\]/g, '');   // retire les en-têtes PGN, garde [%cal]/[%csl] dans les commentaires
  const re = /\{([^}]*)\}|\(|\)|([^\s(){}]+)/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) {
      const ps = _parseShapes(m[1]);
      if (ps.text || ps.shapes.length || ps.author || ps.coachText) tokens.push({type:'comment', text:ps.text, shapes:ps.shapes, author:ps.author, coachText:ps.coachText});
    } else if (m[0]==='(') tokens.push({type:'open'});
    else if (m[0]===')') tokens.push({type:'close'});
    else tokens.push({type:'move', text:m[2]});
  }
  function parse(toks, node) {
    const g = new Chess(node.fenAfter);
    let cur = node, i = 0;
    while (i < toks.length) {
      const tok = toks[i];
      if (tok.type === 'open') {
        let d=1, vt=[];
        i++;
        while (i < toks.length && d > 0) {
          if (toks[i].type==='open') d++;
          if (toks[i].type==='close') { d--; if (d===0) break; }
          vt.push(toks[i]); i++;
        }
        // La variante est une alternative au dernier coup joué → brancher depuis son parent
        if (cur.parent) parse(vt, cur.parent);
        i++; continue;
      }
      if (tok.type === 'close') { i++; continue; }
      if (tok.type === 'comment') {
        if (cur !== node) {
          if (tok.text && !cur.comment) cur.comment = tok.text;
          if (tok.coachText && !cur.coachComment) cur.coachComment = tok.coachText;
          if (tok.shapes && tok.shapes.length) cur.shapes = (cur.shapes||[]).concat(tok.shapes);
          if (tok.author) cur.author = tok.author;
        }
        i++; continue;
      }
      const t = tok.text;
      if (/^\$\d+$/.test(t)) { if (cur !== node) { cur.nags = cur.nags || []; const _n=+t.slice(1); if(!cur.nags.includes(_n)) cur.nags.push(_n); } i++; continue; }
      if (/^\d+\.+$/.test(t)||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) { i++; continue; }
      const fenBefore = g.fen();
      const san = normalizeSAN(t, g);
      const r = g.move(san);
      if (!r) { i++; continue; }
      let ch = cur.children.find(c => c.san===r.san && c.fenBefore===fenBefore);
      if (!ch) {
        ch = {san:r.san, fenBefore, fenAfter:g.fen(), comment:'', children:[], parent:cur};
        cur.children.push(ch);
      }
      cur = ch; i++;
    }
  }
  parse(tokens, root);
  return root;
}

// FEN de la position initiale standard (pour décider d'émettre ou non l'en-tête FEN).
const STD_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Sérialise un arbre éditeur (root) en PGN. `root` passé explicitement (était _E.root).
// `startFen` (optionnel) : si la position de départ n'est pas la position standard,
// on préfixe les en-têtes [FEN]/[SetUp] pour que le PGN se rejoue correctement.
export function editorTreeToPGN(root, startFen) {
  function ser(node, forceNum) {
    if (!node.children.length) return '';
    const main=node.children[0], vars=node.children.slice(1);
    const turn=main.fenBefore.split(' ')[1], num=main.fenBefore.split(' ')[5];
    const pre=(turn==='w'||forceNum) ? num+(turn==='w'?'. ':'... ') : '';
    let s=pre+main.san;
    if (main.nags && main.nags.length) s+=' '+main.nags.map(n=>'$'+n).join(' ');
    { const _cm=_commentWithShapes(main); if (_cm) s+=' {'+_cm+'}'; }
    vars.forEach(v => {
      const vt=v.fenBefore.split(' ')[1], vn=v.fenBefore.split(' ')[5];
      s+=' ('+vn+(vt==='w'?'. ':'... ')+v.san;
      if (v.nags && v.nags.length) s+=' '+v.nags.map(n=>'$'+n).join(' ');
      { const _cm=_commentWithShapes(v); if (_cm) s+=' {'+_cm+'}'; }
      s+=ser(v, vt==='b'); s+=')';
    });
    s+=ser(main, vars.length>0);
    return ' '+s.trimStart();
  }
  const movetext = ser(root, false).trim() + ' *';
  const header = (startFen && startFen !== STD_START_FEN)
    ? `[SetUp "1"]\n[FEN "${startFen}"]\n\n` : '';
  return header + movetext;
}
