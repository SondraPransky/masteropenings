// ══════════════════════════════════════════════════════
// MA BIBLIOTHÈQUE — bases PGN personnelles de l'élève (Pilier 1, P1.0)
// Une base = dossier PGN générique { id, name, created }. Les entrées (parties /
// analyses) arrivent en P1.1 : une entrée = une partie (G.savedGames) portant
// `base_id`. Ici : modèle + CRUD base + page « Ma bibliothèque » (liste + détail).
// Données : `G` (state.js). App-level (save/toast/escapeHtml) via pont window.
// ⚠️ Ne pas confondre avec `renderLibrary`/`openLibrary` (modules.js = modal des
//    ouvertures prêtes à l'emploi) → ici tout est préfixé (renderMyLibrary…).
// ══════════════════════════════════════════════════════
import { G } from '../state.js';

const save       = (...a) => window.save?.(...a);
const toast      = (...a) => window.toast?.(...a);
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

let _openBaseId = null;   // null = liste des bases ; sinon détail d'une base

function _uid() { return Date.now() + Math.floor(Math.random() * 1000); }
function getBase(id) { return (G.bases || []).find(b => String(b.id) === String(id)) || null; }
function _baseGames(id) { return (G.savedGames || []).filter(g => String(g.base_id) === String(id)); }

// ── CRUD base ─────────────────────────────────────────
function createBase(name) {
  const nm = (name || '').trim();
  if (!nm) { toast('⚠ Donne un nom à la base', 'ko'); return null; }
  const b = { id: _uid(), name: nm, created: new Date().toLocaleDateString('fr-FR') };
  G.bases.push(b);
  save();
  window._sbSaveBases?.();
  renderMyLibrary();
  toast(`✓ Base « ${nm} » créée`, 'ok');
  return b;
}

function deleteBase(id) {
  const b = getBase(id); if (!b) return;
  const n = _baseGames(id).length;
  if (!confirm(`Supprimer la base « ${b.name} »${n ? ` et ses ${n} partie(s)` : ''} ?`)) return;
  G.bases = G.bases.filter(x => String(x.id) !== String(id));
  G.savedGames = (G.savedGames || []).filter(g => String(g.base_id) !== String(id));   // parties orphelines retirées
  if (String(_openBaseId) === String(id)) _openBaseId = null;
  save();
  window._sbSaveBases?.();
  renderMyLibrary();
  toast('Base supprimée');
}

function openBase(id) { _openBaseId = id; renderMyLibrary(); }
function backToLibrary() { _openBaseId = null; renderMyLibrary(); }

// Crée une base depuis le champ inline de la page.
function _createBaseFromInput() {
  const inp = document.getElementById('lib-new-base-name');
  if (!inp) return;
  const b = createBase(inp.value);
  if (b && inp) inp.value = '';   // renderMyLibrary a déjà reconstruit, mais au cas où
}

// ── Rendu ─────────────────────────────────────────────
function renderMyLibrary() {
  const el = document.getElementById('library-content');
  if (!el) return;
  el.innerHTML = (_openBaseId != null) ? _baseDetailHTML(getBase(_openBaseId)) : _baseListHTML();
}

function _baseListHTML() {
  const bases = G.bases || [];
  const cards = bases.map(b => {
    const n = _baseGames(b.id).length;
    return `<div class="mcard" onclick="openBase('${b.id}')" style="cursor:pointer">
      <div class="mcard-name">📁 ${escapeHtml(b.name)}</div>
      <div class="mcard-meta">${n} partie${n > 1 ? 's' : ''} · ${escapeHtml(b.created || '—')}</div>
      <div class="mcard-footer">
        <button class="btn btn-gold btn-sm" style="flex:1" onclick="event.stopPropagation();openBase('${b.id}')">Ouvrir</button>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();deleteBase('${b.id}')" title="Supprimer">🗑</button>
      </div>
    </div>`;
  }).join('');
  const empty = `<div class="mcard-empty">
    <div class="mcard-empty-ico">📁</div>
    <div class="mcard-empty-title">Aucune base pour l'instant</div>
    <div class="mcard-empty-sub">Crée une base (un dossier PGN) pour y ranger tes parties et analyses.<br>Ex : « Mes tournois 2026 », « Parties rapides », « Mon répertoire Sicilienne ».</div>
  </div>`;
  return `
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <input id="lib-new-base-name" type="text" placeholder="Nom d'une nouvelle base…" maxlength="60"
             onkeydown="if(event.key==='Enter')_createBaseFromInput()"
             style="flex:1;padding:9px 11px;border:1px solid var(--border);border-radius:var(--rs);background:var(--surf);color:var(--text);font-size:.9rem">
      <button class="btn btn-gold btn-sm" onclick="_createBaseFromInput()">+ Nouvelle base</button>
    </div>
    ${bases.length ? `<div class="module-cards-grid">${cards}</div>` : empty}`;
}

function _baseDetailHTML(b) {
  if (!b) { _openBaseId = null; return _baseListHTML(); }
  const games = _baseGames(b.id);
  const list = games.length
    ? games.map(g => `<div class="mcard">
        <div class="mcard-name">${escapeHtml(g.drillName || g.name || 'Partie')}</div>
        <div class="mcard-meta">${escapeHtml(g.result || '*')} · ${escapeHtml(g.ts ? new Date(g.ts).toLocaleDateString('fr-FR') : '—')}</div>
      </div>`).join('')
    : `<div class="mcard-empty">
        <div class="mcard-empty-ico">♟️</div>
        <div class="mcard-empty-title">Aucune partie dans « ${escapeHtml(b.name)} »</div>
        <div class="mcard-empty-sub">La saisie de partie (échiquier + coller PGN) arrive à l'étape suivante.</div>
      </div>`;
  return `
    <button class="btn btn-ghost btn-sm" onclick="backToLibrary()" style="margin-bottom:12px">← Ma bibliothèque</button>
    <div style="font-size:1.1rem;font-weight:700;margin-bottom:2px">📁 ${escapeHtml(b.name)}</div>
    <div style="font-size:.73rem;color:var(--dim);margin-bottom:16px">${games.length} partie${games.length > 1 ? 's' : ''}</div>
    ${games.length ? `<div class="module-cards-grid">${list}</div>` : list}`;
}

// Pont window : onclick="" (index.html) + appels app.js (goPage).
Object.assign(window, {
  renderMyLibrary, createBase, deleteBase, openBase, backToLibrary,
  _createBaseFromInput, getBase,
});
