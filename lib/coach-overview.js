// ══════════════════════════════════════════════════════
// lib/coach-overview.js — VUE D'ENSEMBLE (atterrissage coach) : synthèse
// prescriptive — chaque bloc répond à « que dois-je faire ? » et renvoie vers
// sa page dédiée. Sans état propre.
// Socle → coach-core.js ; appels latéraux → pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import {
  _tierPct, _tierBg, _tierFail, _clsRoster, _classWeakSpots, _computeRoster,
  _renderCoachLoading, _renderCoachError, fig, escapeHtml,
} from './coach-core.js';

function renderOverview() {
  const kpiEl = document.getElementById('ov-kpis');
  if (!kpiEl) return;
  if (G._coachLoading === 'loading') { _renderCoachLoading(); return; }
  if (G._coachLoading === 'error')   { _renderCoachError(); return; }

  const grid    = document.querySelector('#csec-overview .ov-grid');
  const emptyEl = document.getElementById('ov-empty');
  const hasStudents = G.classes.some(c => _clsRoster(c).length);
  const hasAny = G.results.length || G.practiceLog.length || G.savedGames.length || hasStudents;
  if (!hasAny) {
    // État vide accueillant : le coach démarre par créer un module puis une classe.
    kpiEl.innerHTML = '';
    if (grid) grid.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = '';
      emptyEl.innerHTML = `<div class="empty" style="border:1px dashed var(--border);border-radius:var(--r);padding:48px 24px">
        <div class="empty-ico"><i class="ti ti-chess-knight" aria-hidden="true"></i></div>
        Bienvenue ! Créez votre premier module d'ouvertures, puis une classe pour vos élèves.
        <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
          <button class="btn btn-primary btn-sm" onclick="switchCoachSection('modules')"><i class="ti ti-stack-2" aria-hidden="true"></i> Créer un module</button>
          <button class="btn btn-blue btn-sm" onclick="switchCoachSection('classes')"><i class="ti ti-school" aria-hidden="true"></i> Créer une classe</button>
        </div>
      </div>`;
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (grid) grid.style.display = '';

  // ── KPI strip (données globales, sans filtre) ──
  const { students, totalRes, avgPct, activeWk, inactive, needAttention, behindN } = _computeRoster(G.results, null);
  const pctDisplay = totalRes ? avgPct + '%' : '—';
  const pctColor   = !totalRes ? 'var(--dim)' : _tierPct(avgPct);
  const attColor   = behindN > 0 ? 'var(--red-ink)' : needAttention > 0 ? 'var(--gold-ink)' : 'var(--green-ink)';
  const maiaN      = G.savedGames.filter(g => !g.baseId).length;
  kpiEl.innerHTML = `
    <div class="cs-kpi"><div class="cs-kpi-val" style="color:var(--text)">${students.length}</div><div class="cs-kpi-lbl">Élèves</div></div>
    <div class="cs-kpi"><div class="cs-kpi-val" style="color:${pctColor}">${pctDisplay}</div><div class="cs-kpi-lbl">Réussite moyenne</div></div>
    <div class="cs-kpi${behindN>0?' cs-kpi-accent':''}"><div class="cs-kpi-val" style="color:${attColor}">${students.length?needAttention:'—'}</div><div class="cs-kpi-lbl">À suivre${behindN>0?` · ${behindN} en retard`:''}</div></div>
    <div class="cs-kpi-note">${students.length?`<i class="ti ti-refresh" aria-hidden="true"></i> ${activeWk} actif${activeWk>1?'s':''} cette semaine · ${inactive} inactif${inactive>1?'s':''} (&gt;7j)`:''}<span class="cs-kpi-note-sep">${G.practiceLog.length} session${G.practiceLog.length>1?'s':''} · ${maiaN} partie${maiaN>1?'s':''} Maia</span></div>`;

  // ── À suivre : les élèves qui demandent l'attention du coach, cliquables ──
  const attEl = document.getElementById('ov-attention');
  if (attEl) {
    const need = students.filter(s => s.attention).slice(0, 6);
    attEl.innerHTML = `<div class="wsx-panel">
      <div class="wsx-panel-head">
        <span><i class="ti ti-user-exclamation" aria-hidden="true"></i> À suivre</span>
        <button class="wsx-link" onclick="switchCoachSection('eleves')">Tous les élèves →</button>
      </div>
      ${need.length ? need.map(s => {
        const flag = s.behind
          ? `<span class="eleve-flag due">${s.due} à revoir</span>`
          : `<span class="eleve-flag stale">inactif ${Math.floor((Date.now()-s.lastTs)/86400000)}j</span>`;
        return `<button class="ov-row" onclick="ovOpenStudent(this.dataset.k)" data-k="${escapeHtml(s.key)}">
          <span class="ov-row-name"><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(s.label)}</span>
          ${flag}
        </button>`;
      }).join('') : `<div class="ov-ok"><i class="ti ti-circle-check" aria-hidden="true"></i> Personne en retard — tout le monde suit.</div>`}
    </div>`;
  }

  // ── Points faibles : top 3, la vue complète vit dans « Points faibles » ──
  const wsEl = document.getElementById('ov-weakspots');
  if (wsEl) {
    const spots = _classWeakSpots(G.results).slice(0, 3);
    wsEl.innerHTML = `<div class="wsx-panel">
      <div class="wsx-panel-head">
        <span><i class="ti ti-target" aria-hidden="true"></i> Points faibles</span>
        <button class="wsx-link" onclick="switchCoachSection('heatmap')">Analyse complète →</button>
      </div>
      ${spots.length ? spots.map(s => `<div class="wsx-row">
        <span class="wsx-move">${fig(s.san)}</span>
        <div class="wsx-row-info"><div class="wsx-row-name">${escapeHtml(s.drillName || 'Module')}</div></div>
        <span class="wsx-rate" style="background:${_tierBg(100-s.rate)};color:${_tierFail(s.rate)};white-space:nowrap">${s.failStudentCount} élève${s.failStudentCount>1?'s':''} · ${s.rate}%</span>
      </div>`).join('') : `<div class="ov-ok"><i class="ti ti-circle-check" aria-hidden="true"></i> Aucune position en difficulté.</div>`}
    </div>`;
  }

  window._updatePartiesBadge?.();   // badge sidebar « Parties » (N à annoter) dès l'atterrissage

  // ── Parties à annoter : partagées par les élèves, pas encore revues ──
  const inEl = document.getElementById('ov-inbox');
  if (inEl) {
    const todo = (G.savedGames || []).filter(g => g.baseId && g.shared && !g.reviewedAt).sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0, 4);
    inEl.innerHTML = `<div class="wsx-panel">
      <div class="wsx-panel-head">
        <span><i class="ti ti-inbox" aria-hidden="true"></i> Parties à annoter</span>
        <button class="wsx-link" onclick="switchCoachSection('parties')">Toutes les parties →</button>
      </div>
      ${todo.length ? todo.map(g => {
        // L'élève est presque toujours l'un des deux joueurs : ne pas répéter son nom.
        const players = (g.white||'?') + ' – ' + (g.black||'?');
        const label = g.student && g.student !== g.white && g.student !== g.black
          ? `${escapeHtml(g.student)} · ${escapeHtml(players)}` : escapeHtml(players);
        return `<button class="ov-row" onclick="annotateSharedGame('${escapeHtml(String(g.id))}')">
        <span class="ov-row-name"><i class="ti ti-chess" aria-hidden="true"></i> ${label}</span>
        <span class="ov-row-meta">${g.result || '*'}</span>
      </button>`;
      }).join('') : `<div class="ov-ok"><i class="ti ti-circle-check" aria-hidden="true"></i> Rien en attente.</div>`}
    </div>`;
  }
}

// Depuis la Vue d'ensemble : ouvre la page Élèves directement sur un élève.
function ovOpenStudent(key) {
  window.switchCoachSection?.('eleves');
  window.showStudentDetail?.(key);
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/modules.js.
Object.assign(window, { renderOverview, ovOpenStudent });
