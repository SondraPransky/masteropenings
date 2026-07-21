// ══════════════════════════════════════════════════════
// VUE COACH — Analyse d'ouvertures (OA, D18) : UI de la section.
//
// Affiche les documents d'analyse déposés dans Supabase (`oa_analyses`) par le
// worker local `py -m oa.eecoach_worker` : où les humains se trompent réellement
// dans chaque module, PAR TRANCHE ELO (erreurs + trous du répertoire +
// diagnostics). Tout est précalculé côté worker — ici on ne fait qu'afficher.
//
// RÈGLE coach-* : imports depuis coach-core / coach-analytics-core / miniboard
// uniquement ; le reste (fig, toast, save…) passe par le pont window.
// « Créer un paquet » vit dans coach-analytics-export.js (pont window).
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { renderStaticBoard } from './miniboard.js';
import { escapeHtml, fig } from './coach-core.js';
import {
  OA, bucketShort, bucketLabel, fmtLoss, fmtPct, fmtCrit, fmtDwr, filterErrors,
} from './coach-analytics-core.js';

// ── Accès au doc courant ────────────────────────────────
function _oaaEntries() {
  // [{modId, name, updatedAt, doc}] — le nom vient de G.drills quand le module existe encore.
  return Object.entries(G.oaAnalyses || {}).map(([modId, row]) => {
    const mod = (G.drills || []).find(d => String(d.id) === String(modId));
    return { modId, name: mod?.name || row.data?.chapter || `Module ${modId}`, updatedAt: row.updatedAt, doc: row.data || {} };
  }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function _oaaCurrent() {
  const entries = _oaaEntries();
  if (!entries.length) return null;
  return entries.find(e => e.modId === OA.modId) || entries[0];
}

function _oaaDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
  catch { return ''; }
}

// ── Rendu principal ─────────────────────────────────────
function renderOaAnalytics() {
  const body = document.getElementById('oaa-body');
  if (!body) return;
  const entries = _oaaEntries();

  if (!entries.length) {
    // État vide pédagogique : la section vit de ce que le worker pousse.
    body.innerHTML = `
      <div class="oaa-empty">
        <i class="ti ti-chart-histogram oaa-empty-ico" aria-hidden="true"></i>
        <h3>Aucune analyse pour l'instant</h3>
        <p>Le worker local analyse tes modules (données humaines Lichess + Stockfish)
        et dépose ses résultats ici. Depuis la racine du projet :</p>
        <code>py -m oa.eecoach_worker</code>
        <p class="oaa-empty-note">Prérequis : la migration <b>007</b> (Supabase), le token
        <b>OA_LICHESS_TOKEN</b> et tes identifiants coach dans <b>.env</b>.</p>
      </div>`;
    return;
  }

  const cur = _oaaCurrent();
  OA.modId = cur.modId;
  const doc = cur.doc;
  const buckets = ['all', ...(doc.docBuckets || [])];

  const modOpts = entries.map(e =>
    `<option value="${escapeHtml(e.modId)}"${e.modId === cur.modId ? ' selected' : ''}>${escapeHtml(e.name)}</option>`).join('');

  const chips = buckets.map(b => {
    const on = String(OA.bucket) === String(b);
    return `<button type="button" class="oaa-chip${on ? ' on' : ''}" onclick="oaaSetBucket('${b}')"
      title="${escapeHtml(bucketLabel(b === 'all' ? 'all' : Number(b), doc.fide))}">${escapeHtml(bucketShort(b === 'all' ? 'all' : Number(b)))}</button>`;
  }).join('');

  const tabs = [['errors', 'Erreurs'], ['gaps', 'Trous du répertoire'], ['diag', 'Diagnostics']]
    .map(([k, lbl]) => `<button type="button" class="oaa-tab${OA.tab === k ? ' on' : ''}" onclick="oaaSetTab('${k}')">${lbl}</button>`).join('');

  body.innerHTML = `
    <div class="oaa-bar">
      <select class="oaa-modsel" onchange="oaaSelectModule(this.value)" aria-label="Module analysé">${modOpts}</select>
      <span class="oaa-fresh">analysé le ${_oaaDate(cur.updatedAt)} · ${doc.totals?.errors ?? 0} erreurs détectées</span>
      <span class="oaa-chips" role="group" aria-label="Tranche Elo">${chips}</span>
    </div>
    <div class="oaa-tabs" role="tablist">${tabs}</div>
    <div class="oaa-content">${OA.tab === 'errors' ? _oaaErrorsHTML(doc)
      : OA.tab === 'gaps' ? _oaaGapsHTML(doc) : _oaaDiagHTML(doc)}</div>`;
}

// ── Onglet 1 : les erreurs (le cœur) ────────────────────
function _oaaErrorsHTML(doc) {
  const errs = filterErrors(doc.errors, OA.bucket === 'all' ? 'all' : Number(OA.bucket));
  if (!errs.length) return `<div class="oaa-none">Aucune erreur détectée sur cette tranche.</div>`;
  const rows = errs.map(e => {
    const i = doc.errors.indexOf(e);
    const checked = OA.sel.has(i) ? ' checked' : '';
    return `<tr class="oaa-row" data-i="${i}"
        onmouseenter="oaaTip(event,${i})" onmouseleave="oaaTipHide()"
        onfocus="oaaTip(event,${i})" onblur="oaaTipHide()" tabindex="0">
      <td class="oaa-check"><input type="checkbox" aria-label="Sélectionner cette erreur"${checked}
        onclick="oaaToggleSel(${i},this.checked)"></td>
      <td class="oaa-line">${escapeHtml(e.line || '—')}</td>
      <td class="oaa-move"><span class="mono-move">${fig(escapeHtml(e.san))}</span>
        <span class="oaa-sub">${fmtPct(e.freq)} · ${e.games} parties</span></td>
      <td class="oaa-best"><span class="mono-move">${fig(escapeHtml(e.bestSan || ''))}</span></td>
      <td class="oaa-cost">${escapeHtml(fmtLoss(e.lossCp))}${e.dwr != null ? `<span class="oaa-sub">${escapeHtml(fmtDwr(e.dwr))}</span>` : ''}</td>
      <td class="oaa-bucket">${escapeHtml(bucketShort(e.bucket))}</td>
      <td class="oaa-crit">${fmtCrit(e.crit)}</td>
    </tr>`;
  }).join('');
  return `
    <div class="oaa-actions">
      <span id="oaa-selcount" class="oaa-selcount">${OA.sel.size ? OA.sel.size + ' sélectionnée(s)' : ''}</span>
      <button class="btn btn-primary btn-sm" onclick="oaaCreatePacket()">
        <i class="ti ti-puzzle" aria-hidden="true"></i> Créer un paquet d'exercices</button>
    </div>
    <div class="oaa-scroll"><table class="oaa-table wsx-table">
      <thead><tr><th></th><th>Ligne</th><th>Coup fautif</th><th>Meilleur</th>
        <th>Coût</th><th>Tranche</th>
        <th title="fréquence × coût en points de victoire × volume de parties">Criticité</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// ── Onglet 2 : trous du répertoire ──────────────────────
function _oaaGapsHTML(doc) {
  const color = OA.gapColor || doc.repColor || 'w';
  const bucket = OA.bucket === 'all' ? String((doc.docBuckets || [1600])[0]) : String(OA.bucket);
  const list = ((doc.gaps || {})[color] || {})[bucket] || [];
  const toggle = ['w', 'b'].map(c =>
    `<button type="button" class="oaa-chip${color === c ? ' on' : ''}" onclick="oaaSetGapColor('${c}')">
      ${c === 'w' ? 'Répertoire Blancs' : 'Répertoire Noirs'}${doc.repColor === c ? ' (déduit)' : ''}</button>`).join('');
  const head = `<div class="oaa-gaps-head">${toggle}
    <span class="oaa-sub">tranche ${escapeHtml(bucketShort(Number(bucket)))}${OA.bucket === 'all' ? ' (choisis une tranche pour changer)' : ''}</span></div>`;
  if (!list.length) return head + `<div class="oaa-none">Aucun trou fréquent à cette tranche — le répertoire couvre les réponses courantes.</div>`;
  const rows = list.map(g => `<tr>
      <td class="oaa-move"><span class="mono-move">${escapeHtml(g.moveNo)} ${fig(escapeHtml(g.san))}</span></td>
      <td class="oaa-line">${escapeHtml(g.line || '(départ)')}</td>
      <td>${fmtPct(g.freq)}</td><td class="oaa-sub-td">${g.games} / ${g.total} parties</td>
    </tr>`).join('');
  return head + `
    <p class="oaa-explain">Réponses adverses fréquentes que ton répertoire laisse sans suite — les positions où tes élèves se retrouvent seuls.</p>
    <div class="oaa-scroll"><table class="oaa-table wsx-table">
      <thead><tr><th>Réponse adverse</th><th>Après</th><th>Fréquence</th><th>Échantillon</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

// ── Onglet 3 : diagnostics compacts ─────────────────────
function _oaaDiagHTML(doc) {
  const bucket = OA.bucket === 'all' ? String((doc.docBuckets || [1600])[0]) : String(OA.bucket);

  const lifeRows = (doc.lifetime || []).slice(0, 12).map(l => `<tr>
      <td class="oaa-move"><span class="mono-move">${fig(escapeHtml(l.san))}</span></td>
      <td class="oaa-line">${escapeHtml(l.line)}</td>
      <td>${escapeHtml(l.span)}</td><td>${fmtPct(l.peakFreq)}</td><td>${fmtCrit(l.peak)}</td>
    </tr>`).join('');

  const evRows = ((doc.expected || {})[bucket] || []).slice(0, 10).map(ev => `<tr>
      <td class="oaa-line">${escapeHtml(ev.line)}</td>
      <td class="oaa-move"><span class="mono-move">${fig(escapeHtml(ev.san))}</span></td>
      <td>${fmtPct(ev.reach)}</td><td>${fmtCrit(ev.crit)}</td>
    </tr>`).join('');

  const dgRows = (doc.danger || []).slice(0, 10).map(d => `<tr>
      <td class="oaa-line">${escapeHtml(d.line)}</td>
      <td>${escapeHtml(d.move)}</td>
      <td class="oaa-move">${d.san ? `<span class="mono-move">${fig(escapeHtml(d.san))}</span>` : '—'}</td>
    </tr>`).join('');

  return `
    <div class="oaa-diag-grid">
      <div class="oaa-diag-block">
        <h3>Durée de vie des erreurs</h3>
        <p class="oaa-explain">Jusqu'où dans l'échelle Elo chaque faute reste fréquente.</p>
        <table class="oaa-table wsx-table"><thead><tr><th>Faute</th><th>Ligne</th><th>Tranches</th><th>Pic de fréq.</th><th>Criticité</th></tr></thead>
        <tbody>${lifeRows || ''}</tbody></table>
      </div>
      <div class="oaa-diag-block">
        <h3>Ce que tes élèves vont vraiment rencontrer <span class="oaa-sub">(tranche ${escapeHtml(bucketShort(Number(bucket)))})</span></h3>
        <p class="oaa-explain">Probabilité d'atteindre la position × criticité de l'erreur.</p>
        <table class="oaa-table wsx-table"><thead><tr><th>Ligne</th><th>Faute</th><th>Atteinte</th><th>Criticité</th></tr></thead>
        <tbody>${evRows || ''}</tbody></table>
      </div>
      <div class="oaa-diag-block">
        <h3>Où chaque ligne devient dangereuse</h3>
        <table class="oaa-table wsx-table"><thead><tr><th>Ligne</th><th>Danger au coup</th><th>Faute typique</th></tr></thead>
        <tbody>${dgRows || ''}</tbody></table>
      </div>
    </div>`;
}

// ── Interactions (pont window, onclick inline) ──────────
function oaaSelectModule(modId) { OA.modId = modId; OA.sel.clear(); OA.gapColor = null; renderOaAnalytics(); }
function oaaSetBucket(b) { OA.bucket = b === 'all' ? 'all' : String(Number(b)); renderOaAnalytics(); }
function oaaSetTab(t) { OA.tab = t; renderOaAnalytics(); }
function oaaSetGapColor(c) { OA.gapColor = c; renderOaAnalytics(); }
function oaaToggleSel(i, on) {
  if (on) OA.sel.add(i); else OA.sel.delete(i);
  const el = document.getElementById('oaa-selcount');
  if (el) el.textContent = OA.sel.size ? `${OA.sel.size} sélectionnée(s)` : '';
}

// Aperçu échiquier au survol/focus d'une erreur (même patron que wsTip).
function oaaTip(event, i) {
  const doc = _oaaCurrent()?.doc; const e = doc?.errors?.[i];
  const tip = document.getElementById('oaa-tip');
  if (!e || !tip) return;
  tip.innerHTML = renderStaticBoard(e.fen, { size: 200, flip: e.stm === 'b' }) +
    `<div class="wsx-tip-cap">${e.stm === 'b' ? 'Noirs' : 'Blancs'} au trait — ` +
    `${fmtPct(e.freq)} jouent <b>${fig(escapeHtml(e.san))}</b></div>`;
  tip.style.display = '';
  const x = Math.min(event.clientX + 16, window.innerWidth - 236);
  const y = Math.min(event.clientY + 12, window.innerHeight - 260);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function oaaTipHide() {
  const tip = document.getElementById('oaa-tip');
  if (tip) { tip.style.display = 'none'; tip.innerHTML = ''; }
}

Object.assign(window, {
  renderOaAnalytics, oaaSelectModule, oaaSetBucket, oaaSetTab, oaaSetGapColor,
  oaaToggleSel, oaaTip, oaaTipHide,
});
