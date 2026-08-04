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
import { weaknessReport } from './weakness-core.js';
import { sb, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-client.js';
import {
  CS, _tierPct, _tierFail, _deadlinePill, _resultKeys, _matchStudentSet, _clsRoster,
  _studentIdSet, _studentAvatar, _photoKey, sm2Get, fig, figText, escapeHtml, toast,
} from './coach-core.js';

const _dt = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day:'numeric', month:'short' });

// ── Divulgation progressive ─────────────────────────────────────────────────────
// Mesuré sur le volume RÉEL de lancement (24 modules) : la page montait à 3253px —
// 3,9 écrans, 55 rangées, 73 badges — et le contenu de lancement en compte 49. Le
// défaut n'est pas la longueur, c'est que TOUT criait pareil : le coach prépare un
// cours, il ne lit pas un inventaire. Chaque liste montre donc les N plus URGENTS
// (le tri fait le travail) et range le reste derrière un <details>. Rien n'est perdu :
// la page reste exhaustive, elle cesse d'être plate.
function _capList(rows, n, reste) {
  if (rows.length <= n) return rows.join('');
  const k = rows.length - n;
  return rows.slice(0, n).join('')
    + `<details class="sp-more"><summary>${k} ${reste}${k > 1 ? 's' : ''} de plus</summary>${rows.slice(n).join('')}</details>`;
}

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
  // ⚠ Par le SET d'identifiants, pas par idLower seul : les rosters stockent des
  // EMAILS et la page peut être ouverte par le NOM d'affichage (celui des résultats).
  // Filtrer sur le seul idLower rendait « Aucune classe » — et donc AUCUN module
  // assigné ni échéance — pour tout élève ouvert par son nom (mesuré au volume réel).
  const classes = G.classes.filter(c => _clsRoster(c).some(e => ids.has(String(e).toLowerCase())));

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
  const hasPhoto = !!(G.studentPhotos || {})[_photoKey(ctx.id)];
  return `<div class="sp-head">
    <button class="btn btn-ghost btn-sm" onclick="closeStudentPage()"><i class="ti ti-arrow-left" aria-hidden="true"></i> Élèves</button>
    <button class="sp-avatar-btn" title="Changer la photo de l'élève" aria-label="Changer la photo de ${escapeHtml(ctx.display)}"
            data-key="${escapeHtml(ctx.id)}" onclick="spPickPhoto(this.dataset.key)">
      ${_studentAvatar(ctx.id, ctx.display, 52)}
    </button>
    <div class="sp-head-id">
      <h1 class="sp-name">${escapeHtml(ctx.display)}</h1>
      <div class="sp-head-sub">${cls || 'Aucune classe'} · ${lastTs ? 'vu le ' + _dt(lastTs) : 'jamais venu'}${hasPhoto ? ` · <button class="sp-photo-del" data-key="${escapeHtml(ctx.id)}" onclick="spRemovePhoto(this.dataset.key)">retirer la photo</button>` : ''}</div>
    </div>
    <button class="btn btn-ghost btn-sm sp-parent-btn" title="Générer le lien de suivi à envoyer aux parents"
            data-em="${escapeHtml(ctx.idLower)}" data-nm="${escapeHtml(ctx.name)}" data-dp="${escapeHtml(ctx.display)}"
            onclick="openParentLink(this.dataset.em, this.dataset.nm, this.dataset.dp)">
      <i class="ti ti-users" aria-hidden="true"></i> Lien parents</button>
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
  if (!list.length) return '';
  // Tri par URGENCE — c'est lui qui fait le travail, le plafond ne fait que ranger.
  // En retard d'abord, puis le moins avancé, puis jamais commencé, puis le reste.
  const scored = list.map(m => {
    const st = _modStats(ctx, m);
    const nEx = (m.sessions?.[0]?.kps || m.kps || []).length;
    const avance = isExercise ? (nEx ? st.done / nEx : 0) : (st.tried ? st.pct / 100 : 0);
    return { m, st, nEx, avance, late: ctx.overdue.has(String(m.id)) ? 1 : 0, vierge: st.tried ? 0 : 1 };
  }).sort((a, b) => (b.late - a.late) || (a.avance - b.avance) || (b.vierge - a.vierge));
  const nAttention = scored.filter(x => x.late || x.avance < 0.7).length;
  const titre = isExercise
    ? '<i class="ti ti-puzzle" aria-hidden="true"></i> Ses exercices'
    : '<i class="ti ti-book" aria-hidden="true"></i> Ses modules';
  const compte = `<span class="sp-count">${list.length}${nAttention ? ` · ${nAttention} à travailler` : ' · tout va bien'}</span>`;
  const rows = scored.map(({ m, st, nEx, late }) => {
    const ov = ctx.overlays.find(o => String(o.overlayOf) === String(m.id));
    const nMine = ov ? _countLayerMoves(ov.tree) : 0;
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
  });
  return `<section class="sp-sec"><h2 class="sp-sec-title">${titre} ${compte}</h2>
    ${_capList(rows, 5, isExercise ? 'paquet' : 'module')}</section>`;
}

// ── 5. Ses parties ──────────────────────────────────────────────────────────────
function _gamesHTML(ctx) {
  // À ANNOTER d'abord : c'est l'action en attente, pas la chronologie. Les déjà
  // annotées descendent — le coach n'a rien à y faire.
  const vu = (g) => (g.reviewedAt ? 1 : 0);
  const shared = ctx.games.filter(g => g.baseId && g.shared)
    .sort((a, b) => (vu(a) - vu(b)) || ((b.ts || 0) - (a.ts || 0)));
  if (!shared.length) return '';
  const nTodo = shared.filter(g => !g.reviewedAt).length;
  const compte = `<span class="sp-count">${shared.length}${nTodo ? ` · ${nTodo} à annoter` : ' · toutes annotées'}</span>`;
  const rowShared = shared.map(g => `<div class="sp-row">
    <div class="sp-row-name">${escapeHtml(g.white || '?')} – ${escapeHtml(g.black || '?')}</div>
    <div class="sp-row-tail">
      <span class="sp-when">${g.ts ? _dt(g.ts) : ''}</span>
      <span class="game-result">${escapeHtml(g.result || '')}</span>
      ${g.reviewedAt ? '<span class="badge badge-green"><i class="ti ti-check" aria-hidden="true"></i> annotée</span>'
                     : '<span class="badge badge-gold">à annoter</span>'}
      <button class="btn btn-blue btn-sm" onclick="annotateSharedGame('${escapeHtml(String(g.id))}')"><i class="ti ti-eye" aria-hidden="true"></i> Ouvrir</button>
    </div>
  </div>`);
  return `<section class="sp-sec">
    <h2 class="sp-sec-title"><i class="ti ti-chess" aria-hidden="true"></i> Ses parties ${compte}</h2>
    ${_capList(rowShared, 4, 'partie')}
  </section>`;
}

// ── 5 bis. Faiblesses détectées (assistant faiblesses, arbitrage 04/08) ─────────
// Deux natures : sorties de répertoire RÉCURRENTES (compareGameToRepertoire,
// agrégées à travers ses parties) + fautes tactiques (analyse Stockfish persistée
// dans games.extra.analysis). Visible COACH SEULEMENT (décision fermée).
function _weakReport(ctx) {
  const shared = ctx.games.filter(g => g.baseId && g.shared && g.pgn);
  return { shared, report: weaknessReport(shared, G.drills, window._pgRepOf || undefined) };
}

function _weakHTML(ctx) {
  const { shared, report } = _weakReport(ctx);
  if (!shared.length) return '';
  const { exits, faults } = report;
  const fg = (x) => fig(x);

  // — Sorties de répertoire (récurrentes d'abord — le tri du cœur pur)
  const exitRows = exits.slice(0, 6).map(e => {
    const num = e.moveNo + (e.color === 'b' ? '…' : '.');
    return `<div class="ed-review-item" tabindex="0" data-did="${escapeHtml(String(e.drillId))}" data-san="${escapeHtml(e.expected[0] || '')}">
      <span class="ed-review-move">${fg(e.played.map(escapeHtml).join(' / '))}</span>
      <div class="ed-review-body">
        <div class="ed-review-meta">${escapeHtml(e.drillName)} · coup ${num} · le répertoire joue ${fg(e.expected.map(escapeHtml).join(' ou '))}</div>
        ${e.count > 1 ? `<div class="ed-review-cmt sp-weak-rec"><i class="ti ti-repeat" aria-hidden="true"></i> ${e.count} parties sortent ICI — c'est sa faiblesse d'ouverture</div>` : ''}
      </div>
      ${e.count > 1 ? `<span class="badge badge-red">${e.count}×</span>` : ''}
      <button class="btn btn-blue btn-sm btn-ico" title="Créer un exercice de cette position" aria-label="Créer un exercice de cette position"
        data-gid="${escapeHtml(String(e.gameIds[0]))}" onclick="event.stopPropagation();repCreateExercise(this.dataset.gid)"><i class="ti ti-puzzle" aria-hidden="true"></i></button>
      <button class="btn btn-blue btn-sm btn-ico" title="Assigner cette révision" aria-label="Assigner cette révision à l'élève"
        onclick="event.stopPropagation();assignReviewForStudent(this)"><i class="ti ti-target" aria-hidden="true"></i></button>
    </div>`;
  }).join('');

  // — Fautes tactiques (les plus coûteuses, toutes phases confondues)
  const allFaults = [...faults.phases.ouverture, ...faults.phases.milieu, ...faults.phases.finale]
    .sort((a, b) => b.loss - a.loss).slice(0, 6);
  const faultRows = allFaults.map(ft => {
    const num = ft.moveNo + (ft.color === 'b' ? '…' : '.');
    const pions = (ft.loss / 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    return `<div class="ed-review-item sp-fault">
      <span class="ed-review-move sp-fault-${ft.sev}">${num} ${fg(escapeHtml(ft.san))} ${ft.sev === 'blunder' ? '??' : '?'}</span>
      <div class="ed-review-body">
        <div class="ed-review-meta">${ft.phase === 'ouverture' ? 'Ouverture' : ft.phase === 'finale' ? 'Finale' : 'Milieu de jeu'} · perd ~${pions} pion${ft.loss >= 200 ? 's' : ''}${ft.best ? ` · le moteur préférait ${fg(escapeHtml(ft.best))}` : ''}</div>
        <div class="ed-review-cmt">${escapeHtml(ft.white || '?')} – ${escapeHtml(ft.black || '?')}</div>
      </div>
      <button class="btn btn-blue btn-sm" data-gid="${escapeHtml(String(ft.gameId))}"
        onclick="annotateSharedGame(this.dataset.gid)"><i class="ti ti-eye" aria-hidden="true"></i> Ouvrir</button>
    </div>`;
  }).join('');

  // — Résumé chiffré + progression de la file
  const f = faults;
  const enCours = f.analyzed < f.total ? ` · <span class="sp-weak-pending"><i class="ti ti-loader-2 wq-spin" aria-hidden="true"></i> analyse ${f.analyzed}/${f.total}</span>` : '';
  const parPhase = ['ouverture', 'milieu', 'finale']
    .map(p => f.phases[p].length ? `${f.phases[p].length} en ${p === 'milieu' ? 'milieu de jeu' : p}` : null)
    .filter(Boolean).join(' · ');
  const resume = `<div class="sp-weak-sum">${f.blunders} gaffe${f.blunders > 1 ? 's' : ''} · ${f.mistakes} erreur${f.mistakes > 1 ? 's' : ''} sur ${f.analyzed} partie${f.analyzed > 1 ? 's' : ''} analysée${f.analyzed > 1 ? 's' : ''}${parPhase ? ' — ' + parPhase : ''}${enCours}</div>`;

  // — Synthèse rédigée (bouton par élève — coût maîtrisé, décision 04/08)
  const brief = (G.studentBriefs || {})[_photoKey(ctx.id)];
  const briefHTML = `<div class="sp-brief">
    <div class="sp-brief-head">
      <span class="ed-subhead"><i class="ti ti-sparkles" aria-hidden="true"></i> Synthèse de l'assistant</span>
      <button id="sp-brief-btn" class="btn btn-blue btn-sm" onclick="spGenBrief()">
        <i class="ti ti-wand" aria-hidden="true"></i> ${brief ? 'Régénérer le bilan' : 'Générer le bilan'}</button>
    </div>
    ${brief ? `<div class="sp-brief-body">${figText(escapeHtml(brief.text)).replace(/\n/g, '<br>')}</div>
               <div class="sp-brief-when">généré le ${_dt(brief.ts)}</div>` : ''}
  </div>`;

  const vide = !exitRows && !faultRows;
  return `<section class="sp-sec">
    <h2 class="sp-sec-title"><i class="ti ti-wand" aria-hidden="true"></i> Faiblesses détectées
      <span class="sp-count">${shared.length} partie${shared.length > 1 ? 's' : ''} envoyée${shared.length > 1 ? 's' : ''}</span></h2>
    ${resume}
    ${vide ? `<div class="sp-weak-ok"><i class="ti ti-shield-check" aria-hidden="true"></i> Rien à signaler sur ses parties${f.analyzed < f.total ? ' (analyse en cours)' : ''}.</div>` : ''}
    ${exitRows ? `<div class="ed-subhead sp-weak-sub"><i class="ti ti-route-off" aria-hidden="true"></i> Sorties de répertoire</div>${exitRows}` : ''}
    ${faultRows ? `<div class="ed-subhead sp-weak-sub"><i class="ti ti-bomb" aria-hidden="true"></i> Fautes tactiques</div>${faultRows}` : ''}
    ${briefHTML}
  </section>`;
}

// ── Génération de la synthèse rédigée (Edge Function `student-brief`) ───────────
// Payload = le rapport structuré compact ; la clé API Anthropic vit dans le secret
// Supabase (jamais côté client — patron lichess-ref). JWT vérifié : seul un compte
// connecté peut appeler (et donc dépenser).
async function spGenBrief() {
  if (!CS.selectedStudent) return;
  if (!sb) { toast('⚠ Synthèse disponible en connecté (site déployé)', 'ko'); return; }
  const ctx = _gather(CS.selectedStudent);
  const { report } = _weakReport(ctx);
  const btn = document.getElementById('sp-brief-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 wq-spin" aria-hidden="true"></i> Rédaction…'; }
  try {
    const payload = {
      student: ctx.display,
      games: report.faults.total, analyzed: report.faults.analyzed,
      exits: report.exits.slice(0, 8).map(e => ({
        module: e.drillName, coup: `${e.moveNo}${e.color === 'b' ? '…' : '.'} ${e.played.join('/')}`,
        attendu: e.expected.join(' ou '), parties: e.count })),
      fautes: {
        gaffes: report.faults.blunders, erreurs: report.faults.mistakes,
        parPhase: { ouverture: report.faults.phases.ouverture.length, milieu: report.faults.phases.milieu.length, finale: report.faults.phases.finale.length },
        top: [...report.faults.phases.ouverture, ...report.faults.phases.milieu, ...report.faults.phases.finale]
          .sort((a, b) => b.loss - a.loss).slice(0, 8)
          .map(ft => ({ coup: `${ft.moveNo}${ft.color === 'b' ? '…' : '.'} ${ft.san}`, phase: ft.phase, pions: Math.round(ft.loss) / 100, mieux: ft.best || null })),
      },
    };
    const { data: sess } = await sb.auth.getSession();
    const token = sess?.session?.access_token;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/student-brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token || SUPABASE_PUBLISHABLE_KEY}` },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const out = await r.json();
    if (!out.text) throw new Error('réponse vide');
    G.studentBriefs = { ...(G.studentBriefs || {}), [_photoKey(ctx.id)]: { ts: Date.now(), text: out.text } };
    try { localStorage.setItem('mc_student_briefs', JSON.stringify(G.studentBriefs)); } catch (e) {}
    window._sbSaveStudentBriefs?.();
    renderStudentPage(CS.selectedStudent);
    toast('✓ Bilan généré', 'ok');
  } catch (e) {
    toast('⚠ Synthèse indisponible : ' + (e && e.message || e), 'ko');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-wand" aria-hidden="true"></i> Générer le bilan'; }
  }
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
    <!-- « avec lui » genrait l'élève ; « survolez » excluait le clavier (les rangées
         sont tabbables et posent l'aperçu au focus) — même correction que Points faibles. -->
    <h2 class="sp-sec-title"><i class="ti ti-target" aria-hidden="true"></i> À revoir avec cet élève <span class="ed-review-hint">— choisissez une ligne pour voir la position</span></h2>
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
  const top = ev.filter(e => e.ts).sort((a, b) => b.ts - a.ts).slice(0, 20);
  if (!top.length) return '';
  return `<section class="sp-sec">
    <h2 class="sp-sec-title"><i class="ti ti-history" aria-hidden="true"></i> Son activité récente</h2>
    ${_capList(top.map(e => `<div class="sp-act">
      <i class="ti ${e.icon} sp-act-ico" style="color:${e.col}" aria-hidden="true"></i>
      <span class="sp-act-txt">${e.txt}</span>
      <span class="sp-act-tail">${e.tail}</span>
      <span class="sp-when">${_dt(e.ts)}</span>
    </div>`), 6, 'événement')}
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
    : _modsHTML(ctx, false) + _modsHTML(ctx, true) + _gamesHTML(ctx) + _weakHTML(ctx)
      + _errorsHTML(ctx) + _positionsHTML(ctx) + _activityHTML(ctx));
}

// ── Photo de l'élève (annotation du coach) ──────────────────────────────────
// Redimensionne au chargement (recadrage carré centré ~160px, JPEG) : une photo
// de téléphone (~3 Mo) deviendrait ~8-15 Ko — tenable dans le jsonb du profil coach.
const _PHOTO_PX = 160;
function _resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      const c = document.createElement('canvas');
      c.width = c.height = _PHOTO_PX;
      c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, _PHOTO_PX, _PHOTO_PX);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('image illisible'));
    img.src = URL.createObjectURL(file);
  });
}

function spPickPhoto(key) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    try {
      const url = await _resizePhoto(file);
      G.studentPhotos = { ...(G.studentPhotos || {}), [_photoKey(key)]: url };
      _savePhotos();
      window.renderStudentPage?.(CS.selectedStudent);
      window.renderProfView?.();   // rafraîchit l'avatar dans la liste
      toast('✓ Photo mise à jour', 'ok');
    } catch (e) { toast('⚠ Photo illisible', 'ko'); }
  };
  inp.click();
}

function spRemovePhoto(key) {
  const p = { ...(G.studentPhotos || {}) };
  delete p[_photoKey(key)];
  G.studentPhotos = p;
  _savePhotos();
  window.renderStudentPage?.(CS.selectedStudent);
  window.renderProfView?.();
  toast('✓ Photo retirée', 'ok');
}

function _savePhotos() {
  try { localStorage.setItem('mc_student_photos', JSON.stringify(G.studentPhotos)); } catch (e) {}
  window._sbSaveStudentPhotos?.();
}

// Pont window : `showStudentDetail` (coach-students) pose CS.selectedStudent puis appelle.
Object.assign(window, { renderStudentPage, spPickPhoto, spRemovePhoto, spGenBrief });
