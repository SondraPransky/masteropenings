// ══════════════════════════════════════════════════════
// ÉDITEUR — CŒUR PUR (sérialisation PGN ↔ arbre, formes, NAG)
// Zéro DOM, zéro état module : entrées → sorties, donc testable en isolation.
// Extrait d'app.js (étape 1a du découpage éditeur, cf. CLAUDE.md §5.1).
// Vendors : `Chess` (global CDN). Dépend de `normalizeSAN` (lib/core.js).
// ══════════════════════════════════════════════════════
import { normalizeSAN } from './core.js';

// Glyphes NAG — annotations standard PGN ($1..$19)
export const NAG_GLYPH = {1:'!',2:'?',3:'!!',4:'??',5:'!?',6:'?!',10:'=',13:'∞',14:'⩲',15:'⩱',16:'±',17:'∓',18:'+−',19:'−+'};

// Parse le contenu d'un commentaire PGN : extrait flèches [%cal] et cercles [%csl],
// renvoie { text, shapes }. Ignore les autres annotations (%evp, %clk…).
export function _parseShapes(raw) {
  const COL = { G:'green', R:'red', Y:'yellow', B:'blue' };
  const shapes = [];
  let s = raw;
  s = s.replace(/\[%cal\s+([^\]]+)\]/gi, (mm, list) => {
    list.split(',').forEach(tk => { tk = tk.trim(); const c = COL[(tk[0]||'').toUpperCase()] || 'green'; const f = tk.slice(1,3), t = tk.slice(3,5); if (f.length===2 && t.length===2) shapes.push({type:'arrow', from:f, to:t, color:c}); });
    return '';
  });
  s = s.replace(/\[%csl\s+([^\]]+)\]/gi, (mm, list) => {
    list.split(',').forEach(tk => { tk = tk.trim(); const c = COL[(tk[0]||'').toUpperCase()] || 'green'; const sq = tk.slice(1,3); if (sq.length===2) shapes.push({type:'circle', square:sq, color:c}); });
    return '';
  });
  s = s.replace(/\[%[^\]]*\]/g, '');   // autres annotations (%evp, %clk…) ignorées
  return { text: s.replace(/\s+/g,' ').trim(), shapes };
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
  const sh = _shapesToPGN(node), cm = node.comment || '';
  return sh ? (sh + (cm ? ' ' + cm : '')) : cm;
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
      if (ps.text || ps.shapes.length) tokens.push({type:'comment', text:ps.text, shapes:ps.shapes});
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
          if (tok.shapes && tok.shapes.length) cur.shapes = (cur.shapes||[]).concat(tok.shapes);
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

// Sérialise un arbre éditeur (root) en PGN. `root` passé explicitement (était _E.root).
export function editorTreeToPGN(root) {
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
  return ser(root, false).trim()+' *';
}
