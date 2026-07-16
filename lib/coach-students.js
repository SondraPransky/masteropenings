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
  CS, _tierPct, _masteryBadge,
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

  // Liste élèves : roster complet (depuis les G.classes) + élèves ayant joué.
  // Rangée = vrai contrôle clavier (role/tabindex/Enter) — pas un div-onclick muet.
  document.getElementById('student-list').innerHTML = students.map(s => {
    const pct = s.total ? Math.round(s.correct/s.total*100) : 0;
    const since = s.lastTs ? Math.floor((_now-s.lastTs)/86400000) : null;
    const alertCls = s.behind ? ' alert' : s.stale ? ' warn' : '';
    const dotColor = !s.played ? 'var(--dim)' : since===0 ? 'var(--green)' : since<=7 ? 'var(--gold)' : 'var(--dim)';
    const isOn = s.key===CS.selectedStudent ? ' on' : '';
    // Signal « à suivre » à deux niveaux : retard réel (rouge) prime sur l'inactivité (ambre).
    const flag = s.behind ? `<span class="eleve-flag due">${s.due} à revoir</span>`
      : s.stale ? `<span class="eleve-flag stale">inactif ${since}j</span>` : '';
    return `<div class="eleve-item${isOn}${alertCls}" data-sname="${escapeHtml(s.key)}" data-search="${escapeHtml((s.label||'').toLowerCase())}" role="button" tabindex="0" aria-pressed="${isOn?'true':'false'}" onclick="showStudentDetail(this.dataset.sname)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showStudentDetail(this.dataset.sname)}">
      <div class="eleve-name">
        <span><i class="ti ${s.played?'ti-user':'ti-circle'}" aria-hidden="true"></i> ${escapeHtml(s.label)}</span>
        <div style="display:flex;align-items:center;gap:5px">
          <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};display:inline-block;flex-shrink:0"></span>
          ${s.played ? _masteryBadge(s.label) : ''}
        </div>
      </div>
      <div class="eleve-meta">${s.played ? (since===0?'Aujourd\'hui':since+'j')+' · '+pct+'% · '+s.total+' coup'+(s.total>1?'s':'') : 'Pas encore commencé'}${flag}</div>
      <div class="eleve-progbar"><div class="eleve-progfill" style="width:${pct}%;background:${_tierPct(pct)}"></div></div>
    </div>`;
  }).join('') || '<div style="color:var(--dim);font-size:.82rem;text-align:center;padding:24px">Aucun élève. Cliquez sur « + Ajouter un élève » en haut.</div>';

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
function rosterSearch(v) {
  _rosterQuery = (v || '').trim().toLowerCase();
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
