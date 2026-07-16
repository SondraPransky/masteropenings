// ══════════════════════════════════════════════════════
// VUE COACH — suivi des élèves (onglets présence / progression / classes /
// parties / heatmap) + exports CSV/PGN/JSON.
// Extrait d'app.js (§5.3). État local au module (selectedStudent,
// selectedDrillFilter, _profTab) : rien n'en sort.
// Données : `G` (state.js). Fonctions app-level via le pont window.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { renderStaticBoard } from './miniboard.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const switchCoachSection = (...a) => window.switchCoachSection?.(...a);
const sm2Get             = (...a) => window.sm2Get?.(...a);
const toast              = (...a) => window.toast?.(...a);
const fig        = (x) => window.fig ? window.fig(x) : x;
const figText    = (x) => window.figurineText ? window.figurineText(x) : x;   // coups inline d'un commentaire → figurines
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

// ── Palier de couleur UNIFIÉ (tokens, jamais de hex en dur) ───
// Source unique des 3 paliers vert/ambre/rouge, pour que « réussite » et
// « taux d'échec » parlent la même langue partout dans la vue coach.
// Variantes « encre » (-ink) : ces couleurs colorent du TEXTE petit (11-13px), qui
// exige 4.5:1 — les tokens bruts --green/--gold plafonnent à ~3.2:1 en thème clair.
// En dark, les -ink s'aliassent sur les variantes claires (style.css) : rien ne change.
const _tierPct  = (pct)  => pct  >= 70 ? 'var(--green-ink)' : pct  >= 50 ? 'var(--gold-ink)' : 'var(--red-ink)';  // réussite : haut = bon
const _tierBg   = (pct)  => pct  >= 70 ? 'var(--green-dim)' : pct  >= 50 ? 'var(--gold-dim)' : 'var(--red-dim)';  // fond dim assorti
const _tierFail = (rate) => rate >= 60 ? 'var(--red-ink)'   : rate >= 30 ? 'var(--gold-ink)' : 'var(--green-ink)'; // taux d'échec : haut = mauvais

// Résout le FEN (position AVANT le coup) d'un module par SAN, depuis son PGN.
// Construit une map san -> fenBefore en parcourant l'arbre (mémo par module, le
// temps d'un rendu). Permet le mini-échiquier des points faibles sans stocker de FEN.
let _fenMapCache = {};
function _drillFenMap(drillId) {
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
// Données des cartes de points faibles (pour la modale « Voir la position »).
let _wsCards = [];
// Module sélectionné sur la page Points faibles (master-detail) ; null = pire module.
let _hmSelectedMod = null;

// ══════════════════════════════════════════════════════
// VUE PROF — tabbed
// ══════════════════════════════════════════════════════
let selectedStudent=null, selectedDrillFilter='all', _profTab='presence';
let _rosterQuery='';   // filtre texte de la liste des élèves (recherche par nom)

// Seuil « à suivre » : un élève ne demande l'attention du coach que s'il a un vrai
// retard (>= _DUE_THRESHOLD positions dues) OU est inactif >7j. En répétition
// espacée, tout le monde a *toujours* 1-2 positions dues : sans seuil, l'accent
// « à suivre » vire au rouge pour tout le groupe et ne signale plus rien.
const _DUE_THRESHOLD = 5;
// Nombre de positions dues (en retard) pour un élève, depuis sa mémoire Leitner.
function _dueCount(label) {
  const now = Date.now();
  const pref = label + '_';
  let n = 0;
  for (const k in G.masteryData) {
    if (k.startsWith(pref) && (G.masteryData[k].due || 0) <= now) n++;
  }
  return n;
}

function _masteryBadge(name) {
  const now = Date.now();
  const keys = Object.keys(G.masteryData).filter(k=>k.startsWith(name+'_'));
  if (!keys.length) return '';
  const due = keys.filter(k=>G.masteryData[k].due<=now).length;
  const learned = keys.filter(k=>(G.masteryData[k].level||0)>=4).length;   // Leitner : niveau ≥4 = ≥1 semaine (« appris »)
  if (due > 0) return `<span class="mastery-pill low"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${due} à revoir</span>`;
  if (learned === keys.length) return `<span class="mastery-pill ok"><i class="ti ti-circle-check" aria-hidden="true"></i> Maîtrisé</span>`;
  return `<span class="mastery-pill mid">${learned}/${keys.length} appris</span>`;
}

function _deadlinePill(drill) {
  if (!drill.deadline) return '';
  const today = new Date().toISOString().slice(0,10);
  const diff  = (new Date(drill.deadline).getTime() - new Date(today).getTime()) / 86400000;
  if (diff < 0)  return `<span class="deadline-pill late"><i class="ti ti-alert-triangle" aria-hidden="true"></i> En retard</span>`;
  if (diff <= 3) return `<span class="deadline-pill soon"><i class="ti ti-clock" aria-hidden="true"></i> Dans ${Math.round(diff)}j</span>`;
  const dateFr = new Date(drill.deadline + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return `<span class="deadline-pill ok"><i class="ti ti-calendar" aria-hidden="true"></i> ${dateFr}</span>`;
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

// Filtre par classe : { ids:[minuscule], set:Set } de la classe sélectionnée, ou null (toutes).
function _classFilter(selectId) {
  const v = document.getElementById(selectId)?.value || 'all';
  if (v === 'all') return null;
  const cls = G.classes.find(c => String(c.id) === String(v));
  if (!cls) return null;
  const ids = _clsRoster(cls).map(s => String(s).toLowerCase());
  return { ids, set: new Set(ids) };
}
function _populateClassFilter(el) {
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
const _resultKeys = r => [(r.studentEmail||''), (r.studentPseudo||''), (r.student||'')].map(s => String(s).toLowerCase()).filter(Boolean);
// Un résultat/log appartient-il à un élève de l'ensemble (par email/pseudo/nom) ?
const _matchStudentSet = (r, set) => _resultKeys(r).some(k => set.has(k));
// Roster d'une classe (les deux noms de champ coexistent : dbmap écrit les deux).
const _clsRoster = cls => cls.studentEmails || cls.students || [];
// Tous les identifiants connus d'un élève à partir d'une clé (email OU nom d'affichage) :
// la clé elle-même + email/pseudo/nom relevés dans ses résultats.
function _studentIdSet(key) {
  const kl = String(key).toLowerCase();
  const ids = new Set([kl]);
  G.results.forEach(r => { const ks = _resultKeys(r); if (ks.includes(kl)) ks.forEach(x => ids.add(x)); });
  return ids;
}

// Roster unifié pour la Vue Prof : élèves des G.classes (pseudo/email) + élèves avec résultats, dédupliqués.
function _buildProfRoster(filtered, rosterIdsArg) {
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
function _renderCoachLoading() {
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
function _renderCoachError() {
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
function _computeRoster(filtered, rosterIds) {
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

// ══════════════════════════════════════════════════════
// VUE D'ENSEMBLE (atterrissage coach) — synthèse prescriptive :
// chaque bloc répond à « que dois-je faire ? » et renvoie vers sa page dédiée.
// ══════════════════════════════════════════════════════
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

  _updatePartiesBadge();   // badge sidebar « Parties » (N à annoter) dès l'atterrissage

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
  showStudentDetail(key);
}

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
    const isOn = s.key===selectedStudent ? ' on' : '';
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
  if (!selectedStudent && students.length) selectedStudent = students[0].key;
  if (selectedStudent) showStudentDetail(selectedStudent);
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
  selectedStudent = id;
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
  html += `<div class="ed-kpi-row">
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:${pct>=70?'var(--green)':'var(--red)'}">${pct}%</div><div class="ed-kpi-l">Réussite</div></div>
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:${dueN>0?'var(--red)':'var(--green)'}">${dueN}</div><div class="ed-kpi-l">À revoir</div></div>
    <div class="ed-kpi"><div class="ed-kpi-v" style="color:${lateN>0?'var(--red)':'var(--green)'}">${lateN}</div><div class="ed-kpi-l">En retard</div></div>
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

// ══════════════════════════════════════════════════════
// HEATMAP DES ERREURS
// ══════════════════════════════════════════════════════
function renderHeatmap() {
  const el = document.getElementById('prof-heatmap-content');
  _fenMapCache = {};   // re-résout les FEN à chaque rendu (modules peuvent changer)
  // Le choix du module se fait via les cartes du haut (master-detail) — pas de select.
  _populateClassFilter(document.getElementById('hm-class-filter'));
  const cf = _classFilter('hm-class-filter');

  let filtered = G.results;
  if (cf) filtered = filtered.filter(r => _matchStudentSet(r, cf.set));

  if (!filtered.length) {
    el.innerHTML = '<div class="empty" style="padding:40px"><div class="empty-ico"><i class="ti ti-flame" aria-hidden="true"></i></div>Aucun résultat d\'élève pour l\'instant — les points faibles apparaîtront dès que vos élèves auront révisé.</div>';
    return;
  }

  // Grouper par position : taux, élèves, et surtout QUI échoue (failStudents)
  const byPos = {};
  filtered.forEach(r => {
    const key = `${r.drillId||r.drillName}_${r.posIdx}_${r.san}`;
    if (!byPos[key]) byPos[key] = { drillId:r.drillId, drillName:r.drillName, posIdx:r.posIdx, san:r.san||'—', comment:r.comment||'', attempts:0, correct:0, students:new Set(), failStudents:new Set(), failIds:new Set() };
    const p = byPos[key];
    p.attempts++;
    if (r.correct) p.correct++;
    else {
      p.failStudents.add(r.student);
      // Identifiants de matching complets : sans eux, l'assignation ciblée (rosters
      // en emails vs r.student en nom d'affichage) ne retrouve jamais les élèves.
      _resultKeys(r).forEach(k => p.failIds.add(k));
    }
    p.students.add(r.student);
    if (r.comment && !p.comment) p.comment = r.comment;
  });

  const entries = Object.values(byPos).filter(p=>p.attempts>0);
  entries.forEach(p => { p.rate = Math.round(p.correct/p.attempts*100); });
  const totalPos = entries.length;
  const hotCount = entries.filter(p=>p.rate<50).length;

  // ── Groupement PAR MODULE : chaque position est rattachée à son module. ──
  // Sections triées par réussite moyenne croissante (module le plus en difficulté d'abord) ;
  // lignes triées par taux croissant (pire position d'abord).
  const byMod = {};
  entries.forEach(p => {
    const k = String(p.drillId || p.drillName);
    if (!byMod[k]) byMod[k] = { id: k, name: p.drillName || 'Module', rows: [] };
    byMod[k].rows.push(p);
  });
  const mods = Object.values(byMod);
  mods.forEach(m => {
    m.rows.sort((a,b) => a.rate - b.rate || b.failStudents.size - a.failStudents.size);
    m.avg = Math.round(m.rows.reduce((s,p) => s + p.rate, 0) / m.rows.length);
    m.hot = m.rows.filter(p => p.rate < 50).length;
  });
  mods.sort((a,b) => a.avg - b.avg);

  // ── Master-detail : sélecteur de modules (santé d'un coup d'œil) → UNE table. ──
  // Empiler les 7 tables = scroll interminable ; on n'affiche que le module choisi,
  // le pire par défaut. La sélection persiste entre re-rendus (assignation, filtres).
  if (!mods.some(m => m.id === _hmSelectedMod)) _hmSelectedMod = mods[0].id;
  const sel = mods.find(m => m.id === _hmSelectedMod);

  const modCards = mods.map(m => `<button class="hm-mod-card${m.id === _hmSelectedMod ? ' on' : ''}" onclick="hmSelectMod(this.dataset.mid)" data-mid="${escapeHtml(m.id)}" aria-pressed="${m.id === _hmSelectedMod ? 'true' : 'false'}">
      <span class="hm-mod-card-name">${escapeHtml(m.name)}</span>
      <span class="hm-mod-card-stats">
        <b style="color:${_tierPct(m.avg)}">${m.avg}%</b>
        ${m.hot ? `<span class="hm-mod-card-hot"><i class="ti ti-flame" aria-hidden="true"></i> ${m.hot}</span>` : ''}
        <span class="hm-mod-card-n">${m.rows.length} pos.</span>
      </span>
    </button>`).join('');

  // _wsCards = lignes du module SÉLECTIONNÉ (indexe openWeakspotPosition / assignTargetedReview).
  _wsCards = [];
  const sections = [sel].map(m => {
    const rowsHtml = m.rows.map(p => {
      const i = _wsCards.length;
      _wsCards.push({ drillId:p.drillId, drillName:p.drillName, san:p.san, comment:p.comment, rate:p.rate, students:[...p.students], failStudents:[...p.failStudents], failIds:[...p.failIds], fen:_drillFenMap(p.drillId)[p.san] || null });
      const col = _tierPct(p.rate);
      const fails = [...p.failStudents];
      const chips = fails.slice(0,8).map(s=>`<span class="wsx-chip">${escapeHtml(s)}</span>`).join('')
        + (fails.length>8 ? `<span class="wsx-chip">+${fails.length-8}</span>` : '');
      return `<tr class="wsx-tr${p.rate<50?' hot':''}" tabindex="0" data-did="${escapeHtml(String(p.drillId))}" data-san="${escapeHtml(p.san)}"
        onmouseenter="wsTip(event,this.dataset.did,this.dataset.san)" onmouseleave="wsTipHide()"
        onfocus="wsTip(event,this.dataset.did,this.dataset.san)" onblur="wsTipHide()"
        aria-label="${escapeHtml(fig(p.san))} — ${p.rate}% de réussite">
        <td><span class="mono-move">${fig(p.san)}</span></td>
        <td><span class="wsx-rate" style="background:${_tierBg(p.rate)};color:${col}">${p.rate}%</span></td>
        <td><div class="wsx-chips">${chips || '<span class="wsx-none">—</span>'}</div></td>
        <td class="wsx-cmt">${p.comment ? `« ${figText(escapeHtml(p.comment.slice(0,70)))}${p.comment.length>70?'…':''} »` : ''}</td>
        <td class="wsx-act">
          <button class="btn btn-ghost btn-sm btn-ico" onclick="openWeakspotPosition(${i})" title="Voir la position" aria-label="Voir la position"><i class="ti ti-eye" aria-hidden="true"></i></button>
          <button class="btn btn-blue btn-sm btn-ico" data-assign="${i}" onclick="assignTargetedReview(${i})" title="Assigner une révision ciblée" aria-label="Assigner une révision ciblée"><i class="ti ti-target" aria-hidden="true"></i></button>
          <button class="btn btn-ghost btn-sm btn-ico" data-undo="${i}" onclick="undoTargetedReview(${i})" style="display:none" title="Annuler l'assignation" aria-label="Annuler l'assignation"><i class="ti ti-arrow-back-up" aria-hidden="true"></i></button>
        </td>
      </tr>`;
    }).join('');
    return `<div class="wsx-mod-sec">
      <div class="wsx-mod-head">
        <span class="wsx-mod-name"><i class="ti ti-stack-2" aria-hidden="true"></i> ${escapeHtml(m.name)}</span>
        <span class="wsx-mod-stats">${m.rows.length} position${m.rows.length>1?'s':''} · <b style="color:${_tierPct(m.avg)}">${m.avg}%</b> de réussite${m.hot?` · <span style="color:var(--red);font-weight:700">${m.hot} point${m.hot>1?'s':''} chaud${m.hot>1?'s':''}</span>`:''}</span>
      </div>
      <div class="wsx-table-wrap">
        <table class="wsx-table">
          <thead><tr><th>Coup</th><th>Réussite</th><th>Élèves en échec</th><th>Commentaire</th><th></th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="cs-kpi-strip">
      <div class="cs-kpi"><div class="cs-kpi-val" style="color:var(--text)">${totalPos}</div><div class="cs-kpi-lbl">Positions</div></div>
      <div class="cs-kpi${hotCount>0?' cs-kpi-accent':''}"><div class="cs-kpi-val" style="color:${hotCount>0?'var(--red)':'var(--green)'}">${hotCount}</div><div class="cs-kpi-lbl">Points chauds</div></div>
      <div class="cs-kpi"><div class="cs-kpi-val" style="color:var(--green)">${totalPos-hotCount}</div><div class="cs-kpi-lbl">Bien maîtrisées</div></div>
    </div>
    <div class="hm-mods" role="group" aria-label="Choisir un module">${modCards}</div>
    <div class="wsx-hint"><i class="ti ti-pointer" aria-hidden="true"></i> Survolez une ligne pour voir la position sur l'échiquier.</div>
    ${sections}`;
}

// Sélectionne un module sur la page Points faibles (cartes du haut) et re-rend.
function hmSelectMod(id) { _hmSelectedMod = id; renderHeatmap(); }

// ── Tooltip échiquier générique : survol/focus d'une erreur → position affichée. ──
// FEN résolue à la volée (module + SAN) ; clampé aux bords du viewport ; hover-only
// (en tactile, la modale « Voir » reste le chemin — le tooltip est aria-hidden).
function wsTip(event, drillId, san) {
  const tip = document.getElementById('ws-board-tip');
  if (!tip) return;
  const fen = _drillFenMap(drillId)[san];
  if (!fen) { tip.style.display = 'none'; return; }
  tip.innerHTML = renderStaticBoard(fen, { size: 200 }) +
    `<div class="wsx-tip-cap"><span class="mono-move">${fig(san)}</span> · position avant le coup</div>`;
  tip.style.display = '';
  const r = (event.currentTarget || event.target).getBoundingClientRect();
  const tw = 216, th = 236;   // ~taille du tooltip (échiquier 200 + légende + padding)
  let x = r.right + 12, y = r.top - 8;
  if (x + tw > window.innerWidth)  x = Math.max(8, r.left - tw - 12);
  if (y + th > window.innerHeight) y = Math.max(8, window.innerHeight - th - 8);
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}
function wsTipHide() {
  const tip = document.getElementById('ws-board-tip');
  if (tip) tip.style.display = 'none';
}

// ══════════════════════════════════════════════════════
// ONGLET CLASSES
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// PAGE CLASSES : cartes de classes (renderClassList, modules.js) → détail d'UNE
// classe (roster × modules, échéances, éditer/supprimer). Drill-down navigable.
// ══════════════════════════════════════════════════════
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
      <div style="font-size:1.05rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(name)}"><i class="ti ${cls.individual?'ti-user':'ti-school'}" aria-hidden="true"></i> ${escapeHtml(name)}</div>
      <div style="font-size:.75rem;color:var(--dim)">${roster.length} élève${roster.length>1?'s':''} · ${activeCount} actif${activeCount>1?'s':''} · ${modIds.length} module${modIds.length>1?'s':''}</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0">
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
  if (!roster.length) return '<div style="color:var(--dim);font-size:.8rem;padding:8px 0">Aucun élève dans cette classe.</div>';
  if (!modIds.length) return '<div style="color:var(--dim);font-size:.8rem;padding:8px 0">Aucun module assigné.</div>';
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
        ? `<span style="font-weight:700;color:${_tierPct(pct)}">${pct}%</span> <span style="color:var(--dim);font-size:.72rem">· ${since===0?'auj.':since+'j'}</span>`
        : late
          ? '<span style="color:var(--red);font-size:.76rem;font-weight:700"><i class="ti ti-alert-triangle" aria-hidden="true"></i> En retard</span>'
          : '<span style="color:var(--dim);font-size:.78rem">Pas commencé</span>';
      const display = window._studentDisplayName?.(email) || email;
      return `<button class="ov-row cls-stu-row" onclick="ovOpenStudent(this.dataset.k)" data-k="${escapeHtml(email)}" title="${escapeHtml(email)}">
        <span class="ov-row-name"><i class="ti ti-point-filled" style="color:${played?'var(--green)':(late?'var(--red)':'var(--dim)')}" aria-hidden="true"></i> ${escapeHtml(display)}</span>
        <span style="flex-shrink:0">${status}</span>
      </button>`;
    }).join('');
    return `<div style="margin-top:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
        <span style="font-weight:600;font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class="ti ti-stack-2" aria-hidden="true"></i> ${escapeHtml(modName)}</span>
        <span style="flex-shrink:0;display:flex;align-items:center;gap:6px">${deadline ? _deadlinePill({ deadline }) : ''}<span style="font-size:.72rem;color:var(--dim)"><i class="ti ti-check" aria-hidden="true"></i> ${doneCount}/${roster.length}</span></span>
      </div>
      ${stuRows}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════
// PARTIES PARTAGÉES — dashboard coach : groupé PAR ÉLÈVE (« qu'est-ce que Tom
// m'a envoyé ? »), chips de statut + recherche, marqueur « nouveau », badge sidebar.
// ══════════════════════════════════════════════════════
let _pgQuery = '', _pgStatus = 'all', _pgSeenTs = 0;

function _sharedGames() { return (G.savedGames || []).filter(g => g.baseId && g.shared); }

// Badge sidebar « Parties » = nb de parties à annoter (rouge si > 0).
function _updatePartiesBadge() {
  const todo = _sharedGames().filter(g => !g.reviewedAt).length;
  const b = document.getElementById('csnav-count-parties');
  if (!b) return;
  b.textContent = String(todo);
  b.style.display = todo ? '' : 'none';
  b.classList.toggle('new', todo > 0);
}

function pgSearch(v) {
  _pgQuery = (v || '').trim().toLowerCase();
  const el = document.getElementById('pg-groups');
  if (el) el.innerHTML = _pgGroupsHTML();   // re-rendu ciblé : l'input garde le focus
}
function pgFilterStatus(s) { _pgStatus = s || 'all'; renderPartiesTab(); }

// Rangées groupées par élève, filtrées par statut + recherche.
function _pgGroupsHTML() {
  let games = _sharedGames();
  if (_pgStatus === 'todo') games = games.filter(g => !g.reviewedAt);
  if (_pgStatus === 'done') games = games.filter(g => g.reviewedAt);
  if (_pgQuery) games = games.filter(g =>
    [(g.student||''),(g.event||''),(g.white||''),(g.black||'')].some(s => s.toLowerCase().includes(_pgQuery)));
  if (!games.length) return `<div style="color:var(--dim);font-size:.82rem;padding:18px 4px">Aucune partie ne correspond.</div>`;

  const byStu = {};
  games.forEach(g => {
    const k = g.student || 'Élève';
    if (!byStu[k]) byStu[k] = [];
    byStu[k].push(g);
  });
  const groups = Object.entries(byStu).map(([stu, arr]) => ({
    stu, arr: arr.sort((a,b)=>(b.ts||0)-(a.ts||0)),
    todo: arr.filter(g=>!g.reviewedAt).length,
    last: Math.max(...arr.map(g=>g.ts||0)),
  })).sort((a,b) => b.todo - a.todo || b.last - a.last);

  return groups.map(gr => `<div class="pg-stu-sec">
    <div class="pg-stu-head">
      <span class="pg-stu-name"><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(gr.stu)}</span>
      <span class="pg-stu-stats">${gr.arr.length} partie${gr.arr.length>1?'s':''}${gr.todo?` · <b style="color:var(--red)">${gr.todo} à annoter</b>`:''}</span>
    </div>
    ${gr.arr.map(g => {
      const dt = g.ts ? new Date(g.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) : '';
      const who = (g.white||'?') + ' – ' + (g.black||'?');
      const isNew = (g.ts||0) > _pgSeenTs && !g.reviewedAt;
      const badge = g.reviewedAt
        ? `<span class="pg-annotated" title="Annotée par toi"><i class="ti ti-sparkles" aria-hidden="true"></i> Annotée</span>`
        : isNew ? `<span class="pg-new">nouveau</span>` : '';
      return `<div class="game-row">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <span class="game-result ${g.result==='1-0'?'win':g.result==='0-1'?'loss':'draw'}">${g.result||'*'}</span>
            <div style="min-width:0">
              <div style="font-weight:600;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(who)} ${badge}</div>
              <div style="font-size:.72rem;color:var(--dim)"><i class="ti ti-trophy" aria-hidden="true"></i> ${escapeHtml(g.event||'—')} · ${dt}${g.nature==='analyse'?' · <i class="ti ti-notes" aria-hidden="true"></i> Analyse':''}</div>
            </div>
          </div>
          <button class="btn ${g.reviewedAt?'btn-ghost':'btn-primary'} btn-sm" onclick="annotateSharedGame('${escapeHtml(String(g.id))}')"><i class="ti ${g.reviewedAt?'ti-book':'ti-school'}" aria-hidden="true"></i> ${g.reviewedAt?'Revoir la revue':'Annoter'}</button>
        </div>
      </div>`;
    }).join('')}
  </div>`).join('');
}

function _sharedGamesHTML() {
  const shared = _sharedGames();
  if (!shared.length) return '';
  const todo = shared.filter(g => !g.reviewedAt).length;
  const done = shared.length - todo;
  return `<div class="pg-wrap">
    <div class="pg-toolbar">
      <span class="pg-count"><i class="ti ti-inbox" aria-hidden="true"></i> <b>${shared.length}</b> partie${shared.length>1?'s':''} reçue${shared.length>1?'s':''}${todo?` · <b style="color:var(--red)">${todo} à annoter</b>`:' · tout est annoté ✓'}</span>
      <div class="pg-chips">
        <button class="mod-folder-chip${_pgStatus==='todo'?' on':''}" onclick="pgFilterStatus('todo')">À annoter <span class="mod-chip-n">${todo}</span></button>
        <button class="mod-folder-chip${_pgStatus==='done'?' on':''}" onclick="pgFilterStatus('done')">Annotées <span class="mod-chip-n">${done}</span></button>
        <button class="mod-folder-chip${_pgStatus==='all'?' on':''}" onclick="pgFilterStatus('all')">Toutes <span class="mod-chip-n">${shared.length}</span></button>
      </div>
      <div class="eleve-search mod-search pg-search">
        <i class="ti ti-search" aria-hidden="true"></i>
        <input type="search" placeholder="Élève, tournoi, joueur…" autocomplete="off" value="${escapeHtml(_pgQuery)}"
               aria-label="Rechercher une partie" oninput="pgSearch(this.value)">
      </div>
    </div>
    <div id="pg-groups">${_pgGroupsHTML()}</div>
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
  // Marqueur « nouveau » : parties arrivées depuis la DERNIÈRE visite de cette page.
  // On capture le repère avant de le mettre à jour (les nouveautés du rendu courant
  // restent marquées ; elles ne le seront plus à la prochaine visite).
  _pgSeenTs = +localStorage.getItem('mc_coach_games_seen') || 0;
  const partiesFilter = (document.getElementById('parties-drill-filter') || document.getElementById('prof-drill-filter'))?.value || 'all';
  const sharedHTML = _sharedGamesHTML();
  // Parties Maia uniquement (les entrées bibliothèque ont un baseId → traitées ci-dessus)
  const maia = (G.savedGames || []).filter(g => !g.baseId);
  const games = partiesFilter==='all' ? maia : maia.filter(g=>String(g.drillId)===partiesFilter);
  if (!games.length && !sharedHTML) {
    el.innerHTML='<div class="empty" style="padding:40px"><div class="empty-ico"><i class="ti ti-chess" aria-hidden="true"></i></div>Aucune partie enregistrée</div>';
    _updatePartiesBadge();
    return;
  }
  const sorted = [...games].sort((a,b)=>b.ts-a.ts);
  // Parties Maia = historique d'entraînement, pas du travail à faire → repliées.
  const maiaHTML = !games.length ? '' : `<details class="pg-maia">
    <summary><i class="ti ti-robot" aria-hidden="true"></i> Parties d'entraînement vs Maia <span style="color:var(--dim);font-weight:400">(${games.length})</span></summary>
    ${sorted.map((g,i)=>{
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
  }).join('')}
  </details>`;
  el.innerHTML = sharedHTML + maiaHTML;
  _updatePartiesBadge();
  localStorage.setItem('mc_coach_games_seen', String(Date.now()));
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

// « Voir la position » d'un point faible : modale avec grand échiquier + coup + commentaire + élèves.
function openWeakspotPosition(i) {
  const p = _wsCards[i]; if (!p) return;
  const body = document.getElementById('ws-modal-body'); if (!body) return;
  const board = p.fen ? renderStaticBoard(p.fen, { size: 260 })
    : '<div style="color:var(--dim);font-size:.85rem;padding:24px;text-align:center">Position indisponible pour ce module.</div>';
  const chips = p.failStudents.map(s => `<span class="wsx-chip">${escapeHtml(s)}</span>`).join('');
  body.innerHTML = `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:0 0 auto;margin:0 auto">${board}</div>
      <div style="flex:1;min-width:200px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span class="wsx-move" style="font-size:1.25rem">${fig(p.san)}</span>
          <span class="wsx-rate" style="background:var(--red-dim);color:var(--red)">${100-p.rate}% d'échec</span>
        </div>
        <div style="font-size:.8rem;color:var(--dim);margin-bottom:12px">${escapeHtml(p.drillName)}</div>
        ${p.comment ? `<div class="wsx-comment" style="margin:0 0 14px">« ${figText(escapeHtml(p.comment))} »</div>` : ''}
        <div style="font-size:.78rem;font-weight:700;margin-bottom:6px">Élèves qui échouent (${p.failStudents.length})</div>
        <div class="wsx-chips">${chips}</div>
      </div>
    </div>
    <div class="wsx-actions" style="margin-top:18px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" data-assign="${i}" onclick="assignTargetedReview(${i})"><i class="ti ti-target" aria-hidden="true"></i> Aux élèves qui échouent</button>
      <button class="btn btn-blue btn-sm" data-assign="${i}" onclick="assignTargetedReview(${i},{whole:true})"><i class="ti ti-users" aria-hidden="true"></i> À toute la classe</button>
      <button class="btn btn-ghost btn-sm" data-undo="${i}" onclick="undoTargetedReview(${i})" style="display:none;flex:0 0 auto"><i class="ti ti-arrow-back-up" aria-hidden="true"></i> Annuler</button>
    </div>`;
  document.getElementById('modal-weakspot')?.classList.add('on');
}

// Dernière assignation (pour l'undo) : { key, patches:[{clsId, revId, added:[], created}] }.
// key = index _wsCards (Points faibles) ou 'stu:drillId_san' (détail élève).
let _lastAssign = null;

// Cœur commun d'assignation : upsert de la position (module + coup + FEN + commentaire)
// dans class.targetedReviews (→ classes.extra, migration-free) pour chaque classe où
// pickTargets(cls, roster) retient des élèves. Persiste (local + Supabase) et retourne
// { reached, patches } — de quoi ANNULER (undoTargetedReview) — ou null si personne.
function _assignReviewCore(pos, pickTargets) {
  const reached = new Set(), patches = [];
  G.classes.forEach(cls => {
    const targets = pickTargets(cls, _clsRoster(cls).map(String));
    if (!targets.length) return;
    if (!Array.isArray(cls.targetedReviews)) cls.targetedReviews = [];
    let rev = cls.targetedReviews.find(r => String(r.drillId) === String(pos.drillId) && r.san === pos.san);
    if (rev) {
      const before = new Set((rev.students || []).map(s => String(s).toLowerCase()));
      const added = targets.filter(s => !before.has(s.toLowerCase()));
      rev.students = [...new Set([...(rev.students || []), ...targets])];
      rev.assignedAt = Date.now();
      patches.push({ clsId: cls.id, revId: rev.id, added, created: false });
    } else {
      const revId = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      cls.targetedReviews.push({ id: revId, drillId: pos.drillId, drillName: pos.drillName || '', san: pos.san, fen: pos.fen || null, comment: pos.comment || '', students: targets, assignedAt: Date.now() });
      patches.push({ clsId: cls.id, revId, added: targets, created: true });
    }
    targets.forEach(t => reached.add(t.toLowerCase()));
  });
  if (!reached.size) return null;
  window.saveClasses?.();
  patches.forEach(u => { const c = G.classes.find(x => x.id === u.clsId); if (c) window._sbSaveClass?.(c); });
  return { reached, patches };
}

// « Assigner une révision ciblée » depuis les POINTS FAIBLES (indexe _wsCards). Deux portées :
//  - défaut : uniquement les élèves qui échouent (précision) ;
//  - {whole:true} : toute la classe à qui le module est assigné (prévention).
function assignTargetedReview(i, opts = {}) {
  const p = _wsCards[i]; if (!p) return;
  const whole = !!opts.whole;
  // Matching par identifiants complets (email/pseudo/nom) — les rosters stockent des emails.
  const failSet = new Set((p.failIds && p.failIds.length ? p.failIds : p.failStudents).map(s => String(s).toLowerCase()));
  const res = _assignReviewCore(p, (cls, roster) => whole
    ? ((cls.moduleIds || []).map(String).includes(String(p.drillId)) ? roster : [])
    : roster.filter(s => failSet.has(s.toLowerCase())));
  if (!res) { toast(whole ? 'Aucune classe n\'a ce module assigné' : 'Aucun de ces élèves n\'est dans une classe', 'ko'); return; }
  _lastAssign = { key: i, patches: res.patches };
  toast(`✓ « ${p.san} » à réviser assigné à ${res.reached.size} élève${res.reached.size > 1 ? 's' : ''}`, 'ok');
  document.querySelectorAll(`[data-assign="${i}"]`).forEach(b => { b.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Assigné'; b.setAttribute('disabled', 'disabled'); });
  document.querySelectorAll(`[data-undo="${i}"]`).forEach(b => { b.style.display = ''; });
}

// « Assigner » depuis le DÉTAIL d'un élève : même cœur, cible = les classes où CET élève
// est inscrit ET qui ont le module. Le bouton devient « Annuler » (undo) après assignation.
function assignReviewForStudent(btn) {
  const it = btn?.closest('.ed-review-item');
  if (!it || !selectedStudent) return;
  const drillId = it.dataset.did, san = it.dataset.san;
  const ids = _studentIdSet(selectedStudent);
  const drill = G.drills.find(d => String(d.id) === String(drillId));
  const hit = G.results.find(r => String(r.drillId) === String(drillId) && (r.san||'') === san && r.comment);
  const res = _assignReviewCore(
    { drillId, drillName: drill ? drill.name : '', san, fen: _drillFenMap(drillId)[san] || null, comment: hit ? hit.comment : '' },
    (cls, roster) => {
      if (!(cls.moduleIds || []).map(String).includes(String(drillId))) return [];   // classe sans ce module
      const email = roster.find(e => ids.has(e.toLowerCase()));                      // l'entrée roster de cet élève
      return email ? [email] : [];
    });
  if (!res) { toast('Cet élève n\'est dans aucune classe ayant ce module', 'ko'); return; }
  const key = 'stu:' + drillId + '_' + san;
  _lastAssign = { key, patches: res.patches };
  toast(`✓ « ${san} » à revoir assigné à l'élève`, 'ok');
  btn.innerHTML = '<i class="ti ti-arrow-back-up" aria-hidden="true"></i>';
  btn.title = 'Annuler l\'assignation';
  btn.setAttribute('aria-label', 'Annuler l\'assignation');
  btn.onclick = e => { e.stopPropagation(); undoTargetedReview(key); };
}

// Annule la dernière assignation : retire les révisions créées / les élèves ajoutés.
function undoTargetedReview(key) {
  if (!_lastAssign || String(_lastAssign.key) !== String(key)) return;
  _lastAssign.patches.forEach(u => {
    const cls = G.classes.find(x => x.id === u.clsId); if (!cls) return;
    if (u.created) {
      cls.targetedReviews = (cls.targetedReviews || []).filter(r => r.id !== u.revId);
    } else {
      const rev = (cls.targetedReviews || []).find(r => r.id === u.revId);
      if (rev) { const rm = new Set(u.added.map(s => String(s).toLowerCase())); rev.students = (rev.students || []).filter(s => !rm.has(String(s).toLowerCase())); }
    }
  });
  window.saveClasses?.();
  _lastAssign.patches.forEach(u => { const c = G.classes.find(x => x.id === u.clsId); if (c) window._sbSaveClass?.(c); });
  _lastAssign = null;
  toast('Assignation annulée', 'ok');
  document.querySelectorAll(`[data-assign="${key}"]`).forEach(b => { b.innerHTML = '<i class="ti ti-target" aria-hidden="true"></i> Assigner'; b.removeAttribute('disabled'); });
  document.querySelectorAll(`[data-undo="${key}"]`).forEach(b => { b.style.display = 'none'; });
  // Undo depuis le détail élève → re-rendre le panneau (le bouton 🎯 y renaît propre).
  if (String(key).startsWith('stu:') && selectedStudent) showStudentDetail(selectedStudent);
}


// Pont window : exposé aux onclick="" (index.html) et aux appels app.js.
Object.assign(window, {
  _masteryBadge, _deadlinePill, _classWeakSpots, _buildProfRoster,
  renderProfView, showStudentDetail, _edTab, renderHeatmap,
  renderOverview, ovOpenStudent, renderClassesPage, openClassDetail, closeClassDetail,
  renderPartiesTab, togglePGN, _download,
  exportCSV, exportPracticeCSV, exportPGN, exportAll,
  annotateSharedGame, openWeakspotPosition, assignTargetedReview, undoTargetedReview, assignReviewForStudent,
  wsTip, wsTipHide, hmSelectMod,
  pgSearch, pgFilterStatus, _updatePartiesBadge,
  _eleveListKey, rosterSearch,
});
