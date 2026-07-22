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
//
//  ⚠ La suppression est irreversible cote Supabase : le script ecrit d'abord les
//  lignes entieres dans tools/backup-<horodatage>.json (PGN inclus), de quoi
//  re-inserer a la main si l'arbitrage etait mauvais.
// ════════════════════════════════════════════════════════════
import { writeFileSync } from 'node:fs';

const SUPABASE_URL = 'https://smoftbuyejoyxlonhjcu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Bn0asUgcNYPYA1wnl9bokw_k1xshFC4';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const FOLDER = flag('--folder');
const DELETE_IDS = (flag('--delete') || '').split(',').map(s => s.trim()).filter(Boolean);
const RENAME_ID = flag('--rename');
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

const inFolder = (res.data || []).filter(r => (r.extra?.folder || '') === FOLDER);
console.log(`=== Dossier « ${FOLDER} » : ${inFolder.length} modules ===\n`);
for (const m of inFolder) {
  const sessions = m.sessions || [];
  const labels = sessions.map(s => s?.label).filter(Boolean);
  console.log(`  id=${m.id}`);
  console.log(`    nom       : ${m.name}`);
  console.log(`    camp      : ${m.side}   varmode: ${m.varmode}`);
  console.log(`    chapitres : ${sessions.length}${labels.length ? ' → ' + labels.join(' | ') : ''}`);
  console.log(`    arbre     : ${Object.keys(m.tree || {}).length} noeuds   pgn: ${(m.pgn || '').length} car.\n`);
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

const after = await rest(token, 'GET', `modules?teacher_id=eq.${uid}&select=id,name,sessions,extra`);
const left = (after.data || []).filter(r => (r.extra?.folder || '') === FOLDER);
console.log(`\n=== Relu depuis Supabase : ${left.length} modules dans « ${FOLDER} » ===`);
left.forEach(m => console.log(`  ✓ ${m.id}  "${m.name}"  (${(m.sessions || []).length} chapitres)`));
process.exit(ko ? 1 : 0);
