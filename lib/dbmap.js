// ════════════════════════════════════════════════════════════
//  lib/dbmap.js — mappers PURS objet app ↔ ligne SQL Supabase
//  (camelCase ↔ snake_case). Aucune dépendance DOM/réseau → testables.
//  Chargé avant app.js (fonctions globales) + exporté pour Node/Vitest.
//  Les champs hors-colonnes vont dans `extra` (jsonb) — voir migration 002.
// ════════════════════════════════════════════════════════════

import { pgnHeader } from './core.js';

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
    extra:            { created: d.created || null, fromLibrary: !!d.fromLibrary, demo: !!d.demo, isExercise: !!d.isExercise, exType: d.exType || null, folder: d.folder || null,
                        overlayOf: d.overlayOf != null ? d.overlayOf : null,
                        overlayBy: d.overlayBy || null,
                        // Plans de travail dont ce module est l'ancre (lib/plans-core.js).
                        plans: d.plans || [],
                        // Titres de chapitres édités par le coach (clé gameIdx) : la surcouche
                        // qui prime sur les en-têtes PGN à chaque reconstruction des sessions.
                        chapTitles: d.chapTitles || {} }
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
    demo:           !!ex.demo,
    isExercise:     !!ex.isExercise,
    exType:         ex.exType || null,
    folder:         ex.folder || null,
    // Couche d'edition eleve : cette ligne n'est pas un module, c'est le DIFF des
    // ajouts d'un eleve sur le module <overlayOf> du coach. Jamais drillee telle
    // quelle — fusionnee en memoire sur l'arbre du coach au chargement.
    overlayOf:      ex.overlayOf != null ? ex.overlayOf : null,
    // Identite de l'eleve DENORMALISEE : la policy profiles_read laisse l'eleve lire le
    // profil de son coach, jamais l'inverse -> le coach ne peut pas resoudre
    // owner_student_id (un uid) en un nom. Meme parade que `results` (student /
    // studentEmail / studentPseudo), et meme forme -> _resultKeys marche dessus tel quel.
    overlayBy:      ex.overlayBy || null,
    // Plans de travail dont ce module est l'ancre (composition ouverture +
    // paquets ; voyage dans extra -> l'eleve la recoit avec le module assigne).
    plans:          ex.plans || [],
    chapTitles:     ex.chapTitles || {}
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
    extra:      { created: c.created || null, deadlines: c.moduleDeadlines || {}, targetedReviews: c.targetedReviews || [] }
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
    created:       ex.created || null,
    moduleDeadlines: ex.deadlines || {},   // { moduleId: 'YYYY-MM-DD' } — échéance par assignation
    targetedReviews: ex.targetedReviews || []   // révisions ciblées assignées par le coach
  };
}

// ── Résultat (tentative de position) ────────────────────────
function _sbResultToRow(r) {
  return {
    drill_id:       r.drillId != null ? String(r.drillId) : null,
    drill_name:     r.drillName || null,
    student_id:     r.studentId || null,
    student_email:  r.studentEmail || null,
    student_pseudo: r.studentPseudo || null,
    student_name:   r.student || null,
    san:            r.san || null,
    comment:        r.comment || null,
    correct:        !!r.correct,
    pos_idx:        r.posIdx != null ? r.posIdx : null,
    ts:             r.ts || null
  };
}
function _sbRowToResult(row) {
  return {
    drillId:       row.drill_id,
    drillName:     row.drill_name,
    studentId:     row.student_id,
    studentEmail:  row.student_email,
    studentPseudo: row.student_pseudo,
    student:       row.student_name,
    san:           row.san,
    comment:       row.comment,
    correct:       !!row.correct,
    posIdx:        row.pos_idx,
    ts:            row.ts
  };
}

// ── Session de pratique ─────────────────────────────────────
function _sbPracticeToRow(r) {
  return {
    drill_id:       r.drillId != null ? String(r.drillId) : null,
    drill_name:     r.drillName || null,
    student_id:     r.studentId || null,
    student_email:  r.studentEmail || null,
    student_pseudo: r.studentPseudo || null,
    pct:            r.pct != null ? r.pct : null,
    session_idx:    r.sessionIdx != null ? r.sessionIdx : null,
    ts:             r.ts || null,
    extra:          { student: r.student || null }
  };
}
function _sbRowToPractice(row) {
  const ex = row.extra || {};
  return {
    drillId:       row.drill_id,
    drillName:     row.drill_name,
    studentId:     row.student_id,
    studentEmail:  row.student_email,
    studentPseudo: row.student_pseudo,
    student:       ex.student || null,
    pct:           row.pct,
    sessionIdx:    row.session_idx,
    ts:            row.ts
  };
}

// ── Partie (vs Maia) ────────────────────────────────────────
function _sbGameToRow(r) {
  return {
    id:            r.id,
    drill_id:      r.drillId != null ? String(r.drillId) : null,
    drill_name:    r.drillName || null,
    student_id:    r.studentId || null,
    student_email: r.studentEmail || null,
    side:          r.side || null,
    level:         r.level || null,
    pgn:           r.pgn || null,
    result:        r.result || null,
    ts:            r.ts || null,
    extra:         { student: r.student || null, base_id: r.baseId != null ? String(r.baseId) : null, nature: r.nature || null,
                     shared: !!r.shared, reviewed_at: r.reviewedAt || null,
                     white: r.white || null, black: r.black || null, event: r.event || null }
  };
}
function _sbRowToGame(row) {
  const ex = row.extra || {};
  return {
    id:           row.id,
    drillId:      row.drill_id,
    drillName:    row.drill_name,
    studentId:    row.student_id,
    studentEmail: row.student_email,
    student:      ex.student || null,
    side:         row.side,
    level:        row.level,
    pgn:          row.pgn,
    result:       row.result,
    ts:           row.ts,
    baseId:       ex.base_id || null,      // Pilier 1 : rattachement à une base personnelle
    nature:       ex.nature || null,       // 'partie' | 'analyse'
    shared:       !!ex.shared,             // P1.3 : partagée au coach
    reviewedAt:   ex.reviewed_at || null,  // P1.4 : horodatage de la revue coach
    // Métadonnées d'affichage : extra en priorité, sinon relues des en-têtes du PGN
    // (fallback pour les parties enregistrées avant que white/black/event soient rangés dans extra).
    white:        ex.white || pgnHeader(row.pgn, 'White'),
    black:        ex.black || pgnHeader(row.pgn, 'Black'),
    event:        ex.event || pgnHeader(row.pgn, 'Event')
  };
}

// ── Export ES (importé par app.js + par Vitest) ──
export {
  _sbModuleToRow, _sbRowToModule, _sbClassToRow, _sbRowToClass,
  _sbResultToRow, _sbRowToResult, _sbPracticeToRow, _sbRowToPractice,
  _sbGameToRow, _sbRowToGame
};
