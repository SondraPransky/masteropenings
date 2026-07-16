// ══════════════════════════════════════════════════════
// lib/coach-students.js — PAGE ÉLÈVES : recherche + roster + détail d'un élève
// (Résumé prescriptif / Positions). L'élève sélectionné vit dans `CS` (coach-core)
// car coach-assign en a besoin ; selectedDrillFilter / _rosterQuery restent locaux
// (leurs seuls lecteurs sont ici).
// Socle → coach-core.js ; appels latéraux → pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import {
  CS, _tierPct, _tierFail, _masteryBadge, _deadlinePill,
  _classFilter, _populateClassFilter, _resultKeys, _matchStudentSet, _clsRoster,
  _computeRoster, _renderCoachLoading, _renderCoachError,
  sm2Get, fig, figText, escapeHtml,
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
  document.getElementById('prof-ui').style.display    = hasAny ? ''     : 'none';
  if (!hasAny) return;

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
  // Auto-sélection : sans élève choisi, ouvrir le premier du roster (trié par urgence)
  // plutôt que de laisser le skeleton de chargement (_renderCoachLoading écrit dans
  // #prof-detail et n'est jamais nettoyé sinon). Roster vide → vrai état vide, pas le skeleton.
  if (!CS.selectedStudent && students.length) CS.selectedStudent = students[0].key;
  if (CS.selectedStudent) showStudentDetail(CS.selectedStudent);
  else {
    const det = document.getElementById('prof-detail');
    if (det) det.innerHTML = '<div class="eleve-detail-empty"><div class="eleve-detail-empty-ico"><i class="ti ti-arrow-left" aria-hidden="true"></i></div>Sélectionnez un élève pour voir sa progression</div>';
  }
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

// Accélérateur clavier : ↑/↓ (et Début/Fin) naviguent la liste des élèves et
// sélectionnent au vol — power-coach au clavier, sans souris.
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
  const el = items[idx];
  el.focus();
  showStudentDetail(el.dataset.sname);
}

function showStudentDetail(id) {
  CS.selectedStudent = id;
  document.querySelectorAll('.eleve-item').forEach(el =>
    el.classList.toggle('on', el.dataset.sname === id)
  );

  const idLower = (id||'').toLowerCase();
  let sr = G.results.filter(r =>
    _resultKeys(r).includes(idLower) || (r.student||r.studentName) === id
  );
  const name = (sr[0] && sr[0].student) || id;   // nom affichable (sinon l'identifiant)
  if (selectedDrillFilter !== 'all') sr = sr.filter(r => String(r.drillId) === selectedDrillFilter);

  const byDrill = {};
  sr.forEach(r => {
    if (!byDrill[r.drillName]) byDrill[r.drillName] = { id: r.drillId, positions: {} };
    const key = r.posIdx + '_' + (r.san||'');
    if (!byDrill[r.drillName].positions[key])
      byDrill[r.drillName].positions[key] = { posIdx: r.posIdx, san: r.san, comment: r.comment, attempts: [], correct: false };
    byDrill[r.drillName].positions[key].attempts.push(r);
    if (r.correct) byDrill[r.drillName].positions[key].correct = true;
  });

  const total = sr.length, correctN = sr.filter(r => r.correct).length;
  const pct = total ? Math.round(correctN / total * 100) : 0;
  const lastDate = total ? new Date(Math.max(...sr.map(r => r.ts))).toLocaleDateString('fr-FR') : '—';
  const sessCount = G.practiceLog.filter(l => l.student === name).length;
  // Positions dues en révision espacée pour cet élève (indicateur prescriptif).
  const dueN = Object.keys(G.masteryData).filter(k => k.startsWith(name + '_') && (G.masteryData[k].due || 0) <= Date.now()).length;
  // Modules dont l'échéance d'assignation (portée par les classes de l'élève) est
  // dépassée — signal prescriptif « quoi faire ». On lit class.moduleDeadlines, pas
  // drill.deadline : l'échéance vit sur l'assignation (cohérent avec les vues classe/élève).
  const _today = new Date().toISOString().slice(0,10);
  const _overdueMods = new Set();
  G.classes
    .filter(c => _clsRoster(c).some(e => String(e).toLowerCase() === idLower))
    .forEach(c => {
      const md = c.moduleDeadlines || {};
      for (const mid in md) if (md[mid] && md[mid] < _today) _overdueMods.add(String(mid));
    });
  const lateN = _overdueMods.size;

  // ── Header ──
  let html = `<div class="eleve-detail-header">
    <div class="ed-hdr-name"><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(name)}</div>
    <div class="ed-hdr-sub">Dernière activité : ${lastDate} · ${sessCount} session${sessCount>1?'s':''}</div>
  </div>
  <div class="eleve-detail-body">`;

  if (!sr.length) {
    html += '<div class="ed-empty">Cet élève n\'a pas encore commencé.</div></div>';
    document.getElementById('prof-detail').innerHTML = html; return;
  }

  // ── KPI row ──
  // Couleurs via les tokens -ink (regle de l'encre : 18.4px bold = encore du petit texte,
  // les tokens de base y plafonnent a 3.3:1). La reussite passe par _tierPct — le meme
  // helper de palier que le reste de la vue coach, au lieu d'un seuil 70 reecrit ici.
  const _binInk = (bad) => bad ? 'var(--red-ink)' : 'var(--green-ink)';
  html += `<div class="ed-kpi-row">
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:${_tierPct(pct)}">${pct}%</div><div class="ed-kpi-l">Réussite</div></div>
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:${_binInk(dueN>0)}">${dueN}</div><div class="ed-kpi-l">À revoir</div></div>
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:${_binInk(lateN>0)}">${lateN}</div><div class="ed-kpi-l">En retard</div></div>
  </div>`;

  // ── Onglets ──
  html += `<div class="ed-tabs">
    <button class="ed-tab on" onclick="_edTab(this,'resume')"><i class="ti ti-chart-pie" aria-hidden="true"></i> Résumé</button>
    <button class="ed-tab" onclick="_edTab(this,'positions')"><i class="ti ti-list-details" aria-hidden="true"></i> Positions</button>
  </div>`;

  // ══ TAB 1 : Résumé ══
  const now = Date.now();
  let resumeHtml = '';
  for (const [drillName, ddata] of Object.entries(byDrill)) {
    const posArr = Object.values(ddata.positions).sort((a,b) => a.posIdx - b.posIdx);
    const dc = posArr.filter(p => p.correct).length;
    const dp = posArr.length ? Math.round(dc / posArr.length * 100) : 0;
    const drillSessions = G.practiceLog
      .filter(l => l.student === name && String(l.drillId) === String(ddata.id))
      .sort((a,b) => a.ts - b.ts).slice(-12);
    const n = drillSessions.length;
    let trendHtml = '';
    if (n >= 2) {
      const halfA = drillSessions.slice(0, Math.ceil(n/2)).reduce((s,l) => s+l.pct, 0) / Math.ceil(n/2);
      const halfB = drillSessions.slice(Math.ceil(n/2)).reduce((s,l) => s+l.pct, 0) / Math.max(1, n - Math.ceil(n/2));
      const diff = Math.round(halfB - halfA);
      trendHtml = diff > 5
        ? `<span class="ed-trend up"><i class="ti ti-trending-up" aria-hidden="true"></i> +${diff}%</span>`
        : diff < -5
          ? `<span class="ed-trend down"><i class="ti ti-trending-down" aria-hidden="true"></i> ${diff}%</span>`
          : `<span class="ed-trend flat">→ stable</span>`;
    }
    const bars = drillSessions.map(s => {
      const h = Math.max(4, Math.round(s.pct * 0.24));
      const col = _tierPct(s.pct);
      const dt = new Date(s.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
      return `<div class="ed-mini-bar" title="${dt} — ${s.pct}%" style="height:${h}px;background:${col}"></div>`;
    }).join('');
    const drill = G.drills.find(d => d.id === ddata.id);
    resumeHtml += `<div class="ed-mod-row">
      <div class="ed-mod-name" title="${escapeHtml(drillName)}">${escapeHtml(drillName)}</div>
      <div class="ed-mini-bars">${bars}</div>
      <span class="badge ${dp>=70?'badge-green':'badge-red'}" style="flex-shrink:0">${dp}%</span>
      ${trendHtml}
      ${drill ? _deadlinePill(drill) : ''}
    </div>`;
  }

  // « À revoir avec cet élève » : ses positions ratées + le commentaire (le pourquoi) — prescriptif.
  const errMap = {};
  sr.forEach(r => {
    const key = `${r.drillId}_${r.posIdx}_${r.san||''}`;
    if (!errMap[key]) errMap[key] = { drillId: r.drillId, drillName: r.drillName, san: r.san, comment: r.comment || '', fails: 0, attempts: 0 };
    errMap[key].attempts++;
    if (!r.correct) errMap[key].fails++;
    if (r.comment && !errMap[key].comment) errMap[key].comment = r.comment;
  });
  const topErrors = Object.values(errMap).filter(e => e.fails > 0)
    .sort((a,b) => b.fails - a.fails || b.fails/b.attempts - a.fails/a.attempts).slice(0, 5);
  if (topErrors.length) {
    resumeHtml += `<div class="ed-review-sec">
      <div class="ed-review-title"><i class="ti ti-target" aria-hidden="true"></i> À revoir avec cet élève <span class="ed-review-hint">— survolez pour voir la position</span></div>`;
    topErrors.forEach(e => {
      const rate = Math.round(e.fails / e.attempts * 100);
      const rc = _tierFail(rate);
      resumeHtml += `<div class="ed-review-item" tabindex="0" data-did="${escapeHtml(String(e.drillId))}" data-san="${escapeHtml(e.san||'')}"
        onmouseenter="wsTip(event,this.dataset.did,this.dataset.san)" onmouseleave="wsTipHide()"
        onfocus="wsTip(event,this.dataset.did,this.dataset.san)" onblur="wsTipHide()">
        <span class="ed-review-move">${fig(e.san||'?')}</span>
        <div class="ed-review-body">
          <div class="ed-review-meta">${escapeHtml(e.drillName)} · raté ${e.fails}×</div>
          ${e.comment?`<div class="ed-review-cmt">« ${figText(escapeHtml(e.comment.slice(0,90)))}${e.comment.length>90?'…':''} »</div>`:''}
        </div>
        <span class="ed-review-rate" style="color:${rc}">${rate}%</span>
        <button class="btn btn-blue btn-sm btn-ico" title="Assigner cette révision à l'élève" aria-label="Assigner cette révision à l'élève"
          onclick="event.stopPropagation();assignReviewForStudent(this)"><i class="ti ti-target" aria-hidden="true"></i></button>
      </div>`;
    });
    resumeHtml += '</div>';
  }
  html += `<div class="ed-tab-body" id="edt-resume">${resumeHtml}</div>`;

  // ══ TAB 2 : Positions ══
  let posHtml = '';
  for (const [drillName, ddata] of Object.entries(byDrill)) {
    const posArr = Object.entries(ddata.positions)
      .sort((a,b) => a[1].posIdx - b[1].posIdx)
      .map(([key,p]) => ({ ...p, key, sm2: sm2Get(name, ddata.id, key) }));
    const dc = posArr.filter(p => p.correct).length;
    const dp = posArr.length ? Math.round(dc / posArr.length * 100) : 0;
    const drill = G.drills.find(d => d.id === ddata.id);
    posHtml += `<div class="ed-pos-group">
      <div class="ed-pos-head">
        <div class="ed-subhead"><i class="ti ti-book" aria-hidden="true"></i> ${escapeHtml(drillName)}</div>
        <div class="ed-pos-head-badges">
          <span class="badge ${dp>=70?'badge-green':'badge-red'}">${dp}%</span>
          ${drill ? _deadlinePill(drill) : ''}
        </div>
      </div>
      <table class="pos-table">
        <thead><tr><th>#</th><th>Coup</th><th>Résultat</th><th>Révision</th></tr></thead>
        <tbody>${posArr.map(p => {
          const nW = p.attempts.filter(a => !a.correct).length;
          const due = p.sm2 ? (p.sm2.due<=now ? '<span class="mastery-pill low">À revoir</span>' : `<span class="mastery-pill ok">dans ${Math.ceil((p.sm2.due-now)/86400000)}j</span>`) : '<span class="ed-pos-dash">—</span>';
          return `<tr tabindex="0" data-did="${escapeHtml(String(ddata.id))}" data-san="${escapeHtml(p.san||'')}"
            onmouseenter="wsTip(event,this.dataset.did,this.dataset.san)" onmouseleave="wsTipHide()"
            onfocus="wsTip(event,this.dataset.did,this.dataset.san)" onblur="wsTipHide()">
            <td class="ed-pos-num">${p.posIdx+1}</td>
            <td><span class="mono-move">${escapeHtml(p.san||'')}</span></td>
            <td>${p.correct ? `<span class="ok-pill">✓${nW>0?' ('+nW+'x)':''}</span>` : `<span class="error-pill">✗ (${p.attempts.length})</span>`}</td>
            <td>${due}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }
  html += `<div class="ed-tab-body" id="edt-positions" style="display:none">${posHtml}</div>`;

  html += '</div>'; // close eleve-detail-body
  document.getElementById('prof-detail').innerHTML = html;
}

function _edTab(btn, tab) {
  const detail = document.getElementById('prof-detail');
  detail.querySelectorAll('.ed-tab-body').forEach(b => b.style.display = 'none');
  detail.querySelectorAll('.ed-tab').forEach(b => b.classList.remove('on'));
  const body = detail.querySelector('#edt-' + tab);
  if (body) body.style.display = '';
  btn.classList.add('on');
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/coach-*.
Object.assign(window, {
  renderProfView, showStudentDetail, _edTab, rosterSearch, _eleveListKey,
});
