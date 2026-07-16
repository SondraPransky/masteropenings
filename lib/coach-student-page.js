// ══════════════════════════════════════════════════════
// lib/coach-student-page.js — PAGE PROFIL D'UN ÉLÈVE (vue exhaustive)
//
// Consolide sur UNE page ce qui était éparpillé sur trois : progression et erreurs
// (Élèves), parties partagées (Parties), points chauds (Points faibles). Le coach
// prépare un cours sans naviguer.
//
// Drill-down : la page Élèves reste la LISTE ; CS.selectedStudent posé → cette page
// (patron openClassDetail, coach-classes.js). Aucun état propre.
//
// ⚠ Deux angles morts ASSUMÉS, imposés par le RLS et non contournables côté client :
//   - modules PERSO de l'élève  : modules_read ne rend au coach que teacher_id = lui ;
//   - parties NON partagées     : games_read exige shared = true (P1.3, l'élève décide).
// Le RLS rend ces lignes invisibles à la requête — on ne peut même pas les compter.
// Décision produit : on n'en dit rien (l'élève garde un espace à lui).
//
// Socle → coach-core.js ; appels latéraux → pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { _countLayerMoves } from './tree.js';
import {
  CS, _tierPct, _tierFail, _deadlinePill, _resultKeys, _matchStudentSet, _clsRoster,
  _studentIdSet, sm2Get, fig, figText, escapeHtml,
} from './coach-core.js';

const _dt = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day:'numeric', month:'short' });

// ── Collecte : tout ce que le coach a le droit de savoir sur cet élève ──────────
// Une seule passe sur G, pour que les sections ne re-filtrent pas chacune de leur côté.
function _gather(id) {
  const idLower = String(id || '').toLowerCase();
  const ids = _studentIdSet(id);
  const results = G.results.filter(r => _resultKeys(r).includes(idLower) || r.student === id);
  // ⚠ `name` est une CLÉ, pas un libellé : G.masteryData et sm2Get sont indexés par le
  // nom tel qu'écrit dans les résultats (`${student}_${drillId}_${posKey}`). L'embellir
  // casserait les recherches de maîtrise. Le libellé affiché est `display`, à part —
  // sans quoi un élève sans résultat s'affiche « gabriel.noel@test.com ».
  const name = (results[0] && results[0].student) || id;
  const display = (results[0] && results[0].student) || window._studentDisplayName?.(id) || id;
  const practice = G.practiceLog.filter(l => _matchStudentSet(l, ids) || l.student === name);
  const games = (G.savedGames || []).filter(g => _matchStudentSet(g, ids) || g.student === name);
  const overlays = (G.studentOverlays || []).filter(o => o.overlayBy && _matchStudentSet(o.overlayBy, ids));
  const classes = G.classes.filter(c => _clsRoster(c).some(e => String(e).toLowerCase() === idLower));

  // Modules qui lui sont assignés (via ses classes) + l'échéance de l'assignation.
  const assignedIds = new Set();
  const deadlines = {};
  const today = new Date().toISOString().slice(0, 10);
  const overdue = new Set();
  classes.forEach(c => {
    (c.moduleIds || []).forEach(mid => assignedIds.add(String(mid)));
    const md = c.moduleDeadlines || {};
    for (const mid in md) {
      if (!md[mid]) continue;
      // La plus PROCHE échéance gagne (un module peut être assigné via 2 classes).
      if (!deadlines[mid] || md[mid] < deadlines[mid]) deadlines[mid] = md[mid];
      if (md[mid] < today) overdue.add(String(mid));
    }
  });
  const mods = G.drills.filter(d => assignedIds.has(String(d.id)));

  return { id, idLower, ids, name, display, results, practice, games, overlays, classes,
           mods, deadlines, overdue };
}

// Progression d'un module POUR CET ÉLÈVE, depuis ses résultats réels.
function _modStats(ctx, mod) {
  const rs = ctx.results.filter(r => String(r.drillId) === String(mod.id));
  const byPos = {};
  rs.forEach(r => {
    const k = r.posIdx + '_' + (r.san || '');
    if (!byPos[k]) byPos[k] = { correct: false, attempts: 0 };
    byPos[k].attempts++;
    if (r.correct) byPos[k].correct = true;
  });
  const pos = Object.values(byPos);
  const done = pos.filter(p => p.correct).length;
  return { tried: pos.length, done, pct: pos.length ? Math.round(done / pos.length * 100) : 0,
           lastTs: rs.length ? Math.max(...rs.map(r => r.ts)) : 0 };
}

// ── 1. En-tête ──────────────────────────────────────────────────────────────────
function _headHTML(ctx) {
  const lastTs = Math.max(0, ...ctx.results.map(r => r.ts), ...ctx.games.map(g => g.ts || 0));
  const cls = ctx.classes.map(c => escapeHtml((c.name || '').replace(/^👤\s*/, ''))).join(' · ');
  return `<div class="sp-head">
    <button class="btn btn-ghost btn-sm" onclick="closeStudentPage()"><i class="ti ti-arrow-left" aria-hidden="true"></i> Élèves</button>
    <div class="sp-head-id">
      <h1 class="sp-name"><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(ctx.display)}</h1>
      <div class="sp-head-sub">${cls || 'Aucune classe'} · ${lastTs ? 'vu le ' + _dt(lastTs) : 'jamais venu'}</div>
    </div>
  </div>`;
}

// ── 2. Bandeau KPI ──────────────────────────────────────────────────────────────
function _kpiHTML(ctx) {
  const total = ctx.results.length, ok = ctx.results.filter(r => r.correct).length;
  const pct = total ? Math.round(ok / total * 100) : 0;
  const due = Object.keys(G.masteryData)
    .filter(k => k.startsWith(ctx.name + '_') && (G.masteryData[k].due || 0) <= Date.now()).length;
  const toAnnotate = ctx.games.filter(g => g.baseId && g.shared && !g.reviewedAt).length;
  // Règle de l'encre : ces chiffres sont du petit texte bold → variantes -ink.
  const ink = (bad) => bad ? 'var(--red-ink)' : 'var(--green-ink)';
  const kpi = (v, l, col) => `<div class="cs-kpi"><div class="cs-kpi-v" style="color:${col}">${v}</div><div class="cs-kpi-lbl">${l}</div></div>`;
  return `<div class="sp-kpis">
    ${kpi(total ? pct + '%' : '—', 'Réussite', total ? _tierPct(pct) : 'var(--dim)')}
    ${kpi(due, 'À revoir', ink(due > 0))}
    ${kpi(ctx.overdue.size, 'En retard', ink(ctx.overdue.size > 0))}
    ${kpi(toAnnotate, 'À annoter', ink(toAnnotate > 0))}
  </div>`;
}

// ── 3+4. Ses modules / ses exercices ────────────────────────────────────────────
// Un paquet d'exercices se compte en « résolus », une ouverture en « % de réussite ».
function _modsHTML(ctx, isExercise) {
  const list = ctx.mods.filter(m => !!m.isExercise === isExercise);
  const titre = isExercise
    ? '<i class="ti ti-puzzle" aria-hidden="true"></i> Ses exercices'
    : '<i class="ti ti-book" aria-hidden="true"></i> Ses modules';
  if (!list.length) return '';
  const rows = list.map(m => {
    const st = _modStats(ctx, m);
    const ov = ctx.overlays.find(o => String(o.overlayOf) === String(m.id));
    const nMine = ov ? _countLayerMoves(ov.tree) : 0;
    const late = ctx.overdue.has(String(m.id));
    const nEx = (m.sessions?.[0]?.kps || m.kps || []).length;
    const score = isExercise
      ? `<span class="badge ${st.done >= nEx && nEx ? 'badge-green' : 'badge-gold'}">${st.done} / ${nEx || '?'}</span>`
      : `<span class="badge ${st.pct >= 70 ? 'badge-green' : 'badge-red'}">${st.tried ? st.pct + '%' : '—'}</span>`;
    // « N à lui » + Annoter : la couche d'édition élève (bleu = écrit par l'élève).
    const mine = nMine
      ? `<span class="sp-mine"><i class="ti ti-git-branch" aria-hidden="true"></i> ${nMine} à lui</span>
         <button class="btn btn-blue btn-sm" onclick="openStudentOverlay('${escapeHtml(String(m.id))}','${escapeHtml(String(ov.id))}')"><i class="ti ti-school" aria-hidden="true"></i> Annoter</button>`
      : '';
    return `<div class="sp-row${late ? ' sp-row-late' : ''}">
      <div class="sp-row-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
      <div class="sp-row-tail">
        ${st.lastTs ? `<span class="sp-when">${_dt(st.lastTs)}</span>` : '<span class="sp-when">pas commencé</span>'}
        ${score}
        ${_deadlinePill({ ...m, deadline: ctx.deadlines[String(m.id)] || m.deadline })}
        ${mine}
      </div>
    </div>`;
  }).join('');
  return `<section class="sp-sec"><h2 class="sp-sec-title">${titre}</h2>${rows}</section>`;
}

// ── 5. Ses parties ──────────────────────────────────────────────────────────────
function _gamesHTML(ctx) {
  const shared = ctx.games.filter(g => g.baseId && g.shared).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const maia   = ctx.games.filter(g => !g.baseId).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 5);
  if (!shared.length && !maia.length) return '';
  const rowShared = shared.map(g => `<div class="sp-row">
    <div class="sp-row-name">${escapeHtml(g.white || '?')} – ${escapeHtml(g.black || '?')}</div>
    <div class="sp-row-tail">
      <span class="sp-when">${g.ts ? _dt(g.ts) : ''}</span>
      <span class="game-result">${escapeHtml(g.result || '')}</span>
      ${g.reviewedAt ? '<span class="badge badge-green"><i class="ti ti-check" aria-hidden="true"></i> annotée</span>'
                     : '<span class="badge badge-gold">à annoter</span>'}
      <button class="btn btn-blue btn-sm" onclick="annotateSharedGame('${escapeHtml(String(g.id))}')"><i class="ti ti-school" aria-hidden="true"></i> Annoter</button>
    </div>
  </div>`).join('');
  const rowMaia = maia.map(g => `<div class="sp-row">
    <div class="sp-row-name"><i class="ti ti-robot" aria-hidden="true"></i> ${escapeHtml(g.drillName || 'Partie Maia')}</div>
    <div class="sp-row-tail"><span class="sp-when">${g.ts ? _dt(g.ts) : ''}</span><span class="game-result">${escapeHtml(g.result || '')}</span></div>
  </div>`).join('');
  return `<section class="sp-sec">
    <h2 class="sp-sec-title"><i class="ti ti-chess" aria-hidden="true"></i> Ses parties</h2>
    ${shared.length ? rowShared : '<div class="sp-empty">Aucune partie partagée.</div>'}
    ${maia.length ? `<div class="sp-subhead">Parties contre Maia</div>${rowMaia}` : ''}
  </section>`;
}

// ── 6. À revoir avec lui ────────────────────────────────────────────────────────
function _errorsHTML(ctx) {
  const err = {};
  ctx.results.forEach(r => {
    const k = `${r.drillId}_${r.posIdx}_${r.san || ''}`;
    if (!err[k]) err[k] = { drillId: r.drillId, drillName: r.drillName, san: r.san, comment: r.comment || '', fails: 0, attempts: 0 };
    err[k].attempts++;
    if (!r.correct) err[k].fails++;
    if (r.comment && !err[k].comment) err[k].comment = r.comment;
  });
  const top = Object.values(err).filter(e => e.fails > 0)
    .sort((a, b) => b.fails - a.fails || b.fails / b.attempts - a.fails / a.attempts).slice(0, 5);
  if (!top.length) return '';
  const rows = top.map(e => {
    const rate = Math.round(e.fails / e.attempts * 100);
    return `<div class="ed-review-item" tabindex="0" data-did="${escapeHtml(String(e.drillId))}" data-san="${escapeHtml(e.san || '')}"
      onmouseenter="wsTip(event,this.dataset.did,this.dataset.san)" onmouseleave="wsTipHide()"
      onfocus="wsTip(event,this.dataset.did,this.dataset.san)" onblur="wsTipHide()">
      <span class="ed-review-move">${fig(e.san || '?')}</span>
      <div class="ed-review-body">
        <div class="ed-review-meta">${escapeHtml(e.drillName)} · raté ${e.fails}×</div>
        ${e.comment ? `<div class="ed-review-cmt">« ${figText(escapeHtml(e.comment.slice(0, 90)))}${e.comment.length > 90 ? '…' : ''} »</div>` : ''}
      </div>
      <span class="ed-review-rate" style="color:${_tierFail(rate)}">${rate}%</span>
      <button class="btn btn-blue btn-sm btn-ico" title="Assigner cette révision" aria-label="Assigner cette révision à l'élève"
        onclick="event.stopPropagation();assignReviewForStudent(this)"><i class="ti ti-target" aria-hidden="true"></i></button>
    </div>`;
  }).join('');
  return `<section class="sp-sec">
    <h2 class="sp-sec-title"><i class="ti ti-target" aria-hidden="true"></i> À revoir avec lui <span class="ed-review-hint">— survolez pour voir la position</span></h2>
    ${rows}
  </section>`;
}

// ── 7. Ses positions (replié : c'est la section la plus dense) ──────────────────
function _positionsHTML(ctx) {
  const byDrill = {};
  ctx.results.forEach(r => {
    if (!byDrill[r.drillName]) byDrill[r.drillName] = { id: r.drillId, positions: {} };
    const k = r.posIdx + '_' + (r.san || '');
    if (!byDrill[r.drillName].positions[k]) byDrill[r.drillName].positions[k] = { posIdx: r.posIdx, san: r.san, attempts: [], correct: false };
    byDrill[r.drillName].positions[k].attempts.push(r);
    if (r.correct) byDrill[r.drillName].positions[k].correct = true;
  });
  if (!Object.keys(byDrill).length) return '';
  const now = Date.now();
  const groups = Object.entries(byDrill).map(([dn, dd]) => {
    const arr = Object.entries(dd.positions).sort((a, b) => a[1].posIdx - b[1].posIdx)
      .map(([key, p]) => ({ ...p, key, sm2: sm2Get(ctx.name, dd.id, key) }));
    const dp = arr.length ? Math.round(arr.filter(p => p.correct).length / arr.length * 100) : 0;
    return `<div class="ed-pos-group">
      <div class="ed-pos-head">
        <div class="ed-subhead"><i class="ti ti-book" aria-hidden="true"></i> ${escapeHtml(dn)}</div>
        <span class="badge ${dp >= 70 ? 'badge-green' : 'badge-red'}">${dp}%</span>
      </div>
      <table class="pos-table">
        <thead><tr><th>#</th><th>Coup</th><th>Résultat</th><th>Révision</th></tr></thead>
        <tbody>${arr.map(p => {
          const nW = p.attempts.filter(a => !a.correct).length;
          const due = p.sm2 ? (p.sm2.due <= now ? '<span class="mastery-pill low">À revoir</span>'
                                                : `<span class="mastery-pill ok">dans ${Math.ceil((p.sm2.due - now) / 86400000)}j</span>`)
                            : '<span class="ed-pos-dash">—</span>';
          return `<tr tabindex="0" data-did="${escapeHtml(String(dd.id))}" data-san="${escapeHtml(p.san || '')}"
            onmouseenter="wsTip(event,this.dataset.did,this.dataset.san)" onmouseleave="wsTipHide()"
            onfocus="wsTip(event,this.dataset.did,this.dataset.san)" onblur="wsTipHide()">
            <td class="ed-pos-num">${p.posIdx + 1}</td>
            <td><span class="mono-move">${escapeHtml(p.san || '')}</span></td>
            <td>${p.correct ? `<span class="ok-pill">✓${nW > 0 ? ' (' + nW + 'x)' : ''}</span>` : `<span class="error-pill">✗ (${p.attempts.length})</span>`}</td>
            <td>${due}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }).join('');
  return `<details class="cs-collapse sp-sec">
    <summary><i class="ti ti-list-details" aria-hidden="true"></i> Ses positions en détail</summary>
    ${groups}
  </details>`;
}

// ── 8. Son activité récente ─────────────────────────────────────────────────────
// Timeline fusionnée : c'est la réponse à « ses dernières modifications ».
function _activityHTML(ctx) {
  const ev = [];
  // Les résultats sont par POSITION : on les agrège par module et par jour, sinon la
  // timeline serait noyée sous 40 lignes « a joué Cf3 ».
  const byDay = {};
  ctx.results.forEach(r => {
    const k = new Date(r.ts).toISOString().slice(0, 10) + '_' + r.drillName;
    if (!byDay[k]) byDay[k] = { ts: r.ts, drillName: r.drillName, n: 0, ok: 0 };
    byDay[k].n++; if (r.correct) byDay[k].ok++;
    byDay[k].ts = Math.max(byDay[k].ts, r.ts);
  });
  Object.values(byDay).forEach(d => ev.push({
    ts: d.ts, icon: 'ti-player-play', col: 'var(--cyan)',
    txt: `${d.n} position${d.n > 1 ? 's' : ''} révisée${d.n > 1 ? 's' : ''} · ${escapeHtml(d.drillName)}`,
    tail: `${Math.round(d.ok / d.n * 100)}%`
  }));
  ctx.games.filter(g => g.baseId && g.shared).forEach(g => ev.push({
    ts: g.ts || 0, icon: 'ti-share', col: 'var(--violet)',
    txt: `A partagé une partie · ${escapeHtml(g.white || '?')} – ${escapeHtml(g.black || '?')}`, tail: escapeHtml(g.result || '')
  }));
  ctx.overlays.forEach(o => {
    const mod = G.drills.find(d => String(d.id) === String(o.overlayOf));
    ev.push({ ts: o.updatedAt || 0, icon: 'ti-git-branch', col: 'var(--blue-ink)',
      txt: `A ajouté ses lignes · ${escapeHtml(mod ? mod.name : o.name)}`, tail: `${_countLayerMoves(o.tree)} coups` });
  });
  const top = ev.filter(e => e.ts).sort((a, b) => b.ts - a.ts).slice(0, 12);
  if (!top.length) return '';
  return `<section class="sp-sec">
    <h2 class="sp-sec-title"><i class="ti ti-history" aria-hidden="true"></i> Son activité récente</h2>
    ${top.map(e => `<div class="sp-act">
      <i class="ti ${e.icon} sp-act-ico" style="color:${e.col}" aria-hidden="true"></i>
      <span class="sp-act-txt">${e.txt}</span>
      <span class="sp-act-tail">${e.tail}</span>
      <span class="sp-when">${_dt(e.ts)}</span>
    </div>`).join('')}
  </section>`;
}

// ── La page ─────────────────────────────────────────────────────────────────────
function renderStudentPage(id) {
  const el = document.getElementById('prof-page');
  if (!el) return;
  const ctx = _gather(id);
  const vide = !ctx.results.length && !ctx.games.length && !ctx.overlays.length;
  el.innerHTML = _headHTML(ctx) + _kpiHTML(ctx) + (vide
    ? `<div class="sp-empty-big"><i class="ti ti-hourglass-empty" aria-hidden="true"></i>
         <div>${escapeHtml(ctx.display)} n'a pas encore commencé.</div>
         <div class="sp-empty-sub">${ctx.mods.length ? ctx.mods.length + ' module' + (ctx.mods.length > 1 ? 's' : '') + ' lui sont assignés — rien de révisé pour l\'instant.' : 'Aucun module ne lui est assigné.'}</div>
       </div>`
    : _modsHTML(ctx, false) + _modsHTML(ctx, true) + _gamesHTML(ctx)
      + _errorsHTML(ctx) + _positionsHTML(ctx) + _activityHTML(ctx));
}

// Pont window : `showStudentDetail` (coach-students) pose CS.selectedStudent puis appelle.
Object.assign(window, { renderStudentPage });
