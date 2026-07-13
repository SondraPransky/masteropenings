// ════════════════════════════════════════════════════════════
//  EECoach — GATE de release : validation CONNECTEE reelle Supabase
//  (roadmap CLAUDE.md §6 #7). Exerce le VRAI aller-retour reseau
//  (auth + REST/PostgREST, RLS incluse) sur 2 comptes : eleve + coach.
//
//  Ce que ca prouve :
//   - eleve : bases (profiles.extra), mastery, parties (insert/update/read),
//             partage, results, practice  → write PUIS read confirmes en ligne.
//   - coach : lecture des parties PARTAGEES d'un eleve de SA classe
//             (my_student_ids + policy games_read) ; annotation (games_update).
//   - RLS negatif : le coach NE voit PAS les parties non partagees ;
//                   le coach NE PEUT PAS annoter une partie non partagee.
//
//  Aucune dependance npm : on tape les endpoints HTTP Supabase via fetch natif
//  (exactement ce que fait supabase-js). Les mappers viennent de lib/dbmap.js
//  → lignes SQL identiques a l'app.
//
//  PREREQUIS (deja faits cote Supabase pour cette gate) :
//   - alter table profiles add column if not exists extra jsonb default '{}';
//   - supabase/migration-006-shared-games.sql
//
//  LANCEMENT :
//   1) Creer 2 comptes de test sur le site live : un COACH (role teacher)
//      et un ELEVE (role student). Confirmer les emails si demande.
//   2) Renseigner dans .env (gitignore) :
//        GATE_COACH_EMAIL=...      GATE_COACH_PWD=...
//        GATE_STUDENT_EMAIL=...    GATE_STUDENT_PWD=...
//   3) node --env-file=.env tests/gate/gate.mjs      (ou npm run gate)
//
//  Le script CREE puis SUPPRIME ses propres donnees (classe, parties,
//  results, practice) et RESTAURE profiles.extra / mastery de l'eleve.
// ════════════════════════════════════════════════════════════

import {
  _sbGameToRow, _sbRowToGame,
  _sbResultToRow, _sbRowToResult,
  _sbPracticeToRow, _sbRowToPractice,
  _sbModuleToRow, _sbRowToModule,
  _sbClassToRow, _sbRowToClass,
} from '../../lib/dbmap.js';

// ── Config Supabase (cle PUBLIQUE, identique a app.js) ──────
const SUPABASE_URL = 'https://smoftbuyejoyxlonhjcu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Bn0asUgcNYPYA1wnl9bokw_k1xshFC4';

const {
  GATE_COACH_EMAIL, GATE_COACH_PWD,
  GATE_STUDENT_EMAIL, GATE_STUDENT_PWD,
} = process.env;

if (!GATE_COACH_EMAIL || !GATE_COACH_PWD || !GATE_STUDENT_EMAIL || !GATE_STUDENT_PWD) {
  console.error(
    '\n✗ Variables manquantes. Renseigne dans .env (gitignore) :\n' +
    '    GATE_COACH_EMAIL / GATE_COACH_PWD (compte role=teacher)\n' +
    '    GATE_STUDENT_EMAIL / GATE_STUDENT_PWD (compte role=student)\n' +
    '  puis : node --env-file=.env tests/gate/gate.mjs\n'
  );
  process.exit(2);
}

// ── Helpers HTTP ────────────────────────────────────────────
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

// REST/PostgREST : renvoie { status, data }. Ne throw pas (on teste les codes).
async function rest(token, method, pathAndQuery, { body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, ok: r.ok, data };
}

// ── Rapport ─────────────────────────────────────────────────
let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; results.push(['✓', name]); }
  else { failed++; results.push(['✗', name + (detail ? `  → ${detail}` : '')]); }
}

// Ids uniques (bigint) pour les lignes creees.
const uid53 = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

// ── Main ────────────────────────────────────────────────────
const created = { games: [], classId: null, resultTs: null, practiceTs: null, moduleId: null, coachResultTs: null, coachPracticeTs: null };
let coach, student, studentProfile, origExtra, origMastery;

async function run() {
  console.log('→ Connexion des 2 comptes…');
  coach = await signIn(GATE_COACH_EMAIL, GATE_COACH_PWD);
  student = await signIn(GATE_STUDENT_EMAIL, GATE_STUDENT_PWD);
  console.log(`  coach uid=${coach.uid}\n  eleve uid=${student.uid}`);

  // Roles corrects ? (l'eleve lit son propre profil)
  {
    const me = await rest(student.token, 'GET', `profiles?id=eq.${student.uid}&select=role,pseudo,email,extra,mastery`);
    studentProfile = me.data?.[0];
    check('eleve : lecture de son profil', me.ok && !!studentProfile, `${me.status}`);
    check('eleve : role=student', studentProfile?.role === 'student', `role=${studentProfile?.role}`);
    origExtra = studentProfile?.extra ?? {};
    origMastery = studentProfile?.mastery ?? {};
  }
  {
    const me = await rest(coach.token, 'GET', `profiles?id=eq.${coach.uid}&select=role`);
    check('coach : role=teacher', me.data?.[0]?.role === 'teacher', `role=${me.data?.[0]?.role}`);
  }

  // ── Bootstrap : classe du coach contenant l'eleve ──────────
  // my_student_ids() matche classes.students (?|) contre [lower(pseudo),lower(email)].
  const memberKey = (studentProfile?.email || GATE_STUDENT_EMAIL).toLowerCase();
  created.classId = uid53();
  {
    const ins = await rest(coach.token, 'POST', 'classes', {
      body: {
        id: created.classId, teacher_id: coach.uid, name: 'GATE-temp',
        module_ids: [], students: [memberKey], individual: false, extra: {},
      },
      prefer: 'return=representation',
    });
    check('coach : creation classe (bootstrap)', ins.ok, `${ins.status} ${JSON.stringify(ins.data)}`);
  }

  // ── 1. BASES (profiles.extra) — _sbSaveBases / _sbLoadBases ─
  const testBase = { id: uid53(), name: 'GATE base', created: Date.now() };
  {
    const up = await rest(student.token, 'PATCH', `profiles?id=eq.${student.uid}`,
      { body: { extra: { bases: [testBase] } }, prefer: 'return=representation' });
    check('eleve : write bases (profiles.extra)', up.ok, `${up.status}`);
    const rd = await rest(student.token, 'GET', `profiles?id=eq.${student.uid}&select=extra`);
    const bases = rd.data?.[0]?.extra?.bases || [];
    check('eleve : read bases (round-trip)', bases.some(b => b.id === testBase.id));
  }

  // ── 2. MASTERY — _sbSaveMastery / _sbLoadMastery ───────────
  const masteryKey = `gate:${created.classId}`;
  {
    const merged = { ...origMastery, [masteryKey]: { ef: 2.5, reps: 1, ts: Date.now() } };
    const up = await rest(student.token, 'PATCH', `profiles?id=eq.${student.uid}`,
      { body: { mastery: merged }, prefer: 'return=representation' });
    check('eleve : write mastery', up.ok, `${up.status}`);
    const rd = await rest(student.token, 'GET', `profiles?id=eq.${student.uid}&select=mastery`);
    check('eleve : read mastery (round-trip)', !!rd.data?.[0]?.mastery?.[masteryKey]);
  }

  // ── 3. PARTIE bibliotheque (drill_id=null) — _sbSaveGame ────
  const gameId = uid53();
  created.games.push(gameId);
  const PGN_STUDENT = '[White "Eleve"]\n[Black "Adversaire"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0';
  {
    const rec = {
      id: gameId, drillId: null, studentId: student.uid, studentEmail: GATE_STUDENT_EMAIL,
      side: 'white', level: null, pgn: PGN_STUDENT, result: '1-0', ts: Date.now(),
      baseId: testBase.id, nature: 'partie', shared: false, reviewedAt: null, student: 'Eleve',
    };
    const ins = await rest(student.token, 'POST', 'games',
      { body: _sbGameToRow(rec), prefer: 'return=representation' });
    check('eleve : insert partie (drill_id=null)', ins.ok, `${ins.status} ${JSON.stringify(ins.data)}`);
    const rd = await rest(student.token, 'GET', `games?student_id=eq.${student.uid}&id=eq.${gameId}&select=*`);
    const g = rd.data?.[0] ? _sbRowToGame(rd.data[0]) : null;
    check('eleve : read sa partie (round-trip)', g?.baseId === String(testBase.id) && g?.nature === 'partie', JSON.stringify(g));
  }

  // ── 4. RLS negatif : coach NE voit PAS la partie non partagee ─
  {
    const rd = await rest(coach.token, 'GET', `games?drill_id=is.null&select=id,student_id,extra`);
    const seen = (rd.data || []).some(r => String(r.id) === String(gameId));
    check('RLS : coach ne voit PAS la partie non partagee', rd.ok && !seen, `status=${rd.status} seen=${seen}`);
  }

  // ── 4b. RLS negatif : coach NE PEUT PAS annoter une non-partagee ─
  {
    const up = await rest(coach.token, 'PATCH', `games?id=eq.${gameId}`,
      { body: { pgn: 'HACK' }, prefer: 'return=representation' });
    // RLS bloque → 0 ligne renvoyee (200 + []), ou 403/401.
    const changed = up.ok && Array.isArray(up.data) && up.data.length > 0;
    check('RLS : coach ne peut PAS annoter une partie non partagee', !changed, `status=${up.status} rows=${Array.isArray(up.data) ? up.data.length : '?'}`);
  }

  // ── 5. PARTAGE — toggleShareGame → _sbUpdateGame (UPDATE) ───
  {
    const rec = {
      id: gameId, drillId: null, studentId: student.uid, studentEmail: GATE_STUDENT_EMAIL,
      side: 'white', level: null, pgn: PGN_STUDENT, result: '1-0', ts: Date.now(),
      baseId: testBase.id, nature: 'partie', shared: true, reviewedAt: null, student: 'Eleve',
    };
    const up = await rest(student.token, 'PATCH', `games?id=eq.${gameId}`,
      { body: _sbGameToRow(rec), prefer: 'return=representation' });
    check('eleve : partage (update extra.shared=true)', up.ok && up.data?.length === 1, `${up.status}`);
  }

  // ── 6. Coach LIT la partie partagee (my_student_ids + games_read) ─
  {
    const rd = await rest(coach.token, 'GET', `games?drill_id=is.null&select=*`);
    const row = (rd.data || []).find(r => String(r.id) === String(gameId));
    check('coach : LIT la partie partagee de son eleve', !!row, `status=${rd.status} vues=${(rd.data||[]).length}`);
    check('coach : partie partagee bien decodee', row && _sbRowToGame(row).shared === true);
  }

  // ── 7. Coach ANNOTE (games_update) → _reviewSaveDone / _sbUpdateGame ─
  const ANNOTATED = PGN_STUDENT.replace('a6 1-0', 'a6 { [%author coach] mieux vaut Ba4 } 1-0');
  {
    const up = await rest(coach.token, 'PATCH', `games?id=eq.${gameId}`,
      { body: { pgn: ANNOTATED, extra: { student: 'Eleve', base_id: String(testBase.id), nature: 'partie', shared: true, reviewed_at: Date.now() } },
        prefer: 'return=representation' });
    check('coach : annote la partie partagee (games_update)', up.ok && up.data?.length === 1, `${up.status} ${JSON.stringify(up.data)}`);
  }

  // ── 8. L'eleve REVOIT l'annotation du coach ────────────────
  {
    const rd = await rest(student.token, 'GET', `games?id=eq.${gameId}&select=*`);
    const g = rd.data?.[0] ? _sbRowToGame(rd.data[0]) : null;
    check("eleve : revoit l'annotation du coach", g?.pgn?.includes('%author coach') && !!g?.reviewedAt, JSON.stringify(g?.reviewedAt));
  }

  // ── 9. RESULTS — recordResult ──────────────────────────────
  {
    const rec = {
      drillId: null, drillName: 'GATE', studentId: student.uid, studentEmail: GATE_STUDENT_EMAIL,
      studentPseudo: studentProfile?.pseudo || null, student: 'Eleve',
      san: 'Bb5', comment: null, correct: true, posIdx: 0, ts: Date.now(),
    };
    created.resultTs = rec.ts;
    const ins = await rest(student.token, 'POST', 'results',
      { body: _sbResultToRow(rec), prefer: 'return=representation' });
    check('eleve : insert result', ins.ok, `${ins.status} ${JSON.stringify(ins.data)}`);
    const rd = await rest(student.token, 'GET', `results?student_id=eq.${student.uid}&ts=eq.${rec.ts}&select=*`);
    check('eleve : read result (round-trip)', (rd.data?.length || 0) >= 1);
  }

  // ── 10. PRACTICE — recordPracticeSession ───────────────────
  {
    const rec = {
      drillId: null, drillName: 'GATE', studentId: student.uid, studentEmail: GATE_STUDENT_EMAIL,
      studentPseudo: studentProfile?.pseudo || null, student: 'Eleve',
      pct: 80, sessionIdx: 0, ts: Date.now(),
    };
    created.practiceTs = rec.ts;
    const ins = await rest(student.token, 'POST', 'practice',
      { body: _sbPracticeToRow(rec), prefer: 'return=representation' });
    check('eleve : insert practice', ins.ok, `${ins.status} ${JSON.stringify(ins.data)}`);
    const rd = await rest(student.token, 'GET', `practice?student_id=eq.${student.uid}&ts=eq.${rec.ts}&select=*`);
    check('eleve : read practice (round-trip)', (rd.data?.length || 0) >= 1);
  }

  // ── 11. MODULE : paquet d'exercices MULTI-COUPS — _sbSaveModule ─
  //  Le vrai trou de couverture depuis le 12/07 : les paquets tactiques/mats
  //  vivent dans modules.sessions (jsonb) avec kp.line = sequence SAN complete.
  //  On prouve que sessions[].kps[].line survit write→read en ligne (coach).
  {
    created.moduleId = uid53();
    const LINE = ['Qh5', 'Nf6', 'Qxf7#'];   // mat en 2 (3 demi-coups, finit sur le coup de l'eleve)
    const kp = {
      fen: 'rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 1',
      san: 'Qh5', altSans: [], comment: 'Menace mat du berger',
      isCapture: false, isCastle: false, isCheck: false, line: LINE,
    };
    const mod = {
      id: created.moduleId, teacherId: coach.uid, name: 'GATE paquet exos',
      level: 'Intermédiaire', side: 'w', mode: 'flash', varmode: null, tree: {},
      sessions: [{ label: 'Exercices', startFen: 'start', moves: [], kps: [kp] }],
      hideComments: false, personal: false, deadline: null,
      isExercise: true, exType: 'fourchette', created: new Date().toLocaleDateString('fr-FR'),
    };
    const row = _sbModuleToRow(mod);
    row.teacher_id = coach.uid;   // proprietaire (RLS), comme _sbSaveModule
    const ins = await rest(coach.token, 'POST', 'modules',
      { body: row, prefer: 'return=representation' });
    check('coach : insert paquet exercices (modules)', ins.ok, `${ins.status} ${JSON.stringify(ins.data)}`);

    const rd = await rest(coach.token, 'GET', `modules?id=eq.${created.moduleId}&select=*`);
    const m = rd.data?.[0] ? _sbRowToModule(rd.data[0]) : null;
    const gotLine = m?.sessions?.[0]?.kps?.[0]?.line;
    check('coach : read paquet (round-trip module)', !!m && m.isExercise === true, JSON.stringify(m?.isExercise));
    check('coach : kp.line multi-coups intacte (jsonb)',
      Array.isArray(gotLine) && gotLine.join(' ') === LINE.join(' '),
      JSON.stringify(gotLine));
    check('coach : type de tactique (extra.exType) round-trip', m?.exType === 'fourchette', JSON.stringify(m?.exType));
  }

  // ── 12. PARTIE Lichess : PGN reel (en-tetes + %clk) round-trip ─
  //  L'import Lichess pousse un PGN complet dans games.pgn (colonne text).
  //  On prouve qu'un PGN annote (commentaires horloge, en-tetes) revient
  //  a l'octet pres — c'est le contenu que _sbSaveGame/_sbLoadStudentGames manipulent.
  {
    const gameId = uid53();
    created.games.push(gameId);
    const LICHESS_PGN =
      '[Event "Rated Blitz game"]\n[Site "https://lichess.org/q7ZvsdUF"]\n' +
      '[White "alice"]\n[Black "bob"]\n[Result "1-0"]\n[WhiteElo "1523"]\n[BlackElo "1498"]\n' +
      '[TimeControl "300+3"]\n[Opening "Italian Game"]\n\n' +
      '1. e4 { [%clk 0:05:00] } e5 { [%clk 0:05:00] } ' +
      '2. Nf3 { [%clk 0:04:58] } Nc6 { [%clk 0:04:57] } ' +
      '3. Bc4 { [%clk 0:04:55] } Bc5 { [%clk 0:04:54] } 1-0';
    const rec = {
      id: gameId, drillId: null, studentId: student.uid, studentEmail: GATE_STUDENT_EMAIL,
      side: 'white', level: null, pgn: LICHESS_PGN, result: '1-0', ts: Date.now(),
      baseId: testBase.id, nature: 'partie', shared: false, reviewedAt: null, student: 'Eleve',
    };
    const ins = await rest(student.token, 'POST', 'games',
      { body: _sbGameToRow(rec), prefer: 'return=representation' });
    check('eleve : insert partie Lichess (PGN annote)', ins.ok, `${ins.status}`);
    const rd = await rest(student.token, 'GET', `games?id=eq.${gameId}&select=*`);
    const g = rd.data?.[0] ? _sbRowToGame(rd.data[0]) : null;
    check('eleve : PGN Lichess round-trip a l\'identique', g?.pgn === LICHESS_PGN,
      g ? `len ${g.pgn?.length} vs ${LICHESS_PGN.length}` : 'null');
  }

  // ── 13. OUTILLAGE COACH : classes.extra (revisions ciblees + echeances) ─
  //  Le gros chantier coach (dashboard/points faibles/revisions ciblees) ecrit
  //  dans classes.extra (jsonb) : targetedReviews (assignation ciblee coach->eleve)
  //  + deadlines (echeance par module). On prouve le round-trip connecte + la
  //  lecture RLS par l'eleve (classes_read : membre de la classe).
  {
    const clsObj = {
      id: created.classId, teacherId: coach.uid, name: 'GATE-temp',
      moduleIds: [String(created.moduleId)], students: [memberKey], individual: false,
      moduleDeadlines: { [String(created.moduleId)]: '2026-09-01' },
      targetedReviews: [{
        drillId: String(created.moduleId), drillName: 'GATE paquet exos',
        san: 'Qh5', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w', // fen indicatif
        comment: 'Revois cette fourchette', students: [memberKey],
      }],
    };
    const up = await rest(coach.token, 'PATCH', `classes?id=eq.${created.classId}`,
      { body: _sbClassToRow(clsObj), prefer: 'return=representation' });
    check('coach : write revisions ciblees + echeances (classes.extra)', up.ok && up.data?.length === 1, `${up.status} ${JSON.stringify(up.data)}`);

    const rdC = await rest(coach.token, 'GET', `classes?id=eq.${created.classId}&select=*`);
    const cC = rdC.data?.[0] ? _sbRowToClass(rdC.data[0]) : null;
    check('coach : echeance par module round-trip', cC?.moduleDeadlines?.[String(created.moduleId)] === '2026-09-01', JSON.stringify(cC?.moduleDeadlines));
    check('coach : revision ciblee round-trip', cC?.targetedReviews?.[0]?.san === 'Qh5', JSON.stringify(cC?.targetedReviews?.[0]?.san));

    // L'eleve (membre) LIT la classe et voit sa revision ciblee (RLS classes_read).
    const rdS = await rest(student.token, 'GET', `classes?id=eq.${created.classId}&select=*`);
    const cS = rdS.data?.[0] ? _sbRowToClass(rdS.data[0]) : null;
    check('eleve : LIT sa classe (RLS classes_read)', !!cS, `status=${rdS.status} vues=${(rdS.data||[]).length}`);
    check('eleve : voit la revision ciblee de son coach', cS?.targetedReviews?.some(r => r.san === 'Qh5'), JSON.stringify(cS?.targetedReviews?.length));
  }

  // ── 14. COACH lit result/practice de son eleve (RLS via drill_id du module) ─
  //  _sbLoadTeacherResults/Practice filtrent par drill_id IN (modules du coach).
  //  Policy results_read/practice_read : le coach lit si drill_id est un de ses
  //  modules. On rattache un result + une practice au module du coach (test 11).
  {
    const rRec = {
      drillId: String(created.moduleId), drillName: 'GATE paquet exos', studentId: student.uid,
      studentEmail: GATE_STUDENT_EMAIL, studentPseudo: studentProfile?.pseudo || null, student: 'Eleve',
      san: 'Qh5', comment: null, correct: true, posIdx: 0, ts: Date.now(),
    };
    created.coachResultTs = rRec.ts;
    const insR = await rest(student.token, 'POST', 'results', { body: _sbResultToRow(rRec), prefer: 'return=representation' });
    check('eleve : insert result rattache au module coach', insR.ok, `${insR.status}`);
    const rdR = await rest(coach.token, 'GET', `results?drill_id=eq.${created.moduleId}&select=*`);
    const seenR = (rdR.data || []).some(r => String(r.ts) === String(rRec.ts));
    check('coach : LIT le result de son eleve (RLS drill_id)', rdR.ok && seenR, `status=${rdR.status} vues=${(rdR.data||[]).length}`);

    const pRec = {
      drillId: String(created.moduleId), drillName: 'GATE paquet exos', studentId: student.uid,
      studentEmail: GATE_STUDENT_EMAIL, studentPseudo: studentProfile?.pseudo || null, student: 'Eleve',
      pct: 90, sessionIdx: 0, ts: Date.now() + 1,
    };
    created.coachPracticeTs = pRec.ts;
    const insP = await rest(student.token, 'POST', 'practice', { body: _sbPracticeToRow(pRec), prefer: 'return=representation' });
    check('eleve : insert practice rattachee au module coach', insP.ok, `${insP.status}`);
    const rdP = await rest(coach.token, 'GET', `practice?drill_id=eq.${created.moduleId}&select=*`);
    const seenP = (rdP.data || []).some(r => String(r.ts) === String(pRec.ts));
    check('coach : LIT la practice de son eleve (RLS drill_id)', rdP.ok && seenP, `status=${rdP.status} vues=${(rdP.data||[]).length}`);
  }
}

// ── Nettoyage : supprime tout ce que la gate a cree ─────────
async function cleanup() {
  console.log('\n→ Nettoyage…');
  try {
    for (const id of created.games) {
      await rest(student.token, 'DELETE', `games?id=eq.${id}`);
    }
    if (created.resultTs) await rest(student.token, 'DELETE', `results?student_id=eq.${student.uid}&ts=eq.${created.resultTs}`);
    if (created.coachResultTs) await rest(student.token, 'DELETE', `results?student_id=eq.${student.uid}&ts=eq.${created.coachResultTs}`);
    if (created.practiceTs) await rest(student.token, 'DELETE', `practice?student_id=eq.${student.uid}&ts=eq.${created.practiceTs}`);
    if (created.coachPracticeTs) await rest(student.token, 'DELETE', `practice?student_id=eq.${student.uid}&ts=eq.${created.coachPracticeTs}`);
    if (created.classId) await rest(coach.token, 'DELETE', `classes?id=eq.${created.classId}`);
    if (created.moduleId) await rest(coach.token, 'DELETE', `modules?id=eq.${created.moduleId}`);
    // Restaure profiles.extra / mastery de l'eleve.
    if (student) {
      await rest(student.token, 'PATCH', `profiles?id=eq.${student.uid}`,
        { body: { extra: origExtra ?? {}, mastery: origMastery ?? {} } });
    }
    console.log('  ok');
  } catch (e) {
    console.error('  ⚠ nettoyage partiel :', e.message);
  }
}

// ── Entree ──────────────────────────────────────────────────
try {
  await run();
} catch (e) {
  failed++;
  results.push(['✗', `ERREUR FATALE : ${e.message}`]);
} finally {
  if (coach && student) await cleanup();
}

console.log('\n════════ GATE SUPABASE — RESULTATS ════════');
for (const [mark, name] of results) console.log(`  ${mark} ${name}`);
console.log(`\n  ${passed} OK · ${failed} KO`);
console.log(failed === 0
  ? '\n✅ GATE VERTE — aller-retour reseau connecte confirme.\n'
  : '\n❌ GATE ROUGE — voir les lignes ✗ ci-dessus.\n');
process.exit(failed === 0 ? 0 : 1);
