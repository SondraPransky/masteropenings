// ══════════════════════════════════════════════════════
// lib/coach-classes.js — PAGE CLASSES : cartes de classes (renderClassList,
// modules.js) → détail d'UNE classe (roster × modules, échéances, éditer/supprimer).
// Drill-down navigable. État local : _selectedClassId (il ne sort pas d'ici).
// Socle → coach-core.js ; appels latéraux → pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { _tierPct, _deadlinePill, _resultKeys, _clsRoster, escapeHtml } from './coach-core.js';

let _selectedClassId = null;

function renderClassesPage() {
  const list   = document.getElementById('cls-list');
  const detail = document.getElementById('cls-detail');
  if (!list || !detail) return;
  const badge = document.getElementById('csnav-count-classes');
  if (badge) badge.textContent = String(G.classes.length);
  const cls = _selectedClassId != null ? G.classes.find(c => String(c.id) === String(_selectedClassId)) : null;
  if (cls) {
    list.style.display = 'none';
    detail.style.display = '';
    detail.innerHTML = _classDetailHTML(cls);
  } else {
    _selectedClassId = null;
    detail.style.display = 'none';
    detail.innerHTML = '';
    list.style.display = '';
    window.renderClassList?.();
    if (!G.classes.length) {
      list.innerHTML = '<div class="empty" style="padding:32px;border:1px dashed var(--border);border-radius:var(--r)"><div class="empty-ico"><i class="ti ti-school" aria-hidden="true"></i></div>Aucune classe.<br>Cliquez sur « + Créer une classe » en haut pour organiser vos élèves.</div>';
    }
  }
}

function openClassDetail(id)  { _selectedClassId = id; renderClassesPage(); }
function closeClassDetail()   { _selectedClassId = null; renderClassesPage(); }

// Détail d'une classe : en-tête (retour, nom, actions CRUD) + suivi module × élève.
function _classDetailHTML(cls) {
  const modIds = (cls.moduleIds || []).map(String);
  const roster = _clsRoster(cls);
  const clsResults = G.results.filter(r => modIds.includes(String(r.drillId)));
  const activeCount = roster.filter(email => clsResults.some(r => _resultKeys(r).includes(email))).length;
  const name = cls.individual ? cls.name.replace(/^👤\s*/,'') : cls.name;
  return `<div class="cls-detail-head">
    <button class="btn btn-ghost btn-sm" onclick="closeClassDetail()"><i class="ti ti-arrow-left" aria-hidden="true"></i> Classes</button>
    <div class="cls-detail-title">
      <div class="cls-detail-name" title="${escapeHtml(name)}"><i class="ti ${cls.individual?'ti-user':'ti-school'}" aria-hidden="true"></i> ${escapeHtml(name)}</div>
      <div class="cls-detail-meta">${roster.length} élève${roster.length>1?'s':''} · ${activeCount} actif${activeCount>1?'s':''} · ${modIds.length} module${modIds.length>1?'s':''}</div>
    </div>
    <div class="cls-detail-actions">
      <button class="btn btn-ghost btn-sm" onclick="openEditClass(${cls.id})" title="Modifier"><i class="ti ti-edit" aria-hidden="true"></i> Modifier</button>
      <button class="btn btn-ghost btn-sm btn-ico" onclick="deleteClass(${cls.id})" title="Supprimer" aria-label="Supprimer la classe"><i class="ti ti-trash" aria-hidden="true"></i></button>
    </div>
  </div>
  <div class="card">${_classBreakdownHTML(cls)}</div>`;
}

// Décomposition par module assigné × élève (statut fait/retard/pas commencé + échéance).
// Rangée élève cliquable → détail élève (page Élèves).
function _classBreakdownHTML(cls) {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0,10);
  const matchStu = (r, email) => _resultKeys(r).includes(email);
  const modIds = (cls.moduleIds || []).map(String);
  const roster = _clsRoster(cls);
  const dls    = cls.moduleDeadlines || {};
  if (!roster.length) return '<div class="cls-empty-note">Aucun élève dans cette classe.</div>';
  if (!modIds.length) return '<div class="cls-empty-note">Aucun module assigné.</div>';
  return modIds.map(modId => {
    const d        = G.drills.find(x => String(x.id) === String(modId));
    const modName  = d ? d.name : '— supprimé —';
    const deadline = dls[modId] || null;
    const pastDue  = deadline && deadline < todayStr;
    const modResults = G.results.filter(r => String(r.drillId) === String(modId));
    let doneCount = 0;
    const stuRows = roster.map(email => {
      const sr = modResults.filter(r => matchStu(r, email));
      const played = sr.length > 0;
      if (played) doneCount++;
      const pct    = played ? Math.round(sr.filter(r => r.correct).length / sr.length * 100) : 0;
      const lastTs = played ? Math.max(...sr.map(r => r.ts || 0)) : 0;
      const since  = lastTs ? Math.floor((now - lastTs) / 86400000) : null;
      const late   = !played && pastDue;
      const status = played
        ? `<span class="cls-stu-pct" style="color:${_tierPct(pct)}">${pct}%</span> <span class="cls-stu-since">· ${since===0?'auj.':since+'j'}</span>`
        : late
          ? '<span class="cls-stu-late"><i class="ti ti-alert-triangle" aria-hidden="true"></i> En retard</span>'
          : '<span class="cls-stu-none">Pas commencé</span>';
      const display = window._studentDisplayName?.(email) || email;
      return `<button class="ov-row cls-stu-row" onclick="ovOpenStudent(this.dataset.k)" data-k="${escapeHtml(email)}" title="${escapeHtml(email)}">
        <span class="ov-row-name"><i class="ti ti-point-filled" style="color:${played?'var(--green)':(late?'var(--red)':'var(--dim)')}" aria-hidden="true"></i> ${escapeHtml(display)}</span>
        <span class="cls-stu-status">${status}</span>
      </button>`;
    }).join('');
    return `<div class="cls-mod-group">
      <div class="cls-mod-head">
        <span class="cls-mod-name"><i class="ti ti-stack-2" aria-hidden="true"></i> ${escapeHtml(modName)}</span>
        <span class="cls-mod-meta">${deadline ? _deadlinePill({ deadline }) : ''}<span class="cls-mod-count"><i class="ti ti-check" aria-hidden="true"></i> ${doneCount}/${roster.length}</span></span>
      </div>
      ${stuRows}
    </div>`;
  }).join('');
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/modules.js.
Object.assign(window, {
  renderClassesPage, openClassDetail, closeClassDetail,
});
