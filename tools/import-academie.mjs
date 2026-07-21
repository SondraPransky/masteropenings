// ════════════════════════════════════════════════════════════
//  EECoach — import en masse du fonds « Academie » dans Supabase
//
//  Charge le repertoire d'ouvertures du coach (Ouvertures en vogue + Revue/Nataf)
//  comme modules « arbre », sans passer par l'UI (348 fichiers a la main = non).
//
//  ⚠ Ce script ne REIMPLEMENTE rien : il consomme `buildTreeModule` / `splitPgnGames`
//  de lib/ (le code de l'app) et `_sbModuleToRow` de lib/dbmap.js. S'il diverge de
//  l'app un jour, c'est un bug de lib/, pas d'ici.
//
//  UNE PARTIE PGN = UN MODULE (voir lib/core.js splitPgnGames) : les fichiers de
//  lecon exportes de ChessBase contiennent plusieurs parties, chacune depuis sa
//  propre position [SetUp]/[FEN].
//
//  LANCEMENT
//    node --env-file=.env tools/import-academie.mjs              # simulation (par defaut)
//    node --env-file=.env tools/import-academie.mjs --apply      # ecrit dans Supabase
//    node --env-file=.env tools/import-academie.mjs --undo <manifest.json>
//
//  Le compte cible vient de .env (GATE_COACH_EMAIL / GATE_COACH_PWD).
//  Chaque run --apply ecrit un manifeste d'ids → --undo supprime EXACTEMENT ce lot.
// ════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { splitPgnGames } from '../lib/core.js';
import { buildTreeModule, gameModuleName, _treePlayerPositions } from '../lib/tree.js';
import { _sbModuleToRow } from '../lib/dbmap.js';

// `Chess` est un global du navigateur (CDN) ; en Node on l'injecte, comme les tests.
const { Chess } = await import('chess.js');
globalThis.Chess = Chess;

const SUPABASE_URL = 'https://smoftbuyejoyxlonhjcu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Bn0asUgcNYPYA1wnl9bokw_k1xshFC4';
const ROOT = process.env.ACADEMIE_ROOT || 'C:/Users/mathi/Desktop/Academie';

// ── Perimetre + camp de chaque dossier (arbitrage de l'utilisatrice, 21/07/2026) ──
// Le camp decide quels coups l'eleve doit trouver : il n'est PAS derivable
// automatiquement (heuristique de branchement = pile ou face). Fixe a la main,
// corrobore par la repartition des commentaires (validee 7/7 sur les cas connus).
const SIDES = {
  '760 - Grunfeld Fc4 et Ce2': 'w',
  '761 - Italienne - gérer Fg5': 'b',
  '762 - Petroff 5.Cc3 et 7.Ff4': 'w',
  '763 - Spassky Breyer': 'b',
  '764 - Anglaise dragon inversé': 'b',
  '765 - Anti Marshall d3': 'b',
  '766 - Anti Najdorf 4.h3': 'w',
  '767 - Rubinstein Cxe5': 'w',
  '768 - Gambit Belgrade': 'w',
  '769 - Gambit Cochrane': 'w',
  '770 - Gambit danois': 'w',
  '771 - Gambit Goring accepté': 'w',
  '772 - Gambit Goring refusé': 'w',
  '773 - Koltanowskiaccéléré - Noirs exd4': 'w',
  '774 - Koltanowskiaccéléré - Noirs Fxd4 et Cxd4': 'w',
  '775 - Gambit Koltanowski': 'w',
  '776 - Gambit Mieses': 'w',
  '777 - Gambitducentre': 'w',
};
// « Ouvertures en vogue » melange des ouvertures : le camp s'y decide PAR FICHIER.
const VOGUE_SIDES = {
  'Cc4petroffCaruana_Romu.pgn': 'w',
  'idéesimplefrançaise_Romu.pgn': 'w',
  'shimanovd4sici_Romu.pgn': 'w',
  'viennoisearonian_Romu.pgn': 'w',
  'Estindienneclassique_Romu.pgn': 'b',
  'idee_catalane.pgn': 'b',
  'idéecontreJobava_Romu.pgn': 'b',
};

// Exclusions (decidees avec l'utilisatrice) :
//  - `exercices*.pgn` : ce sont des EXERCICES (positions + solution courte), pas des
//    lignes de repertoire → ils n'ont rien a faire en module « arbre ».
//  - `Gambit Rubinstein/` : copie imbriquee et PLUS ANCIENNE des deux lecons de 767
//    (coquilles non corrigees, et surtout sans les fleches [%cal]/[%csl]).
const EXCLUDE = [/\/exercices[^/]*\.pgn$/i, /\/Gambit Rubinstein\//];

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const UNDO = args[args.indexOf('--undo') + 1] && args.includes('--undo') ? args[args.indexOf('--undo') + 1] : null;

// ── HTTP (meme patron que tests/gate/gate.mjs) ──────────────
async function signIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`signIn(${email}) → ${r.status} ${JSON.stringify(j)}`);
  return { token: j.access_token, uid: j.user.id };
}
async function rest(token, method, pathAndQuery, { body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, ok: r.ok, data };
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e).replace(/\\/g, '/');
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.pgn$/i.test(e)) out.push(p);
  }
  return out;
}

// ── Collecte des modules ────────────────────────────────────
function collect() {
  const files = [
    ...walk(join(ROOT, 'Ouvertures en vogue').replace(/\\/g, '/')),
    ...walk(join(ROOT, 'Revue/Nataf').replace(/\\/g, '/')),
  ].filter(f => !EXCLUDE.some(re => re.test(f)));

  const mods = [], skipped = [];
  const seenGame = new Set();
  let seq = 0;
  const baseId = Date.now();

  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    const inVogue = rel.startsWith('Ouvertures en vogue');
    const folder = inVogue ? 'Ouvertures en vogue' : basename(dirname(f));
    const side = inVogue ? VOGUE_SIDES[basename(f)] : SIDES[folder];
    if (!side) { skipped.push({ rel, why: 'camp non defini' }); continue; }

    const raw = readFileSync(f, 'utf8').replace(/^﻿/, '');
    const chunks = splitPgnGames(raw);
    const games = chunks.length ? chunks : [raw];
    games.forEach((chunk, gi) => {
      // Deux fichiers peuvent porter la meme partie : on ne l'importe qu'une fois.
      const h = createHash('sha1').update(chunk.replace(/\s+/g, ' ').trim()).digest('hex');
      if (seenGame.has(h)) { skipped.push({ rel, why: `partie ${gi + 1} en double` }); return; }
      seenGame.add(h);

      let d = null;
      try {
        d = buildTreeModule({
          id: baseId + (seq++),
          name: games.length > 1 ? gameModuleName(chunk, basename(f, '.pgn'), gi) : gameModuleName(chunk, basename(f, '.pgn'), null),
          pgn: chunk, side, level: null, deadline: null, hideComments: false,
        });
      } catch (e) { skipped.push({ rel, why: `partie ${gi + 1} : ${e.message}` }); return; }
      if (!d) { skipped.push({ rel, why: `partie ${gi + 1} : aucune ligne jouable` }); return; }
      d.folder = folder;
      mods.push({ mod: d, rel, folder });
    });
  }
  return { mods, skipped };
}

// ── Main ────────────────────────────────────────────────────
const { GATE_COACH_EMAIL, GATE_COACH_PWD } = process.env;

if (UNDO) {
  if (!GATE_COACH_EMAIL || !GATE_COACH_PWD) { console.error('✗ GATE_COACH_EMAIL / GATE_COACH_PWD manquants'); process.exit(2); }
  const man = JSON.parse(readFileSync(UNDO, 'utf8'));
  console.log(`→ Suppression du lot ${UNDO} (${man.ids.length} modules)…`);
  const coach = await signIn(GATE_COACH_EMAIL, GATE_COACH_PWD);
  let del = 0;
  for (const id of man.ids) {
    const r = await rest(coach.token, 'DELETE', `modules?id=eq.${id}`);
    if (r.ok) del++; else console.error(`  ✗ ${id} → ${r.status} ${JSON.stringify(r.data)}`);
  }
  console.log(`✓ ${del}/${man.ids.length} modules supprimes.`);
  process.exit(0);
}

const { mods, skipped } = collect();

// ── Rapport (toujours affiche, y compris en simulation) ─────
const byFolder = {};
for (const m of mods) (byFolder[m.folder] ||= []).push(m);
console.log(`\n${mods.length} modules a importer, ${Object.keys(byFolder).length} dossiers\n`);
// ⚠ On compte les positions REELLEMENT a reviser (_treePlayerPositions), pas les
// noeuds de l'arbre : c'est precisement cette confusion qui masquait les modules
// vides. Un module a 0 ici est inutilisable, quel que soit son nombre de noeuds.
console.log('dossier                                        camp  mod  a reviser  commentaires  vides');
let totPos = 0, totCmt = 0, totEmpty = 0;
for (const [f, v] of Object.entries(byFolder)) {
  const pos = v.reduce((a, x) => a + _treePlayerPositions(x.mod).length, 0);
  const empty = v.filter(x => _treePlayerPositions(x.mod).length === 0).length;
  totEmpty += empty;
  const cmt = v.reduce((a, x) => a + Object.values(x.mod.tree)
    .reduce((b, n) => b + [...n.player, ...n.opp].filter(mv => mv.comment).length, 0), 0);
  totPos += pos; totCmt += cmt;
  const camps = [...new Set(v.map(x => x.mod.side))].join('/');
  console.log(f.slice(0, 44).padEnd(46) + camps.padEnd(6) + String(v.length).padStart(3)
    + String(pos).padStart(11) + String(cmt).padStart(14) + String(empty || '').padStart(7));
}
console.log(''.padEnd(46) + ''.padEnd(6) + String(mods.length).padStart(3)
  + String(totPos).padStart(11) + String(totCmt).padStart(14) + String(totEmpty || '').padStart(7));
if (totEmpty) {
  console.error(`\n✗ ${totEmpty} module(s) sans aucune position a reviser — import bloque.`);
  process.exit(3);
}

if (skipped.length) {
  console.log(`\n${skipped.length} elements ecartes :`);
  for (const s of skipped) console.log(`  - ${s.rel} : ${s.why}`);
}

if (!APPLY) {
  console.log('\n— SIMULATION — rien n\'a ete ecrit. Relance avec --apply pour importer.');
  process.exit(0);
}

if (!GATE_COACH_EMAIL || !GATE_COACH_PWD) {
  console.error('\n✗ GATE_COACH_EMAIL / GATE_COACH_PWD manquants dans .env');
  process.exit(2);
}

console.log('\n→ Connexion du compte coach…');
const coach = await signIn(GATE_COACH_EMAIL, GATE_COACH_PWD);
const me = await rest(coach.token, 'GET', `profiles?id=eq.${coach.uid}&select=role,email`);
if (me.data?.[0]?.role !== 'teacher') {
  console.error(`✗ Le compte ${me.data?.[0]?.email} n'a pas le role teacher (role=${me.data?.[0]?.role}) — import annule.`);
  process.exit(2);
}
console.log(`  coach ${me.data[0].email} (uid=${coach.uid})`);

let ok = 0, ko = 0;
const ids = [];
for (const { mod } of mods) {
  mod.teacherId = coach.uid;
  const row = _sbModuleToRow(mod);
  const r = await rest(coach.token, 'POST', 'modules', { body: row, prefer: 'return=minimal' });
  if (r.ok) { ok++; ids.push(mod.id); }
  else { ko++; console.error(`  ✗ ${mod.name} → ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`); }
}

const manifest = `import-academie-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(manifest, JSON.stringify({ at: new Date().toISOString(), coach: me.data[0].email, ids }, null, 1));
console.log(`\n✓ ${ok} modules importes${ko ? `, ${ko} en echec` : ''}.`);
console.log(`  Manifeste : ${manifest}`);
console.log(`  Pour tout annuler : node --env-file=.env tools/import-academie.mjs --undo ${manifest}`);
