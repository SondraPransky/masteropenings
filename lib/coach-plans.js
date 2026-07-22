// ══════════════════════════════════════════════════════
// VUE COACH — Composeur de « Plan de travail » (modal `modal-plan-composer`).
//
// Un plan = le module d'ouverture (l'ANCRE, qui le porte dans `d.plans`) +
// des paquets d'exercices membres : Puzzles (tactiques du prof ou OTKB) et
// Erreurs types (paquets issus de l'analyse d'ouvertures). Le composeur ne
// FABRIQUE aucun paquet : il attache ceux qui existent — les surfaces
// spécialisées (Exercices, explorateur OTKB, panneau à rails OA) restent les
// producteurs. RÈGLE PRODUIT (utilisatrice, 22/07 — annule le « 2 pattes ») :
// un plan a TOUJOURS ses 3 pattes — ouverture + puzzles + erreurs types ;
// l'enregistrement est bloqué tant que les deux emplacements sont vides.
//
// L'assignation (optionnelle, dans le même geste) reprend le patron
// `oaaPacketSave` : ancre + membres → cls.moduleIds + cls.moduleDeadlines.
//
// RÈGLE coach-* : imports depuis coach-core / coach-analytics-core uniquement ;
// le reste passe par le pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { escapeHtml } from './coach-core.js';
import { figurineTitle } from './core.js';
import { OA } from './coach-analytics-core.js';
import { planMembers } from './plans-core.js';

let _plAnchorId = null;   // id du module ancre ouvert dans le composeur
let _plEditId = null;     // id du plan en cours d'édition (null = nouveau)

const _plAnchor = () => (G.drills || []).find(d => String(d.id) === String(_plAnchorId));
// Les paquets attachables : les paquets d'exercices du coach (jamais les overlays élève).
const _plPackets = () => (G.drills || []).filter(d => d.isExercise && !d.overlayOf);

function openPlanComposer(drillId) {
  const d = (G.drills || []).find(x => String(x.id) === String(drillId));
  if (!d || d.isExercise) return;
  _plAnchorId = d.id;
  const sub = document.getElementById('pl-anchor');
  if (sub) sub.innerHTML = figurineTitle(escapeHtml(d.name));

  // Classes du coach (patron modal-oaa-packet) — aucune cochée = plan sans assignation.
  const clsList = document.getElementById('pl-classes');
  if (clsList) {
    const classes = G.classes || [];
    clsList.innerHTML = classes.length
      ? classes.map(c => `<label class="oaa-pk-cls">
          <input type="checkbox" value="${escapeHtml(String(c.id))}">
          <span>${escapeHtml(c.name || 'Classe')}</span>
          <span class="oaa-sub-td">${(c.students || c.studentEmails || []).length} élève(s)</span>
        </label>`).join('')
      : `<div class="oaa-sub-td">Aucune classe — le plan sera enregistré sans assignation.</div>`;
  }

  _plFillSelect();
  _plLoad(null);
  document.getElementById('modal-plan-composer')?.classList.add('on');
}

// Select « Plan » : les plans existants de l'ancre + « Nouveau plan ».
function _plFillSelect() {
  const sel = /** @type {HTMLSelectElement} */ (document.getElementById('pl-select'));
  const d = _plAnchor();
  if (!sel || !d) return;
  const plans = d.plans || [];
  sel.innerHTML = `<option value="">+ Nouveau plan</option>`
    + plans.map(p => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.name || 'Plan')}</option>`).join('');
  sel.style.display = plans.length ? '' : 'none';
}

function planComposerPick(id) { _plLoad(id || null); }

// Peuple le formulaire pour un plan existant (id) ou un nouveau (null).
function _plLoad(planId) {
  const d = _plAnchor();
  if (!d) return;
  const plan = (d.plans || []).find(p => String(p.id) === String(planId)) || null;
  _plEditId = plan ? plan.id : null;

  const sel = /** @type {HTMLSelectElement} */ (document.getElementById('pl-select'));
  if (sel) sel.value = plan ? String(plan.id) : '';
  const name = /** @type {HTMLInputElement} */ (document.getElementById('pl-name'));
  if (name) name.value = plan ? (plan.name || '') : `Plan — ${d.name}`;
  const del = document.getElementById('pl-delete');
  if (del) del.style.display = plan ? '' : 'none';
  const btn = document.getElementById('pl-save-btn');
  if (btn) btn.innerHTML = plan
    ? '<i class="ti ti-check" aria-hidden="true"></i> Enregistrer le plan'
    : '<i class="ti ti-check" aria-hidden="true"></i> Créer le plan';

  const packets = _plPackets();
  const boxRow = (m, slot, checked) => `<label class="oaa-pk-cls">
      <input type="checkbox" value="${escapeHtml(String(m.id))}" data-slot="${slot}" ${checked ? 'checked' : ''} onchange="_plSyncBoxes()">
      <span>${escapeHtml(m.name)}</span>
      <span class="oaa-sub-td">${(m.sessions?.[0]?.kps || m.kps || []).length} exercice(s)</span>
    </label>`;
  const inPuzzles = new Set((plan?.puzzles || []).map(String));
  const inErrors  = new Set((plan?.errors || []).map(String));
  const puz = document.getElementById('pl-puzzles');
  if (puz) puz.innerHTML = packets.length
    ? packets.map(m => boxRow(m, 'puzzles', inPuzzles.has(String(m.id)))).join('')
    : `<div class="oaa-sub-td">Aucun paquet d'exercices — crée-en un (menu + Créer, ou l'explorateur de puzzles) puis reviens.</div>`;
  const err = document.getElementById('pl-errors');
  if (err) err.innerHTML = packets.length
    ? packets.map(m => boxRow(m, 'errors', inErrors.has(String(m.id)))).join('')
    : `<div class="oaa-sub-td">Aucun paquet — le panneau Erreurs de l'analyse d'ouvertures sait en créer un.</div>`;

  // Pont vers l'analyse d'ouvertures : raccourci si elle existe pour ce module,
  // invitation à lancer le worker sinon (pas de bouton fantôme : le lien n'ouvre
  // la section que parce qu'elle est TOUJOURS visible, état vide pédagogique compris).
  const hint = document.getElementById('pl-oa-hint');
  if (hint) {
    const hasOa = !!(G.oaAnalyses || {})[String(d.id)];
    hint.innerHTML = hasOa
      ? `<button type="button" class="btn btn-ghost btn-sm" onclick="planComposerGoOa()"><i class="ti ti-chart-dots" aria-hidden="true"></i> Choisir les erreurs dans l'analyse de ce module</button>`
      : `<span class="oaa-sub-td">Pas encore d'analyse pour ce module — lance le worker, tu pourras ajouter les erreurs types ensuite.</span>`;
  }

  const dl = /** @type {HTMLInputElement} */ (document.getElementById('pl-deadline'));
  if (dl) dl.value = '';
  document.querySelectorAll('#pl-classes input:checked').forEach(el => { /** @type {HTMLInputElement} */ (el).checked = false; });
  _plSyncBoxes();
}

// Un paquet ne peut appartenir qu'à UN emplacement du plan : cochée d'un côté,
// sa case de l'autre côté se désactive.
function _plSyncBoxes() {
  const boxes = [...document.querySelectorAll('#pl-puzzles input, #pl-errors input')]
    .map(el => /** @type {HTMLInputElement} */ (el));
  const checked = new Map();   // id → slot
  boxes.forEach(b => { if (b.checked) checked.set(b.value, b.dataset.slot); });
  boxes.forEach(b => {
    const other = checked.get(b.value) && checked.get(b.value) !== b.dataset.slot;
    b.disabled = !!other;
    if (other) b.checked = false;
  });
}

// Saut vers le panneau Erreurs de l'analyse, module présélectionné.
function planComposerGoOa() {
  OA.modId = String(_plAnchorId);
  window.closeModal?.('modal-plan-composer');
  window.switchCoachSection?.('analytics');
  window.toast?.('Coche des erreurs puis « Créer un paquet » — tu l\'attacheras au plan ensuite', 'ok');
}

function planComposerSave() {
  const d = _plAnchor();
  if (!d) return;
  const name = (/** @type {HTMLInputElement} */ (document.getElementById('pl-name'))?.value || '').trim();
  if (!name) { window.toast?.('⚠ Donne un nom au plan', 'ko'); return; }
  const pick = slot => [...document.querySelectorAll(`#pl-${slot} input:checked`)]
    .map(el => String(/** @type {HTMLInputElement} */ (el).value));
  const puzzles = pick('puzzles'), errors = pick('errors');
  // Règle produit (22/07, annule le « plan à 2 pattes ») : un plan a TOUJOURS
  // ses 3 pattes — l'ouverture (l'ancre), des puzzles ET des erreurs types.
  if (!puzzles.length) { window.toast?.('⚠ Un plan a 3 pattes : attache au moins un paquet de puzzles (tes tactiques ou l\'explorateur)', 'ko'); return; }
  if (!errors.length) { window.toast?.('⚠ Un plan a 3 pattes : attache un paquet d\'erreurs types (panneau Erreurs de l\'analyse d\'ouvertures)', 'ko'); return; }

  let plan = (d.plans || []).find(p => String(p.id) === String(_plEditId));
  if (plan) { plan.name = name; plan.puzzles = puzzles; plan.errors = errors; }
  else {
    plan = { id: Date.now().toString(36), name, puzzles, errors };
    d.plans = [...(d.plans || []), plan];
  }
  window.save?.();
  window.saveModule?.(d);

  // Assignation (optionnelle) : ancre + membres, même échéance pour tous.
  const deadline = /** @type {HTMLInputElement} */ (document.getElementById('pl-deadline'))?.value || null;
  const clsIds = [...document.querySelectorAll('#pl-classes input:checked')]
    .map(el => /** @type {HTMLInputElement} */ (el).value);
  const allIds = [String(d.id), ...planMembers(plan)];
  let assigned = 0;
  clsIds.forEach(cid => {
    const cls = (G.classes || []).find(c => String(c.id) === String(cid));
    if (!cls) return;
    const have = new Set((cls.moduleIds || []).map(String));
    cls.moduleIds = [...(cls.moduleIds || []), ...allIds.filter(id => !have.has(id))];
    if (deadline) {
      cls.moduleDeadlines = { ...(cls.moduleDeadlines || {}) };
      allIds.forEach(id => { cls.moduleDeadlines[id] = deadline; });
    }
    window._sbSaveClass?.(cls);
    assigned++;
  });
  if (assigned) window.saveClasses?.();

  window.closeModal?.('modal-plan-composer');
  window.toast?.(`✓ Plan « ${name} » enregistré`
    + (assigned ? ` · envoyé à ${assigned} classe${assigned > 1 ? 's' : ''}` : ''), 'ok');
  window.renderDrillList?.();
  if (assigned) { window.renderClassList?.(); window.renderClassModuleSelect?.(); }
}

function planComposerDelete() {
  const d = _plAnchor();
  const plan = (d?.plans || []).find(p => String(p.id) === String(_plEditId));
  if (!d || !plan) return;
  d.plans = (d.plans || []).filter(p => String(p.id) !== String(plan.id));
  window.save?.();
  window.saveModule?.(d);
  // Les modules restent assignés tels quels : supprimer le plan ne retire rien aux classes.
  window.toast?.(`Plan « ${plan.name} » supprimé — les modules restent assignés`, 'ok');
  _plFillSelect();
  _plLoad(null);
  window.renderDrillList?.();
}

Object.assign(window, {
  openPlanComposer, planComposerSave, planComposerDelete, planComposerPick,
  planComposerGoOa, _plSyncBoxes,
});
