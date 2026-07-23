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

// Position de départ d'un PGN : en-tête [FEN "…"] si présent (module/partie
// démarrant d'une position), sinon la position initiale standard.
// ⚠ Source UNIQUE de vérité : extractAllLines enracine son arbre ici, et l'import
// doit écrire la MÊME valeur dans sessions[0].startFen — sinon le drill part d'une
// position absente de l'arbre et le module est jouable à vide (bug de juillet 2026).
function pgnStartFen(pgn) {
  const m = (pgn || '').match(/\[FEN\s+"([^"]+)"\]/i);
  return (m && m[1]) ? m[1] : new Chess().fen();
}

// Découpe un PGN multi-parties en parties individuelles (une par en-tête [Event]).
// Chaque partie garde ses propres en-têtes, donc sa propre position de départ.
// ⚠ Ne PAS coller plusieurs parties dans un seul extractAllLines : elles seraient
// rejouées à la suite depuis la racine de la PREMIÈRE, et tout coup illégal dans la
// position courante serait silencieusement sauté (mesuré : plus de la moitié des
// demi-coups perdus sur les fichiers de leçon exportés de ChessBase).
function splitPgnGames(pgn) {
  return (pgn || '').replace(/\r/g, '').split(/\n\s*(?=\[Event\s)/g)
    .map(s => s.trim()).filter(Boolean);
}

// Remplace la partie `idx` (au sens splitPgnGames) d'un PGN multi-parties et
// re-serialise le tout. Les autres parties sont conservees telles quelles.
// Sert a l'edition PAR CHAPITRE : l'editeur ne reecrit que sa partie, jamais
// le fichier entier (sinon les chapitres voisins seraient detruits).
function replacePgnGame(pgn, idx, newChunk) {
  const games = splitPgnGames(pgn);
  if (idx < 0 || idx >= games.length) return pgn;
  games[idx] = (newChunk || '').trim();
  return games.filter(Boolean).join('\n\n');
}

// Notation figurine : « Nf6 » → « ♘f6 ». Pur, et volontairement ICI plutôt que
// derrière le pont window : la liste des modules affiche la ligne d'ouverture en
// figurines dès son PREMIER rendu, or `window.fig` n'est pas encore posé à ce
// moment-là — la liste sortait donc en SAN brut et rien ne la re-rendait ensuite
// (la signature de la vue absente toute la session). Un import ES n'a pas ce
// problème d'ordonnancement. `app.js` réexporte sur window pour les autres vues.
const PIECE_SYMS = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };

function fig(san) {
  if (!san) return san;
  return String(san).replace(/^([KQRBN])/, m => PIECE_SYMS[m] || m);
}

// ── Figurines dans un TEXTE LIBRE (titres de modules et de chapitres) ───────
// Les titres de la coach sont ecrits a la main et melangent les deux notations :
// « 4.Cc4!? vs Petroff » et « 3.Dxd4!? » sont en FRANCAIS (Cavalier, Dame),
// « 8.Qe3-Rxe4 » est en ANGLAIS (Queen, Rook). Mesure sur le fonds reel :
// 6 titres sur 102 portent un coup de piece, lettres rencontrees C, D, R.
//
// ⚠ `R` est une COLLISION : Rook en anglais (♖), Roi en francais (♔). Convertir
// au hasard produirait un titre FAUX (« Tour e8 » devenu « Roi e8 ») — pire
// qu'une lettre laissee telle quelle. On ne devine donc jamais : le R n'est
// converti que si un AUTRE coup du meme texte tranche la langue.
const FIG_EN = { K: '♔', Q: '♕', B: '♗', N: '♘' };          // sans R (ambigu)
const FIG_FR = { D: '♕', T: '♖', F: '♗', C: '♘' };          // sans R (ambigu)
const _MOVE_RE = /\b([KQBNRDTFC])([a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNDTFC])?[+#]?)/g;

function figurineTitle(text) {
  if (!text) return text;
  const s = String(text);
  // Langue tranchee par une lettre NON ambigue presente ailleurs dans le titre.
  let lang = null;
  for (const m of s.matchAll(_MOVE_RE)) {
    if (FIG_EN[m[1]]) { lang = 'en'; break; }
    if (FIG_FR[m[1]]) { lang = 'fr'; break; }
  }
  return s.replace(_MOVE_RE, (whole, p, rest) => {
    if (p === 'R') {
      // Tour (en) ou Roi (fr) — sans indice de langue, on laisse la lettre.
      if (lang === 'en') return '♖' + rest;
      if (lang === 'fr') return '♔' + rest;
      return whole;
    }
    return (FIG_EN[p] || FIG_FR[p] || p) + rest;
  });
}

// ── Le <select> de modules de la page drill ────────────────────────────────
// Il listait G.drills A PLAT. Au volume reel du repertoire (26 modules) ca
// donne une liste interminable, ou les paquets d'exercices se rangent
// alphabetiquement ENTRE deux ouvertures, et ou les homonymes (trois « Gambit
// Koltanowski ») sont strictement indiscernables — ici, contrairement au
// repertoire coach, il n'y a ni sous-titre de dossier ni ligne d'ouverture
// pour trancher. Le select est partage par les DEUX roles.
//
// On regroupe par nature (la meme IA que l'accueil eleve : ouvertures d'un
// cote, exercices de l'autre) et on desambigue les homonymes par les mots de
// leur dossier. `i` reste l'index d'origine dans G.drills : le tri alphabetique
// ne casse donc pas `sel.value = S.idx`.
const _dsFolder = f => String(f || '').replace(/^\d+\s*-\s*/, '').trim();

function drillSelectGroups(drills) {
  const list = (drills || []).map((d, i) => ({ i, d }));
  const seen = {};
  list.forEach(({ d }) => { const n = d && d.name || ''; seen[n] = (seen[n] || 0) + 1; });

  const label = ({ d }) => {
    const base = figurineTitle((d && d.name) || '(sans nom)');
    if ((seen[(d && d.name) || ''] || 0) < 2) return base;
    // Homonyme : on ajoute les mots du dossier, mais SEULEMENT s'ils apportent
    // une distinction (un dossier qui repete le nom n'en apporte aucune).
    const f = _dsFolder(d && d.folder);
    return f && !base.toLowerCase().includes(f.toLowerCase()) ? `${base} — ${f}` : base;
  };

  const mk = xs => xs.map(x => ({ i: x.i, label: label(x) }))
                     .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  const ouv = mk(list.filter(x => !(x.d && x.d.isExercise)));
  const exo = mk(list.filter(x =>   x.d && x.d.isExercise));

  // Un seul groupe : l'en-tete n'apprend rien, on rend une liste plate.
  if (!ouv.length || !exo.length) return [{ label: '', items: ouv.length ? ouv : exo }];
  return [{ label: 'Ouvertures', items: ouv }, { label: 'Exercices', items: exo }];
}

function extractAllLines(pgn) {
  const rootFen = pgnStartFen(pgn);
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

    // Une ligne d'UN SEUL coup est légitime : PGN « 1. e4 », ou variante annotée
    // réduite au bon coup. Seules les lignes sans aucun coup jouable sont rejetées.
    if (moves.length >= 1) allLines.push({label, depth, startFen, moves});
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
export { _normFen, leitnerSchedule, DEFAULT_LADDER_HOURS, normalizeSAN, extractAllLines, pgnHeader,
         pgnStartFen, splitPgnGames, replacePgnGame, fig, PIECE_SYMS, figurineTitle,
         drillSelectGroups };
