// ══════════════════════════════════════════════════════
// VUE COACH — Analyse d'ouvertures : « Créer un paquet d'exercices ».
//
// Les erreurs cochées dans la table deviennent un paquet d'exercices EECoach
// (module `mode:'flash'` / `isExercise`, une position par erreur : le camp
// fautif au trait, l'élève trouve LE meilleur coup). Même patron que
// `explorerCreatePacket` (coach-explorer.js) — l'élève s'entraîne ensuite dans
// EECoach (Leitner, assignation par classe) comme pour tout paquet.
//
// RÈGLE coach-* : imports depuis coach-core / coach-analytics-core uniquement ;
// save/saveModule/renderDrillList via le pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { OA, errorToKp, bucketShort } from './coach-analytics-core.js';

function oaaCreatePacket() {
  if (!OA.sel.size) { window.toast?.('⚠ Coche au moins une erreur', 'ko'); return; }
  const cur = (G.oaAnalyses || {})[OA.modId];
  const doc = cur?.data || {};
  const errs = [...OA.sel].sort((a, b) => a - b).map(i => (doc.errors || [])[i]).filter(Boolean);
  const kps = errs.map(errorToKp).filter(Boolean);
  if (!kps.length) { window.toast?.('❌ Aucune erreur convertible en exercice', 'ko'); return; }

  const modName = (G.drills || []).find(d => String(d.id) === String(OA.modId))?.name || doc.chapter || 'module';
  const suffix = OA.bucket === 'all' ? '' : ` @ ${bucketShort(Number(OA.bucket))}`;
  const name = (prompt("Nom du paquet d'exercices :", `Erreurs — ${modName}${suffix}`) || '').trim();
  if (!name) return;

  // Constructeur canonique du module-paquet (lib/exercises.js) via le pont window.
  const mod = window.buildExercisePacket?.({ name, kps, exType: 'tactique' });
  if (!mod) { window.toast?.('❌ Constructeur de paquet indisponible', 'ko'); return; }
  G.drills.push(mod);
  window.save?.();
  window.saveModule?.(mod);
  OA.sel.clear();
  window.toast?.(`✓ Paquet « ${name} » créé (${kps.length} exercice${kps.length > 1 ? 's' : ''})`, 'ok');
  window.renderDrillList?.();
  window.renderClassModuleSelect?.();
  window.renderOaAnalytics?.();
}

Object.assign(window, { oaaCreatePacket });
