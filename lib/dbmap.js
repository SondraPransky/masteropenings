// ════════════════════════════════════════════════════════════
//  lib/dbmap.js — mappers PURS objet app ↔ ligne SQL Supabase
//  (camelCase ↔ snake_case). Aucune dépendance DOM/réseau → testables.
//  Chargé avant app.js (fonctions globales) + exporté pour Node/Vitest.
//  Les champs hors-colonnes vont dans `extra` (jsonb) — voir migration 002.
// ════════════════════════════════════════════════════════════

// ── Module (drill) ──────────────────────────────────────────
function _sbModuleToRow(d) {
  return {
    id:               d.id,
    teacher_id:       d.teacherId || null,
    owner_student_id: d.ownerStudentId || null,
    name:             d.name,
    level:            d.level || null,
    side:             d.side || null,
    pgn:              d.pgn || null,
    mode:             d.mode || null,
    varmode:          d.varmode || null,
    tree:             d.tree || {},
    sessions:         d.sessions || [],
    hide_comments:    !!d.hideComments,
    personal:         !!d.personal,
    deadline:         d.deadline || null,
    updated_at:       d.updatedAt || null,
    extra:            { created: d.created || null, fromLibrary: !!d.fromLibrary, demo: !!d.demo }
  };
}

function _sbRowToModule(r) {
  const ex = r.extra || {};
  return {
    id:             r.id,
    teacherId:      r.teacher_id || null,
    ownerStudentId: r.owner_student_id || null,
    name:           r.name,
    level:          r.level,
    side:           r.side,
    pgn:            r.pgn,
    mode:           r.mode,
    varmode:        r.varmode,
    tree:           r.tree || {},
    sessions:       r.sessions || [],
    hideComments:   !!r.hide_comments,
    personal:       !!r.personal,
    deadline:       r.deadline,
    updatedAt:      r.updated_at,
    created:        ex.created || null,
    fromLibrary:    !!ex.fromLibrary,
    demo:           !!ex.demo
  };
}

// ── Classe ──────────────────────────────────────────────────
function _sbClassToRow(c) {
  return {
    id:         c.id,
    teacher_id: c.teacherId || null,
    name:       c.name || null,
    module_ids: c.moduleIds || [],
    students:   c.students || c.studentEmails || [],
    individual: !!c.individual,
    extra:      { created: c.created || null }
  };
}

function _sbRowToClass(r) {
  const ex = r.extra || {};
  const students = r.students || [];
  return {
    id:            r.id,
    teacherId:     r.teacher_id || null,
    name:          r.name,
    moduleIds:     r.module_ids || [],
    students:      students,
    studentEmails: students,        // l'app lit cls.studentEmails || cls.students
    individual:    !!r.individual,
    created:       ex.created || null
  };
}

// ── Export Node/Vitest (inerte dans le navigateur) ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _sbModuleToRow, _sbRowToModule, _sbClassToRow, _sbRowToClass };
}
