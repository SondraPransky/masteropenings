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
const closeModal = (...a) => window.closeModal?.(...a);
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

let _openBaseId = null;         // null = liste des bases ; sinon détail d'une base
let _pendingGameBaseId = null;  // base cible du modal « Nouvelle partie »

function _uid() { return Date.now() + Math.floor(Math.random() * 1000); }
function getBase(id) { return (G.bases || []).find(b => String(b.id) === String(id)) || null; }
function _baseGames(id) { return (G.savedGames || []).filter(g => String(g.baseId) === String(id)); }

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
  G.savedGames = (G.savedGames || []).filter(g => String(g.baseId) !== String(id));   // parties orphelines retirées
  if (String(_openBaseId) === String(id)) _openBaseId = null;
  save();
  window._sbSaveBases?.();
  renderMyLibrary();
  toast('Base supprimée');
}

function renameBase(id) {
  const b = getBase(id); if (!b) return;
  const nm = (prompt('Nouveau nom de la base :', b.name) || '').trim();
  if (!nm || nm === b.name) return;
  b.name = nm;
  save();
  window._sbSaveBases?.();
  renderMyLibrary();
  toast('✓ Base renommee', 'ok');
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
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();renameBase('${b.id}')" title="Renommer">✏️</button>
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
  const games = _baseGames(b.id).slice().sort((a, c) => (c.ts || 0) - (a.ts || 0));
  const natLabel = { partie: '♟️', analyse: '📝' };
  const list = games.length
    ? `<div class="module-cards-grid">${games.map(g => {
        const title = (g.white || '?') + ' – ' + (g.black || '?');
        const meta  = [escapeHtml(g.result || '*'), g.event ? escapeHtml(g.event) : '', g.ts ? new Date(g.ts).toLocaleDateString('fr-FR') : '']
          .filter(Boolean).join(' · ');
        const reviewed = g.reviewedAt ? `<span title="Annotée par le coach" style="color:#7c3aed;font-weight:700;font-size:.7rem">✨ Annotée</span>` : '';
        const shareBtn = g.shared
          ? `<button class="btn btn-ghost btn-sm" style="color:var(--dim)" onclick="toggleShareGame('${g.id}')" title="Ne plus partager">✓ Partagé</button>`
          : `<button class="btn btn-blue btn-sm" onclick="toggleShareGame('${g.id}')" title="Rendre visible par le coach">📤 Partager</button>`;
        return `<div class="mcard">
          <div class="mcard-name">${natLabel[g.nature] || '♟️'} ${escapeHtml(title)}</div>
          <div class="mcard-meta">${meta} ${reviewed}</div>
          <div class="mcard-footer">
            <button class="btn btn-gold btn-sm" style="flex:1" onclick="openGameReview('${g.id}')">${g.reviewedAt ? '📖 Voir la revue' : '🔎 Revoir'}</button>
            ${shareBtn}
            <button class="btn btn-ghost btn-sm" onclick="deleteGame('${g.id}')" title="Supprimer">🗑</button>
          </div>
        </div>`;
      }).join('')}</div>`
    : `<div class="mcard-empty">
        <div class="mcard-empty-ico">♟️</div>
        <div class="mcard-empty-title">Aucune partie dans « ${escapeHtml(b.name)} »</div>
        <div class="mcard-empty-sub">Ajoute ta première entrée : colle un PGN, ou saisis-la sur l'échiquier.</div>
      </div>`;
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">
      <button class="btn btn-ghost btn-sm" onclick="backToLibrary()">← Ma bibliothèque</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="renameBase('${b.id}')" title="Renommer la base">✏️ Renommer</button>
        <button class="btn btn-gold btn-sm" onclick="openNewGameModal('${b.id}')">+ Nouvelle partie</button>
      </div>
    </div>
    <div style="font-size:1.1rem;font-weight:700;margin-bottom:2px">📁 ${escapeHtml(b.name)}</div>
    <div style="font-size:.73rem;color:var(--dim);margin-bottom:16px">${games.length} partie${games.length > 1 ? 's' : ''}</div>
    ${list}`;
}

// ── Saisie de partie : coller PGN + métadonnées (P1.1a) ──────────
function openNewGameModal(baseId) {
  const bases = G.bases || [];
  if (!bases.length) { toast('⚠ Cree d\'abord une base', 'ko'); return; }
  _pendingGameBaseId = (baseId != null && getBase(baseId)) ? baseId : (_openBaseId != null ? _openBaseId : bases[0].id);
  const sel = document.getElementById('ng-base');
  if (sel) {
    sel.innerHTML = bases.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    sel.value = String(_pendingGameBaseId);
  }
  const nat = document.getElementById('ng-nature'); if (nat) nat.value = 'partie';
  ['ng-white', 'ng-black', 'ng-event', 'ng-welo', 'ng-belo', 'ng-pgn'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const r = document.getElementById('ng-result'); if (r) r.value = '*';
  document.getElementById('modal-new-game')?.classList.add('on');
  setTimeout(() => document.getElementById('ng-pgn')?.focus(), 100);
}

// Quand on colle un PGN avec en-têtes, pré-remplir les champs vides.
function _ngPrefillFromPgn() {
  const pgn = (document.getElementById('ng-pgn')?.value || '').trim();
  if (!pgn) return;
  try {
    const g = new Chess();
    if (!g.load_pgn(pgn, { sloppy: true })) return;
    const h = g.header() || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el && !el.value && v) el.value = v; };
    set('ng-white', h.White); set('ng-black', h.Black); set('ng-event', h.Event);
    set('ng-welo', h.WhiteElo); set('ng-belo', h.BlackElo);
    const rs = document.getElementById('ng-result');
    if (rs && (rs.value === '*' || !rs.value) && h.Result) rs.value = h.Result;
  } catch (e) { /* PGN partiel pendant la frappe : on ignore */ }
}

function saveGameEntry() {
  const selBase = document.getElementById('ng-base')?.value;
  if (selBase) _pendingGameBaseId = selBase;
  const base = getBase(_pendingGameBaseId);
  if (!base) { toast('⚠ Base introuvable', 'ko'); return; }
  const nature = document.getElementById('ng-nature')?.value === 'analyse' ? 'analyse' : 'partie';
  const val = id => (document.getElementById(id)?.value || '').trim();
  const white = val('ng-white'), black = val('ng-black'), event = val('ng-event');
  const welo = val('ng-welo'), belo = val('ng-belo');
  const result = document.getElementById('ng-result')?.value || '*';
  const rawPgn = val('ng-pgn');
  if (!rawPgn) { toast('⚠ Colle un PGN (la saisie sur l\'échiquier arrive bientôt)', 'ko'); return; }

  const g = new Chess();
  if (!g.load_pgn(rawPgn, { sloppy: true })) { toast('❌ PGN invalide', 'ko'); return; }
  if (white) g.header('White', white);
  if (black) g.header('Black', black);
  if (event) g.header('Event', event);
  if (welo)  g.header('WhiteElo', welo);
  if (belo)  g.header('BlackElo', belo);
  g.header('Result', result);
  const h = g.header() || {};

  const rec = {
    id: Date.now(),
    baseId: String(_pendingGameBaseId),
    nature,
    pgn: g.pgn(),
    white: white || h.White || '?',
    black: black || h.Black || '?',
    event: event || h.Event || null,
    result,
    student: G.currentUser?.displayName || G.currentUser?.email || null,
    studentId: G.currentUser?.uid || null,
    studentEmail: G.currentUser?.email || null,
    ts: Date.now()
  };
  G.savedGames.push(rec);
  save();
  window._sbSaveGame?.(rec);
  closeModal('modal-new-game');
  renderMyLibrary();
  toast(nature === 'analyse' ? '✓ Analyse ajoutée' : '✓ Partie ajoutée', 'ok');
}

// Ouvre l'éditeur sur échiquier par-dessus le modal (P1.1b) — le PGN déjà tapé pré-charge le plateau.
function openBoardEntry() {
  const pgn = document.getElementById('ng-pgn')?.value || '';
  window.openGameEditor?.(pgn);   // le modal reste ouvert dessous (éditeur z-index:200)
}

// Retour de l'éditeur : le PGN saisi arrive ici, on remplit le champ + on pré-remplit les métadonnées.
function _boardEntryDone(pgn) {
  const ta = document.getElementById('ng-pgn');
  if (ta) ta.value = pgn || '';
  _ngPrefillFromPgn();
  document.getElementById('modal-new-game')?.classList.add('on');   // au cas où
  toast('✓ Coups saisis — complète les infos puis enregistre', 'ok');
}

// ── Partage au coach (P1.3) ───────────────────────────
function toggleShareGame(id) {
  const g = (G.savedGames || []).find(x => String(x.id) === String(id));
  if (!g) return;
  g.shared = !g.shared;
  save();
  window._sbUpdateGame?.(g);   // UPDATE (pas insert) : la partie existe déjà côté serveur
  renderMyLibrary();
  toast(g.shared ? '📤 Partagée avec le coach' : 'Partage retiré', 'ok');
}

// ── Ouvrir la partie (élève) — voit les annotations coach en violet (P1.5) ──
function openGameReview(id) {
  const g = (G.savedGames || []).find(x => String(x.id) === String(id));
  if (!g) { toast('⚠ Partie introuvable', 'ko'); return; }
  window.openReviewEditor?.(g.pgn || '', { gameId: g.id, role: 'student', white: g.white, black: g.black });
}

// Retour de l'éditeur de revue : le PGN (annoté par le coach, ou étendu par l'élève) arrive ici.
function _reviewSaveDone(gameId, pgn, role) {
  const g = (G.savedGames || []).find(x => String(x.id) === String(gameId));
  if (!g) return;
  g.pgn = pgn;
  if (role === 'coach') g.reviewedAt = Date.now();
  save();
  window._sbUpdateGame?.(g);   // UPDATE : coach annote une partie existante de l'élève
  window.renderMyLibrary?.();
  window.renderPartiesTab?.();
  toast(role === 'coach' ? '✓ Revue enregistrée' : '✓ Enregistré', 'ok');
}

function deleteGame(id) {
  const g = (G.savedGames || []).find(x => String(x.id) === String(id));
  if (!g) return;
  if (!confirm(`Supprimer la partie ${g.white || '?'} – ${g.black || '?'} ?`)) return;
  G.savedGames = G.savedGames.filter(x => String(x.id) !== String(id));
  save();
  window._sbDeleteGame?.(id);
  renderMyLibrary();
  toast('Partie supprimée');
}

// Pont window : onclick="" (index.html) + appels app.js (goPage).
Object.assign(window, {
  renderMyLibrary, createBase, deleteBase, renameBase, openBase, backToLibrary,
  _createBaseFromInput, getBase,
  openNewGameModal, _ngPrefillFromPgn, saveGameEntry, deleteGame,
  openBoardEntry, _boardEntryDone,
  toggleShareGame, openGameReview, _reviewSaveDone,
});
