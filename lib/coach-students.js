// ══════════════════════════════════════════════════════
// lib/coach-students.js — PAGE ÉLÈVES : recherche + LISTE des élèves.
// Drill-down : cliquer un élève ouvre sa page profil (lib/coach-student-page.js) ;
// l'ancien panneau « détail » 2 onglets (Résumé / Positions) a été absorbé par elle.
// L'élève sélectionné vit dans `CS` (coach-core) car coach-assign en a besoin ;
// selectedDrillFilter / _rosterQuery restent locaux (leurs seuls lecteurs sont ici).
// Socle → coach-core.js ; appels latéraux → pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import {
  CS, _tierPct, _studentAvatar, _studentIdSet,
  _classFilter, _populateClassFilter, _matchStudentSet, _clsRoster,
  _computeRoster, _renderCoachLoading, _renderCoachError, escapeHtml,
} from './coach-core.js';

let selectedDrillFilter='all';
let _rosterQuery='';   // filtre texte de la liste des élèves (recherche par nom)

function renderProfView(){
  if (G._coachLoading === 'loading') { _renderCoachLoading(); return; }
  if (G._coachLoading === 'error')   { _renderCoachError(); return; }
  selectedDrillFilter = document.getElementById('prof-drill-filter').value;

  // Des élèves inscrits (via G.classes) suffisent à afficher le panneau, même sans résultat encore.
  const hasStudents = G.classes.some(c => _clsRoster(c).length);
  const hasAny = G.results.length || G.practiceLog.length || G.savedGames.length || hasStudents;
  document.getElementById('prof-empty').style.display = hasAny ? 'none' : 'block';
  if (!hasAny) { _syncStudentRoute(); document.getElementById('prof-ui').style.display = 'none'; return; }
  // La bascule liste/page appartient à _syncStudentRoute : sans ça, un re-rendu (filtre,
  // rechargement coach) rallumerait la liste PAR-DESSUS la page profil ouverte.
  _syncStudentRoute();

  // Update drill filter options
  const filterEl = document.getElementById('prof-drill-filter');
  const prev = filterEl.value;
  filterEl.innerHTML = '<option value="all">Tous les modules</option>' +
    G.drills.map(d=>`<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  filterEl.value = prev;

  // Filtre par classe (roster + résultats restreints aux élèves de la classe choisie)
  _populateClassFilter(document.getElementById('prof-class-filter'));
  const cf = _classFilter('prof-class-filter');

  let filtered = selectedDrillFilter==='all' ? G.results : G.results.filter(r=>String(r.drillId)===selectedDrillFilter);
  if (cf) filtered = filtered.filter(r => _matchStudentSet(r, cf.set));

  // Roster filtré + flags « à suivre » (le KPI strip et les points faibles vivent
  // désormais sur la Vue d'ensemble — cette page = recherche + roster + détail).
  const { students } = _computeRoster(filtered, cf ? cf.ids : null);
  const _now = Date.now();

  // Update sidebar eleves badge
  const eleveBadge = document.getElementById('csnav-count-eleves');
  if (eleveBadge) eleveBadge.textContent = String(students.length);
  const eleveCount2 = document.getElementById('csnav-count-eleves2');
  if (eleveCount2) eleveCount2.textContent = students.length + ' élève' + (students.length>1?'s':'');
  // ── Option A (arbitrage 03/08) : SECTIONS PAR CLASSE, rangées compactes ──────
  // La structure vraie du club (la leçon du répertoire par camp) : chaque classe est
  // une section, les élèves des rangées triées par urgence DANS leur section. La
  // teinte rouge est réservée aux vrais retards ; « inactif » redevient neutre —
  // « vu il y a N j » le dit en clair. Un élève dans 2 classes apparaît 2 fois.
  const rowHTML = (s) => {
    const pct = s.total ? Math.round(s.correct/s.total*100) : 0;
    const since = s.lastTs ? Math.floor((_now-s.lastTs)/86400000) : null;
    const isOn = s.key===CS.selectedStudent ? ' on' : '';
    const pill = s.behind ? `<span class="eleve-pill due"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${s.due} à revoir</span>`
      : s.played ? '<span class="eleve-pill okp">à jour</span>'
      : '<span class="eleve-pill zero">pas commencé</span>';
    const meta = s.played
      ? (since===0?"vu aujourd'hui":'vu il y a '+since+' j')+' · '+pct+' % de réussite · '+s.total+' coup'+(s.total>1?'s':'')
      : 'Pas encore commencé';
    return `<div class="eleve-item${isOn}${s.behind?' alert':''}" data-sname="${escapeHtml(s.key)}" data-search="${escapeHtml(_noAcc(s.label||''))}" role="button" tabindex="0" aria-pressed="${isOn?'true':'false'}" onclick="showStudentDetail(this.dataset.sname)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showStudentDetail(this.dataset.sname)}">
      ${_studentAvatar(s.key, s.label, 28)}
      <span class="eleve-name-txt">${escapeHtml(s.label)}</span>
      <span class="eleve-meta">${meta}</span>
      <span class="eleve-progbar"><span class="eleve-progfill" style="width:${pct}%;background:${_tierPct(pct)}"></span></span>
      ${pill}
    </div>`;
  };
  // Tri d'urgence : en retard d'abord (les plus chargés en tête), puis les actifs
  // récents, puis les « pas commencé » en queue de section.
  const urgence = (a, b) => (b.behind - a.behind) || (b.due - a.due) || (b.played - a.played) || (b.lastTs - a.lastTs);
  const idSets = new Map(students.map(s => [s.key, _studentIdSet(s.key)]));
  const selClass = document.getElementById('prof-class-filter')?.value || 'all';
  const inClass = new Set();
  const sections = G.classes.filter(c => selClass === 'all' || String(c.id) === String(selClass)).map(c => {
    const roster = _clsRoster(c).map(e => String(e).toLowerCase());
    const list = students.filter(s => roster.some(e => idSets.get(s.key)?.has(e)));
    list.forEach(s => inClass.add(s.key));
    if (!list.length) return '';
    const nLate = list.filter(s => s.behind).length;
    const nm = escapeHtml((c.name || '').replace(/^👤\s*/, ''));
    return `<div class="eleve-sec">
      <div class="eleve-sec-h"><i class="ti ${c.individual ? 'ti-user' : 'ti-school'}" aria-hidden="true"></i> ${nm}
        <span class="eleve-sec-n">${list.length} élève${list.length>1?'s':''}${nLate ? ` · <b>${nLate} en retard</b>` : ''}</span></div>
      ${list.sort(urgence).map(rowHTML).join('')}
    </div>`;
  }).join('');
  const orphans = selClass === 'all' ? students.filter(s => !inClass.has(s.key)).sort(urgence) : [];
  const orphanSec = orphans.length ? `<div class="eleve-sec">
      <div class="eleve-sec-h"><i class="ti ti-users" aria-hidden="true"></i> Sans classe
        <span class="eleve-sec-n">${orphans.length} élève${orphans.length>1?'s':''}</span></div>
      ${orphans.map(rowHTML).join('')}
    </div>` : '';
  document.getElementById('student-list').innerHTML = (sections + orphanSec)
    || '<div style="color:var(--dim);font-size:.82rem;text-align:center;padding:24px">Aucun élève. Cliquez sur « + Ajouter un élève » en haut.</div>';

  _applyRosterFilter();   // ré-applique le filtre de recherche après re-rendu
  // ⚠ PAS d'auto-sélection ici. L'ancien layout (roster + panneau à droite) ouvrait le 1er
  // élève par défaut pour éviter un faux skeleton dans #prof-detail (fix du 15/07). En
  // drill-down ça ouvrirait la PAGE d'un élève au hasard à l'arrivée : la sélection est
  // désormais une navigation, donc une intention. La liste est l'état par défaut.
}

// ── Drill-down : liste ⇄ page profil (patron openClassDetail, coach-classes.js) ──
// `showStudentDetail` garde son nom : il est câblé dans ~6 onclick, dans ovOpenStudent
// (Vue d'ensemble) et dans _eleveListKey. Il ouvre maintenant la PAGE.
function showStudentDetail(id) {
  CS.selectedStudent = id;
  _syncStudentRoute();
}
function closeStudentPage() {
  CS.selectedStudent = null;
  _syncStudentRoute();
  renderProfView();
}
// Bascule liste ⇄ page. L'en-tête de liste (titre « Élèves » + filtres) se masque avec
// la liste : au-dessus du profil de Nicolas, il serait trompeur.
function _syncStudentRoute() {
  const open = !!CS.selectedStudent;
  const set = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; };
  set('prof-list-header', !open);
  set('prof-ui', !open);
  set('prof-page', open);
  if (open) window.renderStudentPage?.(CS.selectedStudent);
}

// Recherche du roster : filtre live des cartes élèves par nom (persiste au re-rendu).
// Insensible aux ACCENTS des deux côtés (« chloe » doit trouver Chloé) — le bug de la
// recherche du répertoire (23/07), jamais propagé ici, retrouvé à l'audit du 03/08.
const _noAcc = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function rosterSearch(v) {
  _rosterQuery = _noAcc((v || '').trim());
  _applyRosterFilter();
}
function _applyRosterFilter() {
  const list = document.getElementById('student-list');
  if (!list) return;
  const items = [...list.querySelectorAll('.eleve-item')];
  let shown = 0;
  items.forEach(el => {
    const hit = !_rosterQuery || (el.dataset.search || '').includes(_rosterQuery);
    el.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });
  // Une section (classe) dont toutes les rangées sont filtrées se masque avec elles.
  [...list.querySelectorAll('.eleve-sec')].forEach(sec => {
    const any = [...sec.querySelectorAll('.eleve-item')].some(el => el.style.display !== 'none');
    sec.style.display = any ? '' : 'none';
  });
  // Message « aucun résultat » (créé/retiré à la volée).
  let empty = list.querySelector('.eleve-roster-empty');
  if (_rosterQuery && shown === 0) {
    if (!empty) { empty = document.createElement('div'); empty.className = 'eleve-roster-empty'; list.appendChild(empty); }
    empty.textContent = `Aucun élève ne correspond à « ${_rosterQuery} ».`;
  } else if (empty) { empty.remove(); }
}

// Accélérateur clavier : ↑/↓ (et Début/Fin) parcourent la liste des élèves.
// ⚠ Les flèches ne font QUE déplacer le focus. Avant le drill-down elles ouvraient
// l'élève au vol (le panneau se contentait de se redessiner) ; maintenant ouvrir = NAVIGUER,
// et naviguer à chaque pression de flèche serait un piège. C'est Entrée/Espace qui ouvre
// (déjà porté par la carte elle-même, role=button).
function _eleveListKey(e) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const items = [...document.querySelectorAll('#student-list .eleve-item')].filter(el => el.style.display !== 'none');
  if (!items.length) return;
  const cur = document.activeElement?.closest?.('.eleve-item');
  let idx = items.indexOf(cur);
  if (e.key === 'ArrowDown')      idx = idx < 0 ? 0 : Math.min(items.length - 1, idx + 1);
  else if (e.key === 'ArrowUp')   idx = idx < 0 ? items.length - 1 : Math.max(0, idx - 1);
  else if (e.key === 'Home')      idx = 0;
  else if (e.key === 'End')       idx = items.length - 1;
  e.preventDefault();
  items[idx].focus();
}


// Ouvre la copie d'un élève : le module du coach + les lignes que l'élève y a greffées
// (en bleu). Le coach voit SA version comme référence et les ajouts par-dessus ; son
// propre module n'est jamais touché — l'ouverture passe par une COPIE de travail, pas
// par l'entrée de G.drills.
function openStudentOverlay(moduleId, overlayId) {
  const mod = G.drills.find(d => String(d.id) === String(moduleId));
  const ov  = (G.studentOverlays || []).find(o => String(o.id) === String(overlayId));
  if (!mod || !ov) { window.toast?.('⚠ Module introuvable', 'ko'); return; }
  // Copie de TRAVAIL, jamais poussée dans G.drills (qui est persisté en localStorage) :
  // l'éditeur reçoit le module par objet. Le module du coach reste hors d'atteinte.
  window.openStudentLayerEditor?.(
    { ...mod, _coachTree: mod.tree, _layerTree: ov.tree, _overlayId: ov.id,
      _overlayBy: ov.overlayBy, _overlayOwnerId: ov.ownerStudentId },
    'coach');
}

// Rappel de l'éditeur : le coach a répondu dans la copie d'un élève.
// La ligne appartient à l'ÉLÈVE (owner_student_id) — le coach n'y écrit que parce qu'elle
// porte aussi son teacher_id. On repasse donc l'identité et le propriétaire d'origine :
// les écraser reviendrait à voler la ligne à l'élève.
function _coachOverlayReplyDone(moduleId, diff, meta) {
  if (!meta?.overlayId || !meta?.ownerId) { window.toast?.('⚠ Couche introuvable', 'ko'); return; }
  const overlay = {
    id:             meta.overlayId,
    teacherId:      G.currentUser?.uid || null,
    ownerStudentId: meta.ownerId,        // reste l'élève
    name:           meta.name,
    side:           meta.side,
    varmode:        'tree',
    tree:           diff,                // lignes de l'élève + réponses du coach (tagées)
    overlayOf:      moduleId,
    overlayBy:      meta.overlayBy,      // l'identité de l'élève, conservée
    updatedAt:      Date.now()
  };
  const local = (G.studentOverlays || []).find(o => String(o.id) === String(meta.overlayId));
  if (local) local.tree = diff;          // la vue coach reflète la réponse tout de suite
  window._sbSaveCoachOverlayReply?.(overlay);
  window.toast?.('✓ Ta réponse est enregistrée — l\'élève la verra en violet', 'ok');
  showStudentDetail(CS.selectedStudent);
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/coach-*.
Object.assign(window, {
  renderProfView, showStudentDetail, closeStudentPage, rosterSearch, _eleveListKey, openStudentOverlay,
  _coachOverlayReplyDone,
});
