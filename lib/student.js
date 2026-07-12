// ══════════════════════════════════════════════════════
// ACCUEIL ÉLÈVE — cartes de modules (assignés + perso), stats, série,
// anneaux de progression, import/suppression de révisions perso.
// Extrait d'app.js (§5.3). Données : `G` (state.js) + `S` (session.js).
// Fonctions app-level / Supabase résolues au runtime via le pont window.
// `Chess` = global CDN.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { S } from './session.js';
import { extractAllLines } from './core.js';
import { _buildDrillTree, _treePlayerPositions } from './tree.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const loadStudentModules    = (...a) => window.loadStudentModules?.(...a);
const goPage                = (...a) => window.goPage?.(...a);
const save                  = (...a) => window.save?.(...a);
const startDrill            = (...a) => window.startDrill?.(...a);
const closeModal            = (...a) => window.closeModal?.(...a);
const playVsMaia            = (...a) => window.playVsMaia?.(...a);
const toast                 = (...a) => window.toast?.(...a);
const _sbSaveStudentModule  = (...a) => window._sbSaveStudentModule?.(...a);
const _sbDeleteStudentModule= (...a) => window._sbDeleteStudentModule?.(...a);
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

// ── Identifiants de l'élève pour le matching des G.classes (pseudo, email, nom) ──
function _myIdentifiers() {
  return [...new Set([
    G.currentPseudo,
    (G.currentUser?.email || '').toLowerCase(),
    (G.currentUser?.displayName || '').toLowerCase()
  ].filter(Boolean))].slice(0, 10);
}

function renderStudentHome(assigned, personal) {
  assigned = assigned || [];
  personal = personal || [];
  const first = G.currentUser ? (G.currentUser.displayName || G.currentUser.email).split(' ')[0] : '';
  if (G.currentUser) S.student = G.currentUser.displayName || G.currentUser.email;
  const nameEl = document.getElementById('sh-student-name');
  if (nameEl) nameEl.textContent = 'Salut ' + first;

  // Streak (jours d'affilée avec activité)
  const streak = _computeStreak();
  const streakEl = document.getElementById('sh-streak');
  if (streakEl) streakEl.innerHTML = streak > 0 ? `🔥 ${streak} j` : '';

  // Notification : modules assignés pas encore ouverts
  const seen    = _seenModules();
  const seenVer = _seenVersions();
  const newOnes = assigned.filter(m => !seen.includes(String(m.id)));
  // Modules ÉDITÉS depuis la dernière ouverture par l'élève
  const updatedOnes = assigned.filter(m => {
    const id = String(m.id);
    if (!seen.includes(id)) return false;                                          // pas encore vu = "nouveau"
    if (!(id in seenVer)) { _markVersionSeen(id, m.updatedAt || 0); return false; } // baseline (vu avant cette fonctionnalité)
    return (m.updatedAt || 0) > seenVer[id];
  });
  assigned.forEach(m => { m._updated = updatedOnes.includes(m); });

  // Hero : à réviser aujourd'hui (positions dues — répétition espacée)
  const all    = [...assigned, ...personal];
  const dueN   = window._srSessionSize?.('all');
  const heroEl = document.getElementById('sh-hero');
  if (heroEl) {
    if (dueN > 0) {
      heroEl.className = 'sh-hero';   // indigo plein = signal "tu as du travail"
      heroEl.innerHTML = `<div class="sh-hero-label">À réviser aujourd'hui</div>
        <div class="sh-hero-sub">${dueN} position${dueN>1?'s':''} due${dueN>1?'s':''} — choisies par la répétition espacée.</div>
        <button class="sh-hero-btn" onclick="reviserTout()">▶ Commencer la révision</button>`;
    } else if (all.length) {
      heroEl.className = 'sh-hero sh-hero--calm';
      heroEl.innerHTML = `<div class="sh-hero-label">Tout est à jour ✓</div>
        <div class="sh-hero-sub">Bravo ${escapeHtml(first)} ! Rien à réviser aujourd'hui. Reviens demain ou explore un module.</div>`;
    } else {
      heroEl.className = 'sh-hero sh-hero--calm';
      heroEl.innerHTML = `<div class="sh-hero-label">Bienvenue 👋</div>
        <div class="sh-hero-sub">Ton prof va t'assigner des modules. En attendant, tu peux importer ton propre PGN ci-dessous.</div>`;
    }
  }

  window.renderSrDashboard?.();   // tableau de bord répétition espacée (P3)

  // Bannière nouveaux modules
  const notifEl = document.getElementById('sh-notif');
  if (notifEl) {
    let _nb = '';
    if (newOnes.length) _nb += `<div class="sh-notif-banner">🔔 <strong>${newOnes.length} nouveau${newOnes.length>1?'x':''} module${newOnes.length>1?'s':''}</strong> de ton prof !</div>`;
    if (updatedOnes.length) _nb += `<div class="sh-notif-banner" style="background:var(--cyan-dim);border-color:var(--cyan-glow);color:var(--cyan)">✏️ <strong>${updatedOnes.length} module${updatedOnes.length>1?'s':''} mis à jour</strong> par ton coach — rouvre${updatedOnes.length>1?'-les':'-le'} pour voir les nouveautés.</div>`;
    notifEl.innerHTML = _nb;
  }

  // Modules assignés
  const el = document.getElementById('sh-module-list');
  if (el) el.innerHTML = assigned.length
    ? assigned.map((m, i) => _shModuleCard(m, i, newOnes.some(n => String(n.id)===String(m.id)), false)).join('')
    : '<div class="sh-empty">Aucun module assigné. Ton prof t\'en enverra bientôt — tu seras prévenu ici.</div>';

  // Révisions perso
  const pel = document.getElementById('sh-perso-list');
  if (pel) pel.innerHTML = personal.length
    ? personal.map((m, j) => _shModuleCard(m, assigned.length + j, false, true)).join('')
    : '<div class="sh-empty">Aucune révision perso. Importe un PGN pour t\'entraîner sur ce que tu veux.</div>';
}

// Stats d'un module pour l'élève (depuis les résultats réels)
function _moduleStats(m) {
  const student = S.student || (G.currentUser ? (G.currentUser.displayName || G.currentUser.email) : '');
  const rs = G.results.filter(r => String(r.drillId) === String(m.id));
  const total   = rs.length;
  const correct = rs.filter(r => r.correct).length;
  let pct = total ? Math.round(correct / total * 100) : null;
  let due = 0, totalPos = 0, played = false;
  if (m.varmode === 'tree') {
    const positions = _treePlayerPositions(m);
    totalPos = positions.length;
    const did = String(m.id), now = Date.now();
    positions.forEach(p => {
      const mm = G.masteryData[`${student}_${did}_${p.masteryKey}`];
      if (mm) played = true;
      if (!mm || mm.due <= now) due++;
    });
    // L'anneau = couverture de maîtrise (positions non dues / total)
    pct = totalPos ? Math.round((totalPos - due) / totalPos * 100) : null;
  }
  let state;
  if (m.varmode === 'tree') {
    if (!played && due === totalPos) state = 'new';
    else if (due === 0)             state = 'mastered';
    else                           state = 'review';
  } else {
    state = total > 0 ? (pct >= 90 ? 'mastered' : 'review') : 'new';
  }
  return { total, correct, pct, due, totalPos, played, state };
}

function _computeStreak() {
  const days = new Set();
  const add = ts => { if (ts) days.add(new Date(ts).toDateString()); };
  G.results.forEach(r => add(r.ts));
  (typeof G.practiceLog !== 'undefined' ? G.practiceLog : []).forEach(p => add(p.ts));
  if (!days.size) return 0;
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // tolère "hier" comme départ
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function _renderRing(pct, colorVar) {
  const has = pct !== null && pct !== undefined;
  const p   = Math.max(0, Math.min(100, has ? pct : 0));
  const C    = 100.5;                       // 2·π·r, r=16
  const off  = (C * (1 - p / 100)).toFixed(1);
  const label = has ? p + '%' : '·';
  return `<svg width="38" height="38" viewBox="0 0 40 40" class="sh-ring" aria-hidden="true">
    <circle cx="20" cy="20" r="16" fill="none" stroke="var(--surf3)" stroke-width="4"/>
    <circle cx="20" cy="20" r="16" fill="none" stroke="${colorVar}" stroke-width="4" stroke-dasharray="${C}" stroke-dashoffset="${off}" stroke-linecap="round" transform="rotate(-90 20 20)"/>
    <text x="20" y="20" text-anchor="middle" dominant-baseline="central" style="font-size:10px;font-weight:700;fill:var(--text)">${label}</text>
  </svg>`;
}

function _shModuleCard(m, idx, isNew, isPersonal) {
  const st = _moduleStats(m);
  const sideSym = m.side === 'w' ? '♔' : m.side === 'b' ? '♚' : '⇄';
  const sideTxt = m.side === 'w' ? 'Blancs' : m.side === 'b' ? 'Noirs' : 'Les deux';
  // État → classe + libellé de la pastille (new / review / mastered)
  let stCls, stTxt;
  if (isNew)                        { stCls = 'new';      stTxt = '<i class="ti ti-bell" aria-hidden="true"></i> Nouveau'; }
  else if (m._updated)              { stCls = 'new';      stTxt = '<i class="ti ti-pencil" aria-hidden="true"></i> Mis à jour'; }
  else if (st.state === 'new')      { stCls = 'new';      stTxt = 'À découvrir'; }
  else if (st.state === 'mastered') { stCls = 'mastered'; stTxt = '<i class="ti ti-circle-check" aria-hidden="true"></i> Maîtrisé'; }
  else                              { stCls = 'review';   stTxt = `<i class="ti ti-rotate" aria-hidden="true"></i> À revoir${st.due ? ` · ${st.due}` : ''}`; }
  const pct = (st.pct == null) ? 0 : st.pct;
  const coachBadge = (!isPersonal && m._showCoach && m.coachName)
    ? `<span class="sh-mod-side" style="background:var(--cyan-dim);color:var(--cyan);padding:2px 9px;border-radius:999px"><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(m.coachName)}</span>` : '';
  // Badge d'échéance (assignation) : en retard / bientôt / date.
  let deadlineBadge = '';
  if (m.deadline) {
    const diff = (new Date(m.deadline + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime()) / 86400000;
    const st = diff < 0 ? ['var(--red-dim)','var(--red)','<i class="ti ti-alert-triangle" aria-hidden="true"></i> En retard']
             : diff <= 3 ? ['var(--gold-dim)','var(--gold)',`<i class="ti ti-clock" aria-hidden="true"></i> ${Math.round(diff)}j`]
             : ['var(--cyan-dim)','var(--cyan)',`<i class="ti ti-calendar" aria-hidden="true"></i> ${escapeHtml(m.deadline)}`];
    deadlineBadge = `<span class="sh-mod-side" style="background:${st[0]};color:${st[1]}">${st[2]}</span>`;
  }
  const edit = isPersonal ? `<button class="sh-card-act" onclick="event.stopPropagation();openPgnEditor(${idx})" title="Éditer sur échiquier"><i class="ti ti-edit" aria-hidden="true"></i></button>` : '';
  const del  = isPersonal ? `<button class="sh-card-act" onclick="event.stopPropagation();deleteStudentDrill('${m.id}')" title="Supprimer"><i class="ti ti-trash" aria-hidden="true"></i></button>` : '';
  // Paquet d'exercices : icône/badge dédiés + pas de partie Maia (positions isolées).
  const nEx = (m.sessions?.[0]?.kps || m.kps || []).length;
  const icon = m.isExercise ? '<i class="ti ti-puzzle" aria-hidden="true"></i>' : sideSym;
  const kindBadge = m.isExercise
    ? `<span class="sh-mod-side" style="background:var(--surf2);color:var(--violet)"><i class="ti ti-puzzle" aria-hidden="true"></i> ${nEx} exercice${nEx > 1 ? 's' : ''}</span>`
    : `<span class="sh-mod-side">${sideTxt}</span>`;
  const maiaBtn = m.isExercise ? '' : `<button class="sh-card-act" onclick="event.stopPropagation();playVsMaia(${idx})" title="Jouer contre Maia"><i class="ti ti-robot" aria-hidden="true"></i></button>`;
  return `<div class="sh-mod${isNew ? ' sh-mod-new' : ''}" onclick="startStudentDrill(${idx})">
    <div class="sh-mod-head">
      <div class="sh-mod-name">${escapeHtml(m.name)}</div>
      <div class="sh-mod-icon">${icon}</div>
    </div>
    <div class="sh-mod-meta">
      <span class="sh-mod-state ${stCls}">${stTxt}</span>
      ${kindBadge}
      ${coachBadge}
      ${deadlineBadge}
    </div>
    <div class="sh-mod-progress"><div class="sh-mod-progress-fill" style="width:${pct}%"></div></div>
    <div class="sh-mod-actions">
      ${edit}${del}
      ${maiaBtn}
      <button class="sh-card-act sh-card-play" title="Réviser"><i class="ti ti-player-play" aria-hidden="true"></i></button>
    </div>
  </div>`;
}

// ── Suivi "déjà vu" pour la notification (local par élève) ──
function _seenKey()    { return 'mc_seen_modules_' + (G.currentUser?.uid || 'anon'); }
function _seenModules(){ try { return JSON.parse(localStorage.getItem(_seenKey()) || '[]'); } catch(e){ return []; } }
function _markModuleSeen(id) {
  const seen = _seenModules();
  if (!seen.includes(String(id))) { seen.push(String(id)); localStorage.setItem(_seenKey(), JSON.stringify(seen)); }
}

// Suivi de la version vue — pour notifier les modules ÉDITÉS par le coach
function _seenVerKey()   { return 'mc_seen_versions_' + (G.currentUser?.uid || 'anon'); }
function _seenVersions() { try { return JSON.parse(localStorage.getItem(_seenVerKey()) || '{}'); } catch(e){ return {}; } }
function _markVersionSeen(id, ver) {
  const v = _seenVersions();
  v[String(id)] = ver || 0;
  localStorage.setItem(_seenVerKey(), JSON.stringify(v));
}

function startStudentDrill(idx) {
  S.student = G.currentUser?.displayName || G.currentUser?.email || 'Élève';
  localStorage.setItem('mc_student', S.student);
  const d = G.drills[idx];
  if (d) { _markModuleSeen(d.id); _markVersionSeen(d.id, d.updatedAt || 0); }
  goPage('drill');
  startDrill(idx);
}

// ── Import perso par l'élève (privé) ──────────────────
// Entree unique de creation cote eleve (miroir du « + Creer » coach) : ouvre un
// petit menu de choix (echiquier / PGN / ouvertures pretes) au lieu de 3 boutons.
function openStudentCreateChoice() {
  document.getElementById('modal-student-create-choice')?.classList.add('on');
}

function openStudentImport() {
  const n = document.getElementById('si-name'); if (n) n.value = '';
  const p = document.getElementById('si-pgn');  if (p) p.value = '';
  document.getElementById('modal-student-import').classList.add('on');
}

function importStudentDrill() {
  const name = document.getElementById('si-name').value.trim();
  const pgn  = document.getElementById('si-pgn').value.trim();
  const side = document.getElementById('si-side').value;
  if (!name) { toast('⚠ Donne un nom à ta révision', 'ko'); return; }
  if (!pgn)  { toast('⚠ Colle un PGN', 'ko'); return; }
  let allLines;
  try { allLines = extractAllLines(pgn); }
  catch(e) { toast('❌ PGN invalide : ' + e.message, 'ko'); return; }
  if (!allLines.length) { toast('❌ Aucune ligne jouable dans ce PGN', 'ko'); return; }
  const tree = _buildDrillTree(allLines, side);
  if (!Object.keys(tree).length) { toast('⚠ Aucun coup extractible', 'ko'); return; }
  const d = {
    id: Date.now(),
    name, level: 'Perso', side, pgn,
    mode: 'line', varmode: 'tree', tree,
    sessions: [{ label: 'Arbre complet', startFen: new Chess().fen(), moves: [], kps: [] }],
    hideComments: false, deadline: null,
    personal: true,
    ownerStudentId: G.currentUser?.uid || null,
    created: new Date().toLocaleDateString('fr-FR')
  };
  G.drills.push(d);
  save();
  _sbSaveStudentModule(d);
  closeModal('modal-student-import');
  toast('✓ Révision perso créée', 'ok');
  loadStudentModules();
}

function deleteStudentDrill(id) {
  if (!confirm('Supprimer cette révision perso ?')) return;
  G.drills = G.drills.filter(d => String(d.id) !== String(id));
  save();
  _sbDeleteStudentModule(id);
  loadStudentModules();
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js.
Object.assign(window, {
  _myIdentifiers, renderStudentHome, _moduleStats, _computeStreak, _renderRing, _shModuleCard,
  _seenKey, _seenModules, _markModuleSeen, _seenVerKey, _seenVersions, _markVersionSeen,
  startStudentDrill, openStudentImport, openStudentCreateChoice, importStudentDrill, deleteStudentDrill,
});
