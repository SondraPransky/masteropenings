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
  OA, bucketShort, bucketLabel, fmtLoss, fmtPct, fmtCrit, fmtDwr, filterErrorsIndexed,
} from './coach-analytics-core.js';

// ── Accès au doc courant ────────────────────────────────
function _oaaEntries() {
  // [{modId, name, updatedAt, doc}] — le nom vient de G.drills quand le module existe encore.
  return Object.entries(G.oaAnalyses || {}).map(([modId, row]) => {
    const mod = (G.drills || []).find(d => String(d.id) === String(modId));
    return { modId, name: mod?.name || row.data?.chapter || `Module ${modId}`, updatedAt: row.updatedAt, doc: row.data || {} };
  }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function _oaaCurrent(entries) {
  entries = entries || _oaaEntries();
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
  oaaTipHide();   // le re-rendu détruit la ligne survolée → son mouseleave ne viendra jamais
  const entries = _oaaEntries();

  if (!entries.length) {
    // État vide pédagogique : la section vit de ce que le worker pousse.
    body.innerHTML = `
      <div class="oaa-empty">
        <i class="ti ti-chart-histogram oaa-empty-ico" aria-hidden="true"></i>
        <h2>Aucune analyse pour l'instant</h2>
        <p>Le worker local analyse tes modules (données humaines Lichess + Stockfish)
        et dépose ses résultats ici. Depuis la racine du projet :</p>
        <code>py -m oa.eecoach_worker</code>
        <p class="oaa-empty-note">Prérequis : la migration <b>007</b> (Supabase), le token
        <b>OA_LICHESS_TOKEN</b> et tes identifiants coach dans <b>.env</b>.</p>
      </div>`;
    return;
  }

  const cur = _oaaCurrent(entries);
  OA.modId = cur.modId;
  const doc = cur.doc;
  const buckets = ['all', ...(doc.docBuckets || [])];

  const modOpts = entries.map(e =>
    `<option value="${escapeHtml(e.modId)}"${e.modId === cur.modId ? ' selected' : ''}>${escapeHtml(e.name)}</option>`).join('');

  // data-b / aria-pressed : l'état actif est synchronisé SANS re-rendu de la barre
  // (les clics de chip/onglet ne re-rendent que #oaa-content — audit P3 perf).
  const chips = buckets.map(b => {
    const on = String(OA.bucket) === String(b);
    return `<button type="button" class="oaa-chip${on ? ' on' : ''}" data-b="${b}" aria-pressed="${on}"
      onclick="oaaSetBucket('${b}')"
      title="${escapeHtml(bucketLabel(b === 'all' ? 'all' : Number(b), doc.fide))}">${escapeHtml(bucketShort(b === 'all' ? 'all' : Number(b)))}</button>`;
  }).join('');

  // Pas un vrai patron ARIA « tabs » (qui exigerait tab/tabpanel/flèches) : trois
  // boutons de vue à état pressé — plus honnête qu'un tablist à moitié câblé.
  const tabs = [['errors', 'Erreurs'], ['gaps', 'Trous du répertoire'], ['diag', 'Diagnostics']]
    .map(([k, lbl]) => `<button type="button" class="oaa-tab${OA.tab === k ? ' on' : ''}" data-tab="${k}"
      aria-pressed="${OA.tab === k}" onclick="oaaSetTab('${k}')">${lbl}</button>`).join('');

  body.innerHTML = `
    <div class="oaa-bar">
      <select class="oaa-modsel" onchange="oaaSelectModule(this.value)" aria-label="Module analysé">${modOpts}</select>
      <span class="oaa-fresh">analysé le ${_oaaDate(cur.updatedAt)} · ${doc.totals?.errors ?? 0} erreurs détectées</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="oaaRefresh()" aria-label="Recharger les analyses">
        <i class="ti ti-refresh" aria-hidden="true"></i></button>
      <span class="oaa-chips" role="group" aria-label="Tranche Elo">${chips}</span>
    </div>
    <div class="oaa-tabs" role="group" aria-label="Vues de l'analyse">${tabs}</div>
    <div class="oaa-content" id="oaa-content">${_oaaContentHTML(doc)}</div>`;
}

function _oaaContentHTML(doc) {
  return OA.tab === 'errors' ? _oaaErrorsHTML(doc)
    : OA.tab === 'gaps' ? _oaaGapsHTML(doc) : _oaaDiagHTML(doc);
}

// Re-rendu CIBLÉ : seul #oaa-content est reconstruit (un clic de chip sur 150
// lignes coûtait ~24 ms en re-rendant toute la section) ; l'état actif des
// chips/onglets est basculé en place.
function _oaaRerenderContent() {
  oaaTipHide();
  const el = document.getElementById('oaa-content');
  const doc = (G.oaAnalyses || {})[OA.modId]?.data;
  if (!el || !doc) { renderOaAnalytics(); return; }
  document.querySelectorAll('.oaa-chip[data-b]').forEach(c => {
    const on = String(OA.bucket) === String(/** @type {HTMLElement} */ (c).dataset.b);
    c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('.oaa-tab[data-tab]').forEach(t => {
    const on = OA.tab === /** @type {HTMLElement} */ (t).dataset.tab;
    t.classList.toggle('on', on); t.setAttribute('aria-pressed', String(on));
  });
  el.innerHTML = _oaaContentHTML(doc);
}

// ── Onglet 1 : les erreurs (le cœur) ────────────────────
function _oaaErrorsHTML(doc) {
  const errs = filterErrorsIndexed(doc.errors, OA.bucket === 'all' ? 'all' : Number(OA.bucket));
  if (!errs.length) return `<div class="oaa-none">Aucune erreur détectée sur cette tranche.</div>`;
  const rows = errs.map(({ e, i }) => {
    const checked = OA.sel.has(i) ? ' checked' : '';
    // Le focus clavier vit sur la CASE (le seul contrôle, déjà nommée) — une
    // rangée tabbable serait un arrêt muet ×150 pour un lecteur d'écran (audit P2).
    // L'aperçu échiquier suit ce focus ; la souris garde le survol de rangée.
    return `<tr class="oaa-row" data-i="${i}"
        onmouseenter="oaaTip(event,${i})" onmouseleave="oaaTipHide()">
      <td class="oaa-check"><input type="checkbox"
        aria-label="Sélectionner l'erreur ${escapeHtml(e.san)} (${escapeHtml(bucketShort(e.bucket))})"${checked}
        onclick="oaaToggleSel(${i},this.checked)"
        onfocus="oaaTip(event,${i})" onblur="oaaTipHide()"></td>
      <td class="oaa-line">${escapeHtml(e.line || '—')}</td>
      <td class="oaa-move"><span class="mono-move">${fig(escapeHtml(e.san))}</span>
        <span class="oaa-sub">${fmtPct(e.freq)} · ${e.games} parties</span></td>
      <td class="oaa-best"><span class="mono-move">${fig(escapeHtml(e.bestSan || e.bestUci || ''))}</span></td>
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
      ${_oaaHeatmapHTML(doc)}
      <div class="oaa-diag-block">
        <h2>Durée de vie des erreurs</h2>
        <p class="oaa-explain">Jusqu'où dans l'échelle Elo chaque faute reste fréquente.</p>
        <table class="oaa-table wsx-table"><thead><tr><th>Faute</th><th>Ligne</th><th>Tranches</th><th>Pic de fréq.</th><th>Criticité</th></tr></thead>
        <tbody>${lifeRows || ''}</tbody></table>
      </div>
      <div class="oaa-diag-block">
        <h2>Ce que tes élèves vont vraiment rencontrer <span class="oaa-sub">(tranche ${escapeHtml(bucketShort(Number(bucket)))})</span></h2>
        <p class="oaa-explain">Probabilité d'atteindre la position × criticité de l'erreur.</p>
        <table class="oaa-table wsx-table"><thead><tr><th>Ligne</th><th>Faute</th><th>Atteinte</th><th>Criticité</th></tr></thead>
        <tbody>${evRows || ''}</tbody></table>
      </div>
      <div class="oaa-diag-block">
        <h2>Où chaque ligne devient dangereuse</h2>
        <table class="oaa-table wsx-table"><thead><tr><th>Ligne</th><th>Danger au coup</th><th>Faute typique</th></tr></thead>
        <tbody>${dgRows || ''}</tbody></table>
      </div>
    </div>`;
}

// Carte thermique : pic de criticité par (coup, tranche). Le doc porte des
// cellules [ply, bucket, crit] pour tous les buckets ; on n'affiche que les
// tranches que la section sait filtrer (docBuckets), en 3 niveaux d'intensité.
function _oaaHeatmapHTML(doc) {
  const buckets = doc.docBuckets || [];
  const cells = (doc.heatmap || []).filter(([, b]) => buckets.includes(b));
  if (!cells.length || !buckets.length) return '';
  const max = Math.max(...cells.map(([, , c]) => c));
  const byKey = {};
  cells.forEach(([p, b, c]) => { byKey[p + ':' + b] = c; });
  const plies = [...new Set(cells.map(([p]) => p))].sort((a, b) => a - b);
  const lbl = p => `${Math.floor(p / 2) + 1}${p % 2 === 0 ? '.' : '…'}`;
  const rows = plies.map(p => `<tr><th scope="row">${lbl(p)}</th>` + buckets.map(b => {
    const c = byKey[p + ':' + b];
    const lvl = c == null ? 0 : c >= max * 0.66 ? 3 : c >= max * 0.33 ? 2 : 1;
    return `<td class="oaa-hm-cell${lvl ? ' oaa-hm-' + lvl : ''}"${c != null ? ` title="criticité ${fmtCrit(c)}"` : ''}></td>`;
  }).join('') + '</tr>').join('');
  return `
    <div class="oaa-diag-block">
      <h2>Carte thermique</h2>
      <p class="oaa-explain">Où la criticité culmine : profondeur (coup) × tranche Elo.</p>
      <table class="oaa-table oaa-hm"><thead><tr><th>Coup</th>${buckets.map(b =>
        `<th>${escapeHtml(bucketShort(b))}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
}

// ── Interactions (pont window, onclick inline) ──────────
function oaaSelectModule(modId) { OA.modId = modId; OA.sel.clear(); OA.gapColor = null; renderOaAnalytics(); }
// ⚠ La sélection est vidée aussi : sinon un paquet « @ 1600+ » embarquerait des
// erreurs cochées dans une autre tranche, devenues invisibles et indécochables.
function oaaSetBucket(b) { OA.bucket = b === 'all' ? 'all' : String(Number(b)); OA.sel.clear(); _oaaRerenderContent(); }
function oaaSetTab(t) { OA.tab = t; _oaaRerenderContent(); }
function oaaSetGapColor(c) { OA.gapColor = c; _oaaRerenderContent(); }
function oaaToggleSel(i, on) {
  if (on) OA.sel.add(i); else OA.sel.delete(i);
  const el = document.getElementById('oaa-selcount');
  if (el) el.textContent = OA.sel.size ? `${OA.sel.size} sélectionnée(s)` : '';
}

// Aperçu échiquier au survol/focus d'une erreur (même patron que wsTip).
function oaaTip(event, i) {
  // Accès direct par OA.modId (posé au rendu) — pas de _oaaEntries() re-trié par survol.
  const doc = (G.oaAnalyses || {})[OA.modId]?.data; const e = doc?.errors?.[i];
  const tip = document.getElementById('oaa-tip');
  if (!e || !tip) return;
  tip.innerHTML = renderStaticBoard(e.fen, { size: 200, flip: e.stm === 'b' }) +
    `<div class="wsx-tip-cap">${e.stm === 'b' ? 'Noirs' : 'Blancs'} au trait — ` +
    `${fmtPct(e.freq)} jouent <b>${fig(escapeHtml(e.san))}</b></div>`;
  tip.style.display = '';
  // Un événement focus (clavier) n'a pas de coordonnées souris → ancrer sur l'élément.
  let cx = event.clientX, cy = event.clientY;
  if (!cx && !cy) {
    const r = /** @type {Element} */ (event.target)?.getBoundingClientRect?.();
    if (r) { cx = r.right; cy = r.top; }
  }
  const x = Math.min((cx || 0) + 16, window.innerWidth - 236);
  const y = Math.min((cy || 0) + 12, window.innerHeight - 260);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function oaaTipHide() {
  const tip = document.getElementById('oaa-tip');
  if (tip) { tip.style.display = 'none'; tip.innerHTML = ''; }
}

// Recharge forcée depuis Supabase (le loader met les analyses en cache de session).
function oaaRefresh() {
  Promise.resolve(window._sbLoadOaAnalyses?.(true)).then(() => renderOaAnalytics());
}

Object.assign(window, {
  renderOaAnalytics, oaaSelectModule, oaaSetBucket, oaaSetTab, oaaSetGapColor,
  oaaToggleSel, oaaTip, oaaTipHide, oaaRefresh,
});
