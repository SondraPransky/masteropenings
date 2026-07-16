// ══════════════════════════════════════════════════════
// lib/coach-weakspots.js — PAGE POINTS FAIBLES : cartes-modules (santé) → UNE table
// du module choisi (master-detail), tooltip échiquier au survol, modale « Voir la
// position ». Les lignes rendues sont publiées dans `CS.wsCards` — coach-assign les
// indexe. État local : _hmSelectedMod.
// Socle → coach-core.js ; appels latéraux → pont window (assignTargetedReview).
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { renderStaticBoard } from './miniboard.js';
import {
  CS, _resetFenCache, _drillFenMap, _tierPct, _tierBg,
  _classFilter, _populateClassFilter, _resultKeys, _matchStudentSet,
  fig, figText, escapeHtml,
} from './coach-core.js';

// Module sélectionné sur la page Points faibles (master-detail) ; null = pire module.
let _hmSelectedMod = null;
// Plafond d'affichage de la table (le tri met les pires en tete, cf. _HM_CAP ci-dessous).
let _hmShowAll = false;
// 8 lignes : au volume reel un module porte jusqu'a 40 positions, soit ~9,7 ecrans sur
// mobile. Le TRI fait deja le travail (pire taux d'abord) ; le plafond ne fait que ranger
// le reste. Meme patron que _capList sur la page profil eleve — mais PAS le meme outil :
// <details> ne peut pas envelopper des <tr> (HTML invalide, le parseur l'ejecte hors de
// la table), donc on plafonne par RE-RENDU, comme hmSelectMod.
const _HM_CAP = 8;

function renderHeatmap() {
  const el = document.getElementById('prof-heatmap-content');
  _resetFenCache();   // re-résout les FEN à chaque rendu (modules peuvent changer)
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

  // CS.wsCards = lignes du module SÉLECTIONNÉ (indexe openWeakspotPosition / assignTargetedReview).
  CS.wsCards = [];
  const sections = [sel].map(m => {
    // On ne pousse dans CS.wsCards QUE les lignes rendues : les index de wsCards indexent
    // les onclick (openWeakspotPosition/assignTargetedReview). Deplier re-rend, donc les
    // deux restent alignes par construction.
    const shown  = _hmShowAll ? m.rows : m.rows.slice(0, _HM_CAP);
    const hidden = m.rows.length - shown.length;
    const rowsHtml = shown.map(p => {
      const i = CS.wsCards.length;
      CS.wsCards.push({ drillId:p.drillId, drillName:p.drillName, san:p.san, comment:p.comment, rate:p.rate, students:[...p.students], failStudents:[...p.failStudents], failIds:[...p.failIds], fen:_drillFenMap(p.drillId)[p.san] || null });
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
      ${hidden > 0
        ? `<button class="btn btn-ghost btn-sm wsx-more" onclick="hmToggleAll()">Voir les ${hidden} autre${hidden>1?'s':''} position${hidden>1?'s':''}</button>`
        : (_hmShowAll && m.rows.length > _HM_CAP
            ? `<button class="btn btn-ghost btn-sm wsx-more" onclick="hmToggleAll()">Réduire</button>`
            : '')}
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
// Changer de module remet le plafond : le deplie d'un module ne dit rien du suivant.
function hmSelectMod(id) { _hmSelectedMod = id; _hmShowAll = false; renderHeatmap(); }
function hmToggleAll() { _hmShowAll = !_hmShowAll; renderHeatmap(); }

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

// « Voir la position » d'un point faible : modale avec grand échiquier + coup + commentaire + élèves.
function openWeakspotPosition(i) {
  const p = CS.wsCards[i]; if (!p) return;
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

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js.
Object.assign(window, {
  renderHeatmap, hmSelectMod, hmToggleAll, wsTip, wsTipHide, openWeakspotPosition,
});
