// ════════════════════════════════════════════════════════════
//  lib/tree.js — LOGIQUE PURE des arbres d'ouverture (sans DOM, sans état app).
//  Construit/parcourt l'arbre de variantes d'un module. Testable en isolation.
//  `Chess` = global (CDN navigateur ; injecté via globalThis dans les tests).
// ════════════════════════════════════════════════════════════
import { _normFen, extractAllLines, pgnStartFen, pgnHeader, splitPgnGames } from './core.js';

// Le camp qui doit jouer dans cette position, d'après le trait (champ 2 du FEN).
function isPlayerMove(fenBefore, side) {
  const turn = fenBefore.split(' ')[1];
  return side === 'both' || turn === side;
}

// Construit l'arbre {normFen: {opp[], player[], startFen}} depuis les lignes extraites.
function _buildDrillTree(allLines, side) {
  const tree = {};
  for (const line of allLines) {
    const g = new Chess(line.startFen || new Chess().fen());
    for (const mv of line.moves) {
      const nf = _normFen(g.fen());
      if (!tree[nf]) tree[nf] = { opp: [], player: [], startFen: g.fen() };
      const isPlayer = isPlayerMove(g.fen(), side);
      const bucket   = isPlayer ? 'player' : 'opp';
      if (!tree[nf][bucket].find(m => m.san === mv.san)) {
        tree[nf][bucket].push({ san: mv.san, comment: mv.comment || '' });
      }
      g.move(mv.san);
    }
  }
  return tree;
}

// ── Construction canonique d'un module « arbre » depuis UN PGN ──────────────
// Consomme par les 2 chemins d'import (collage `importDrill` et lot `_pgnBatchRun`)
// pour qu'ils ne puissent plus diverger. Retourne null si rien n'est extractible.
//
// UN FICHIER = UN MODULE. Un PGN multi-parties (fichier de lecon ChessBase :
// plusieurs parties, chacune depuis une position [SetUp]/[FEN]) devient un module
// a CHAPITRES : une session par partie ({label, startFen}), et un arbre FUSIONNE
// de toutes les lignes. Les chapitres d'un meme fichier se chevauchent massivement
// (mesure : 139 paires sur 174 — le ch.2 demarre sur la ligne du ch.1), donc :
//  - l'arbre fusionne est LE bon niveau pour la file SR et la carte eleve
//    (une position = un noeud = un historique Leitner, cle normFen_san) ;
//  - le drill d'un chapitre reconstruit l'arbre de SA partie a la volee
//    (chapterPgn ci-dessous), sinon le chapitre 1 avalerait tout le fichier.
//
// ⚠ `sessions[i].startFen` DOIT valoir la racine reelle de la partie i
// (`pgnStartFen`) et non la position initiale standard : _treePlayerPositions
// parcourt l'arbre depuis ces FEN, donc un startFen faux = module d'apparence
// normale mais SANS aucune position a reviser (bug silencieux du 21/07).
//
// ⚠ Chaque partie est extraite SEPAREMENT : plusieurs parties collees bout a
// bout se rejouent depuis la racine de la premiere, et les coups illegaux dans
// la position courante sont silencieusement sautes (l'autre bug du 21/07).
function buildTreeModule({ id, name, pgn, side, level, deadline, hideComments }) {
  const games = splitPgnGames(pgn);
  const chunks = games.length ? games : [pgn];
  const sessions = [];
  let allLines = [];
  chunks.forEach((chunk, i) => {
    const lines = extractAllLines(chunk);
    if (!lines.length) return;                 // partie sans coup jouable → pas de chapitre
    allLines = allLines.concat(lines);
    sessions.push({
      label: chunks.length > 1 ? gameModuleName(chunk, 'Chapitre', i) : 'Arbre complet',
      startFen: pgnStartFen(chunk), moves: [], kps: [],
      // Index de la partie dans le PGN : une partie sans coup jouable ne cree pas
      // de session, donc sessions[i] et splitPgnGames(pgn)[i] peuvent se decaler.
      gameIdx: i,
    });
  });
  if (!allLines.length) return null;
  const tree = _buildDrillTree(allLines, side);
  if (!Object.keys(tree).length) return null;
  return {
    id, name, level: level || null, side, pgn,
    mode: 'line', varmode: 'tree', tree,
    sessions,
    hideComments: !!hideComments,
    deadline: deadline || null,
    created: new Date().toLocaleDateString('fr-FR'),
    updatedAt: Date.now(),
  };
}

// ── Chapitres d'un module « arbre » ─────────────────────────────────────────
// Un chapitre = une partie du PGN du module (decoupe splitPgnGames). Le PGN
// entier reste LA source de verite ; rien d'autre n'est persiste.
function chapterCount(d) {
  if (!d || d.varmode !== 'tree' || !d.pgn) return 1;
  const n = splitPgnGames(d.pgn).length;
  return n || 1;
}

// PGN du chapitre `sessionIdx` du module (repli : le PGN entier, cas mono-partie).
// L'index de PARTIE vient de sessions[sessionIdx].gameIdx : une partie sans coup
// jouable ne cree pas de session, les deux numerotations peuvent donc differer.
function chapterPgn(d, sessionIdx) {
  const games = splitPgnGames(d?.pgn || '');
  const gi = d?.sessions?.[sessionIdx]?.gameIdx ?? sessionIdx;
  return games[gi] ?? (d?.pgn || '');
}

// Nom d'un module issu d'une partie d'un fichier multi-parties : on prefere les
// en-tetes du coach (« Le Gambit Danois » / « Les Noirs acceptent ») au nom de
// fichier, qui serait identique pour toutes les parties du lot.
function gameModuleName(gamePgn, fallback, index) {
  // ⚠ Le placeholder ChessBase est la valeur « ? » SEULE. Ne pas rejeter les titres
  // qui CONTIENNENT un ? : « On va plus loin : 4...a6 5.g4!? » est un vrai titre
  // (l'annotation !? fait partie du vocabulaire des échecs).
  const pick = k => { const v = (pgnHeader(gamePgn, k) || '').trim(); return v && v !== '?' ? v : null; };
  const parts = [pick('White'), pick('Black')].filter(Boolean);
  if (parts.length) return parts.join(' — ');
  return fallback + (index != null ? ` (${index + 1})` : '');
}

// ── Couche d'edition eleve (additive) ───────────────────────────────────────
// Un module de coach est en lecture seule pour l'eleve, mais l'eleve peut y GREFFER
// ses propres lignes. Ses ajouts vivent dans une ligne « overlay » separee (voir
// extra.overlayOf) qui ne contient QUE le diff — jamais l'arbre du coach. C'est ce
// qui donne la propagation gratuitement : on regreffe sur l'arbre VIVANT du coach a
// chaque chargement, donc une correction du coach descend sans ecraser l'eleve.
// L'arbre etant une map FEN -> coups, greffe et diff sont des operations de
// dictionnaire ; on reprend la dedup par SAN de _buildDrillTree.

function _cloneNode(n) {
  return { opp: [...(n.opp || [])], player: [...(n.player || [])], startFen: n.startFen };
}

// Arbre du coach + ajouts de l'eleve. Les coups greffes sont tagues author:'student'
// (sauf s'ils portent deja un auteur — le coach peut repondre DANS la copie de l'eleve).
function _mergeStudentLayer(coachTree, overlayTree, author) {
  const who = author || 'student';
  const out = {};
  for (const fen in (coachTree || {})) out[fen] = _cloneNode(coachTree[fen]);
  for (const fen in (overlayTree || {})) {
    const src = overlayTree[fen];
    if (!out[fen]) out[fen] = { opp: [], player: [], startFen: src.startFen };
    for (const bucket of ['player', 'opp']) {
      for (const mv of (src[bucket] || [])) {
        if (out[fen][bucket].find(m => m.san === mv.san)) continue;   // le coach fait autorite
        out[fen][bucket].push({ ...mv, author: mv.author || who });
      }
    }
  }
  return out;
}

// Ne garde que ce qui N'EST PAS dans l'arbre du coach -> ce qu'on persiste dans l'overlay.
// Empeche mecaniquement l'eleve de « s'approprier » une ligne du coach : si le coach la
// possede, elle n'entre pas dans le diff, donc elle continue de venir de lui (et suit ses
// corrections). C'est ce qui rend l'edition eleve additive PAR CONSTRUCTION.
function _diffAgainstCoach(fullTree, coachTree) {
  const out = {};
  for (const fen in (fullTree || {})) {
    const src = fullTree[fen];
    for (const bucket of ['player', 'opp']) {
      for (const mv of (src[bucket] || [])) {
        const chezCoach = (coachTree?.[fen]?.[bucket] || []).some(m => m.san === mv.san);
        if (chezCoach) continue;
        if (!out[fen]) out[fen] = { opp: [], player: [], startFen: src.startFen };
        out[fen][bucket].push({ san: mv.san, comment: mv.comment || '', ...(mv.author ? { author: mv.author } : {}) });
      }
    }
  }
  return out;
}

// Arbre de l'EDITEUR (noeuds {san, fenAfter, author, children}) -> arbre de drill
// (map FEN -> coups). Miroir de _buildDrillTree, mais SANS passer par le PGN : la chaine
// editorTreeToPGN -> extractAllLines -> _buildDrillTree perd l'auteur, car extractAllLines
// jette tout commentaire commencant par `[%` (core.js) — donc [%author coach] n'y survit
// pas. Or l'auteur est ce qui distingue « ligne de l'eleve » de « reponse du coach ».
function _editorTreeToDrillTree(root, side) {
  const tree = {};
  const visit = (node) => {
    const nf = _normFen(node.fenAfter);
    for (const ch of (node.children || [])) {
      if (!tree[nf]) tree[nf] = { opp: [], player: [], startFen: node.fenAfter };
      const bucket = isPlayerMove(node.fenAfter, side) ? 'player' : 'opp';
      if (!tree[nf][bucket].find(m => m.san === ch.san)) {
        tree[nf][bucket].push({ san: ch.san, comment: ch.comment || '',
                                ...(ch.author ? { author: ch.author } : {}) });
      }
      visit(ch);
    }
  };
  visit(root);
  return tree;
}

// Combien de coups l'eleve a-t-il ajoutes ? (badge « N lignes » cote coach)
function _countLayerMoves(overlayTree) {
  let n = 0;
  for (const fen in (overlayTree || {})) {
    n += (overlayTree[fen].player || []).length + (overlayTree[fen].opp || []).length;
  }
  return n;
}

// Énumère les positions où l'élève doit jouer (points de décision), pour la SM-2.
// ⚠ La file est semée avec les racines de TOUTES les sessions (union) : un module
// à chapitres dont un chapitre ne serait pas atteignable depuis la racine du
// chapitre 1 perdrait sinon ses positions EN SILENCE (file SR + carte élève
// passent par ici) — la classe de bug « module d'apparence normale » du 21/07.
// Cas mono-session : strictement identique à avant.
function _treePlayerPositions(drill) {
  const out = [];
  if (drill.varmode !== 'tree' || !drill.tree) return out;
  const side = drill.side;
  const roots = (drill.sessions || []).map(s => s?.startFen).filter(Boolean);
  if (!roots.length) roots.push(new Chess().fen());
  const seen = new Set();
  const queue = roots.map(f => new Chess(f));
  while (queue.length) {
    const g  = queue.shift();
    const nf = _normFen(g.fen());
    if (seen.has(nf)) continue;
    seen.add(nf);
    const node = drill.tree[nf];
    if (!node) continue;
    if (isPlayerMove(g.fen(), side) && node.player && node.player.length) {
      const canon = node.player[0];
      out.push({
        fen: g.fen(),
        masteryKey: nf + '_' + canon.san,
        san: canon.san,
        altSans: node.player.map(m => m.san),
        comment: canon.comment || ''
      });
    }
    [...(node.player || []), ...(node.opp || [])].forEach(mv => {
      const g2 = new Chess(g.fen());
      if (g2.move(mv.san)) queue.push(g2);
    });
  }
  return out;
}

// Heuristique « ce coup laisse-t-il du matériel en prise ? » (1 coup, seuil ≥2 pts).
function _materialHint(fenBefore, moveSan) {
  try {
    const g = new Chess(fenBefore);
    if (!g.move(moveSan)) return '';
    const val = { p:1, n:3, b:3, r:5, q:9, k:0 };
    let worst = 0;
    for (const c of g.moves({ verbose:true }).filter(m => m.captured)) {
      const g2 = new Chess(g.fen()); g2.move(c.san);
      const recap = g2.moves({ verbose:true }).some(m => m.to === c.to && m.captured);
      const net = val[c.captured] - (recap ? val[c.piece] : 0);
      if (net > worst) worst = net;
    }
    return worst >= 2 ? '⚠ ce coup semble laisser du matériel en prise' : '';
  } catch(e) { return ''; }
}

export { isPlayerMove, _buildDrillTree, _treePlayerPositions, _materialHint,
         buildTreeModule, gameModuleName, chapterCount, chapterPgn,
         _mergeStudentLayer, _diffAgainstCoach, _countLayerMoves, _editorTreeToDrillTree };
