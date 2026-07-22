import {
  _sbModuleToRow, _sbRowToModule, _sbClassToRow, _sbRowToClass,
  _sbResultToRow, _sbRowToResult, _sbPracticeToRow, _sbRowToPractice,
  _sbGameToRow, _sbRowToGame
} from '../lib/dbmap.js';

describe('mapping module ↔ ligne SQL', () => {
  const drill = {
    id: 1700000000000,
    teacherId: 'tch-uuid',
    name: 'Espagnole',
    level: 'Intermédiaire',
    side: 'w',
    pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5',
    mode: 'line',
    varmode: 'tree',
    tree: { fen1: { player: ['Bb5'] } },
    sessions: [{ label: 'Arbre complet', moves: [] }],
    hideComments: false,
    personal: false,
    deadline: null,
    updatedAt: 1700000001234,
    created: '27/06/2026',
    fromLibrary: true,
  };

  it('snake_case les clés + stocke les extras dans `extra`', () => {
    const row = _sbModuleToRow(drill);
    expect(row.teacher_id).toBe('tch-uuid');
    expect(row.hide_comments).toBe(false);
    expect(row.updated_at).toBe(1700000001234);
    expect(row.owner_student_id).toBe(null);
    expect(row.extra).toEqual({ created: '27/06/2026', fromLibrary: true, demo: false, isExercise: false, exType: null, folder: null, overlayOf: null, overlayBy: null, plans: [] });
  });

  it('round-trip : les plans de travail survivent à l\'aller-retour extra', () => {
    const plans = [{ id: 'p1', name: 'Plan — 1400', puzzles: ['10'], errors: ['11'] }];
    const back = _sbRowToModule(_sbModuleToRow({ ...drill, plans }));
    expect(back.plans).toEqual(plans);
    // Un module sans plans en ressort avec une liste vide (jamais undefined).
    expect(_sbRowToModule(_sbModuleToRow(drill)).plans).toEqual([]);
  });

  it('round-trip : restitue tous les champs persistés', () => {
    const back = _sbRowToModule(_sbModuleToRow(drill));
    for (const k of ['id','teacherId','name','level','side','pgn','mode','varmode','hideComments','personal','updatedAt','created','fromLibrary']) {
      expect(back[k]).toEqual(drill[k]);
    }
    expect(back.tree).toEqual(drill.tree);
    expect(back.sessions).toEqual(drill.sessions);
  });

  it('module perso élève : ownerStudentId + personal préservés', () => {
    const perso = { id: 42, name: 'Perso', ownerStudentId: 'stu-uuid', personal: true, tree: {}, sessions: [] };
    const back = _sbRowToModule(_sbModuleToRow(perso));
    expect(back.ownerStudentId).toBe('stu-uuid');
    expect(back.personal).toBe(true);
  });

  it('paquet d\'exercices : isExercise + exType (type de tactique) préservés', () => {
    const pk = { id: 7, name: 'Fourchettes', isExercise: true, exType: 'fourchette', tree: {}, sessions: [] };
    const back = _sbRowToModule(_sbModuleToRow(pk));
    expect(back.isExercise).toBe(true);
    expect(back.exType).toBe('fourchette');
    // Absence de type → null (rétrocompat modules existants).
    expect(_sbRowToModule(_sbModuleToRow({ id: 8, name: 'x', tree: {}, sessions: [] })).exType).toBe(null);
  });

  // `extra` est RECONSTRUIT de zéro par _sbModuleToRow : toute clé absente du mapper
  // est perdue au premier upsert. D'où ce round-trip sur overlayOf.
  it('couche d\'édition élève : overlayOf + les 2 propriétaires survivent au round-trip', () => {
    const overlay = { id: 9, name: 'Espagnole', overlayOf: 42,
                      teacherId: 'uid-coach', ownerStudentId: 'uid-eleve', tree: {}, sessions: [] };
    const row  = _sbModuleToRow(overlay);
    // teacher_id ET owner_student_id : c'est ce qui rend la ligne lisible par le coach
    // et éditable par l'élève (les policies RLS sont des OR sur ces 2 colonnes).
    expect(row.teacher_id).toBe('uid-coach');
    expect(row.owner_student_id).toBe('uid-eleve');
    expect(row.extra.overlayOf).toBe(42);
    expect(_sbRowToModule(row).overlayOf).toBe(42);
  });

  // Le coach ne peut PAS lire le profil de ses élèves (profiles_read ne va que de l'élève
  // vers son coach) : sans cette identité dénormalisée dans la ligne, il serait incapable
  // de dire à QUI appartient une couche. Même triplet que `results` → _resultKeys marche dessus.
  it('couche élève : l\'identité dénormalisée survit et garde la forme de _resultKeys', () => {
    const by = { student: 'Test Eleve', studentEmail: 'testeleve@test.com', studentPseudo: 'lea' };
    const back = _sbRowToModule(_sbModuleToRow({ id: 9, name: 'x', overlayOf: 42, overlayBy: by, tree: {}, sessions: [] }));
    expect(back.overlayBy).toEqual(by);
    // La forme est celle qu'attend _resultKeys(r) = [studentEmail, studentPseudo, student]
    expect(Object.keys(back.overlayBy).sort()).toEqual(['student', 'studentEmail', 'studentPseudo']);
  });

  it('un module normal n\'a pas d\'overlayOf (rétrocompat)', () => {
    expect(_sbRowToModule(_sbModuleToRow({ id: 10, name: 'x', tree: {}, sessions: [] })).overlayOf).toBe(null);
    // Ligne existante en base, sans la clé : ne doit pas devenir un overlay fantôme.
    expect(_sbRowToModule({ id: 11, name: 'x', extra: {} }).overlayOf).toBe(null);
  });
});

// Le filtre anti-pollution CLIENT : une couche d'édition élève (overlayOf != null) partage
// des colonnes avec les vrais modules (teacher_id pour le coach, owner_student_id pour l'élève),
// donc les MÊMES requêtes SQL la ramènent. app.js la sépare par `.overlayOf == null` :
//   - _sbLoadTeacherModules : .eq(teacher_id) puis .filter(m => m.overlayOf == null) → « Mes modules »
//   - _sbFetchPersonalModules : .eq(owner_student_id) puis .filter(m => m.overlayOf == null) → perso
//   - _sbFetchStudentOverlays / _sbLoadTeacherOverlays : .filter(m => m.overlayOf != null) → les couches
// La gate connectée prouve que overlayOf survit au round-trip réseau ; ce test prouve que le
// PRÉDICAT partitionne correctement le jeu de lignes mixte (le contenu de ces filtres).
describe('filtre anti-pollution des couches d\'édition (overlayOf)', () => {
  const isModule  = m => m.overlayOf == null;   // le prédicat exact d'app.js
  const isOverlay = m => m.overlayOf != null;

  // Requête coach : .eq('teacher_id', coach) → SES modules + les couches greffées dessus.
  it('côté coach : « Mes modules » exclut les couches, « overlays » ne garde qu\'elles', () => {
    const rows = [
      _sbModuleToRow({ id: 1, teacherId: 'coach', name: 'Espagnole', tree: {}, sessions: [] }),
      _sbModuleToRow({ id: 2, teacherId: 'coach', name: 'Sicilienne', tree: {}, sessions: [] }),
      // une couche d'un élève sur le module 1 : porte teacher_id=coach ET owner_student_id=élève
      _sbModuleToRow({ id: 3, teacherId: 'coach', ownerStudentId: 'eleve', name: 'Espagnole',
                       overlayOf: 1, overlayBy: { student: 'Léa', studentEmail: 'l@x.fr', studentPseudo: 'lea' }, tree: {}, sessions: [] }),
    ].map(_sbRowToModule);

    const mesModules = rows.filter(isModule);
    const overlays   = rows.filter(isOverlay);
    expect(mesModules.map(m => m.id)).toEqual([1, 2]);          // la couche n'y est PAS
    expect(overlays.map(m => m.id)).toEqual([3]);               // et n'apparaît QUE là
    expect(overlays[0].overlayOf).toBe(1);                      // rattachée au bon module coach
  });

  // Requête élève : .eq('owner_student_id', élève) → SES modules perso + SES couches.
  it('côté élève : « Mes révisions perso » exclut les couches', () => {
    const rows = [
      _sbModuleToRow({ id: 10, ownerStudentId: 'eleve', personal: true, name: 'Mon perso', tree: {}, sessions: [] }),
      _sbModuleToRow({ id: 11, ownerStudentId: 'eleve', teacherId: 'coach', name: 'Espagnole', overlayOf: 1, tree: {}, sessions: [] }),
    ].map(_sbRowToModule);

    const perso    = rows.filter(isModule);
    const mesAjouts = rows.filter(isOverlay);
    expect(perso.map(m => m.id)).toEqual([10]);                 // le perso seul, pas la couche
    expect(mesAjouts.map(m => m.id)).toEqual([11]);
    expect(perso[0].personal).toBe(true);
  });
});

describe('mapping classe ↔ ligne SQL', () => {
  const cls = {
    id: 1700000009999,
    teacherId: 'tch-uuid',
    name: '🏫 Groupe A',
    moduleIds: ['1700000000000', '1700000000001'],
    studentEmails: ['toto', 'lea@ex.fr'],
    students: ['toto', 'lea@ex.fr'],
    individual: false,
    created: '27/06/2026',
  };

  it('round-trip : moduleIds + élèves + individual préservés', () => {
    const back = _sbRowToClass(_sbClassToRow(cls));
    expect(back.id).toBe(cls.id);
    expect(back.teacherId).toBe('tch-uuid');
    expect(back.moduleIds).toEqual(cls.moduleIds);
    expect(back.students).toEqual(cls.students);
    expect(back.studentEmails).toEqual(cls.students);   // l'app lit les deux
    expect(back.individual).toBe(false);
    expect(back.created).toBe('27/06/2026');
  });

  it('cours particulier (individual) : 1 élève', () => {
    const indiv = { id: 7, teacherId: 't', name: '👤 paul', moduleIds: ['9'], students: ['paul'], individual: true };
    const back = _sbRowToClass(_sbClassToRow(indiv));
    expect(back.individual).toBe(true);
    expect(back.students).toEqual(['paul']);
  });
});

describe('mapping résultat / pratique / partie ↔ ligne SQL', () => {
  it('résultat : round-trip (student→student_name, posIdx→pos_idx, drillId en texte)', () => {
    const rec = { drillId: 123, drillName: 'Espagnole', student: 'Léa', studentEmail: 'lea@ex.fr', studentPseudo: 'lea', studentId: 'uid', posIdx: 4, san: 'Bb5', comment: 'clouage', correct: true, ts: 1700000000000 };
    const back = _sbRowToResult(_sbResultToRow(rec));
    expect(back.drillId).toBe('123');
    expect(back.student).toBe('Léa');
    expect(back.posIdx).toBe(4);
    expect(back.correct).toBe(true);
    expect(back.san).toBe('Bb5');
    expect(back.ts).toBe(1700000000000);
  });
  it('pratique : round-trip (student dans extra, sessionIdx→session_idx)', () => {
    const rec = { drillId: 9, drillName: 'D', student: 'Léa', studentEmail: 'lea@ex.fr', studentPseudo: 'lea', studentId: 'uid', pct: 80, sessionIdx: 2, ts: 1700000000001 };
    const back = _sbRowToPractice(_sbPracticeToRow(rec));
    expect(back.pct).toBe(80);
    expect(back.sessionIdx).toBe(2);
    expect(back.student).toBe('Léa');
    expect(back.drillId).toBe('9');
  });
  it('partie : round-trip (id bigint préservé)', () => {
    const rec = { id: 1700000000002, drillId: 9, drillName: 'D', student: 'Léa', studentEmail: 'lea@ex.fr', studentId: 'uid', side: 'w', level: 'Avancé', pgn: '1. e4 e5', result: '1-0', ts: 1700000000002 };
    const back = _sbRowToGame(_sbGameToRow(rec));
    expect(back.id).toBe(1700000000002);
    expect(back.result).toBe('1-0');
    expect(back.side).toBe('w');
    expect(back.student).toBe('Léa');
    expect(back.pgn).toBe('1. e4 e5');
  });
});
