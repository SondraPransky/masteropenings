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
import { _normFen } from './core.js';
import { renderStaticBoard } from './miniboard.js';
import { escapeHtml, fig, _drillFenMap } from './coach-core.js';
import {
  OA, bucketShort, bucketLabel, fmtLoss, fmtPct, fmtCrit, fmtDwr,
  fmtLossShort, fmtDwrShort,
  filterErrorsIndexed, sortErrors, oaaFenIndex,
} from './coach-analytics-core.js';

// ── Croisement élèves : normFen d'une position → set des élèves qui l'ont ratée
// dans le module courant (résultats du coach). Mémo par module (invalidé au
// changement de sélection). C'est le pont entre le diagnostic Lichess et le tien.
let _oaaStuCache = { modId: null, map: null };
function _oaaStudentFails(modId) {
  if (_oaaStuCache.modId === modId && _oaaStuCache.map) return _oaaStuCache.map;
  const fenMap = _drillFenMap(modId);            // san → fenBefore (arbre du module)
  const map = new Map();                          // normFen → Set(noms d'élèves)
  (G.results || []).forEach(r => {
    if (String(r.drillId) !== String(modId) || r.correct) return;
    const fen = fenMap[r.san];
    if (!fen) return;
    const nf = _normFen(fen);
    if (!map.has(nf)) map.set(nf, new Set());
    map.get(nf).add(r.student || r.studentName || r.studentEmail || 'Anonyme');
  });
  _oaaStuCache = { modId, map };
  return map;
}
function _oaaResetStuCache() { _oaaStuCache = { modId: null, map: null }; }

// Pastilles des élèves qui échouent à une erreur (max 3 + « +N »), patron .wsx-chip.
function _oaaStuChips(err, stuFails) {
  const set = stuFails.get(_normFen(err.fen));
  if (!set || !set.size) return '';
  const names = [...set];
  const shown = names.slice(0, 3).map(n => `<span class="oaa-stu-chip">${escapeHtml(n)}</span>`).join('');
  return shown + (names.length > 3 ? `<span class="oaa-stu-chip oaa-stu-more">+${names.length - 3}</span>` : '');
}

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
  // Tranche mémorisée d'une session à l'autre (posée une seule fois).
  if (!OA._bucketRead) {
    OA._bucketRead = true;
    try { const b = localStorage.getItem('mc_oaa_bucket'); if (b) OA.bucket = b; } catch (e) {}
  }
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
        <button type="button" class="btn btn-primary btn-sm" onclick="oaaRefresh()">
          <i class="ti ti-refresh" aria-hidden="true"></i> J'ai lancé le worker — actualiser</button>
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
      <button type="button" class="btn btn-blue btn-sm oaa-refresh" onclick="oaaRefresh()"
        title="Recharger depuis Supabase après un run du worker">
        <i class="ti ti-refresh" aria-hidden="true"></i> Actualiser</button>
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

// Plafond d'affichage MOBILE (patron de Points faibles, 16/07). En carte, une
// erreur occupe ~137px : 60 erreurs faisaient 10 écrans de défilement avant
// d'atteindre quoi que ce soit. Le plafond est appliqué en CSS (donc le point de
// rupture reste dans la feuille de style) ; le bouton ne fait que poser la classe.
// Rien n'est perdu : le tri met le plus critique en tête, le reste est à un tap.
const _OAA_CAP = 8;

// ── Onglet 1 : les erreurs (le cœur) ────────────────────
// Deux colonnes : la table (scrollable) + un APERÇU ÉPINGLÉ à droite qui suit le
// survol/focus et se fige au clic (OA.pin), avec les flèches du coup fautif et
// du meilleur coup. Sous 960px l'aperçu se masque (patron explorateur).
function _oaaErrorsHTML(doc) {
  let errs = filterErrorsIndexed(doc.errors, OA.bucket === 'all' ? 'all' : Number(OA.bucket));
  const stuFails = _oaaStudentFails(OA.modId);
  if (OA.onlyMine) errs = errs.filter(({ e }) => stuFails.has(_normFen(e.fen)));
  errs = sortErrors(errs, OA.sort.key, OA.sort.dir);

  const mineCount = filterErrorsIndexed(doc.errors, OA.bucket === 'all' ? 'all' : Number(OA.bucket))
    .filter(({ e }) => stuFails.has(_normFen(e.fen))).length;

  const th = (key, label, title) => {
    const on = OA.sort.key === key;
    const arrow = on ? (OA.sort.dir === -1 ? ' ▼' : ' ▲') : '';
    return `<th aria-sort="${on ? (OA.sort.dir === -1 ? 'descending' : 'ascending') : 'none'}">
      <button type="button" class="oaa-th-sort" onclick="oaaSort('${key}')"
        title="${escapeHtml(title || ('Trier par ' + label.toLowerCase()))}">${label}${arrow}</button></th>`;
  };

  if (!errs.length) {
    return _oaaErrorsShellHTML(doc, mineCount,
      `<div class="oaa-none">${OA.onlyMine
        ? 'Aucune de ces erreurs n’a encore été ratée par tes élèves sur cette tranche.'
        : 'Aucune erreur détectée sur cette tranche.'}</div>`);
  }

  const rows = errs.map(({ e, i }) => {
    const checked = OA.sel.has(i) ? ' checked' : '';
    const chips = _oaaStuChips(e, stuFails);
    // Le focus clavier vit sur la CASE (le seul contrôle, déjà nommée) — une
    // rangée tabbable serait un arrêt muet ×150 pour un lecteur d'écran (audit P2).
    // L'aperçu épinglé suit ce focus ; la souris garde le survol de rangée.
    return `<tr class="oaa-row${OA.pin === i ? ' pinned' : ''}" data-i="${i}"
        onmouseenter="oaaHover(${i})" onclick="oaaPin(${i},event)">
      <td class="oaa-check"><label class="oaa-check-hit"><input type="checkbox"
        aria-label="Sélectionner l'erreur ${escapeHtml(e.san)} (${escapeHtml(bucketShort(e.bucket))})"${checked}
        onclick="event.stopPropagation();oaaToggleSel(${i},this.checked)"
        onfocus="oaaHover(${i})"></label></td>
      <td class="oaa-line" title="${escapeHtml(e.line || '')}"><span class="oaa-line-t">${escapeHtml(e.line || '—')}</span></td>
      <td class="oaa-move"><span class="mono-move">${fig(escapeHtml(e.san))}</span>
        <span class="oaa-sub">${fmtPct(e.freq)} · ${e.games} parties</span></td>
      <td class="oaa-best" data-l="Meilleur"><span class="mono-move">${fig(escapeHtml(e.bestSan || e.bestUci || ''))}</span></td>
      <td class="oaa-cost" data-l="Coût"
        title="${escapeHtml(fmtLoss(e.lossCp))}${e.dwr != null ? ` · ${fmtDwr(e.dwr)}` : ''}">${escapeHtml(fmtLossShort(e.lossCp))}${e.dwr != null ? `<span class="oaa-sub">${escapeHtml(fmtDwrShort(e.dwr))}</span>` : ''}</td>
      <td class="oaa-stu" data-l="Tes élèves">${chips || '<span class="oaa-sub-td">—</span>'}</td>
      <td class="oaa-bucket" data-l="Tranche">${escapeHtml(bucketShort(e.bucket))}</td>
      <td class="oaa-crit" data-l="Criticité">${fmtCrit(e.crit)}</td>
      <td class="oaa-act"><button type="button" class="btn btn-ghost btn-sm btn-ico"
        onclick="event.stopPropagation();oaaOpenPos(${i})"
        aria-label="Voir la position ${escapeHtml(e.san)} en grand"><i class="ti ti-search" aria-hidden="true"></i></button></td>
    </tr>`;
  }).join('');

  const table = `
    <div class="oaa-scroll"><table class="oaa-table">
      <thead><tr><th></th><th>Ligne</th>
        ${th('freq', 'Coup fautif', 'Trier par fréquence')}
        <th>Meilleur</th>
        ${th('lossCp', 'Coût (pions)', 'Trier par coût — pions perdus contre le meilleur coup')}
        <th>Tes élèves</th>
        ${th('bucket', 'Tranche', 'Trier par tranche Elo — regroupe les erreurs d’un même niveau')}
        ${th('crit', 'Criticité', 'fréquence × coût en points de victoire × volume de parties')}
        <th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${errs.length > _OAA_CAP ? `<button type="button" class="oaa-more" onclick="oaaShowAll(this)">
      Voir les ${errs.length - _OAA_CAP} autres positions</button>` : ''}`;
  return _oaaErrorsShellHTML(doc, mineCount, table);
}

// Coquille commune (barre d'actions + grille table/aperçu) — partagée par l'état
// plein et les états vides pour que les filtres restent atteignables.
function _oaaErrorsShellHTML(doc, mineCount, inner) {
  return `
    <div class="oaa-actions">
      <!-- En carte (≤640px) le <thead> est masqué : les 3 boutons de tri qui y
           vivent disparaîtraient avec lui. Ce select les remplace au doigt et
           ne s'affiche QUE sous 640px (l'en-tête reste la voie desktop). -->
      <label class="oaa-sortsel">
        <span class="sr-only">Trier les erreurs</span>
        <!-- oaaSortKey, pas oaaSort : re-choisir la clé courante dans un select ne
             doit PAS inverser le sens (le toggle est la sémantique d'un en-tête). -->
        <select onchange="oaaSortKey(this.value)" aria-label="Trier les erreurs">
          ${[['crit', 'Criticité'], ['freq', 'Fréquence'], ['lossCp', 'Coût'], ['bucket', 'Tranche']].map(([k, l]) =>
            `<option value="${k}"${OA.sort.key === k ? ' selected' : ''}>Trier : ${l}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="oaa-chip${OA.onlyMine ? ' on' : ''}" aria-pressed="${OA.onlyMine}"
        onclick="oaaToggleMine()" ${mineCount ? '' : 'disabled'}
        title="N'afficher que les positions déjà ratées par tes élèves">
        <i class="ti ti-users" aria-hidden="true"></i> Où mes élèves trébuchent${mineCount ? ` (${mineCount})` : ''}</button>
      <span id="oaa-selcount" class="oaa-selcount">${OA.sel.size ? OA.sel.size + ' sélectionnée(s)' : ''}</span>
      <button class="btn btn-primary btn-sm" onclick="oaaCreatePacket()">
        <i class="ti ti-puzzle" aria-hidden="true"></i> Créer un paquet d'exercices</button>
    </div>
    <div class="oaa-layout">
      ${inner}
      <aside class="oaa-aside" aria-label="Aperçu de la position">
        <div id="oaa-pin-board" class="oaa-board-pin">${_oaaPinHTML(doc)}</div>
      </aside>
    </div>`;
}

// ── Aperçu épinglé : échiquier + flèches (fautif rouge, meilleur vert) ──
function _oaaPinHTML(doc) {
  const i = OA.pin != null ? OA.pin : OA.hover;
  const e = (doc?.errors || [])[i];
  // « Survole » excluait le clavier (la case de chaque ligne pose l'aperçu au focus).
  if (!e) return `<div class="oaa-pin-empty">Choisis une ligne pour voir la position.</div>`;
  const flip = e.stm === 'b';
  const arrows = _oaaArrowsSvg([[e.uci, 'var(--arrow-red)'], [e.bestUci, 'var(--arrow-green)']], flip);
  return `
    <div class="oaa-pin-wrap">${renderStaticBoard(e.fen, { size: 260, flip })}${arrows}</div>
    <div class="oaa-pin-cap">
      <b>${e.stm === 'b' ? 'Noirs' : 'Blancs'} au trait</b> — ${fmtPct(e.freq)} jouent
      <span class="mono-move oaa-bad">${fig(escapeHtml(e.san))}</span>,
      le bon coup est <span class="mono-move oaa-good">${fig(escapeHtml(e.bestSan || ''))}</span>.
      ${OA.pin === i ? '<span class="oaa-sub">épinglée — clique à nouveau pour libérer</span>' : ''}
    </div>`;
}

// Calque de flèches posé sur le miniboard — géométrie de Chessground (le plateau
// de Lichess), reprise à l'identique pour que ces flèches soient CELLES que le
// coach connaît. Repère : viewBox 8×8, donc 1 unité = 1 case ; tout est dérivé de
// la case et rien de la taille en pixels (le même SVG sert l'aperçu 260 et la
// modale 320). ⚠ Surtout PAS `preserveAspectRatio="none"` : il étirait les
// flèches dès que le conteneur n'était pas parfaitement carré.
const _CG_SHAFT  = 10 / 64;   // largeur du trait (chessground : lineWidth 10 / 64e de plateau)
const _CG_MARGIN = 10 / 64;   // retrait avant le centre d'arrivée ; la pointe du marqueur l'y ramène
let _oaaArrowSeq = 0;         // ids de marqueurs uniques (aperçu + modale coexistent dans le DOM)

function _oaaArrowsSvg(pairs, flip) {
  const seq = ++_oaaArrowSeq;
  const sq = uci => {
    if (typeof uci !== 'string' || uci.length < 4) return null;
    let f = uci.charCodeAt(0) - 97, r = 8 - Number(uci[1]);
    let f2 = uci.charCodeAt(2) - 97, r2 = 8 - Number(uci[3]);
    if ([f, r, f2, r2].some(n => Number.isNaN(n) || n < 0 || n > 7)) return null;
    if (flip) { f = 7 - f; r = 7 - r; f2 = 7 - f2; r2 = 7 - r2; }
    return [f + .5, r + .5, f2 + .5, r2 + .5];   // centres de case, en unités de case
  };
  const lines = pairs.map(([uci, color], k) => {
    const c = sq(uci); if (!c) return '';
    const [x1, y1, x2, y2] = c;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (!len) return '';
    // Le trait s'arrête avant le centre d'arrivée ; le marqueur (pointe en avant
    // de son refX) rend la pointe pile sur ce centre — le rendu Lichess.
    const ex = x2 - dx / len * _CG_MARGIN, ey = y2 - dy / len * _CG_MARGIN;
    return `<line x1="${x1}" y1="${y1}" x2="${ex.toFixed(4)}" y2="${ey.toFixed(4)}"
      stroke="${color}" stroke-width="${_CG_SHAFT}" stroke-linecap="round"
      marker-end="url(#oaa-ah${seq}-${k})"/>`;
  }).join('');
  // markerUnits vaut `strokeWidth` par défaut : la tête grandit avec le trait
  // (≈ 0,6 case de large), d'où la grosse pointe triangulaire de Lichess.
  const markers = pairs.map(([, color], k) =>
    `<marker id="oaa-ah${seq}-${k}" orient="auto" markerWidth="4" markerHeight="4" refX="2.05" refY="2">
      <path d="M0,0 V4 L3,2 Z" fill="${color}"/></marker>`).join('');
  return `<svg class="oaa-arrows" viewBox="0 0 8 8" aria-hidden="true">
    <defs>${markers}</defs>${lines}</svg>`;
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
    <div class="oaa-scroll"><table class="oaa-table">
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
        <table class="oaa-table"><thead><tr><th>Faute</th><th>Ligne</th><th>Tranches</th><th>Pic de fréq.</th><th>Criticité</th></tr></thead>
        <tbody>${lifeRows || ''}</tbody></table>
      </div>
      <div class="oaa-diag-block">
        <h2>Ce que tes élèves vont vraiment rencontrer <span class="oaa-sub">(tranche ${escapeHtml(bucketShort(Number(bucket)))})</span></h2>
        <p class="oaa-explain">Probabilité d'atteindre la position × criticité de l'erreur.</p>
        <table class="oaa-table"><thead><tr><th>Ligne</th><th>Faute</th><th>Atteinte</th><th>Criticité</th></tr></thead>
        <tbody>${evRows || ''}</tbody></table>
      </div>
      <div class="oaa-diag-block">
        <h2>Où chaque ligne devient dangereuse</h2>
        <table class="oaa-table"><thead><tr><th>Ligne</th><th>Danger au coup</th><th>Faute typique</th></tr></thead>
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
    // ⚠ Une cellule vide teintée ne dit RIEN à un lecteur d'écran, ni au doigt
    // (le `title` est une affordance souris). Le principe produit est explicite :
    // jamais l'information par la seule couleur → chaque cellule porte son texte.
    const cellLbl = c == null
      ? `${lbl(p)} — ${bucketShort(b)} : aucune donnée`
      : `${lbl(p)} — ${bucketShort(b)} : criticité ${fmtCrit(c)} (${['', 'faible', 'moyenne', 'forte'][lvl]})`;
    return `<td class="oaa-hm-cell${lvl ? ' oaa-hm-' + lvl : ''}" role="img"
      aria-label="${escapeHtml(cellLbl)}"${c != null ? ` title="${escapeHtml(cellLbl)}"` : ''}></td>`;
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
function oaaSelectModule(modId) {
  OA.modId = modId; OA.sel.clear(); OA.gapColor = null; OA.pin = null; OA.hover = null;
  OA.onlyMine = false; _oaaResetStuCache();
  renderOaAnalytics();
}
// ⚠ La sélection est vidée aussi : sinon un paquet « @ 1600+ » embarquerait des
// erreurs cochées dans une autre tranche, devenues invisibles et indécochables.
// La tranche est MÉMORISÉE (le coach travaille durablement à un niveau donné).
function oaaSetBucket(b) {
  OA.bucket = b === 'all' ? 'all' : String(Number(b));
  OA.sel.clear(); OA.pin = null;
  try { localStorage.setItem('mc_oaa_bucket', String(OA.bucket)); } catch (e) {}
  _oaaRerenderContent();
}
function oaaSetTab(t) { OA.tab = t; _oaaRerenderContent(); }
function oaaSetGapColor(c) { OA.gapColor = c; _oaaRerenderContent(); }
function oaaSort(key) {
  // Même colonne → inverse le sens ; nouvelle colonne → décroissant (le plus fort d'abord).
  if (OA.sort.key === key) OA.sort.dir = -OA.sort.dir;
  else OA.sort = { key, dir: -1 };
  _oaaRerenderContent();
}
// Tri par CLÉ seule (select mobile) : toujours décroissant, jamais de bascule —
// un select rejoué sur la même valeur ne doit rien inverser.
function oaaSortKey(key) { OA.sort = { key, dir: -1 }; _oaaRerenderContent(); }
// Lève le plafond mobile : une classe sur la table, pas de re-rendu (la sélection
// en cours et l'état des cases restent intacts). Le bouton disparaît avec lui.
function oaaShowAll(btn) {
  document.querySelector('.oaa-table')?.classList.add('oaa-all');
  btn?.remove();
}
function oaaToggleMine() { OA.onlyMine = !OA.onlyMine; OA.pin = null; _oaaRerenderContent(); }
function oaaToggleSel(i, on) {
  if (on) OA.sel.add(i); else OA.sel.delete(i);
  const el = document.getElementById('oaa-selcount');
  if (el) el.textContent = OA.sel.size ? `${OA.sel.size} sélectionnée(s)` : '';
}

// ── Aperçu épinglé : survol (volatil) vs clic (épingle) ──
function _oaaRepaintPin() {
  const el = document.getElementById('oaa-pin-board');
  const doc = (G.oaAnalyses || {})[OA.modId]?.data;
  if (el && doc) el.innerHTML = _oaaPinHTML(doc);
}
function oaaHover(i) {
  if (OA.pin != null) return;      // une position épinglée ne bouge plus au survol
  OA.hover = i; _oaaRepaintPin();
}
function oaaPin(i, event) {
  if (event) event.stopPropagation();
  OA.pin = (OA.pin === i) ? null : i;   // re-clic = libère
  OA.hover = i;
  document.querySelectorAll('.oaa-row.pinned').forEach(r => r.classList.remove('pinned'));
  if (OA.pin != null) document.querySelector(`.oaa-row[data-i="${i}"]`)?.classList.add('pinned');
  _oaaRepaintPin();
}

// ── Modale « Voir la position » (échiquier en grand + tout le contexte) ──
function oaaOpenPos(i) {
  const doc = (G.oaAnalyses || {})[OA.modId]?.data;
  const e = doc?.errors?.[i];
  const box = document.getElementById('oaa-pos-body');
  if (!e || !box) return;
  const flip = e.stm === 'b';
  const stu = [...(_oaaStudentFails(OA.modId).get(_normFen(e.fen)) || [])];
  const stat = (lbl, val) => `<div class="oaa-pos-stat"><span>${lbl}</span><b>${val}</b></div>`;
  box.innerHTML = `
    <div class="oaa-pos-grid">
      <div class="oaa-pin-wrap oaa-pos-board">${renderStaticBoard(e.fen, { size: 320, flip })}${
        _oaaArrowsSvg([[e.uci, 'var(--arrow-red)'], [e.bestUci, 'var(--arrow-green)']], flip)}</div>
      <div>
        <div class="oaa-pos-line">${escapeHtml(e.line || '—')}</div>
        <p class="oaa-pos-verdict"><b>${flip ? 'Noirs' : 'Blancs'} au trait.</b>
          ${fmtPct(e.freq)} des joueurs ${escapeHtml(bucketShort(e.bucket))} jouent
          <span class="mono-move oaa-bad">${fig(escapeHtml(e.san))}</span> ici ;
          le bon coup est <span class="mono-move oaa-good">${fig(escapeHtml(e.bestSan || ''))}</span>.</p>
        ${stat('Fréquence', fmtPct(e.freq))}
        ${stat('Échantillon', `${e.games} parties`)}
        ${stat('Coût', escapeHtml(fmtLoss(e.lossCp)))}
        ${e.dwr != null ? stat('Écart humain', escapeHtml(fmtDwr(e.dwr))) : ''}
        ${stat('Criticité', fmtCrit(e.crit))}
        ${stu.length ? `<div class="oaa-pos-stu"><span>Tes élèves qui la ratent</span>
          <div>${stu.map(n => `<span class="oaa-stu-chip">${escapeHtml(n)}</span>`).join('')}</div></div>` : ''}
        <div class="oaa-pos-actions">
          <button class="btn btn-blue btn-sm" onclick="oaaAddToSel(${i})">
            <i class="ti ti-plus" aria-hidden="true"></i> Ajouter à la sélection</button>
          <button class="btn btn-primary btn-sm" onclick="oaaCreateOne(${i})">
            <i class="ti ti-puzzle" aria-hidden="true"></i> Créer un exercice de cette erreur</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-oaa-pos')?.classList.add('on');
}

// Ajoute la position à la sélection sans quitter la modale (coche la case rendue).
function oaaAddToSel(i) {
  OA.sel.add(i);
  const cb = /** @type {HTMLInputElement} */ (document.querySelector(`.oaa-row[data-i="${i}"] .oaa-check input`));
  if (cb) cb.checked = true;
  const el = document.getElementById('oaa-selcount');
  if (el) el.textContent = `${OA.sel.size} sélectionnée(s)`;
  window.toast?.('✓ Ajoutée à la sélection', 'ok');
}

// Paquet d'UNE erreur depuis la modale : même chemin que la sélection multiple.
function oaaCreateOne(i) {
  window.closeModal?.('modal-oaa-pos');
  window.oaaCreatePacket?.([i]);
}

// Note de croisement lue par Points faibles (pont window, sens inverse) :
// « aussi ratée par N % des X+ Lichess » pour une position (drillId, san).
function oaaLichessNote(drillId, san) {
  const doc = (G.oaAnalyses || {})[String(drillId)]?.data;
  if (!doc) return '';
  const fen = _drillFenMap(drillId)[san];
  if (!fen) return '';
  const nf = _normFen(fen);
  const hits = (doc.errors || []).filter(e => _normFen(e.fen) === nf && e.san === san);
  if (!hits.length) return '';
  const worst = hits.reduce((a, b) => (b.freq > a.freq ? b : a));
  return `<span class="oaa-lichess-note" title="Données humaines Lichess (analyse d'ouvertures)">`
    + `aussi ratée par ${fmtPct(worst.freq)} des ${escapeHtml(bucketShort(worst.bucket))} Lichess</span>`;
}

// Recharge forcée depuis Supabase (le loader met les analyses en cache de session).
function oaaRefresh() {
  _oaaResetStuCache();
  Promise.resolve(window._sbLoadOaAnalyses?.(true)).then(() => renderOaAnalytics());
}

Object.assign(window, {
  renderOaAnalytics, oaaSelectModule, oaaSetBucket, oaaSetTab, oaaSetGapColor,
  oaaToggleSel, oaaRefresh, oaaSort, oaaSortKey, oaaToggleMine, oaaShowAll, oaaHover, oaaPin, oaaLichessNote,
  oaaOpenPos, oaaAddToSel, oaaCreateOne, _oaaResetStuCache,
});
