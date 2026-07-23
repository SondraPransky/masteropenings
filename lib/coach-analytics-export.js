// ══════════════════════════════════════════════════════
// VUE COACH — Analyse d'ouvertures : « Créer un paquet d'exercices ».
//
// Les erreurs cochées dans la table deviennent un paquet d'exercices EECoach
// (module `mode:'flash'` / `isExercise`, une position par erreur : le camp
// fautif au trait, l'élève trouve LE meilleur coup) — ET, dans le même geste,
// le paquet peut être ASSIGNÉ à des classes avec une échéance (modale
// `modal-oaa-packet`, v2 du 21/07 : le prompt() ne faisait que créer, il
// fallait ensuite aller dans Classes pour assigner).
//
// Le module lui-même est bâti par `buildExercisePacket` (lib/exercises.js, LE
// constructeur canonique) via le pont window ; l'assignation reprend le patron
// de `saveClass` (modules.js) : moduleIds + moduleDeadlines + saveClasses/_sbSaveClass.
//
// RÈGLE coach-* : imports depuis coach-core / coach-analytics-core uniquement.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { escapeHtml } from './coach-core.js';
import { OA, errorToKp, bucketShort } from './coach-analytics-core.js';

// Erreurs retenues pour le paquet : la sélection courante, ou une liste
// explicite (bouton « Créer un exercice de cette erreur » de la modale position).
let _oaaPkIdx = [];

function oaaCreatePacket(only) {
  const idx = Array.isArray(only) ? only : [...OA.sel].sort((a, b) => a - b);
  if (!idx.length) { window.toast?.('⚠ Coche au moins une erreur', 'ko'); return; }
  const doc = (G.oaAnalyses || {})[OA.modId]?.data || {};
  const kps = idx.map(i => (doc.errors || [])[i]).filter(Boolean).map(errorToKp).filter(Boolean);
  if (!kps.length) { window.toast?.('❌ Aucune erreur convertible en exercice', 'ko'); return; }
  _oaaPkIdx = idx;

  const modName = (G.drills || []).find(d => String(d.id) === String(OA.modId))?.name || doc.chapter || 'module';
  const suffix = OA.bucket === 'all' ? '' : ` @ ${bucketShort(Number(OA.bucket))}`;
  const nameEl = /** @type {HTMLInputElement} */ (document.getElementById('oaa-pk-name'));
  if (nameEl) nameEl.value = `Erreurs — ${modName}${suffix}`;
  const cntEl = document.getElementById('oaa-pk-count');
  if (cntEl) cntEl.textContent = `${kps.length} exercice${kps.length > 1 ? 's' : ''}`;

  // Classes du coach : cases à cocher (aucune cochée = paquet créé sans assignation).
  const list = document.getElementById('oaa-pk-classes');
  if (list) {
    const classes = G.classes || [];
    list.innerHTML = classes.length
      ? classes.map(c => `<label class="oaa-pk-cls">
          <input type="checkbox" value="${escapeHtml(String(c.id))}">
          <span>${escapeHtml(c.name || 'Classe')}</span>
          <span class="oaa-sub-td">${(c.students || c.studentEmails || []).length} élève${(c.students || c.studentEmails || []).length > 1 ? 's' : ''}</span>
        </label>`).join('')
      : `<div class="oaa-sub-td">Aucune classe — le paquet sera créé sans assignation.</div>`;
  }
  const dl = /** @type {HTMLInputElement} */ (document.getElementById('oaa-pk-deadline'));
  if (dl) dl.value = '';
  document.getElementById('modal-oaa-packet')?.classList.add('on');
}

function oaaPacketSave() {
  const name = (/** @type {HTMLInputElement} */ (document.getElementById('oaa-pk-name'))?.value || '').trim();
  if (!name) { window.toast?.('⚠ Donne un nom au paquet', 'ko'); return; }
  const level = /** @type {HTMLSelectElement} */ (document.getElementById('oaa-pk-level'))?.value || 'Intermédiaire';
  const deadline = /** @type {HTMLInputElement} */ (document.getElementById('oaa-pk-deadline'))?.value || null;
  const clsIds = [...document.querySelectorAll('#oaa-pk-classes input:checked')]
    .map(el => /** @type {HTMLInputElement} */ (el).value);

  const doc = (G.oaAnalyses || {})[OA.modId]?.data || {};
  const kps = _oaaPkIdx.map(i => (doc.errors || [])[i]).filter(Boolean).map(errorToKp).filter(Boolean);
  if (!kps.length) { window.toast?.('❌ Aucune erreur convertible', 'ko'); return; }

  // Constructeur canonique du module-paquet (lib/exercises.js) via le pont window.
  const mod = window.buildExercisePacket?.({ name, kps, level, exType: 'tactique' });
  if (!mod) { window.toast?.('❌ Constructeur de paquet indisponible', 'ko'); return; }
  G.drills.push(mod);
  window.save?.();
  window.saveModule?.(mod);

  // Assignation : même patron que saveClass (modules.js) — moduleIds + échéance.
  let assigned = 0;
  clsIds.forEach(cid => {
    const cls = (G.classes || []).find(c => String(c.id) === String(cid));
    if (!cls) return;
    cls.moduleIds = [...(cls.moduleIds || []), String(mod.id)];
    if (deadline) { cls.moduleDeadlines = { ...(cls.moduleDeadlines || {}), [String(mod.id)]: deadline }; }
    window._sbSaveClass?.(cls);
    assigned++;
  });
  if (assigned) window.saveClasses?.();

  OA.sel.clear(); _oaaPkIdx = [];
  window.closeModal?.('modal-oaa-packet');
  window.toast?.(`✓ Paquet « ${name} » créé (${kps.length} exercice${kps.length > 1 ? 's' : ''})`
    + (assigned ? ` · assigné à ${assigned} classe${assigned > 1 ? 's' : ''}` : ''), 'ok');
  window.renderDrillList?.();
  window.renderClassModuleSelect?.();
  window.renderClassList?.();
  window.renderOaAnalytics?.();
}

Object.assign(window, { oaaCreatePacket, oaaPacketSave });
