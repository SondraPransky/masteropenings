import dbmap from '../lib/dbmap.js';
const {
  _sbModuleToRow, _sbRowToModule, _sbClassToRow, _sbRowToClass,
  _sbResultToRow, _sbRowToResult, _sbPracticeToRow, _sbRowToPractice,
  _sbGameToRow, _sbRowToGame
} = dbmap;

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
    expect(row.extra).toEqual({ created: '27/06/2026', fromLibrary: true, demo: false });
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
