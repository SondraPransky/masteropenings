// ════════════════════════════════════════════════════════════
//  lib/core.js — LOGIQUE PURE (sans DOM, sans Firebase)
//  Chargé par <script src="lib/core.js"> AVANT app.js → fonctions globales.
//  Aussi exporté pour Node/Vitest (tests/core.test.js) en bas de fichier.
//  `Chess` = global (CDN) dans le navigateur ; injecté via globalThis dans les tests.
// ════════════════════════════════════════════════════════════

// FEN normalisé = 4 premiers champs (pièces, trait, roques, en-passant).
// Sert de clé de transposition (ignore les compteurs de coups).
function _normFen(fen) { return fen.split(' ').slice(0, 4).join(' '); }

// ── Répétition espacée LEITNER à échelons (cœur pur, sans état) ──────────────
// Modèle Chessable/Chess.com : échelle discrète de paliers (pas de facteur de
// facilité). Bon coup → palier +1 (plafonné au dernier) ; raté → retour au palier 1.
// Chaque position a son propre record → « chaque coup a son niveau ».
//
// Échelle par défaut = celle de Chessable, exprimée en HEURES par palier :
//   4h · 1j · 3j · 1sem · 2sem · 1mois · 3mois · 6mois
const DEFAULT_LADDER_HOURS = [4, 24, 72, 168, 336, 720, 2160, 4320];

// Calcule le nouvel état de maîtrise à partir de l'ancien + réussite (binaire).
// `prev` : { level, due, reps } ou null (première rencontre → level 0).
// `ladder` : tableau d'heures par palier (défaut = Chessable). `now` injectable (tests).
// Retourne un NOUVEL objet (ne mute pas `prev`). Le champ `.due` est conservé
// (même nom que l'ancien SM-2) → les consommateurs de file/prévision sont inchangés.
function leitnerSchedule(prev, correct, now, ladder) {
  const L = (Array.isArray(ladder) && ladder.length) ? ladder : DEFAULT_LADDER_HOURS;
  const maxLevel = L.length;
  const prevLevel = (prev && prev.level) || 0;
  const level = correct ? Math.min(maxLevel, prevLevel + 1) : 1;
  const now2 = (now == null ? Date.now() : now);
  const reps = ((prev && prev.reps) || 0) + 1;
  return { level, due: now2 + L[level - 1] * 3600000, reps, last: now2 };
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
  // Position de départ : en-tête [FEN "…"] si présent (partie/module depuis une position), sinon standard.
  const fenM = (pgn || '').match(/\[FEN\s+"([^"]+)"\]/i);
  const rootFen = (fenM && fenM[1]) ? fenM[1] : new Chess().fen();
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

  parseLine(tokenize(text), rootFen, 'Ligne principale', 0);
  return allLines;
}

// En-tête PGN (`[White "…"]` → "…") — helper canonique (dbmap, autofill…).
// Retourne null si l'en-tête est absent ou vide.
function pgnHeader(pgn, key) {
  if (!pgn) return null;
  const m = pgn.match(new RegExp('\\[' + key + '\\s+"([^"]*)"\\]'));
  return (m && m[1]) ? m[1] : null;
}

// ── Export ES (importé par app.js + par Vitest) ──
export { _normFen, leitnerSchedule, DEFAULT_LADDER_HOURS, normalizeSAN, extractAllLines, pgnHeader };
