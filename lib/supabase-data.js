// ══════════════════════════════════════════════════════
// lib/supabase-data.js — COUCHE D'ACCÈS DONNÉES Supabase (extraite d'app.js)
//
// Tous les `_sb*` de lecture/écriture (modules, classes, résultats, pratique,
// parties, overlays, mastery, bases) + l'orchestration (`_coachLoad`,
// `_sbLoadStudentModules`) + l'exécuteur commun `_sbRun`.
//
// ⚠ L'AUTH reste dans app.js (soudée au login : showLoginError/updateNav). Ce
// module n'expose que la DONNÉE. `sb` vient du client partagé.
//
// Dépendances : `sb` (client), `G` (state), mappers (dbmap), greffe overlay
// (tree). App-level (save/saveClasses/_cache/updateStudentBar/toast/render*)
// via le pont window — mêmes shims que les autres modules lib/*.
// ══════════════════════════════════════════════════════
import { sb } from './supabase-client.js';
import { G } from '../state.js';
import {
  _sbModuleToRow, _sbRowToModule, _sbClassToRow, _sbRowToClass,
  _sbResultToRow, _sbRowToResult, _sbPracticeToRow, _sbRowToPractice,
  _sbGameToRow, _sbRowToGame
} from './dbmap.js';
import { _mergeStudentLayer, _countLayerMoves } from './tree.js';

// ── Shims app-level (restés dans app.js) — résolus au runtime via window ──
const _cache            = (...a) => window._cache?.(...a);
const save              = (...a) => window.save?.(...a);
const saveClasses       = (...a) => window.saveClasses?.(...a);
const updateStudentBar  = (...a) => window.updateStudentBar?.(...a);

// Chargement des données coach (dashboard) avec état de chargement/erreur :
// skeleton pendant les fetch, carte d'erreur si l'un d'eux échoue (via l'horodatage
// _sbErrorAt posé par _sbRun). Réutilisé par le retry (window.retryCoachLoad).
async function _coachLoad() {
  const t0 = Date.now();
  G._coachLoading = 'loading';
  window.renderOverview?.(); window.renderProfView?.();
  await _sbLoadTeacherModules();
  // Résultats / pratique / parties des élèves (incl. parties partagées) → dashboard coach.
  await _sbLoadTeacherResults(); await _sbLoadTeacherPractice(); await _sbLoadTeacherGames();
  await _sbLoadTeacherOverlays();   // lignes ajoutees par les eleves sur ses modules
  G._coachLoading = (G._sbErrorAt && G._sbErrorAt >= t0) ? 'error' : null;
  window.renderOverview?.(); window.renderProfView?.();
  window._expDetectBridge?.();   // révèle la section Explorateur si l'usine OTKB locale répond
}

// ════════════════════════════════════════════════════════════
//  DONNÉES — modules & G.classes (côté enseignant)
// ════════════════════════════════════════════════════════════
async function _sbLoadTeacherModules() {
  if (!sb || !G.currentUser || G.currentRole !== 'teacher') return;
  try {
    const { data: mods, error: e1 } = await sb.from('modules').select('*').eq('teacher_id', G.currentUser.uid);
    if (e1) throw e1;
    // Les couches d'edition eleve portent teacher_id (pour que le coach puisse les LIRE)
    // mais ne sont PAS des modules : elles ne doivent pas polluer « Mes modules ».
    // Elles sont chargees a part par _sbLoadTeacherOverlays (detail eleve).
    G.drills = (mods || []).map(_sbRowToModule).filter(m => m.overlayOf == null)
                           .sort((a, b) => (b.id || 0) - (a.id || 0));
    save();
    const { data: cls, error: e2 } = await sb.from('classes').select('*').eq('teacher_id', G.currentUser.uid);
    if (e2) throw e2;
    G.classes = (cls || []).map(_sbRowToClass);
    saveClasses();
    window.renderDrillList?.();
    window.renderClassList?.();
    window.renderClassModuleSelect?.();
    updateStudentBar();
  } catch (e) { console.error('_sbLoadTeacherModules', e); window.renderDrillList?.(); }
}

// Exécuteur commun de la couche CRUD Supabase : factorise la garde de
// précondition + le try/catch/log uniformes répétés par chaque `_sb*`.
// `guardOk` est évalué au call-site (short-circuit sur sb/currentUser/rôle),
// donc l'accès à `G.currentUser.uid` dans `fn` est sûr quand fn s'exécute.
async function _sbRun(label, guardOk, fn) {
  if (!guardOk) return;
  try { return await fn(); }
  catch (e) {
    console.error(label, e); G._sbErrorAt = Date.now();   // horodatage additif → état d'erreur de chargement (coach)
    // Échec d'ÉCRITURE : prévenir l'utilisateur (sinon perte silencieuse côté cloud alors que
    // le localStorage a réussi). Rate-limité à 1 toast / 30 s — la synchro mastery ré-écrit
    // toutes les 2,5 s et provoquerait une tempête de toasts hors-ligne.
    if (/Save|Update|Delete/.test(label) && Date.now() - (G._sbWarnAt || 0) > 30000) {
      G._sbWarnAt = Date.now();
      window.toast?.('⚠ Sauvegarde en ligne échouée — tes données restent sur cet appareil', 'warn');
    }
  }
}

async function _sbSaveModule(drill) {
  return _sbRun('_sbSaveModule', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const row = _sbModuleToRow(drill);
    row.teacher_id = G.currentUser.uid;   // garantir le propriétaire (RLS)
    const { error } = await sb.from('modules').upsert(row);
    if (error) throw error;
  });
}

async function _sbDeleteModule(drillId) {
  return _sbRun('_sbDeleteModule', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const { error } = await sb.from('modules').delete().eq('id', drillId);
    if (error) throw error;
  });
}

async function _sbSaveClass(cls) {
  return _sbRun('_sbSaveClass', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const row = _sbClassToRow(cls);
    row.teacher_id = G.currentUser.uid;
    const { error } = await sb.from('classes').upsert(row);
    if (error) throw error;
  });
}

async function _sbDeleteClass(id) {
  return _sbRun('_sbDeleteClass', sb && G.currentUser, async () => {
    const { error } = await sb.from('classes').delete().eq('id', id);
    if (error) throw error;
  });
}

// ════════════════════════════════════════════════════════════
//  DONNÉES — élève + résultats / pratique / parties + mastery
// ════════════════════════════════════════════════════════════
// Classes de l'élève connecté.
// RLS : la policy `classes_read` (migration-005, VÉRIFIÉE appliquée sur le live
// 12/07/2026) restreint déjà `select *` aux classes dont l'élève est membre
// (`students ?| my_identifiers()`). Le `select('*')` ne ramène donc QUE ses
// classes ; le `.filter` client ci-dessous est une ceinture-bretelles redondante.
async function _sbFetchStudentClasses() {
  const ids = window._myIdentifiers?.() || [];
  const { data: allCls, error } = await sb.from('classes').select('*');
  if (error) throw error;
  return (allCls || []).map(_sbRowToClass)
    .filter(c => (c.students || []).some(s => ids.includes(String(s).toLowerCase())));
}

// Échéance d'assignation la plus proche par module, parmi les classes de
// l'élève. Dates 'YYYY-MM-DD' → comparaison lexicographique = chronologique. Pur.
function _assignDeadlinesFrom(classes) {
  const out = {};
  classes.forEach(c => {
    const dls = c.moduleDeadlines || {};
    Object.keys(dls).forEach(mid => {
      const d = dls[mid]; if (!d) return;
      if (!out[mid] || d < out[mid]) out[mid] = d;
    });
  });
  return out;
}

// Modules assignés à l'élève (via ses classes) : échéance d'assignation (prime
// sur celle du module) + noms de coachs pour l'affichage multi-profs.
async function _sbFetchAssignedModules(classes) {
  const moduleIds = new Set();
  classes.forEach(c => (c.moduleIds || []).forEach(id => moduleIds.add(Number(id))));
  if (!moduleIds.size) return [];
  const { data: mods } = await sb.from('modules').select('*').in('id', [...moduleIds]);
  const assigned = (mods || []).map(_sbRowToModule);
  const deadlines = _assignDeadlinesFrom(classes);
  assigned.forEach(m => { const d = deadlines[String(m.id)]; if (d) m.deadline = d; });
  await _sbApplyCoachNames(assigned);
  return assigned;
}

// Renseigne coachName/_showCoach sur les modules assignés (badge si ≥ 2 profs).
async function _sbApplyCoachNames(assigned) {
  const coachIds = [...new Set(assigned.map(m => m.teacherId).filter(Boolean))];
  const names = {};
  if (coachIds.length) {
    const { data: profs } = await sb.from('profiles').select('id,name,pseudo,email').in('id', coachIds);
    (profs || []).forEach(p => names[p.id] = p.name || p.pseudo || p.email || 'Coach');
  }
  const multiCoach = coachIds.length > 1;
  assigned.forEach(m => { m.coachName = names[m.teacherId] || null; m._showCoach = multiCoach; });
}

// Modules perso de l'élève. Les couches d'edition (overlayOf) partagent la colonne
// owner_student_id mais ne sont PAS des modules perso : elles sont renvoyees a part.
async function _sbFetchPersonalModules() {
  const { data: pers } = await sb.from('modules').select('*').eq('owner_student_id', G.currentUser.uid);
  return (pers || []).map(_sbRowToModule).filter(m => m.overlayOf == null);
}

// Couches d'edition de l'eleve, indexees par id du module coach qu'elles etendent.
async function _sbFetchStudentOverlays() {
  const { data: rows } = await sb.from('modules').select('*').eq('owner_student_id', G.currentUser.uid);
  const byModule = {};
  (rows || []).map(_sbRowToModule).filter(m => m.overlayOf != null)
              .forEach(o => { byModule[String(o.overlayOf)] = o; });
  return byModule;
}

// Greffe les ajouts de l'eleve sur l'arbre VIVANT de chaque module coach. En memoire
// seulement : la ligne du coach n'est jamais reecrite, et le drill continue de tourner
// sous l'id du module COACH -> la cle SR (${student}_${drillId}_${fen}_${san}) ne bouge
// pas, l'historique survit a l'ajout de lignes.
function _sbApplyStudentOverlays(assigned, overlays) {
  assigned.forEach(m => {
    const ov = overlays[String(m.id)];
    if (!ov || !ov.tree) return;
    // L'arbre VIERGE du coach est conserve : c'est la reference du diff a la sauvegarde
    // (sans lui on diffe l'arbre fusionne contre lui-meme -> diff vide, ajouts perdus).
    m._coachTree = m.tree;
    m.tree = _mergeStudentLayer(m.tree, ov.tree);
    m._layerTree = ov.tree;                     // le diff brut : greffe dans l'editeur
    m._overlayId = ov.id;                       // pour re-sauver sans creer un doublon
    m._overlayCount = _countLayerMoves(ov.tree);
  });
}

// Cote COACH : les couches que ses eleves ont greffees sur SES modules. Elles portent
// teacher_id = lui, donc la meme requete que ses modules les ramene ; on les separe ici
// (elles sont filtrees de « Mes modules » par _sbLoadTeacherModules).
// -> G.studentOverlays, consomme par le detail eleve.
async function _sbLoadTeacherOverlays() {
  if (!sb || !G.currentUser || G.currentRole !== 'teacher') return;
  return _sbRun('_sbLoadTeacherOverlays', sb && G.currentUser, async () => {
    const { data, error } = await sb.from('modules').select('*').eq('teacher_id', G.currentUser.uid);
    if (error) throw error;
    G.studentOverlays = (data || []).map(_sbRowToModule).filter(m => m.overlayOf != null);
  });
}

// Cree/met a jour la couche d'edition de l'eleve sur un module coach.
// teacher_id = le coach : c'est ce qui rend la ligne LISIBLE par lui (policy
// modules_read : teacher_id = auth.uid() OR owner_student_id = auth.uid()).
async function _sbSaveStudentOverlay(o) {
  return _sbRun('_sbSaveStudentOverlay', sb && G.currentUser, async () => {
    const row = _sbModuleToRow(o);
    row.owner_student_id = G.currentUser.uid;
    const { error } = await sb.from('modules').upsert(row);
    if (error) throw error;
  });
}

// Le COACH repond dans la copie d'un eleve. Chemin SEPARE de _sbSaveStudentOverlay :
// celui-ci force owner_student_id = l'utilisateur courant, ce qui ferait VOLER la ligne
// a l'eleve. Ici owner_student_id reste celui de l'eleve ; c'est teacher_id = le coach
// qui l'autorise a ecrire (modules_update_owner est un OR sur les deux colonnes).
async function _sbSaveCoachOverlayReply(o) {
  return _sbRun('_sbSaveCoachOverlayReply', sb && G.currentUser, async () => {
    const row = _sbModuleToRow(o);
    row.teacher_id = G.currentUser.uid;      // son droit d'ecriture sur cette ligne
    // row.owner_student_id vient de o.ownerStudentId : NE PAS l'ecraser.
    if (!row.owner_student_id) throw new Error('overlay sans proprietaire eleve');
    const { error } = await sb.from('modules').upsert(row);
    if (error) throw error;
  });
}

// Résultats + pratique de l'élève (dashboard multi-appareils) → G + cache.
async function _sbFetchStudentActivity() {
  const { data: rs } = await sb.from('results').select('*').eq('student_id', G.currentUser.uid);
  G.results = (rs || []).map(_sbRowToResult); _cache('mc_results', G.results);
  const { data: ps } = await sb.from('practice').select('*').eq('student_id', G.currentUser.uid);
  G.practiceLog = (ps || []).map(_sbRowToPractice); _cache('mc_practice', G.practiceLog);
}

// Orchestration : mêmes étapes séquentielles qu'avant, découpées par rôle.
async function _sbLoadStudentModules() {
  if (!sb || !G.currentUser || G.currentRole !== 'student') return;
  const listEl = document.getElementById('sh-module-list');
  // Le titre #sh-student-name appartient a renderStudentHome (format « Salut <prenom> »).
  // Il ecrivait ici le nom BRUT avant les 4 requetes -> le titre affichait « Test Eleve »
  // pendant tout le chargement puis basculait sur « Salut Test », a chaque login / clic
  // sur Actualiser / sauvegarde de module. Et si une requete echouait, le catch rendait
  // la main sans appeler renderStudentHome : le titre restait bloque sur le nom brut.
  // Le <h1> porte deja « Salut ! » en statique dans index.html.

  let assigned = [], personal = [];
  try {
    const myCls = await _sbFetchStudentClasses();
    // L'élève lit G.classes dans renderStudentHome pour afficher les révisions
    // ciblées du coach (cls.targetedReviews). Sans ça, la section « À revoir —
    // demandé par ton coach » reste vide en connecté (myCls restait local).
    G.classes = myCls;
    saveClasses();
    assigned = await _sbFetchAssignedModules(myCls);
    personal = await _sbFetchPersonalModules();
    // Ses propres lignes, greffees sur l'arbre vivant du coach (jamais l'inverse).
    _sbApplyStudentOverlays(assigned, await _sbFetchStudentOverlays());
    await _sbFetchStudentActivity();
  } catch (e) {
    console.error('_sbLoadStudentModules', e);
    if (listEl) listEl.innerHTML = '<div style="color:var(--red);padding:20px;text-align:center;font-size:.85rem">Erreur de chargement. Vérifiez votre connexion.</div>';
    return;
  }
  G.drills = [...assigned, ...personal];
  save();
  window.renderStudentHome?.(assigned, personal);
}

async function _sbSaveStudentModule(d) {
  return _sbRun('_sbSaveStudentModule', sb && G.currentUser, async () => {
    const row = _sbModuleToRow(d);
    row.owner_student_id = G.currentUser.uid;   // RLS : module perso de l'élève
    const { error } = await sb.from('modules').upsert(row);
    if (error) throw error;
  });
}

async function _sbDeleteStudentModule(id) {
  return _sbRun('_sbDeleteStudentModule', sb && G.currentUser, async () => {
    const { error } = await sb.from('modules').delete().eq('id', id);
    if (error) throw error;
  });
}

async function _sbRecordResult(rec) {
  return _sbRun('_sbRecordResult', sb && G.currentUser, async () => {
    const { error } = await sb.from('results').insert(_sbResultToRow(rec)); if (error) throw error;
  });
}

async function _sbRecordPractice(rec) {
  return _sbRun('_sbRecordPractice', sb && G.currentUser, async () => {
    const { error } = await sb.from('practice').insert(_sbPracticeToRow(rec)); if (error) throw error;
  });
}

async function _sbSaveGame(rec) {
  return _sbRun('_sbSaveGame', sb && G.currentUser, async () => {
    const { error } = await sb.from('games').insert(_sbGameToRow(rec)); if (error) throw error;
  });
}

// Mise à jour d'une partie existante (partage P1.3, annotation coach P1.4).
// UPDATE et non insert → pas de conflit de PK ; RLS games_update autorise
// l'élève (les siennes) ou le prof (parties partagées de ses élèves).
async function _sbUpdateGame(rec) {
  return _sbRun('_sbUpdateGame', sb && G.currentUser, async () => {
    const row = _sbGameToRow(rec); delete row.id;   // ne pas réécrire la clé
    const { error } = await sb.from('games').update(row).eq('id', rec.id);
    if (error) throw error;
  });
}

async function _sbDeleteGame(id) {
  return _sbRun('_sbDeleteGame', sb && G.currentUser, async () => {
    const { error } = await sb.from('games').delete().eq('id', id); if (error) throw error;
  });
}

// Parties de l'élève connecté (Maia + bibliothèque) → multi-appareils.
async function _sbLoadStudentGames() {
  return _sbRun('_sbLoadStudentGames', sb && G.currentUser && G.currentRole === 'student', async () => {
    const { data } = await sb.from('games').select('*').eq('student_id', G.currentUser.uid);
    G.savedGames = (data || []).map(_sbRowToGame);
    _cache('mc_games', G.savedGames);
  });
}

// Vue Prof : résultats / pratique / parties portant sur les modules du prof.
async function _sbLoadTeacherResults() {
  return _sbRun('_sbLoadTeacherResults', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const ids = G.drills.map(d => String(d.id));
    if (!ids.length) { G.results = []; _cache('mc_results', []); return; }
    const { data } = await sb.from('results').select('*').in('drill_id', ids);
    G.results = (data || []).map(_sbRowToResult);
    _cache('mc_results', G.results);
  });
}

async function _sbLoadTeacherPractice() {
  return _sbRun('_sbLoadTeacherPractice', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const ids = G.drills.map(d => String(d.id));
    if (!ids.length) { G.practiceLog = []; _cache('mc_practice', []); return; }
    const { data } = await sb.from('practice').select('*').in('drill_id', ids);
    G.practiceLog = (data || []).map(_sbRowToPractice);
    _cache('mc_practice', G.practiceLog);
  });
}

async function _sbLoadTeacherGames() {
  return _sbRun('_sbLoadTeacherGames', sb && G.currentUser && G.currentRole === 'teacher', async () => {
    const ids = G.drills.map(d => String(d.id));
    // 1) Parties Maia liées aux modules du prof (drill_id).
    let maia = [];
    if (ids.length) {
      const { data } = await sb.from('games').select('*').in('drill_id', ids);
      maia = (data || []).map(_sbRowToGame);
    }
    // 2) Parties bibliothèque partagées (drill_id null) — RLS games_read filtre aux élèves du prof.
    const { data: libRows } = await sb.from('games').select('*').is('drill_id', null);
    const lib = (libRows || []).map(_sbRowToGame).filter(g => g.shared);
    // Fusion dédoublonnée par id.
    const byId = {};
    [...maia, ...lib].forEach(g => { byId[g.id] = g; });
    G.savedGames = Object.values(byId);
    _cache('mc_games', G.savedGames);
  });
}

// Progression SM-2 (mastery) — stockée dans profiles.mastery (jsonb).
async function _sbSaveMastery() {
  const student = G.currentUser && (G.currentUser.displayName || G.currentUser.email);
  return _sbRun('_sbSaveMastery', sb && G.currentUser && student, async () => {
    const prefix = student + '_';
    const mine = {};
    for (const k in G.masteryData) if (k.startsWith(prefix)) mine[k] = G.masteryData[k];
    const { error } = await sb.from('profiles').update({ mastery: mine }).eq('id', G.currentUser.uid);
    if (error) throw error;
  });
}

async function _sbLoadMastery() {
  return _sbRun('_sbLoadMastery', sb && G.currentUser, async () => {
    const { data } = await sb.from('profiles').select('mastery').eq('id', G.currentUser.uid).maybeSingle();
    const m = data && data.mastery;
    if (m) {
      for (const k in m) if (!G.masteryData[k] || (m[k].due || 0) > (G.masteryData[k].due || 0)) G.masteryData[k] = m[k];
      _cache('mc_mastery', G.masteryData);
    }
  });
}

// ── Bases PGN personnelles (Pilier 1) — stockées dans profiles.extra.bases (jsonb) ──
// Défensif : si la colonne `extra` n'existe pas encore, l'erreur est catchée sans
// casser le reste (migration idempotente : alter table profiles add column if not exists extra jsonb default '{}';).
async function _sbSaveBases() {
  return _sbRun('_sbSaveBases', sb && G.currentUser && G.currentRole === 'student', async () => {
    const { error } = await sb.from('profiles').update({ extra: { bases: G.bases } }).eq('id', G.currentUser.uid);
    if (error) throw error;
  });
}

async function _sbLoadBases() {
  if (!sb || !G.currentUser) return;
  try {
    const { data } = await sb.from('profiles').select('extra').eq('id', G.currentUser.uid).maybeSingle();
    G.bases = (data && data.extra && data.extra.bases) || [];
    _cache('mc_bases', G.bases);
  } catch (e) { console.warn('_sbLoadBases (colonne extra manquante ?)', e); }
}

// ── Ponts window : les `_sb*` appelés par les handlers onclick="" et les autres
// modules lib/* (même ensemble qu'app.js exposait avant l'extraction) + le retry coach.
window.retryCoachLoad = _coachLoad;
Object.assign(window, {
  _sbDeleteClass, _sbDeleteStudentModule, _sbRecordPractice, _sbRecordResult,
  _sbSaveClass, _sbSaveGame, _sbUpdateGame, _sbDeleteGame, _sbSaveMastery, _sbSaveBases,
  _sbSaveStudentModule, _sbSaveStudentOverlay, _sbFetchStudentOverlays,
  _sbLoadTeacherOverlays, _sbSaveCoachOverlayReply,
});

// app.js (auth) importe les loaders déclenchés au login + _sbSaveModule/_sbDeleteModule
// (appelés par la vue coach via app.js).
export {
  _coachLoad, _sbLoadMastery, _sbLoadBases, _sbLoadStudentModules, _sbLoadStudentGames,
  _sbLoadTeacherResults, _sbLoadTeacherPractice, _sbLoadTeacherGames,
  _sbSaveModule, _sbDeleteModule,
};
