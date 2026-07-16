// ══════════════════════════════════════════════════════
// lib/coach-assign.js — ASSIGNATION CIBLÉE coach → élève(s), migration-free
// (class.targetedReviews ↔ classes.extra.targetedReviews).
// UN cœur commun (_assignReviewCore) + 2 points d'entrée minces :
//   - assignTargetedReview   ← Points faibles (indexe CS.wsCards), 2 portées ;
//   - assignReviewForStudent ← détail élève (CS.selectedStudent).
// Les deux capturent de quoi ANNULER (undoTargetedReview). État local : _lastAssign.
// Socle → coach-core.js ; appels latéraux → pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { CS, _drillFenMap, _clsRoster, _studentIdSet, toast } from './coach-core.js';

// Dernière assignation (pour l'undo) : { key, patches:[{clsId, revId, added:[], created}] }.
// key = index CS.wsCards (Points faibles) ou 'stu:drillId_san' (détail élève).
let _lastAssign = null;

// Cœur commun d'assignation : upsert de la position (module + coup + FEN + commentaire)
// dans class.targetedReviews (→ classes.extra, migration-free) pour chaque classe où
// pickTargets(cls, roster) retient des élèves. Persiste (local + Supabase) et retourne
// { reached, patches } — de quoi ANNULER (undoTargetedReview) — ou null si personne.
function _assignReviewCore(pos, pickTargets) {
  const reached = new Set(), patches = [];
  G.classes.forEach(cls => {
    const targets = pickTargets(cls, _clsRoster(cls).map(String));
    if (!targets.length) return;
    if (!Array.isArray(cls.targetedReviews)) cls.targetedReviews = [];
    let rev = cls.targetedReviews.find(r => String(r.drillId) === String(pos.drillId) && r.san === pos.san);
    if (rev) {
      const before = new Set((rev.students || []).map(s => String(s).toLowerCase()));
      const added = targets.filter(s => !before.has(s.toLowerCase()));
      rev.students = [...new Set([...(rev.students || []), ...targets])];
      rev.assignedAt = Date.now();
      patches.push({ clsId: cls.id, revId: rev.id, added, created: false });
    } else {
      const revId = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      cls.targetedReviews.push({ id: revId, drillId: pos.drillId, drillName: pos.drillName || '', san: pos.san, fen: pos.fen || null, comment: pos.comment || '', students: targets, assignedAt: Date.now() });
      patches.push({ clsId: cls.id, revId, added: targets, created: true });
    }
    targets.forEach(t => reached.add(t.toLowerCase()));
  });
  if (!reached.size) return null;
  window.saveClasses?.();
  patches.forEach(u => { const c = G.classes.find(x => x.id === u.clsId); if (c) window._sbSaveClass?.(c); });
  return { reached, patches };
}

// « Assigner une révision ciblée » depuis les POINTS FAIBLES (indexe CS.wsCards). Deux portées :
//  - défaut : uniquement les élèves qui échouent (précision) ;
//  - {whole:true} : toute la classe à qui le module est assigné (prévention).
function assignTargetedReview(i, opts = {}) {
  const p = CS.wsCards[i]; if (!p) return;
  const whole = !!opts.whole;
  // Matching par identifiants complets (email/pseudo/nom) — les rosters stockent des emails.
  const failSet = new Set((p.failIds && p.failIds.length ? p.failIds : p.failStudents).map(s => String(s).toLowerCase()));
  const res = _assignReviewCore(p, (cls, roster) => whole
    ? ((cls.moduleIds || []).map(String).includes(String(p.drillId)) ? roster : [])
    : roster.filter(s => failSet.has(s.toLowerCase())));
  if (!res) { toast(whole ? 'Aucune classe n\'a ce module assigné' : 'Aucun de ces élèves n\'est dans une classe', 'ko'); return; }
  _lastAssign = { key: i, patches: res.patches };
  toast(`✓ « ${p.san} » à réviser assigné à ${res.reached.size} élève${res.reached.size > 1 ? 's' : ''}`, 'ok');
  document.querySelectorAll(`[data-assign="${i}"]`).forEach(b => { b.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Assigné'; b.setAttribute('disabled', 'disabled'); });
  document.querySelectorAll(`[data-undo="${i}"]`).forEach(b => { b.style.display = ''; });
}

// « Assigner » depuis le DÉTAIL d'un élève : même cœur, cible = les classes où CET élève
// est inscrit ET qui ont le module. Le bouton devient « Annuler » (undo) après assignation.
function assignReviewForStudent(btn) {
  const it = btn?.closest('.ed-review-item');
  if (!it || !CS.selectedStudent) return;
  const drillId = it.dataset.did, san = it.dataset.san;
  const ids = _studentIdSet(CS.selectedStudent);
  const drill = G.drills.find(d => String(d.id) === String(drillId));
  const hit = G.results.find(r => String(r.drillId) === String(drillId) && (r.san||'') === san && r.comment);
  const res = _assignReviewCore(
    { drillId, drillName: drill ? drill.name : '', san, fen: _drillFenMap(drillId)[san] || null, comment: hit ? hit.comment : '' },
    (cls, roster) => {
      if (!(cls.moduleIds || []).map(String).includes(String(drillId))) return [];   // classe sans ce module
      const email = roster.find(e => ids.has(e.toLowerCase()));                      // l'entrée roster de cet élève
      return email ? [email] : [];
    });
  if (!res) { toast('Cet élève n\'est dans aucune classe ayant ce module', 'ko'); return; }
  const key = 'stu:' + drillId + '_' + san;
  _lastAssign = { key, patches: res.patches };
  toast(`✓ « ${san} » à revoir assigné à l'élève`, 'ok');
  btn.innerHTML = '<i class="ti ti-arrow-back-up" aria-hidden="true"></i>';
  btn.title = 'Annuler l\'assignation';
  btn.setAttribute('aria-label', 'Annuler l\'assignation');
  btn.onclick = e => { e.stopPropagation(); undoTargetedReview(key); };
}

// Annule la dernière assignation : retire les révisions créées / les élèves ajoutés.
function undoTargetedReview(key) {
  if (!_lastAssign || String(_lastAssign.key) !== String(key)) return;
  _lastAssign.patches.forEach(u => {
    const cls = G.classes.find(x => x.id === u.clsId); if (!cls) return;
    if (u.created) {
      cls.targetedReviews = (cls.targetedReviews || []).filter(r => r.id !== u.revId);
    } else {
      const rev = (cls.targetedReviews || []).find(r => r.id === u.revId);
      if (rev) { const rm = new Set(u.added.map(s => String(s).toLowerCase())); rev.students = (rev.students || []).filter(s => !rm.has(String(s).toLowerCase())); }
    }
  });
  window.saveClasses?.();
  _lastAssign.patches.forEach(u => { const c = G.classes.find(x => x.id === u.clsId); if (c) window._sbSaveClass?.(c); });
  _lastAssign = null;
  toast('Assignation annulée', 'ok');
  document.querySelectorAll(`[data-assign="${key}"]`).forEach(b => { b.innerHTML = '<i class="ti ti-target" aria-hidden="true"></i> Assigner'; b.removeAttribute('disabled'); });
  document.querySelectorAll(`[data-undo="${key}"]`).forEach(b => { b.style.display = 'none'; });
  // Undo depuis le détail élève → re-rendre le panneau (le bouton 🎯 y renaît propre).
  if (String(key).startsWith('stu:') && CS.selectedStudent) window.showStudentDetail?.(CS.selectedStudent);
}

// Pont window : exposé aux onclick="" (index.html).
Object.assign(window, {
  assignTargetedReview, assignReviewForStudent, undoTargetedReview,
});
