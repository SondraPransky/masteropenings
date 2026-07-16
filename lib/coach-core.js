// ══════════════════════════════════════════════════════
// lib/coach-core.js — SOCLE de la vue coach.
// Helpers purs + état partagé des 7 modules `coach-*` (voir lib/coach.js).
//
// RÈGLE D'ARCHITECTURE (rend le graphe acyclique par construction) :
//   - helpers/état partagés  → `import` ES depuis CE fichier, et lui seul ;
//   - appel d'un module coach vers un autre → pont `window` (window.foo?.(…)).
// Ce fichier n'importe RIEN de ses frères.
//
// Données : `G` (state.js). Fonctions app-level via le pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
// Exportés : les 7 modules coach les importent d'ici plutôt que de les redupliquer.
export const switchCoachSection = (...a) => window.switchCoachSection?.(...a);
export const sm2Get             = (...a) => window.sm2Get?.(...a);
export const toast              = (...a) => window.toast?.(...a);
export const fig        = (x) => window.fig ? window.fig(x) : x;
export const figText    = (x) => window.figurineText ? window.figurineText(x) : x;   // coups inline d'un commentaire → figurines
export const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

// ── État partagé de la vue coach (patron `S` de lib/session.js) ───────────────
// Seuls les états qui traversent RÉELLEMENT les modules vivent ici :
//   - selectedStudent : écrit par coach-students, lu par coach-assign ;
//   - wsCards         : rempli par coach-weakspots, indexé par coach-assign.
// Tout le reste (selectedDrillFilter, _hmSelectedMod, _lastAssign, _selectedClassId,
// _pgQuery…) reste local à son module — il n'en sort pas.
// Comme `G`/`S` : on ne RÉASSIGNE jamais `CS` (un `import` ES est en lecture seule),
// on mute uniquement ses PROPRIÉTÉS (`CS.selectedStudent = …`).
export const CS = {
  selectedStudent: null,
  wsCards: [],
};

// ── Palier de couleur UNIFIÉ (tokens, jamais de hex en dur) ───
// Source unique des 3 paliers vert/ambre/rouge, pour que « réussite » et
// « taux d'échec » parlent la même langue partout dans la vue coach.
// Variantes « encre » (-ink) : ces couleurs colorent du TEXTE petit (11-13px), qui
// exige 4.5:1 — les tokens bruts --green/--gold plafonnent à ~3.2:1 en thème clair.
// En dark, les -ink s'aliassent sur les variantes claires (style.css) : rien ne change.
export const _tierPct  = (pct)  => pct  >= 70 ? 'var(--green-ink)' : pct  >= 50 ? 'var(--gold-ink)' : 'var(--red-ink)';  // réussite : haut = bon
export const _tierBg   = (pct)  => pct  >= 70 ? 'var(--green-dim)' : pct  >= 50 ? 'var(--gold-dim)' : 'var(--red-dim)';  // fond dim assorti
export const _tierFail = (rate) => rate >= 60 ? 'var(--red-ink)'   : rate >= 30 ? 'var(--gold-ink)' : 'var(--green-ink)'; // taux d'échec : haut = mauvais

// Résout le FEN (position AVANT le coup) d'un module par SAN, depuis son PGN.
// Construit une map san -> fenBefore en parcourant l'arbre (mémo par module, le
// temps d'un rendu). Permet le mini-échiquier des points faibles sans stocker de FEN.
let _fenMapCache = {};
// Vide le mémo (appelé en tête de rendu : les modules peuvent avoir changé).
// Passe par une fonction : un binding importé est en lecture seule côté appelant.
export function _resetFenCache() { _fenMapCache = {}; }
export function _drillFenMap(drillId) {
  if (_fenMapCache[drillId]) return _fenMapCache[drillId];
  const drill = G.drills.find(d => String(d.id) === String(drillId));
  const map = {};
  if (drill && drill.pgn && window.pgnToEditorTree) {
    try {
      const root = window.pgnToEditorTree(drill.pgn, drill.sessions?.[0]?.startFen);
      const stack = [root];
      while (stack.length) {
        const n = stack.pop();
        if (n && n.san && n.fenBefore && !(n.san in map)) map[n.san] = n.fenBefore;
        (n && n.children || []).forEach(c => stack.push(c));
      }
    } catch (e) {}
  }
  _fenMapCache[drillId] = map;
  return map;
}

// Seuil « à suivre » : un élève ne demande l'attention du coach que s'il a un vrai
// retard (>= _DUE_THRESHOLD positions dues) OU est inactif >7j. En répétition
// espacée, tout le monde a *toujours* 1-2 positions dues : sans seuil, l'accent
// « à suivre » vire au rouge pour tout le groupe et ne signale plus rien.
export const _DUE_THRESHOLD = 5;
// Nombre de positions dues (en retard) pour un élève, depuis sa mémoire Leitner.
export function _dueCount(label) {
  const now = Date.now();
  const pref = label + '_';
  let n = 0;
  for (const k in G.masteryData) {
    if (k.startsWith(pref) && (G.masteryData[k].due || 0) <= now) n++;
  }
  return n;
}

export function _masteryBadge(name) {
  const now = Date.now();
  const keys = Object.keys(G.masteryData).filter(k=>k.startsWith(name+'_'));
  if (!keys.length) return '';
  const due = keys.filter(k=>G.masteryData[k].due<=now).length;
  const learned = keys.filter(k=>(G.masteryData[k].level||0)>=4).length;   // Leitner : niveau ≥4 = ≥1 semaine (« appris »)
  if (due > 0) return `<span class="mastery-pill low"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${due} à revoir</span>`;
  if (learned === keys.length) return `<span class="mastery-pill ok"><i class="ti ti-circle-check" aria-hidden="true"></i> Maîtrisé</span>`;
  return `<span class="mastery-pill mid">${learned}/${keys.length} appris</span>`;
}

export function _deadlinePill(drill) {
  if (!drill.deadline) return '';
  const today = new Date().toISOString().slice(0,10);
  const diff  = (new Date(drill.deadline).getTime() - new Date(today).getTime()) / 86400000;
  if (diff < 0)  return `<span class="deadline-pill late"><i class="ti ti-alert-triangle" aria-hidden="true"></i> En retard</span>`;
  if (diff <= 3) return `<span class="deadline-pill soon"><i class="ti ti-clock" aria-hidden="true"></i> Dans ${Math.round(diff)}j</span>`;
  const dateFr = new Date(drill.deadline + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return `<span class="deadline-pill ok"><i class="ti ti-calendar" aria-hidden="true"></i> ${dateFr}</span>`;
}

// Points faibles de la classe : positions qui font échouer le plus d'élèves.
export function _classWeakSpots(arr) {
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

// Filtre par classe : { ids:[minuscule], set:Set } de la classe sélectionnée, ou null (toutes).
export function _classFilter(selectId) {
  const v = document.getElementById(selectId)?.value || 'all';
  if (v === 'all') return null;
  const cls = G.classes.find(c => String(c.id) === String(v));
  if (!cls) return null;
  const ids = _clsRoster(cls).map(s => String(s).toLowerCase());
  return { ids, set: new Set(ids) };
}
export function _populateClassFilter(el) {
  if (!el) return;
  const prev = el.value;
  el.innerHTML = '<option value="all">Toutes les classes</option>' +
    G.classes.map(c => `<option value="${c.id}">${escapeHtml((c.individual ? (c.name||'') : c.name).replace(/^👤\s*/,''))}</option>`).join('');
  el.value = prev;
}
// ── Identité élève (helpers canoniques) ─────────────────────────────────────
// Les rosters de classes stockent des EMAILS, r.student est un NOM D'AFFICHAGE :
// tout matching passe par ces helpers (jamais de triplet inline — source de bugs).
// Identifiants (minuscules, non vides) portés par un résultat/log : email/pseudo/nom.
export const _resultKeys = r => [(r.studentEmail||''), (r.studentPseudo||''), (r.student||'')].map(s => String(s).toLowerCase()).filter(Boolean);
// Un résultat/log appartient-il à un élève de l'ensemble (par email/pseudo/nom) ?
export const _matchStudentSet = (r, set) => _resultKeys(r).some(k => set.has(k));
// Roster d'une classe (les deux noms de champ coexistent : dbmap écrit les deux).
export const _clsRoster = cls => cls.studentEmails || cls.students || [];
// Tous les identifiants connus d'un élève à partir d'une clé (email OU nom d'affichage) :
// la clé elle-même + email/pseudo/nom relevés dans ses résultats.
export function _studentIdSet(key) {
  const kl = String(key).toLowerCase();
  const ids = new Set([kl]);
  G.results.forEach(r => { const ks = _resultKeys(r); if (ks.includes(kl)) ks.forEach(x => ids.add(x)); });
  return ids;
}

// Roster unifié pour la Vue Prof : élèves des G.classes (pseudo/email) + élèves avec résultats, dédupliqués.
export function _buildProfRoster(filtered, rosterIdsArg) {
  const rosterIds = rosterIdsArg || [...new Set(G.classes.flatMap(c => _clsRoster(c)))];
  const map = {};
  rosterIds.forEach(id => { map[id] = { key:id, label:id, total:0, correct:0, lastTs:0, played:false }; });
  const attach = (r, isResult) => {
    const keys = _resultKeys(r);
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

// États de chargement du dashboard coach (flag G._coachLoading posé par app.js
// autour des fetch Supabase) : skeleton pendant, carte d'erreur+retry si échec.
export function _renderCoachLoading() {
  const empty = document.getElementById('prof-empty'); if (empty) empty.style.display = 'none';
  const ui = document.getElementById('prof-ui'); if (ui) ui.style.display = '';
  // Vue d'ensemble (atterrissage) : tuiles KPI en skeleton, blocs vidés.
  const kpis = document.getElementById('ov-kpis');
  if (kpis) kpis.innerHTML = [0,1,2].map(() => `<div class="cs-kpi"><div class="skeleton skel-num"></div><div class="skeleton skel-lbl"></div></div>`).join('');
  ['ov-attention','ov-weakspots','ov-inbox'].forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = ''; });
  const list = document.getElementById('student-list');
  if (list) list.innerHTML = [0,1,2,3].map(() => `<div class="eleve-item" style="pointer-events:none"><div class="skeleton skel-line" style="width:60%"></div><div class="skeleton skel-line" style="width:40%;height:9px;margin-top:8px"></div></div>`).join('');
  const det = document.getElementById('prof-detail');
  if (det) det.innerHTML = `<div style="padding:20px"><div class="skeleton skel-line" style="width:45%;height:15px"></div><div class="skeleton skel-line" style="width:70%;margin-top:14px"></div><div class="skeleton skel-line" style="width:55%;margin-top:8px"></div></div>`;
}
export function _renderCoachError() {
  const empty = document.getElementById('prof-empty'); if (empty) empty.style.display = 'none';
  const ui = document.getElementById('prof-ui'); if (ui) ui.style.display = '';
  const errHTML = `<div class="coach-error">
    <div class="empty-ico"><i class="ti ti-cloud-off" aria-hidden="true"></i></div>
    <div style="font-weight:700;margin-bottom:4px">Chargement impossible</div>
    <div style="font-size:.82rem;color:var(--dim);margin-bottom:14px">Les données de tes élèves n'ont pas pu être récupérées — vérifie ta connexion. Rien n'est perdu.</div>
    <button class="btn btn-primary btn-sm" onclick="retryCoachLoad()"><i class="ti ti-refresh" aria-hidden="true"></i> Réessayer</button>
  </div>`;
  // Carte d'erreur sur la Vue d'ensemble ET sur la page Élèves (une seule visible à la fois).
  const kpis = document.getElementById('ov-kpis'); if (kpis) kpis.innerHTML = errHTML;
  const list = document.getElementById('student-list'); if (list) list.innerHTML = errHTML;
  ['ov-attention','ov-weakspots','ov-inbox','prof-detail'].forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = ''; });
}

// Roster + indicateurs agrégés (flags behind/stale, seuil de retard ADAPTATIF) —
// partagé entre la Vue d'ensemble (données globales) et la page Élèves (roster filtré).
export function _computeRoster(filtered, rosterIds) {
  const students = _buildProfRoster(filtered, rosterIds);
  const totalRes = filtered.length;
  const correct  = filtered.filter(r=>r.correct).length;
  const avgPct   = totalRes ? Math.round(correct/totalRes*100) : 0;
  const _now = Date.now();
  const _wkAgo = _now - 7 * 86400000;
  const activeWk = students.filter(s => s.lastTs >= _wkAgo).length;
  const inactive = students.filter(s => s.played && s.lastTs < _wkAgo).length;
  // Nb de positions dues par élève.
  students.forEach(s => { s.due = _dueCount(s.label); s.stale = s.played && s.lastTs < _wkAgo; });
  // Seuil de retard ADAPTATIF : un seuil absolu ne scale pas (dépend de la longueur
  // des modules). On flague le retard nettement au-dessus de la norme de la classe
  // (2× la médiane des dus), plancher _DUE_THRESHOLD. => l'accent reste un petit
  // sous-ensemble « à prioriser », pas tout le groupe.
  const _dues = students.filter(s => s.played).map(s => s.due).sort((a,b) => a-b);
  const _median = _dues.length ? _dues[Math.floor(_dues.length/2)] : 0;
  const _lagThreshold = Math.max(_DUE_THRESHOLD, _median * 2);
  students.forEach(s => {
    s.behind = s.due >= _lagThreshold;            // retard réel (rouge)
    s.attention = s.behind || s.stale;            // à suivre (retard ou inactivité)
  });
  // Priorise : retard d'abord, puis inactifs, puis par récence.
  students.sort((a,b) =>
    (b.behind - a.behind) || (b.stale - a.stale) || (b.due - a.due) || (b.lastTs - a.lastTs)
  );
  return {
    students, totalRes, avgPct, activeWk, inactive,
    needAttention: students.filter(s => s.attention).length,
    behindN: students.filter(s => s.behind).length,
  };
}

// Pont window : ces 4 helpers sont consommés HORS de la vue coach
// (modules.js lit window._deadlinePill pour ses cartes de module).
Object.assign(window, {
  _masteryBadge, _deadlinePill, _classWeakSpots, _buildProfRoster,
});
