// ════════════════════════════════════════════════════════════
//  lib/core.js — LOGIQUE PURE (sans DOM, sans Firebase)
//  Chargé par <script src="lib/core.js"> AVANT app.js → fonctions globales.
//  Aussi exporté pour Node/Vitest (tests/core.test.js) en bas de fichier.
//  `Chess` = global (CDN) dans le navigateur ; injecté via globalThis dans les tests.
// ════════════════════════════════════════════════════════════

// FEN normalisé = 4 premiers champs (pièces, trait, roques, en-passant).
// Sert de clé de transposition (ignore les compteurs de coups).
function _normFen(fen) { return fen.split(' ').slice(0, 4).join(' '); }

// ── Répétition espacée SM-2 (cœur pur, sans état) ──────────────
// Calcule le nouvel état de maîtrise à partir de l'ancien + réussite (binaire).
// `prev` : {ef, interval, reps, due} ou null (première rencontre).
// Retourne un NOUVEL objet (ne mute pas `prev`). `now` injectable pour les tests.
function sm2Schedule(prev, correct, now) {
  const m = Object.assign({ ef: 2.5, interval: 1, reps: 0, due: 0 }, prev || {});
  const q = correct ? 5 : 1;
  if (q >= 3) {
    if      (m.reps === 0) m.interval = 1;
    else if (m.reps === 1) m.interval = 6;
    else                   m.interval = Math.round(m.interval * m.ef);
    m.reps++;
  } else {
    m.reps = 0; m.interval = 1;
  }
  m.ef  = Math.max(1.3, m.ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  m.due = (now == null ? Date.now() : now) + m.interval * 86400000;
  return m;
}

// ══════════════════════════════════════════════════════
// PARSING PGN
// ══════════════════════════════════════════════════════
function normalizeSAN(san, g) {
  const tmp = new Chess(g.fen());
  if (tmp.move(san)) return san;
  // Tenter sans désambiguïsation (Nge2 → Ne2, Rdf1 → Rf1, etc.)
  const m = san.match(/^([NBRQK])([a-h][1-8]|[a-h]|[1-8])(.+)$/);
  if (m) {
    const t2 = new Chess(g.fen());
    if (t2.move(m[1]+m[3])) return m[1]+m[3];
  }
  return san;
}

function extractAllLines(pgn) {
  const text = pgn.replace(/\[[^\]]*\]/g, '');
  const allLines = [];

  function tokenize(str) {
    const tokens = [];
    // Regex corrigée : [^\s(){}]+ évite d'absorber les ( ) collés (ex: "d3)" → "d3" + ")")
    const re = /\{([^}]*)\}|\(|\)|([^\s(){}]+)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      if (m[1] !== undefined) {
        const t = m[1].replace(/\[%[^\]]*\]/g, '').trim();
        if (t && !/^\[%/.test(m[1].trim())) tokens.push({ type:'comment', text:t });
      } else if (m[0]==='(') tokens.push({type:'open'});
      else if (m[0]===')') tokens.push({type:'close'});
      else tokens.push({type:'move', text:m[2]});
    }
    return tokens;
  }

  function parseLine(tokens, startFen, label, depth) {
    const g = new Chess(startFen);
    const moves = [];
    let i = 0;

    while (i < tokens.length) {
      const tok = tokens[i];

      if (tok.type === 'open') {
        let d = 1, vt = [];
        i++;
        while (i < tokens.length && d > 0) {
          if (tokens[i].type==='open') d++;
          if (tokens[i].type==='close') { d--; if (d===0) break; }
          vt.push(tokens[i]);
          i++;
        }
        const forkFen = moves.length>0 ? moves[moves.length-1].fenBefore : startFen;
        const ft = vt.find(t => t.type==='move' && !/^\d+\./.test(t.text) && !/^\$/.test(t.text) && !/^(1-0|0-1|1\/2|\*)/.test(t.text));
        parseLine(vt, forkFen, label+' ['+(ft?ft.text:'?')+']', depth+1);
        continue;
      }

      if (tok.type==='close') { i++; continue; }

      // Commentaire post-coup : on l'attache au dernier coup joué (look-behind)
      if (tok.type==='comment') {
        if (moves.length > 0 && !moves[moves.length-1].comment) {
          moves[moves.length-1].comment = tok.text;
        }
        i++; continue;
      }

      if (tok.type==='move') {
        const t = tok.text;
        if (/^\d+\.+$/.test(t)||/^\$\d+$/.test(t)||/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) { i++; continue; }
        const fenBefore = g.fen();
        const san = normalizeSAN(t, g);
        const r = g.move(san);
        if (!r) { i++; continue; }
        moves.push({san:r.san, comment:'', fenBefore});
      }
      i++;
    }

    if (moves.length >= 2) allLines.push({label, depth, startFen, moves});
  }

  parseLine(tokenize(text), new Chess().fen(), 'Ligne principale', 0);
  return allLines;
}

// ── Export ES (importé par app.js + par Vitest) ──
export { _normFen, sm2Schedule, normalizeSAN, extractAllLines };
