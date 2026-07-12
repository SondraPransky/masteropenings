// ══════════════════════════════════════════════════════
// VUE COACH — suivi des élèves (onglets présence / progression / classes /
// parties / heatmap) + exports CSV/PGN/JSON.
// Extrait d'app.js (§5.3). État local au module (selectedStudent,
// selectedDrillFilter, _profTab) : rien n'en sort.
// Données : `G` (state.js). Fonctions app-level via le pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const switchCoachSection = (...a) => window.switchCoachSection?.(...a);
const sm2Get             = (...a) => window.sm2Get?.(...a);
const toast              = (...a) => window.toast?.(...a);
const fig        = (x) => window.fig ? window.fig(x) : x;
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

// ══════════════════════════════════════════════════════
// VUE PROF — tabbed
// ══════════════════════════════════════════════════════
let selectedStudent=null, selectedDrillFilter='all', _profTab='presence';

function _masteryBadge(name) {
  const now = Date.now();
  const keys = Object.keys(G.masteryData).filter(k=>k.startsWith(name+'_'));
  if (!keys.length) return '';
  const due = keys.filter(k=>G.masteryData[k].due<=now).length;
  const learned = keys.filter(k=>(G.masteryData[k].level||0)>=4).length;   // Leitner : niveau ≥4 = ≥1 semaine (« appris »)
  if (due > 0) return `<span class="mastery-pill low"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${due} à réviser</span>`;
  if (learned === keys.length) return `<span class="mastery-pill ok"><i class="ti ti-circle-check" aria-hidden="true"></i> Maîtrisé</span>`;
  return `<span class="mastery-pill mid">${learned}/${keys.length} appris</span>`;
}

function _deadlinePill(drill) {
  if (!drill.deadline) return '';
  const today = new Date().toISOString().slice(0,10);
  const diff  = (new Date(drill.deadline).getTime() - new Date(today).getTime()) / 86400000;
  if (diff < 0)  return `<span class="deadline-pill late"><i class="ti ti-alert-triangle" aria-hidden="true"></i> En retard</span>`;
  if (diff <= 3) return `<span class="deadline-pill soon"><i class="ti ti-clock" aria-hidden="true"></i> Dans ${Math.round(diff)}j</span>`;
  return `<span class="deadline-pill ok"><i class="ti ti-calendar" aria-hidden="true"></i> ${drill.deadline}</span>`;
}

// Points faibles de la classe : positions qui font échouer le plus d'élèves.
function _classWeakSpots(arr) {
  const byPos = {};
  arr.forEach(r => {
    const key = r.drillId + '|' + (r.san || '');
    if (!byPos[key]) byPos[key] = { drillName: r.drillName, san: r.san, comment: r.comment || '', attempts: 0, fails: 0, failStudents: new Set() };
    const p = byPos[key];
    p.attempts++;
    if (!r.correct) { p.fails++; p.failStudents.add(r.student || r.studentName || 'Anonyme'); }
    if (r.comment && !p.comment) p.comment = r.comment;
  });
  return Object.values(byPos)
    .filter(p => p.fails > 0)
    .map(p => ({ ...p, failStudentCount: p.failStudents.size, rate: Math.round(p.fails / p.attempts * 100) }))
    .sort((a, b) => b.failStudentCount - a.failStudentCount || b.rate - a.rate)
    .slice(0, 6);
}

function renderClassWeakSpots(arr) {
  const el = document.getElementById('prof-weakspots');
  if (!el) return;
  const spots = _classWeakSpots(arr || []);
  if (!spots.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="ws-card">
    <div class="ws-head" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <span><i class="ti ti-target" aria-hidden="true"></i> Points faibles de la classe</span>
      <button onclick="switchCoachSection('heatmap')" style="background:none;border:none;color:var(--cyan);font-size:.74rem;font-weight:600;cursor:pointer;padding:0;white-space:nowrap">Analyse complète →</button>
    </div>
    <div class="ws-sub">Aperçu des positions qui font le plus échouer tes élèves — à revoir en cours.</div>
    ${spots.map(s => `<div class="ws-row">
      <span class="ws-move">${fig(s.san)}</span>
      <div class="ws-info">
        <div class="ws-name">${escapeHtml(s.drillName || 'Module')}${s.comment ? ` · <span class="ws-comment">${escapeHtml(s.comment.slice(0,42))}</span>` : ''}</div>
        <div class="ws-bar"><div class="ws-fill" style="width:${s.rate}%"></div></div>
      </div>
      <span class="ws-stat">${s.failStudentCount} élève${s.failStudentCount > 1 ? 's' : ''} · ${s.rate}%</span>
    </div>`).join('')}
  </div>`;
}

// Filtre par classe : { ids:[minuscule], set:Set } de la classe sélectionnée, ou null (toutes).
function _classFilter(selectId) {
  const v = document.getElementById(selectId)?.value || 'all';
  if (v === 'all') return null;
  const cls = G.classes.find(c => String(c.id) === String(v));
  if (!cls) return null;
  const ids = (cls.studentEmails || cls.students || []).map(s => String(s).toLowerCase());
  return { ids, set: new Set(ids) };
}
function _populateClassFilter(el) {
  if (!el) return;
  const prev = el.value;
  el.innerHTML = '<option value="all">Toutes les classes</option>' +
    G.classes.map(c => `<option value="${c.id}">${escapeHtml((c.individual ? (c.name||'') : c.name).replace(/^👤\s*/,''))}</option>`).join('');
  el.value = prev;
}
// Un résultat/log appartient-il à un élève de l'ensemble (par email/pseudo/nom) ?
const _matchStudentSet = (r, set) => [(r.studentEmail||'').toLowerCase(),(r.studentPseudo||'').toLowerCase(),(r.student||'').toLowerCase()].some(k => k && set.has(k));

// Roster unifié pour la Vue Prof : élèves des G.classes (pseudo/email) + élèves avec résultats, dédupliqués.
function _buildProfRoster(filtered, rosterIdsArg) {
  const rosterIds = rosterIdsArg || [...new Set(G.classes.flatMap(c => (c.studentEmails || c.students || [])))];
  const keysOf = r => [(r.studentEmail||'').toLowerCase(), (r.studentPseudo||'').toLowerCase(), (r.student||'').toLowerCase()].filter(Boolean);
  const map = {};
  rosterIds.forEach(id => { map[id] = { key:id, label:id, total:0, correct:0, lastTs:0, played:false }; });
  const attach = (r, isResult) => {
    const keys = keysOf(r);
    let target = rosterIds.find(id => keys.includes(id));
    if (!target) { target = keys[0] || (r.student||'anonyme').toLowerCase(); if (!map[target]) map[target] = { key:target, label:r.student||target, total:0, correct:0, lastTs:0, played:false }; }
    const s = map[target];
    if (r.student) s.label = r.student;
    if ((r.ts||0) > s.lastTs) s.lastTs = r.ts;
    s.played = true;
    if (isResult) { s.total++; if (r.correct) s.correct++; }
  };
  filtered.forEach(r => attach(r, true));
  G.practiceLog.forEach(l => attach(l, false));
  return Object.values(map).sort((a,b) => b.lastTs - a.lastTs);
}

function renderProfView(){
  selectedDrillFilter = document.getElementById('prof-drill-filter').value;

  // Des élèves inscrits (via G.classes) suffisent à afficher le panneau, même sans résultat encore.
  const hasStudents = G.classes.some(c => (c.studentEmails || c.students || []).length);
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

  // KPIs
  const students   = _buildProfRoster(filtered, cf ? cf.ids : null);
  const totalRes   = filtered.length;
  const correct    = filtered.filter(r=>r.correct).length;
  const avgPct     = totalRes ? Math.round(correct/totalRes*100) : 0;
  let sessions     = selectedDrillFilter==='all' ? G.practiceLog : G.practiceLog.filter(l=>String(l.drillId)===selectedDrillFilter);
  if (cf) sessions = sessions.filter(l => _matchStudentSet(l, cf.set));
  // Réussite : neutre tant qu'il n'y a rien à mesurer (pas de rouge alarmant sur données vides),
  // puis 3 paliers encourageants (vert ≥70 · ambre ≥50 · rouge <50) plutôt qu'un binaire sec.
  const pctColor   = !totalRes ? 'var(--dim)' : avgPct>=70 ? 'var(--green)' : avgPct>=50 ? 'var(--gold)' : 'var(--red)';
  const pctDisplay = totalRes ? avgPct+'%' : '—';
  document.getElementById('prof-kpis').innerHTML=`
    <div class="cs-kpi"><div class="cs-kpi-val" style="color:var(--blue)">${students.length}</div><div class="cs-kpi-lbl">Élèves</div></div>
    <div class="cs-kpi"><div class="cs-kpi-val" style="color:var(--cyan)">${sessions.length}</div><div class="cs-kpi-lbl">Sessions</div></div>
    <div class="cs-kpi"><div class="cs-kpi-val" style="color:${pctColor}">${pctDisplay}</div><div class="cs-kpi-lbl">Réussite</div></div>
    <div class="cs-kpi"><div class="cs-kpi-val" style="color:var(--blue)">${G.savedGames.filter(g=>!g.baseId).length}</div><div class="cs-kpi-lbl">Parties Maia</div></div>`;

  // Points faibles de la classe (insight actionnable)
  renderClassWeakSpots(filtered);

  // Update sidebar eleves badge
  const eleveBadge = document.getElementById('csnav-count-eleves');
  if (eleveBadge) eleveBadge.textContent = String(students.length);
  const eleveCount2 = document.getElementById('csnav-count-eleves2');
  if (eleveCount2) eleveCount2.textContent = students.length + ' élève' + (students.length>1?'s':'');

  // Liste élèves : roster complet (depuis les G.classes) + élèves ayant joué
  const _now = Date.now();
  const _wkAgo = _now - 7 * 86400000;
  const _activeWk = students.filter(s => s.lastTs >= _wkAgo).length;
  const _inactive = students.filter(s => s.played && s.lastTs < _wkAgo).length;
  const _srSummary = students.length ? `<div class="sr-coach-summary"><i class="ti ti-refresh" aria-hidden="true"></i> Révisions — <strong>${_activeWk}</strong> actif${_activeWk>1?'s':''} cette semaine · <strong>${_inactive}</strong> inactif${_inactive>1?'s':''} (&gt;7j) · rétention moyenne ${avgPct}%</div>` : '';
  document.getElementById('student-list').innerHTML = _srSummary + students.map(s => {
    const pct = s.total ? Math.round(s.correct/s.total*100) : 0;
    const since = s.lastTs ? Math.floor((_now-s.lastTs)/86400000) : null;
    const dueCount = Object.keys(G.masteryData).filter(k => k.startsWith(s.label+'_') && G.masteryData[k].due<=_now).length;
    const alertCls = dueCount > 0 ? ' alert' : '';
    const dotColor = !s.played ? 'var(--dim)' : since===0 ? 'var(--green)' : since<=7 ? '#d97706' : 'var(--dim)';
    const isOn = s.key===selectedStudent ? ' on' : '';
    return `<div class="eleve-item${isOn}${alertCls}" data-sname="${escapeHtml(s.key)}" onclick="showStudentDetail(this.dataset.sname)">
      <div class="eleve-name">
        <span><i class="ti ${s.played?'ti-user':'ti-circle'}" aria-hidden="true"></i> ${escapeHtml(s.label)}</span>
        <div style="display:flex;align-items:center;gap:5px">
          <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};display:inline-block;flex-shrink:0"></span>
          ${s.played ? _masteryBadge(s.label) : ''}
        </div>
      </div>
      <div class="eleve-meta">${s.played ? (since===0?'Aujourd\'hui':since+'j')+' · '+pct+'% · '+s.total+' coup'+(s.total>1?'s':'') : 'Pas encore commencé'}</div>
      <div class="eleve-progbar"><div class="eleve-progfill" style="width:${pct}%;background:${pct>=70?'var(--green)':pct>=50?'#facc15':'var(--red)'}"></div></div>
    </div>`;
  }).join('') || '<div style="color:var(--dim);font-size:.82rem;text-align:center;padding:24px">Aucun élève. Cliquez sur « + Ajouter un élève » en haut.</div>';

  if (selectedStudent) showStudentDetail(selectedStudent);
}

function showStudentDetail(id) {
  selectedStudent = id;
  document.querySelectorAll('.eleve-item').forEach(el =>
    el.classList.toggle('on', el.dataset.sname === id)
  );

  const idLower = (id||'').toLowerCase();
  let sr = G.results.filter(r =>
    [(r.studentEmail||'').toLowerCase(), (r.studentPseudo||'').toLowerCase(), (r.student||'').toLowerCase()].includes(idLower)
    || (r.student||r.studentName) === id
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
  const drillCount = Object.keys(byDrill).length;

  // ── Header ──
  let html = `<div class="eleve-detail-header">
    <div style="font-size:1.05rem;font-weight:700"><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(name)}</div>
    <div style="font-size:.73rem;color:var(--dim);margin-top:3px">Dernière activité : ${lastDate} · ${sessCount} session${sessCount>1?'s':''}</div>
  </div>
  <div class="eleve-detail-body">`;

  if (!sr.length) {
    html += '<div style="padding:20px;color:var(--dim);font-size:.83rem">Cet élève n\'a pas encore commencé.</div></div>';
    document.getElementById('prof-detail').innerHTML = html; return;
  }

  // ── KPI row ──
  html += `<div class="ed-kpi-row">
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:${pct>=70?'var(--green)':'var(--red)'}">${pct}%</div><div class="ed-kpi-l">Réussite</div></div>
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:var(--cyan)">${sessCount}</div><div class="ed-kpi-l">Sessions</div></div>
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:var(--blue)">${drillCount}</div><div class="ed-kpi-l">Modules</div></div>
  </div>`;

  // ── Onglets ──
  html += `<div class="ed-tabs">
    <button class="ed-tab on" onclick="_edTab(this,'resume')"><i class="ti ti-chart-pie" aria-hidden="true"></i> Résumé</button>
    <button class="ed-tab" onclick="_edTab(this,'positions')"><i class="ti ti-list-details" aria-hidden="true"></i> Positions</button>
    <button class="ed-tab" onclick="_edTab(this,'progression')"><i class="ti ti-trending-up" aria-hidden="true"></i> Progression</button>
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
        ? `<span style="color:var(--green);font-size:.67rem;flex-shrink:0"><i class="ti ti-trending-up" aria-hidden="true"></i> +${diff}%</span>`
        : diff < -5
          ? `<span style="color:var(--red);font-size:.67rem;flex-shrink:0"><i class="ti ti-trending-down" aria-hidden="true"></i> ${diff}%</span>`
          : `<span style="color:var(--dim);font-size:.67rem;flex-shrink:0">→ stable</span>`;
    }
    const bars = drillSessions.map(s => {
      const h = Math.max(4, Math.round(s.pct * 0.24));
      const col = s.pct>=70?'var(--green)':s.pct>=50?'#facc15':'var(--red)';
      const dt = new Date(s.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
      return `<div class="ed-mini-bar" title="${dt} — ${s.pct}%" style="height:${h}px;background:${col};opacity:.85"></div>`;
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

  // Top erreurs dans le résumé
  const errMap = {};
  sr.forEach(r => {
    const key = `${r.drillId}_${r.posIdx}_${r.san||''}`;
    if (!errMap[key]) errMap[key] = { drillName: r.drillName, san: r.san, fails: 0, attempts: 0 };
    errMap[key].attempts++;
    if (!r.correct) errMap[key].fails++;
  });
  const topErrors = Object.values(errMap).filter(e => e.fails > 0)
    .sort((a,b) => b.fails - a.fails || b.fails/b.attempts - a.fails/a.attempts).slice(0, 5);
  if (topErrors.length) {
    resumeHtml += `<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px">
      <div style="font-size:.72rem;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"><i class="ti ti-trending-down" aria-hidden="true"></i> Positions difficiles</div>
      <table class="pos-table" style="font-size:.78rem"><thead><tr><th>Module</th><th>Coup</th><th>Échecs</th><th>Taux</th></tr></thead><tbody>`;
    topErrors.forEach(e => {
      const rate = Math.round(e.fails / e.attempts * 100);
      const rc = rate>=60?'var(--red)':rate>=30?'#facc15':'var(--green)';
      resumeHtml += `<tr>
        <td style="color:var(--dim);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(e.drillName)}">${escapeHtml(e.drillName)}</td>
        <td><span style="font-family:'JetBrains Mono',monospace;font-weight:700">${escapeHtml(e.san||'?')}</span></td>
        <td style="color:var(--red);font-weight:700">${e.fails}×</td>
        <td style="color:${rc};font-weight:700">${rate}%</td>
      </tr>`;
    });
    resumeHtml += '</tbody></table></div>';
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
    posHtml += `<div style="margin-bottom:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
        <div style="font-weight:700;font-size:.88rem"><i class="ti ti-book" aria-hidden="true"></i> ${escapeHtml(drillName)}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${dp>=70?'badge-green':'badge-red'}">${dp}%</span>
          ${drill ? _deadlinePill(drill) : ''}
        </div>
      </div>
      <table class="pos-table">
        <thead><tr><th>#</th><th>Coup</th><th>Résultat</th><th>SM-2</th></tr></thead>
        <tbody>${posArr.map(p => {
          const nW = p.attempts.filter(a => !a.correct).length;
          const due = p.sm2 ? (p.sm2.due<=now ? '<span class="mastery-pill low">due</span>' : `<span class="mastery-pill ok">+${Math.ceil((p.sm2.due-now)/86400000)}j</span>`) : '<span style="color:var(--dim)">—</span>';
          return `<tr>
            <td style="color:var(--dim)">${p.posIdx+1}</td>
            <td><span style="font-family:'JetBrains Mono',monospace;font-weight:700">${escapeHtml(p.san||'')}</span></td>
            <td>${p.correct ? `<span class="ok-pill">✓${nW>0?' ('+nW+'x)':''}</span>` : `<span class="error-pill">✗ (${p.attempts.length})</span>`}</td>
            <td>${due}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }
  html += `<div class="ed-tab-body" id="edt-positions" style="display:none">${posHtml}</div>`;

  // ══ TAB 3 : Progression ══
  html += `<div class="ed-tab-body" id="edt-progression" style="display:none">${_buildProgressionHTML(name)}</div>`;

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

function _buildProgressionHTML(name) {
  const log = G.practiceLog.filter(l=>l.student===name &&
    (selectedDrillFilter==='all'||String(l.drillId)===selectedDrillFilter)
  ).sort((a,b)=>a.ts-b.ts);

  const errMap = {};
  G.results.filter(r=>(r.student||r.studentName)===name &&
    (selectedDrillFilter==='all'||String(r.drillId)===selectedDrillFilter)
  ).forEach(r=>{
    const key = `${r.drillId}_${r.posIdx}_${r.san||''}`;
    if (!errMap[key]) errMap[key]={drillName:r.drillName,drillId:r.drillId,posIdx:r.posIdx,san:r.san,fails:0,attempts:0,lastFailTs:0};
    errMap[key].attempts++;
    if (!r.correct){ errMap[key].fails++; if(r.ts>errMap[key].lastFailTs) errMap[key].lastFailTs=r.ts; }
  });
  const topErrors = Object.values(errMap).filter(e=>e.fails>0)
    .sort((a,b)=>b.fails-a.fails||b.fails/b.attempts-a.fails/a.attempts).slice(0,10);

  if (!log.length && !topErrors.length) return '';

  let html = `<div style="border-top:1px solid var(--border);margin-top:22px;padding-top:18px">`;

  if (log.length) {
    const byDrill = {};
    log.forEach(l=>{ if(!byDrill[l.drillName]) byDrill[l.drillName]=[]; byDrill[l.drillName].push(l); });
    html += `<div style="font-weight:700;font-size:.88rem;margin-bottom:12px"><i class="ti ti-trending-up" aria-hidden="true"></i> Progression</div>`;
    for (const [drillName, sessions] of Object.entries(byDrill)) {
      const maxPct = Math.max(...sessions.map(s=>s.pct));
      const minPct = Math.min(...sessions.map(s=>s.pct));
      const n = sessions.length;
      const halfA = sessions.slice(0,Math.ceil(n/2)).reduce((a,s)=>a+s.pct,0)/Math.ceil(n/2);
      const halfB = sessions.slice(Math.ceil(n/2)).reduce((a,s)=>a+s.pct,0)/Math.max(1,n-Math.ceil(n/2));
      const trend = n<2 ? '' : halfB-halfA>5 ? '<i class="ti ti-trending-up" aria-hidden="true"></i> +'+Math.round(halfB-halfA)+'%' : halfA-halfB>5 ? '<i class="ti ti-trending-down" aria-hidden="true"></i> '+Math.round(halfB-halfA)+'%' : '→ stable';
      html += `<div style="background:var(--surf2);border-radius:var(--rs);padding:12px 14px;margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:.82rem;font-weight:600"><i class="ti ti-book" aria-hidden="true"></i> ${escapeHtml(drillName)}</div>
          <div style="display:flex;gap:6px;align-items:center">
            ${trend ? `<span style="font-size:.7rem;color:var(--dim)">${trend}</span>` : ''}
            <span class="badge ${maxPct>=70?'badge-green':'badge-red'}">max ${maxPct}%</span>
          </div>
        </div>
        <div style="position:relative;height:64px">
          <div style="position:absolute;inset:0;display:flex;align-items:flex-end;gap:2px">
            ${sessions.map(s=>{
              const h=Math.max(3,Math.round(s.pct*0.64));
              const col=s.pct>=70?'var(--green)':s.pct>=50?'#facc15':'var(--red)';
              const dt=new Date(s.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
              return `<div title="${dt} — ${s.pct}%" style="flex:1;min-width:5px;height:${h}px;background:${col};border-radius:2px 2px 0 0;opacity:.85"></div>`;
            }).join('')}
          </div>
          <div style="position:absolute;left:0;right:0;top:${Math.round(64-70*0.64)}px;border-top:1px dashed rgba(5,150,105,.4);pointer-events:none"></div>
        </div>
        <div style="font-size:.62rem;color:var(--dim);margin-top:5px">${n} session${n>1?'s':''} · min ${minPct}% · max ${maxPct}%</div>
      </div>`;
    }
  }

  if (topErrors.length) {
    const now = Date.now();
    html += `<div style="font-weight:700;font-size:.88rem;margin:${log.length?'16px 0':'0 0'} 10px"><i class="ti ti-trending-down" aria-hidden="true"></i> Positions difficiles</div>`;
    html += `<table class="pos-table" style="font-size:.78rem"><thead><tr><th>Module</th><th>Coup</th><th>Échecs</th><th>Taux</th></tr></thead><tbody>`;
    topErrors.forEach(e=>{
      const rate = Math.round(e.fails/e.attempts*100);
      const rateCol = rate>=60?'var(--red)':rate>=30?'#facc15':'var(--green)';
      html += `<tr>
        <td style="color:var(--dim);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(e.drillName)}">${escapeHtml(e.drillName)}</td>
        <td><span style="font-family:'JetBrains Mono',monospace;font-weight:700">${escapeHtml(e.san||'?')}</span></td>
        <td style="color:var(--red);font-weight:700">${e.fails}×</td>
        <td style="color:${rateCol};font-weight:700">${rate}%</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  return html + '</div>';
}

// ══════════════════════════════════════════════════════
// HEATMAP DES ERREURS
// ══════════════════════════════════════════════════════
function renderHeatmap() {
  const el = document.getElementById('prof-heatmap-content');
  const drillId = (document.getElementById('hm-drill-filter') || document.getElementById('prof-drill-filter'))?.value || 'all';
  _populateClassFilter(document.getElementById('hm-class-filter'));
  const cf = _classFilter('hm-class-filter');

  let filtered = drillId === 'all' ? G.results : G.results.filter(r=>String(r.drillId)===drillId);
  if (cf) filtered = filtered.filter(r => _matchStudentSet(r, cf.set));

  if (!filtered.length) {
    el.innerHTML = '<div class="empty" style="padding:40px"><div class="empty-ico"><i class="ti ti-flame" aria-hidden="true"></i></div>Sélectionnez un module pour voir les positions les plus ratées</div>';
    return;
  }

  // Grouper par position : taux, élèves, et surtout QUI échoue (failStudents)
  const byPos = {};
  filtered.forEach(r => {
    const key = `${r.drillId||r.drillName}_${r.posIdx}_${r.san}`;
    if (!byPos[key]) byPos[key] = { drillId:r.drillId, drillName:r.drillName, posIdx:r.posIdx, san:r.san||'—', comment:r.comment||'', attempts:0, correct:0, students:new Set(), failStudents:new Set() };
    const p = byPos[key];
    p.attempts++;
    if (r.correct) p.correct++; else p.failStudents.add(r.student);
    p.students.add(r.student);
    if (r.comment && !p.comment) p.comment = r.comment;
  });

  const entries = Object.values(byPos).filter(p=>p.attempts>0);
  entries.forEach(p => { p.rate = Math.round(p.correct/p.attempts*100); });
  const totalPos = entries.length;
  const hotCount = entries.filter(p=>p.rate<50).length;

  const rateCol = r => r>=75?'var(--green)':r>=50?'#ca8a04':r>=25?'#ea580c':'var(--red)';
  const rateBg  = r => r>=75?'var(--green-dim)':r>=50?'rgba(250,204,21,.12)':r>=25?'rgba(251,146,60,.12)':'var(--red-dim)';

  // Cartes = positions ratées par au moins un élève, triées par nb d'élèves puis taux
  const cards = entries.filter(p=>p.failStudents.size>0)
    .sort((a,b)=> b.failStudents.size - a.failStudents.size || a.rate - b.rate)
    .slice(0, 8);
  const cardsHtml = cards.map(p => {
    const col = rateCol(p.rate), fs = p.failStudents.size;
    const chips = [...p.failStudents].slice(0,10).map(s=>`<span class="wsx-chip">${escapeHtml(s)}</span>`).join('');
    return `<div class="wsx-card${p.rate<50?' hot':''}">
      <div class="wsx-head">
        <span class="wsx-move">${fig(p.san)}</span>
        <span class="wsx-rate" style="background:${rateBg(p.rate)};color:${col}">${100-p.rate}% d'échec</span>
      </div>
      <div class="wsx-sub">${fs} / ${p.students.size} élève${p.students.size>1?'s':''} échoue${fs>1?'nt':''}</div>
      <div class="wsx-chips">${chips}</div>
      ${p.comment?`<div class="wsx-comment">« ${escapeHtml(p.comment.slice(0,140))}${p.comment.length>140?'…':''} »</div>`:''}
    </div>`;
  }).join('');

  // Bande d'aperçu = toutes les positions, triées par difficulté
  const strip = entries.slice().sort((a,b)=>a.rate-b.rate);
  const stripHtml = strip.map(p=>{
    const col = rateCol(p.rate);
    return `<div class="wsx-cell" style="background:${rateBg(p.rate)};border-color:${col}" title="${escapeHtml([...p.students].join(', '))}">
      <div style="font-size:1rem;font-weight:800;color:${col};line-height:1">${p.rate}%</div>
      <div style="font-family:var(--font-mono);font-size:.78rem;margin-top:2px">${fig(p.san)}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div class="kpi"><div class="kpi-val" style="color:var(--cyan)">${totalPos}</div><div class="kpi-lbl">Positions</div></div>
      <div class="kpi"><div class="kpi-val" style="color:var(--red)">${hotCount}</div><div class="kpi-lbl">Points chauds</div></div>
      <div class="kpi"><div class="kpi-val" style="color:var(--green)">${totalPos-hotCount}</div><div class="kpi-lbl">Bien maîtrisées</div></div>
    </div>
    ${cards.length?`<div style="font-size:.82rem;font-weight:700;margin-bottom:10px">Positions à revoir en priorité</div><div class="wsx-grid">${cardsHtml}</div>`:''}
    <div style="font-size:.75rem;color:var(--dim);margin-bottom:8px"><i class="ti ti-flame" aria-hidden="true"></i> Toutes les positions — triées par difficulté. Survolez une case pour voir les élèves.</div>
    <div class="wsx-strip">${stripHtml}</div>`;
}

// ══════════════════════════════════════════════════════
// ONGLET CLASSES
// ══════════════════════════════════════════════════════
function renderClassesTab() {
  const el = document.getElementById('prof-classes-content');
  if (!el) return;
  if (!G.classes.length) {
    el.innerHTML = '<div class="empty" style="padding:32px;border:1px dashed var(--border);border-radius:var(--r)"><div class="empty-ico"><i class="ti ti-school" aria-hidden="true"></i></div>Aucune classe.<br>Cliquez sur « + Créer une classe » en haut pour organiser vos élèves.</div>';
    return;
  }
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0,10);
  const matchStu = (r, email) => [(r.studentEmail||'').toLowerCase(), (r.studentPseudo||'').toLowerCase(), (r.student||'').toLowerCase()].includes(email);

  el.innerHTML = G.classes.map(cls => {
    const modIds = (cls.moduleIds || []).map(String);
    const roster = (cls.studentEmails || cls.students || []);
    const dls    = cls.moduleDeadlines || {};
    const clsResults = G.results.filter(r => modIds.includes(String(r.drillId)));
    // Actifs = élèves ayant joué au moins un module de la classe.
    const activeCount = roster.filter(email => clsResults.some(r => matchStu(r, email))).length;

    // Décomposition par module assigné × élève (statut fait/retard/pas commencé + échéance).
    let body;
    if (!roster.length)      body = '<div style="color:var(--dim);font-size:.8rem;padding:8px 0">Aucun élève dans cette classe.</div>';
    else if (!modIds.length) body = '<div style="color:var(--dim);font-size:.8rem;padding:8px 0">Aucun module assigné.</div>';
    else body = modIds.map(modId => {
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
          ? `<span style="font-weight:700;color:${pct>=70?'var(--green)':pct>=50?'var(--gold)':'var(--red)'}">${pct}%</span> <span style="color:var(--dim);font-size:.72rem">· ${since===0?'auj.':since+'j'}</span>`
          : late
            ? '<span style="color:var(--red);font-size:.76rem;font-weight:700"><i class="ti ti-alert-triangle" aria-hidden="true"></i> En retard</span>'
            : '<span style="color:var(--dim);font-size:.78rem">Pas commencé</span>';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);gap:8px">
          <span style="font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class="ti ti-point-filled" style="color:${played?'var(--green)':(late?'var(--red)':'var(--dim)')}" aria-hidden="true"></i> ${escapeHtml(email)}</span>
          <span style="flex-shrink:0">${status}</span>
        </div>`;
      }).join('');
      return `<div style="margin-top:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
          <span style="font-weight:600;font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class="ti ti-stack-2" aria-hidden="true"></i> ${escapeHtml(modName)}</span>
          <span style="flex-shrink:0;display:flex;align-items:center;gap:6px">${deadline ? _deadlinePill({ deadline }) : ''}<span style="font-size:.72rem;color:var(--dim)"><i class="ti ti-check" aria-hidden="true"></i> ${doneCount}/${roster.length}</span></span>
        </div>
        ${stuRows}
      </div>`;
    }).join('');

    return `<div class="card" style="margin-bottom:14px">
      <div style="font-size:1rem;font-weight:700"><i class="ti ti-school" aria-hidden="true"></i> ${escapeHtml(cls.name)}</div>
      <div style="font-size:.73rem;color:var(--dim);margin:2px 0 4px">${activeCount}/${roster.length} actif${activeCount>1?'s':''} · ${modIds.length} module${modIds.length>1?'s':''}</div>
      ${body}
    </div>`;
  }).join('');
}

// Parties partagées par les élèves depuis « Ma bibliothèque » (P1.3) — à annoter (P1.4).
function _sharedGamesHTML() {
  const shared = (G.savedGames || []).filter(g => g.baseId && g.shared).sort((a,b)=>(b.ts||0)-(a.ts||0));
  if (!shared.length) return '';
  const rows = shared.map(g => {
    const dt = g.ts ? new Date(g.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : '';
    const who = (g.white||'?') + ' – ' + (g.black||'?');
    const nat = g.nature==='analyse' ? '<i class="ti ti-notes" aria-hidden="true"></i> Analyse' : '<i class="ti ti-chess" aria-hidden="true"></i> Partie';
    const badge = g.reviewedAt ? `<span title="Déjà annotée" style="color:#7c3aed;font-weight:700;font-size:.7rem"><i class="ti ti-sparkles" aria-hidden="true"></i> Annotée</span>` : '';
    return `<div class="game-row">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="game-result ${g.result==='1-0'?'win':g.result==='0-1'?'loss':'draw'}">${g.result||'*'}</span>
          <div>
            <div style="font-weight:600;font-size:.85rem"><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(g.student||'Élève')} — ${escapeHtml(who)} ${badge}</div>
            <div style="font-size:.72rem;color:var(--dim)">${nat} · ${escapeHtml(g.event||'—')} · ${dt}</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="annotateSharedGame('${g.id}')"><i class="ti ti-school" aria-hidden="true"></i> ${g.reviewedAt?'Revoir la revue':'Annoter'}</button>
      </div>
    </div>`;
  }).join('');
  return `<div style="margin-bottom:18px">
    <div style="font-weight:700;font-size:.9rem;margin-bottom:8px">📥 Parties partagées par les élèves <span style="color:var(--dim);font-weight:400">(${shared.length})</span></div>
    ${rows}
  </div>`;
}

// Ouvre une partie partagée dans l'éditeur en mode revue coach (P1.4).
function annotateSharedGame(id) {
  const g = (G.savedGames || []).find(x => String(x.id) === String(id));
  if (!g) { toast('⚠ Partie introuvable','ko'); return; }
  window.openReviewEditor?.(g.pgn || '', { gameId: g.id, role: 'coach', white: g.white, black: g.black });
}

function renderPartiesTab() {
  const el = document.getElementById('prof-parties-content');
  const partiesFilter = (document.getElementById('parties-drill-filter') || document.getElementById('prof-drill-filter'))?.value || 'all';
  const sharedHTML = _sharedGamesHTML();
  // Parties Maia uniquement (les entrées bibliothèque ont un baseId → traitées ci-dessus)
  const maia = (G.savedGames || []).filter(g => !g.baseId);
  const games = partiesFilter==='all' ? maia : maia.filter(g=>String(g.drillId)===partiesFilter);
  if (!games.length && !sharedHTML) {
    el.innerHTML='<div class="empty" style="padding:40px"><div class="empty-ico"><i class="ti ti-chess" aria-hidden="true"></i></div>Aucune partie enregistrée</div>'; return;
  }
  const sorted = [...games].sort((a,b)=>b.ts-a.ts);
  el.innerHTML = sharedHTML + (games.length ? '<div style="font-weight:700;font-size:.9rem;margin-bottom:8px">♟ Parties Maia</div>' : '') + sorted.map((g,i)=>{
    const resClass = g.result==='1-0'?(g.side==='w'?'win':'loss'):g.result==='0-1'?(g.side==='b'?'win':'loss'):'draw';
    const dt = new Date(g.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});
    const side = g.side==='w'?'♔ Blancs':g.side==='b'?'♚ Noirs':'⇄';
    return `<div class="game-row" onclick="togglePGN(${i})">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="game-result ${resClass}">${g.result}</span>
          <div>
            <div style="font-weight:600;font-size:.85rem"><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(g.student)} — ${escapeHtml(g.drillName)}</div>
            <div style="font-size:.72rem;color:var(--dim)">${side} · ${g.level} · ${dt}</div>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();exportPGN(${i})"><i class="ti ti-download" aria-hidden="true"></i> PGN</button>
      </div>
      <div id="pgn-view-${i}" style="display:none;margin-top:10px;padding:10px;background:var(--bg);border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:.7rem;line-height:1.7;color:var(--dim);white-space:pre-wrap;word-break:break-all">${escapeHtml(g.pgn)}</div>
    </div>`;
  }).join('');
}

function togglePGN(i) {
  const el = document.getElementById(`pgn-view-${i}`);
  if (el) el.style.display = el.style.display==='none' ? 'block' : 'none';
}

// ── Exports ───────────────────────────────────────────
function _download(filename, content, mime='text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type:mime}));
  a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function exportCSV() {
  const header = 'étudiant,drill,position,coup,correct,horodatage\n';
  const rows   = G.results.map(r=>
    [r.student,r.drillName,r.posIdx+1,r.san||'',r.correct?'1':'0',new Date(r.ts).toISOString()].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  _download('results.csv', header+rows, 'text/csv');
}

function exportPracticeCSV() {
  const header = 'étudiant,drill,session,score%,horodatage\n';
  const rows   = G.practiceLog.map(l=>
    [l.student,l.drillName,l.sessionIdx+1,l.pct,new Date(l.ts).toISOString()].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  _download('sessions.csv', header+rows, 'text/csv');
}

function exportPGN(idx) {
  const sorted = [...G.savedGames].sort((a,b)=>b.ts-a.ts);
  const games  = idx===null ? sorted : [sorted[idx]].filter(Boolean);
  if (!games.length) { toast('Aucune partie à exporter','ko'); return; }
  const out = games.map(g=>`[Event "${g.drillName}"]\n[White "${g.side==='w'?g.student:'Maia'}"]\n[Black "${g.side==='b'?g.student:'Maia'}"]\n[Result "${g.result}"]\n[Date "${new Date(g.ts).toISOString().slice(0,10)}"]\n\n${g.pgn}\n`).join('\n\n');
  _download(idx===null?'parties.pgn':`partie_${idx+1}.pgn`, out);
}

function exportAll() {
  const data = { drills: G.drills, results: G.results, practiceLog: G.practiceLog, savedGames: G.savedGames, masteryData: G.masteryData, exportedAt: new Date().toISOString() };
  _download('backup.json', JSON.stringify(data,null,2), 'application/json');
}


// Pont window : exposé aux onclick="" (index.html) et aux appels app.js.
Object.assign(window, {
  _masteryBadge, _deadlinePill, _classWeakSpots, renderClassWeakSpots, _buildProfRoster,
  renderProfView, showStudentDetail, _edTab, _buildProgressionHTML, renderHeatmap,
  renderClassesTab, renderPartiesTab, togglePGN, _download,
  exportCSV, exportPracticeCSV, exportPGN, exportAll,
  annotateSharedGame,
});
