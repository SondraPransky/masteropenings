// ════════════════════════════════════════════════════════════
//  EECoach — petit CLI d'administration des modules d'un dossier (Supabase)
//
//  Ne des doublons du fonds ChessBase : certains fichiers de lecon rejouent une
//  lecon deja presente dans le fichier principal (meme arbre, annotations
//  differentes). L'arbitrage se fait A LA MAIN — ce script ne devine rien, il
//  montre, puis n'agit que sur ce qu'on lui nomme explicitement.
//
//  LANCEMENT (simulation par defaut, --apply pour ecrire — patron import-academie)
//    node --env-file=.env tools/modules-admin.mjs --folder "776 - Gambit Mieses"
//        → liste les modules du dossier (id, chapitres, positions)
//    ... --delete <id,id,id> [--apply]
//        → supprime, apres controle de REDONDANCE et sauvegarde JSON complete
//    ... --rename <id> --name "<nouveau nom>" [--apply]
//        → renomme un module (le libelle des chapitres, lui, vient du PGN)
//    ... --move <id> [--apply]
//        → range le module dans le dossier nomme par --folder (extra FUSIONNE,
//          jamais reconstruit — prealable a un --merge inter-dossiers)
//
//  ⚠ La suppression est irreversible cote Supabase : le script ecrit d'abord les
//  lignes entieres dans tools/backup-<horodatage>.json (PGN inclus), de quoi
//  re-inserer a la main si l'arbitrage etait mauvais.
// ════════════════════════════════════════════════════════════
import { writeFileSync } from 'node:fs';
// `Chess` est un global du navigateur (CDN) ; en Node on l'injecte, comme les tests.
const { Chess } = await import('chess.js');
globalThis.Chess = Chess;
// ⚠ On ne REIMPLEMENTE pas la fusion : c'est `buildTreeModule` (le code de l'app,
// celui de l'import) qui fabrique l'arbre fusionne et les sessions. S'il diverge
// un jour, c'est un bug de lib/, pas d'ici.
const { buildTreeModule, _treePlayerPositions } = await import('../lib/tree.js');
const { splitPgnGames } = await import('../lib/core.js');

const SUPABASE_URL = 'https://smoftbuyejoyxlonhjcu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Bn0asUgcNYPYA1wnl9bokw_k1xshFC4';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const FOLDER = flag('--folder');
const DELETE_IDS = (flag('--delete') || '').split(',').map(s => s.trim()).filter(Boolean);
const MERGE_IDS = (flag('--merge') || '').split(',').map(s => s.trim()).filter(Boolean);
const RENAME_ID = flag('--rename');
const MOVE_ID = flag('--move');
const NEW_NAME = flag('--name');
const APPLY = argv.includes('--apply');

if (!FOLDER) {
  console.error('Usage : --folder "<dossier>" [--delete id,id] [--rename <id> --name "<nom>"] [--apply]');
  process.exit(1);
}
if (RENAME_ID && !NEW_NAME) { console.error('--rename exige --name "<nouveau nom>"'); process.exit(1); }

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

const email = process.env.GATE_COACH_EMAIL, pwd = process.env.GATE_COACH_PWD;
if (!email || !pwd) { console.error('GATE_COACH_EMAIL / GATE_COACH_PWD manquants dans .env'); process.exit(1); }
const { token, uid } = await signIn(email, pwd);
console.log(`Connecte : ${email} (${uid})\n`);

const res = await rest(token, 'GET', `modules?teacher_id=eq.${uid}&select=*`);
if (!res.ok) { console.error('Lecture KO', res.status, res.data); process.exit(1); }

// `--all` : balayage de TOUS les dossiers (etat global + garde-fou modules vides).
if (FOLDER === '*') {
  const byFolder = {};
  (res.data || []).forEach(m => { (byFolder[m.extra?.folder || '(sans dossier)'] ||= []).push(m); });
  let vides = 0, chap = 0, pos = 0;
  for (const f of Object.keys(byFolder).sort()) {
    const g = byFolder[f];
    const gPos = g.reduce((a, m) => a + (m.varmode === 'tree' ? _treePlayerPositions(m).length : 0), 0);
    const gChap = g.reduce((a, m) => a + ((m.sessions || []).length || 1), 0);
    chap += gChap; pos += gPos;
    console.log(`  ${f} — ${g.length} module(s), ${gChap} ch., ${gPos} positions`);
    g.forEach(m => {
      if (m.varmode === 'tree' && !_treePlayerPositions(m).length) {
        vides++; console.log(`      ⚠ VIDE : ${m.id} "${m.name}" — 0 position a reviser`);
      }
    });
  }
  console.log(`\nTOTAL : ${(res.data || []).length} modules · ${chap} chapitres · ${pos} positions a reviser`);
  console.log(`Modules a 0 position a reviser : ${vides}${vides ? '  ⚠' : '  ✓'}`);
  process.exit(vides ? 1 : 0);
}

const inFolder = (res.data || []).filter(r => (r.extra?.folder || '') === FOLDER);
console.log(`=== Dossier « ${FOLDER} » : ${inFolder.length} modules ===\n`);
for (const m of inFolder) {
  const sessions = m.sessions || [];
  const labels = sessions.map(s => s?.label).filter(Boolean);
  console.log(`  id=${m.id}`);
  console.log(`    nom       : ${m.name}`);
  console.log(`    camp      : ${m.side}   varmode: ${m.varmode}`);
  console.log(`    chapitres : ${sessions.length}${labels.length ? ' → ' + labels.join(' | ') : ''}`);
  // ⚠ La metrique qui compte est `_treePlayerPositions`, JAMAIS le nombre de
  // noeuds : c'est la confusion entre les deux qui a masque les modules vides
  // de juillet (carte flatteuse, drill qui ne proposait rien).
  const pos = m.varmode === 'tree' ? _treePlayerPositions(m).length : null;
  console.log(`    arbre     : ${Object.keys(m.tree || {}).length} noeuds   pgn: ${(m.pgn || '').length} car.`);
  console.log(`    a reviser : ${pos == null ? 'n/a' : pos + ' positions'}${pos === 0 ? '   ⚠ MODULE VIDE' : ''}\n`);
}

// ── Rangement d'un module dans le dossier nomme ──────────────────────────────
// Cherche l'id PARTOUT (c'est le point : il n'est pas encore dans --folder).
// ⚠ `extra` est relu puis FUSIONNE, jamais reconstruit de zero (le piege
// `_sbModuleToRow` documente : reconstruire perdrait les autres cles).
if (MOVE_ID) {
  const m = (res.data || []).find(x => String(x.id) === String(MOVE_ID));
  if (!m) { console.error(`⚠ ARRET : id ${MOVE_ID} introuvable dans le compte`); process.exit(1); }
  console.log(`=== ${APPLY ? 'RANGEMENT' : 'SIMULATION de rangement'} ===`);
  console.log(`  id=${m.id}  "${m.name}"`);
  console.log(`    dossier avant : ${m.extra?.folder || '(sans dossier)'}`);
  console.log(`    dossier apres : ${FOLDER}`);
  if (!APPLY) { console.log('\n(simulation — relancer avec --apply pour ecrire)'); process.exit(0); }
  const extra = { ...(m.extra || {}), folder: FOLDER };
  const up = await rest(token, 'PATCH', `modules?id=eq.${m.id}&teacher_id=eq.${uid}`,
    { body: { extra }, prefer: 'return=representation' });
  console.log(`  PATCH → ${up.status} ${up.ok ? 'OK, extra = ' + JSON.stringify(up.data?.[0]?.extra) : JSON.stringify(up.data)}`);
  process.exit(up.ok ? 0 : 1);
}

// ── Garde-fou : ce qu'on supprime est-il VRAIMENT redondant ? ────────────────
// Un doublon n'en est un que si toutes ses positions existent deja ailleurs.
// On compare les CLES de l'arbre (normFen_san) : c'est l'unite de maitrise, donc
// exactement ce qu'un eleve perdrait. Une seule position orpheline suffit a
// transformer « nettoyage » en « perte de contenu ».
if (DELETE_IDS.length) {
  const keep = inFolder.filter(m => !DELETE_IDS.includes(String(m.id)));
  const keepKeys = new Set(keep.flatMap(m => Object.keys(m.tree || {})));
  console.log(`=== Redondance : ${keepKeys.size} positions conservees au total ===`);
  for (const m of inFolder.filter(m => DELETE_IDS.includes(String(m.id)))) {
    const keys = Object.keys(m.tree || {});
    const orphans = keys.filter(k => !keepKeys.has(k));
    const pct = keys.length ? Math.round((keys.length - orphans.length) / keys.length * 100) : 100;
    console.log(`  ${m.id} "${m.name}" : ${keys.length} positions, ${pct} % deja conservees` +
      (orphans.length ? `  ⚠ ${orphans.length} ORPHELINES` : '  ✓ redondant'));
    if (orphans.length) orphans.slice(0, 5).forEach(o => console.log(`      orpheline : ${o}`));
  }
  console.log('');
}

// ── Fusion de N modules en UN module a N chapitres ──────────────────────────
// Contrairement a --delete (qui jette du redondant), ici le contenu est DISTINCT :
// des lecons d'une meme serie que l'import a eclatees parce qu'elles vivaient dans
// des fichiers separes. On recolle les PGN dans l'ordre donne et on laisse
// `buildTreeModule` fabriquer l'arbre fusionne + une session par partie.
//
// ⚠ On GARDE l'id du premier module : la cle de maitrise Leitner est
// `${eleve}_${drillId}_${normFen}_${san}`, donc conserver l'id preserve son
// historique SR. Celui des modules absorbes devient orphelin (benin avant
// lancement, mais c'est une raison de fusionner TOT).
if (MERGE_IDS.length) {
  if (MERGE_IDS.length < 2) { console.error('--merge exige au moins 2 ids'); process.exit(1); }
  const src = MERGE_IDS.map(id => inFolder.find(m => String(m.id) === id));
  const bad = MERGE_IDS.filter((id, i) => !src[i]);
  if (bad.length) { console.error(`⚠ ARRET : ids introuvables dans « ${FOLDER} » : ${bad.join(', ')}`); process.exit(1); }

  const sides = [...new Set(src.map(m => m.side))];
  if (sides.length > 1) {
    console.error(`⚠ ARRET : camps differents (${sides.join(', ')}) — fusionner changerait les coups attendus`);
    process.exit(1);
  }

  const head = src[0];
  // BOM en tete de fichier ChessBase : retire, sinon il se retrouve au milieu du
  // PGN recolle et brouille le decoupage des parties.
  const pgn = src.map(m => (m.pgn || '').replace(/^﻿/, '').trim()).join('\n\n');
  const chunks = splitPgnGames(pgn);
  console.log(`=== ${APPLY ? 'FUSION' : 'SIMULATION de fusion'} ===`);
  console.log(`  Sources (dans cet ordre) :`);
  src.forEach(m => console.log(`    ${m.id}  "${m.name}"  ${Object.keys(m.tree || {}).length} noeuds`));
  console.log(`  PGN recolle : ${pgn.length} car. → ${chunks.length} parties detectees`);
  if (chunks.length !== src.length) {
    console.error(`\n⚠ ARRET : ${chunks.length} parties pour ${src.length} modules.`);
    console.error('  Le recollage n\'a pas produit un chapitre par module (en-tete [Event] manquant ?).');
    process.exit(1);
  }

  const merged = buildTreeModule({
    id: head.id, name: NEW_NAME || head.name, pgn,
    side: head.side, level: head.level,
    deadline: head.deadline, hideComments: head.hideComments,
  });
  if (!merged) { console.error('⚠ ARRET : buildTreeModule n\'a rien produit'); process.exit(1); }

  const sumNodes = src.reduce((a, m) => a + Object.keys(m.tree || {}).length, 0);
  const mergedNodes = Object.keys(merged.tree).length;
  console.log(`\n  Resultat : "${merged.name}"  (id ${merged.id} conserve → historique SR preserve)`);
  console.log(`    chapitres : ${merged.sessions.length}`);
  merged.sessions.forEach((s, i) => console.log(`      ch.${i + 1} : ${s.label}`));
  console.log(`    arbre : ${mergedNodes} noeuds  (somme des sources : ${sumNodes}` +
    `${mergedNodes < sumNodes ? `, dont ${sumNodes - mergedNodes} en commun — les chapitres se recouvrent` : ''})`);
  console.log(`    absorbes puis supprimes : ${src.slice(1).map(m => m.id).join(', ')}`);

  if (!APPLY) { console.log('\n(simulation — relancer avec --apply pour ecrire)'); process.exit(0); }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `tools/backup-${stamp}.json`;
  writeFileSync(backup, JSON.stringify(src, null, 2), 'utf8');
  console.log(`\nSauvegarde des ${src.length} modules sources → ${backup}`);

  // PATCH cible : on ne touche QUE ce qui change. ⚠ Ne pas passer par
  // `_sbModuleToRow`, qui reconstruit `extra` de zero et perdrait le dossier.
  const up = await rest(token, 'PATCH', `modules?id=eq.${head.id}&teacher_id=eq.${uid}`,
    { body: { name: merged.name, pgn: merged.pgn, tree: merged.tree, sessions: merged.sessions } });
  console.log(`  PATCH ${head.id} → ${up.status} ${up.ok ? 'OK' : JSON.stringify(up.data)}`);
  if (!up.ok) { console.error('  (rien supprime : la fusion a echoue)'); process.exit(1); }

  for (const m of src.slice(1)) {
    const d = await rest(token, 'DELETE', `modules?id=eq.${m.id}&teacher_id=eq.${uid}`);
    console.log(`  DELETE ${m.id} → ${d.status} ${d.ok ? 'OK' : JSON.stringify(d.data)}`);
  }

  // Les analyses OA (oa_analyses) des modules absorbes suivent la fusion : sans
  // re-cle, elles deviennent des entrees FANTOMES dans la section « Analyse
  // d'ouvertures » (leur module n'existe plus). Le module fusionne etant un
  // surensemble des positions analysees, l'analyse reste valable telle quelle
  // (le worker la rafraichira au prochain run, cache FEN-4 → quasi gratuit).
  // Si la tete a DEJA une analyse, on n'ecrase rien : on signale, arbitrage humain.
  const oaHead = await rest(token, 'GET', `oa_analyses?module_id=eq.${head.id}&teacher_id=eq.${uid}&select=module_id`);
  for (const m of src.slice(1)) {
    const oa = await rest(token, 'GET', `oa_analyses?module_id=eq.${m.id}&teacher_id=eq.${uid}&select=module_id`);
    if (!(oa.data || []).length) continue;
    if ((oaHead.data || []).length) {
      console.log(`  ⚠ analyse OA de ${m.id} NON re-clee : ${head.id} en a deja une (arbitrer a la main)`);
      continue;
    }
    const rk = await rest(token, 'PATCH', `oa_analyses?module_id=eq.${m.id}&teacher_id=eq.${uid}`,
      { body: { module_id: head.id } });
    console.log(`  RE-CLE analyse OA ${m.id} → ${head.id} : ${rk.status} ${rk.ok ? 'OK' : JSON.stringify(rk.data)}`);
  }

  const after = await rest(token, 'GET', `modules?teacher_id=eq.${uid}&select=id,name,sessions,extra`);
  const left = (after.data || []).filter(r => (r.extra?.folder || '') === FOLDER);
  console.log(`\n=== Relu depuis Supabase : ${left.length} module(s) dans « ${FOLDER} » ===`);
  left.forEach(m => {
    console.log(`  ✓ ${m.id}  "${m.name}"  (${(m.sessions || []).length} chapitres)`);
    (m.sessions || []).forEach((s, i) => console.log(`      ch.${i + 1} : ${s.label}`));
  });
  process.exit(0);
}

// ── Renommage d'un module ───────────────────────────────────────────────────
// Ne touche QUE `name`. Les libelles de chapitre vivent dans sessions[].label et
// sont derives des en-tetes du PGN (gameModuleName) : les reecrire ici les ferait
// diverger de leur source des la prochaine edition.
if (RENAME_ID) {
  const m = inFolder.find(x => String(x.id) === String(RENAME_ID));
  if (!m) { console.error(`⚠ ARRET : id ${RENAME_ID} introuvable dans « ${FOLDER} »`); process.exit(1); }
  console.log(`=== ${APPLY ? 'RENOMMAGE' : 'SIMULATION de renommage'} ===`);
  console.log(`  id=${m.id}`);
  console.log(`    avant : ${m.name}`);
  console.log(`    apres : ${NEW_NAME}`);
  console.log(`    (les ${(m.sessions || []).length} libelles de chapitre sont inchanges — ils viennent du PGN)`);
  if (!APPLY) { console.log('\n(simulation — relancer avec --apply pour ecrire)'); process.exit(0); }
  const up = await rest(token, 'PATCH', `modules?id=eq.${m.id}&teacher_id=eq.${uid}`,
    { body: { name: NEW_NAME }, prefer: 'return=representation' });
  console.log(`  PATCH → ${up.status} ${up.ok ? 'OK' : JSON.stringify(up.data)}`);
  if (!up.ok) process.exit(1);
  const back = await rest(token, 'GET', `modules?id=eq.${m.id}&select=id,name,sessions`);
  const r = (back.data || [])[0];
  console.log(`\n=== Relu depuis Supabase ===`);
  console.log(`  ✓ ${r.id}  "${r.name}"  (${(r.sessions || []).length} chapitres)`);
  (r.sessions || []).forEach((s, i) => console.log(`      ch.${i + 1} : ${s.label}`));
  process.exit(0);
}

if (!DELETE_IDS.length) {
  console.log('(aucun --delete : inspection seule)');
  process.exit(0);
}

const targets = inFolder.filter(m => DELETE_IDS.includes(String(m.id)));
const missing = DELETE_IDS.filter(id => !inFolder.some(m => String(m.id) === id));
if (missing.length) {
  console.error(`\n⚠ ARRET : ids introuvables DANS CE DOSSIER : ${missing.join(', ')}`);
  console.error('  (garde-fou : on ne supprime jamais un id qu\'on n\'a pas relu ici)');
  process.exit(1);
}

console.log(`=== ${APPLY ? 'SUPPRESSION' : 'SIMULATION de suppression'} : ${targets.length} modules ===`);
targets.forEach(m => console.log(`  - ${m.id}  "${m.name}"  (${(m.sessions || []).length} ch., ${Object.keys(m.tree || {}).length} noeuds)`));

const survivors = inFolder.filter(m => !DELETE_IDS.includes(String(m.id)));
console.log(`\n=== Resteraient : ${survivors.length} ===`);
survivors.forEach(m => console.log(`  ✓ ${m.id}  "${m.name}"  (${(m.sessions || []).length} chapitres)`));

if (!APPLY) { console.log('\n(simulation — relancer avec --apply pour ecrire)'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `tools/backup-${stamp}.json`;
writeFileSync(backup, JSON.stringify(targets, null, 2), 'utf8');
console.log(`\nSauvegarde complete (PGN inclus) → ${backup}`);

let ko = 0;
for (const m of targets) {
  const d = await rest(token, 'DELETE', `modules?id=eq.${m.id}&teacher_id=eq.${uid}`);
  console.log(`  DELETE ${m.id} → ${d.status} ${d.ok ? 'OK' : JSON.stringify(d.data)}`);
  if (!d.ok) ko++;
}

// Analyses OA des modules supprimes : sans re-cle elles deviennent des entrees
// FANTOMES de la section « Analyse d'ouvertures ». Quand un survivant du MEME
// dossier couvre le contenu (cas du doublon), on re-cle sur lui ; s'il en a
// deja une, ou s'il n'y a pas de survivant unique, on signale sans rien casser.
const survivor = survivors.length === 1 ? survivors[0] : null;
for (const m of targets) {
  const oa = await rest(token, 'GET', `oa_analyses?module_id=eq.${m.id}&teacher_id=eq.${uid}&select=module_id`);
  if (!(oa.data || []).length) continue;
  if (!survivor) { console.log(`  ⚠ analyse OA de ${m.id} orpheline (pas de survivant unique — arbitrer a la main)`); continue; }
  const oaS = await rest(token, 'GET', `oa_analyses?module_id=eq.${survivor.id}&teacher_id=eq.${uid}&select=module_id`);
  if ((oaS.data || []).length) { console.log(`  ⚠ analyse OA de ${m.id} NON re-clee : ${survivor.id} en a deja une`); continue; }
  const rk = await rest(token, 'PATCH', `oa_analyses?module_id=eq.${m.id}&teacher_id=eq.${uid}`,
    { body: { module_id: survivor.id } });
  console.log(`  RE-CLE analyse OA ${m.id} → ${survivor.id} : ${rk.status} ${rk.ok ? 'OK' : JSON.stringify(rk.data)}`);
}

const after = await rest(token, 'GET', `modules?teacher_id=eq.${uid}&select=id,name,sessions,extra`);
const left = (after.data || []).filter(r => (r.extra?.folder || '') === FOLDER);
console.log(`\n=== Relu depuis Supabase : ${left.length} modules dans « ${FOLDER} » ===`);
left.forEach(m => console.log(`  ✓ ${m.id}  "${m.name}"  (${(m.sessions || []).length} chapitres)`));
process.exit(ko ? 1 : 0);
