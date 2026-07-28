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
import { fig, pgnMainlineSans, pgnStartFen } from './core.js';

const save       = (...a) => window.save?.(...a);
const toast      = (...a) => window.toast?.(...a);
const closeModal = (...a) => window.closeModal?.(...a);
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

let _openBaseId = null;         // null = liste des bases ; sinon détail d'une base
let _pendingGameBaseId = null;  // base cible du modal « Nouvelle partie »
// État de la barre recherche / tri / filtre (vue détail d'une base). Persiste entre
// re-rendus (partage, suppression) ; remis à zéro à l'ouverture d'une autre base.
let _libQuery = '', _libResFilter = 'all', _libSort = 'date-desc';

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

// Renommage INLINE (même patron que la création `lib-new-base-name`) : le nom
// devient un champ en place — dans la carte (liste) ou le titre (détail).
let _renamingBaseId = null;

function renameBase(id) {
  const b = getBase(id); if (!b) return;
  _renamingBaseId = id;
  renderMyLibrary();
  const inp = /** @type {HTMLInputElement|null} */ (document.getElementById('lib-rename-input'));
  if (inp) { inp.focus(); inp.select(); }
}
function _renameBaseCancel() { _renamingBaseId = null; renderMyLibrary(); }
function _renameBaseCommit() {
  const b = getBase(_renamingBaseId);
  const inp = /** @type {HTMLInputElement|null} */ (document.getElementById('lib-rename-input'));
  _renamingBaseId = null;
  if (!b || !inp) { renderMyLibrary(); return; }
  const nm = inp.value.trim();
  if (!nm || nm === b.name) { renderMyLibrary(); return; }
  b.name = nm;
  save();
  window._sbSaveBases?.();
  renderMyLibrary();
  toast('✓ Base renommée', 'ok');
}
function _renameBaseKeydown(ev) {
  if (ev.key === 'Enter') _renameBaseCommit();
  else if (ev.key === 'Escape') _renameBaseCancel();
}
function _renameFieldHTML(b) {
  return `<span class="lib-rename" onclick="event.stopPropagation()">
    <input id="lib-rename-input" type="text" value="${escapeHtml(b.name)}" maxlength="60"
           aria-label="Nouveau nom de la base" onkeydown="_renameBaseKeydown(event)">
    <button class="btn btn-primary btn-sm" onclick="_renameBaseCommit()">OK</button>
    <button class="btn btn-ghost btn-sm" onclick="_renameBaseCancel()" aria-label="Annuler le renommage"><i class="ti ti-x" aria-hidden="true"></i></button>
  </span>`;
}

function openBase(id) { _openBaseId = id; _renamingBaseId = null; _libQuery = ''; _libResFilter = 'all'; _libSort = 'date-desc'; _libPosIds = null; renderMyLibrary(); }
function backToLibrary() { _openBaseId = null; _renamingBaseId = null; _libPosIds = null; renderMyLibrary(); }

// Parties de la base OUVERTE (pour l'échiquier-requête de library-etabli.js).
function _libOpenBaseGames() { return _openBaseId != null ? _baseGames(_openBaseId) : []; }

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
  // L'établi (échiquier de saisie/recherche) se monte APRÈS le innerHTML — le
  // rendu détruit l'ancien nœud Chessground à chaque passage (library-etabli.js).
  window._qeMount?.();
  // Consulter la bibliothèque = annotations du coach « vues » (éteint la bannière d'accueil).
  localStorage.setItem('mc_seen_reviews', String(Date.now()));
}

function _baseListHTML() {
  const bases = G.bases || [];
  const cards = bases.map(b => {
    const n = _baseGames(b.id).length;
    return `<div class="lib-base" onclick="openBase('${b.id}')">
      <div class="lib-base-top">
        <div class="lib-folder" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="lib-base-count"><b>${n}</b><span>entrée${n > 1 ? 's' : ''}</span></div>
      </div>
      <div class="lib-base-name">${String(_renamingBaseId) === String(b.id) ? _renameFieldHTML(b) : escapeHtml(b.name)}</div>
      <div class="lib-base-meta">créée ${escapeHtml(b.created || '—')}</div>
      <div class="lib-base-actions">
        <button class="btn btn-primary btn-sm" style="flex:1" onclick="event.stopPropagation();openBase('${b.id}')">Ouvrir</button>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();renameBase('${b.id}')" title="Renommer" aria-label="Renommer la base"><i class="ti ti-edit" aria-hidden="true"></i></button>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();deleteBase('${b.id}')" title="Supprimer" aria-label="Supprimer la base"><i class="ti ti-trash" aria-hidden="true"></i></button>
      </div>
    </div>`;
  }).join('');
  const empty = `<div class="lib-empty">
    <div class="lib-empty-ico"><i class="ti ti-folders" aria-hidden="true"></i></div>
    <div class="lib-empty-title">Aucune base pour l'instant</div>
    <div class="lib-empty-sub">Crée une base (un dossier PGN) pour y ranger tes parties et analyses.<br>Ex : « Mes tournois 2026 », « Parties rapides », « Mon répertoire Sicilienne ».</div>
  </div>`;
  return `
    <div class="lib-eyebrow">${bases.length} base${bases.length > 1 ? 's' : ''}</div>
    <div class="lib-toolbar">
      <input id="lib-new-base-name" type="text" placeholder="Nom d'une nouvelle base…" maxlength="60"
             onkeydown="if(event.key==='Enter')_createBaseFromInput()">
      <button class="btn btn-primary btn-sm" onclick="_createBaseFromInput()">+ Nouvelle base</button>
    </div>
    ${bases.length ? `<div class="lib-grid">${cards}</div>` : empty}`;
}

// Ouverture d'une partie : lue de l'en-tête PGN [Opening] si présent (souvent absent
// des PGN collés à la main). Sert à la recherche ; l'affichage retombe sur '—'.
function _gameOpening(g) {
  const m = (g.pgn || '').match(/\[Opening\s+"([^"]+)"\]/);
  return m ? m[1] : '';
}

// La FORME de l'ouverture : les premiers demi-coups en figurines (l'idée de la
// maquette europe échecs — « 1.e4 c5 2.♘f3 » se reconnaît d'un coup d'œil, un
// nom ou un code non). Mémoïsé : la liste se re-rend à chaque frappe de la
// recherche, relire chaque PGN par caractère tapé serait payer cher un texte
// qui ne change jamais. `plain` alimente aussi la recherche (« e4 » trouve).
const _lineCache = new Map();
function _entryLine(g) {
  const key = g.id + ':' + (g.pgn || '').length;
  const hit = _lineCache.get(key);
  if (hit) return hit;
  if (_lineCache.size > 400) _lineCache.clear();
  const sans = pgnMainlineSans(g.pgn, 8);
  const sf = pgnStartFen(g.pgn).split(' ');
  const startBlack = sf[1] === 'b';
  // Partie démarrant d'une position ([FEN]) : la numérotation part du vrai
  // numéro de coup, pas de 1.
  let html = '', plain = '', n = parseInt(sf[5], 10) || 1;
  sans.forEach((san, k) => {
    const isWhite = startBlack ? k % 2 === 1 : k % 2 === 0;
    if (isWhite) { html += `<span class="mv-num">${n}.</span>`; plain += n + '.'; n++; }
    else if (k === 0) { html += `<span class="mv-num">${n}…</span>`; plain += n + '…'; }
    html += fig(escapeHtml(san)); plain += san;
    if (k < sans.length - 1) { html += ' '; plain += ' '; }
  });
  const out = { html, plain };
  _lineCache.set(key, out);
  return out;
}

// Filtre PAR POSITION posé par l'échiquier de saisie (library-etabli.js) :
// null = pas de filtre, sinon Set d'ids de parties passant par la position.
let _libPosIds = null;
function _libSetPosFilter(idSet) { _libPosIds = idSet; _libRenderEntries(); }

// Applique la recherche + le filtre résultat + le tri courants à une liste d'entrées.
function _libFilterSort(games) {
  const q = _libQuery.trim().toLowerCase();
  const out = games.filter(g => {
    if (_libPosIds && !_libPosIds.has(String(g.id))) return false;
    if (_libResFilter !== 'all') {
      const r = g.result || '';
      if (_libResFilter === 'draw') { if (!(r === '1/2-1/2' || r === '½-½')) return false; }
      else if (r !== _libResFilter) return false;
    }
    if (q) {
      const hay = [g.white, g.black, g.event, _gameOpening(g), _entryLine(g).plain]
        .map(x => (x || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const cmp = ({
    'date-desc': (a, c) => (c.ts || 0) - (a.ts || 0),
    'date-asc':  (a, c) => (a.ts || 0) - (c.ts || 0),
    'white-az':  (a, c) => (a.white || '').localeCompare(c.white || '', 'fr'),
    'black-az':  (a, c) => (a.black || '').localeCompare(c.black || '', 'fr'),
    'result':    (a, c) => (a.result || '').localeCompare(c.result || ''),
  })[_libSort] || ((a, c) => (c.ts || 0) - (a.ts || 0));
  return out.slice().sort(cmp);
}

function _libEntryRow(g) {
  const natLabel = { partie: '<i class="ti ti-chess" aria-hidden="true"></i>', analyse: '<i class="ti ti-notes" aria-hidden="true"></i>' };
  const resClass = r => r === '1-0' ? 'win' : r === '0-1' ? 'loss' : '';
  const title = (g.white || '?') + ' – ' + (g.black || '?');
  const date  = g.ts ? new Date(g.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const natTxt = g.nature === 'analyse' ? 'Analyse' : 'Partie';
  const bits = [g.event ? escapeHtml(g.event) : '', date].filter(Boolean).join(' · ');
  const reviewed = g.reviewedAt ? `<span class="lib-chip-coach" title="Annotée par le coach"><i class="ti ti-sparkles" aria-hidden="true"></i> Annotée</span>` : '';
  const shareBtn = g.shared
    ? `<button class="btn btn-ghost btn-sm" style="color:var(--dim)" onclick="toggleShareGame('${g.id}')" title="Ne plus partager"><i class="ti ti-check" aria-hidden="true"></i> Partagé</button>`
    : `<button class="btn btn-ghost btn-sm" onclick="toggleShareGame('${g.id}')" title="Rendre visible par le coach"><i class="ti ti-share" aria-hidden="true"></i> Partager</button>`;
  const line = _entryLine(g);
  return `<div class="lib-entry">
    <div class="lib-entry-result ${resClass(g.result)}">${escapeHtml(g.result || '*')}</div>
    <div class="lib-entry-main">
      <div class="lib-entry-title">${escapeHtml(title)} <span class="nat">${natLabel[g.nature] || natLabel.partie} ${natTxt}</span></div>
      ${line.plain ? `<div class="lib-entry-line" title="${escapeHtml(line.plain)}">${line.html}</div>` : ''}
      <div class="lib-entry-meta">${bits}${bits && reviewed ? ' ' : ''}${reviewed}</div>
    </div>
    <div class="lib-entry-actions">
      <button class="btn btn-primary btn-sm" onclick="openGameReview('${g.id}')">${g.reviewedAt ? '<i class="ti ti-book" aria-hidden="true"></i> Voir la revue' : '<i class="ti ti-edit" aria-hidden="true"></i> Annoter'}</button>
      ${shareBtn}
      <button class="btn btn-ghost btn-sm" onclick="openGameTransfer('${g.id}')" title="Déplacer ou copier vers une autre base" aria-label="Déplacer ou copier la partie ${escapeHtml(title)}"><i class="ti ti-folder-symlink" aria-hidden="true"></i></button>
      <button class="btn btn-ghost btn-sm" onclick="deleteGame('${g.id}')" title="Supprimer" aria-label="Supprimer"><i class="ti ti-trash" aria-hidden="true"></i></button>
    </div>
  </div>`;
}

// HTML de la liste d'entrées (filtrée + triée) — recalculé seul, sans reconstruire la barre.
function _libEntriesHTML(b) {
  const all = _baseGames(b.id);
  const games = _libFilterSort(all);
  // L'échiquier de saisie est aussi une requête : dire que la liste est
  // restreinte, et offrir la sortie (sinon des parties « disparaissent »).
  const posNote = _libPosIds
    ? `<div class="lib-pos-note"><i class="ti ti-chess-filled" aria-hidden="true"></i>
         ${games.length} partie${games.length > 1 ? 's' : ''} passe${games.length > 1 ? 'nt' : ''} par la position de l'échiquier
         <button class="lib-pos-clear" onclick="qeReset()">Tout afficher</button></div>`
    : '';
  if (!games.length) {
    return posNote + `<div class="lib-empty-sub" style="padding:26px 14px;text-align:center">Aucune entrée ne correspond${_libQuery ? ' à « ' + escapeHtml(_libQuery) + ' »' : _libPosIds ? ' — aucune de tes parties ne passe par cette position' : ' à ce filtre'}.</div>`;
  }
  return posNote + `<div class="lib-list">${games.map(_libEntryRow).join('')}</div>`;
}

// Re-rendu ciblé (barre inchangée → l'input de recherche garde le focus).
function _libRenderEntries() {
  const b = getBase(_openBaseId); if (!b) return;
  const cont = document.getElementById('lib-entries'); if (cont) cont.innerHTML = _libEntriesHTML(b);
  const cnt = document.getElementById('lib-detail-count');
  if (cnt) {
    const all = _baseGames(b.id), shown = _libFilterSort(all).length;
    cnt.textContent = shown === all.length ? `${all.length} entrée${all.length > 1 ? 's' : ''}` : `${shown} sur ${all.length}`;
  }
}
function _libSetQuery(v) { _libQuery = v; _libRenderEntries(); }
function _libSetResFilter(v) { _libResFilter = v; _libRenderEntries(); }
function _libSetSort(v) { _libSort = v; _libRenderEntries(); }

function _baseDetailHTML(b) {
  if (!b) { _openBaseId = null; return _baseListHTML(); }
  const all = _baseGames(b.id);
  const head = `
    <div class="lib-detail-head">
      <button class="btn btn-ghost btn-sm" onclick="backToLibrary()">← Ma bibliothèque</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="renameBase('${b.id}')" title="Renommer la base"><i class="ti ti-edit" aria-hidden="true"></i> Renommer</button>
        <button class="btn btn-primary btn-sm" onclick="openNewGameModal('${b.id}')">+ Nouvelle partie</button>
      </div>
    </div>
    <div class="lib-detail-title"><span class="lib-folder" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${String(_renamingBaseId) === String(b.id) ? _renameFieldHTML(b) : escapeHtml(b.name)}</div>
    <div class="lib-detail-sub" id="lib-detail-count">${all.length} entrée${all.length > 1 ? 's' : ''}</div>`;

  // L'établi (maquette europe échecs) : un échiquier jouable à demeure. On y
  // SAISIT une partie coup après coup — et chaque coup posé INTERROGE la base
  // (la liste se restreint aux parties passées par la position). Le montage
  // Chessground est fait par _qeMount (library-etabli.js) après le innerHTML.
  const etabli = `<div class="lib-etabli">
    <div class="lib-qe-left">
      <div id="lib-qe-board" aria-label="Échiquier de saisie et de recherche"></div>
      <div class="lib-qe-acts">
        <button class="btn btn-ghost btn-sm" onclick="qeUndo()" title="Annuler le dernier coup"><i class="ti ti-arrow-back-up" aria-hidden="true"></i> Annuler</button>
        <button class="btn btn-ghost btn-sm" onclick="qeReset()" title="Revenir à la position de départ"><i class="ti ti-rotate" aria-hidden="true"></i> Recommencer</button>
        <button class="btn btn-primary btn-sm" onclick="qeSave()"><i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer…</button>
      </div>
    </div>
    <div class="lib-qe-right">
      <div class="lib-qe-hint" id="lib-qe-hint">Joue des coups pour saisir une partie — ou pour chercher : la liste se limite aux parties qui passent par la position.</div>
      <div class="lib-qe-moves" id="lib-qe-moves" aria-live="polite"></div>
      <div class="lib-qe-tree" id="lib-qe-tree"></div>
    </div>
  </div>`;

  // Base vide : pas de barre, juste l'invite (l'établi reste — c'est LA porte
  // de la première saisie).
  if (!all.length) {
    return head + etabli + `<div class="lib-empty">
      <div class="lib-empty-ico"><i class="ti ti-chess" aria-hidden="true"></i></div>
      <div class="lib-empty-title">Rien dans « ${escapeHtml(b.name)} » pour l'instant</div>
      <div class="lib-empty-sub">Ajoute ta première entrée : joue-la sur l'échiquier ci-dessus, ou colle un PGN.</div>
    </div>`;
  }

  const sel = (v, cur) => v === cur ? ' selected' : '';
  const toolbar = `<div class="lib-detail-toolbar">
    <div class="lib-search"><i class="ti ti-search" aria-hidden="true"></i>
      <input type="text" id="lib-search" placeholder="Rechercher (joueur, tournoi, ouverture…)" value="${escapeHtml(_libQuery)}"
             oninput="_libSetQuery(this.value)" autocomplete="off" spellcheck="false"></div>
    <select id="lib-filter-result" onchange="_libSetResFilter(this.value)" aria-label="Filtrer par résultat">
      <option value="all"${sel('all', _libResFilter)}>Résultat : tous</option>
      <option value="1-0"${sel('1-0', _libResFilter)}>Victoire des Blancs (1-0)</option>
      <option value="0-1"${sel('0-1', _libResFilter)}>Victoire des Noirs (0-1)</option>
      <option value="draw"${sel('draw', _libResFilter)}>Nulle (½-½)</option>
    </select>
    <select id="lib-sort" onchange="_libSetSort(this.value)" aria-label="Trier">
      <option value="date-desc"${sel('date-desc', _libSort)}>Plus récentes d'abord</option>
      <option value="date-asc"${sel('date-asc', _libSort)}>Plus anciennes d'abord</option>
      <option value="white-az"${sel('white-az', _libSort)}>Blancs (A→Z)</option>
      <option value="black-az"${sel('black-az', _libSort)}>Noirs (A→Z)</option>
      <option value="result"${sel('result', _libSort)}>Résultat</option>
    </select>
  </div>`;

  return head + etabli + toolbar + `<div id="lib-entries">${_libEntriesHTML(b)}</div>`;
}

// ── Déplacer / copier / dupliquer une partie entre bases ────────────────────
// (patron de la maquette europe échecs : le libellé du bouton NOMME l'acte —
// « Copier » vers une autre base, « Dupliquer » vers la sienne, « Déplacer »
// réellement refusé vers elle-même.)
let _gtGameId = null;

function openGameTransfer(id) {
  const g = (G.savedGames || []).find(x => String(x.id) === String(id));
  if (!g) return;
  _gtGameId = String(id);
  let m = document.getElementById('modal-game-transfer');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal-game-transfer';
    m.className = 'overlay';
    document.body.appendChild(m);
  }
  const srcBase = getBase(g.baseId);
  const opts = (G.bases || []).map(b =>
    `<option value="${escapeHtml(String(b.id))}"${String(b.id) === String(g.baseId) ? ' selected' : ''}>
       ${escapeHtml(b.name)}${String(b.id) === String(g.baseId) ? ' (cette base)' : ''}</option>`).join('');
  m.innerHTML = `<div class="modal" style="max-width:480px;width:96vw;padding:24px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div class="modal-title" style="margin:0">Ranger cette partie</div>
      <button class="btn btn-ghost btn-sm" onclick="closeModal('modal-game-transfer')" aria-label="Fermer">✕</button>
    </div>
    <div class="ct-src">${escapeHtml((g.white || '?') + ' – ' + (g.black || '?'))}
      <small>depuis « ${escapeHtml(srcBase?.name || '?')} »</small></div>
    <label class="ct-lbl" for="gt-dest">Base de destination</label>
    <select id="gt-dest" class="ct-sel" onchange="_gtSync()">${opts}</select>
    <div class="ct-modes" role="radiogroup" aria-label="Type de rangement">
      <label class="ct-mode"><input type="radio" name="gt-mode" value="copy" checked onchange="_gtSync()">
        <span><b>Copier</b><small>une seconde partie, autonome — vers sa propre base, c'est un duplicata</small></span></label>
      <label class="ct-mode"><input type="radio" name="gt-mode" value="move" onchange="_gtSync()">
        <span><b>Déplacer</b><small>la partie change de base</small></span></label>
    </div>
    <div class="ct-acts">
      <button class="btn btn-ghost" onclick="closeModal('modal-game-transfer')">Annuler</button>
      <button class="btn btn-primary" id="gt-run" onclick="gameTransferRun()">Copier</button>
    </div>
  </div>`;
  m.classList.add('on');
  _gtSync();
}

// Le libellé du bouton nomme l'acte, jamais « Valider » ; « Déplacer » vers la
// base d'origine n'a pas de sens → réellement désactivé.
function _gtSync() {
  const g = (G.savedGames || []).find(x => String(x.id) === String(_gtGameId));
  const dest = document.getElementById('gt-dest')?.value;
  const mode = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name=gt-mode]:checked'))?.value || 'copy';
  const run  = document.getElementById('gt-run');
  if (!g || !dest || !run) return;
  const same = String(dest) === String(g.baseId);
  run.textContent = mode === 'move' ? 'Déplacer' : same ? 'Dupliquer' : 'Copier';
  /** @type {HTMLButtonElement} */ (run).disabled = mode === 'move' && same;
}

function gameTransferRun() {
  const g = (G.savedGames || []).find(x => String(x.id) === String(_gtGameId));
  const dest = getBase(document.getElementById('gt-dest')?.value);
  const mode = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name=gt-mode]:checked'))?.value || 'copy';
  if (!g || !dest) { toast('⚠ Base introuvable', 'ko'); return; }
  const same = String(dest.id) === String(g.baseId);
  if (mode === 'move') {
    if (same) return;                                   // bouton désactivé, garde métier quand même
    g.baseId = String(dest.id);
    save(); window._sbUpdateGame?.(g);
    toast(`✓ Partie déplacée vers « ${dest.name} »`, 'ok');
  } else {
    // Copie AUTONOME : nouvel id, annotations conservées (elles vivent dans le
    // PGN), mais le partage coach ne se duplique pas — sinon la même partie
    // apparaîtrait deux fois dans « Parties partagées ».
    const rec = { ...g, id: _uid(), baseId: String(dest.id), shared: false, ts: Date.now() };
    G.savedGames.push(rec);
    save(); window._sbSaveGame?.(rec);
    toast(same ? '✓ Partie dupliquée' : `✓ Partie copiée vers « ${dest.name} »`, 'ok');
  }
  closeModal('modal-game-transfer');
  renderMyLibrary();
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
  ['ng-white', 'ng-black', 'ng-event', 'ng-welo', 'ng-belo', 'ng-pgn', 'ng-lichess-url'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
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

// Extrait l'ID de partie (8 car.) d'une URL Lichess, d'une URL POV joueur (ID 12 car.,
// les 8 premiers = l'ID public) ou d'un ID collé brut. null si non reconnu.
function _lichessGameId(input) {
  const s = (input || '').trim();
  if (!s) return null;
  const m = s.match(/lichess\.org\/(?:embed\/)?(?:game\/)?([A-Za-z0-9]{8,12})/);
  if (m) return m[1].slice(0, 8);
  if (/^[A-Za-z0-9]{8,12}$/.test(s)) return s.slice(0, 8);
  return null;
}

// Import Lichess (P post-lancement) : URL de partie → API publique → PGN → champ ng-pgn.
// L'API Lichess renvoie le PGN avec en-têtes + CORS ouvert (Access-Control-Allow-Origin: *).
// Migration-free : réutilise entièrement le flux de saisie (saveGameEntry).
async function importLichessGame() {
  const url = document.getElementById('ng-lichess-url')?.value || '';
  const id = _lichessGameId(url);
  if (!id) { toast('⚠ URL Lichess non reconnue (ex : lichess.org/q7ZvsdUF)', 'ko'); return; }
  const btn = document.getElementById('ng-lichess-btn');
  const prev = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" aria-hidden="true"></i> Import…'; }
  try {
    const res = await fetch(`https://lichess.org/game/export/${id}?clocks=false&evals=false&literate=false`,
      { headers: { Accept: 'application/x-chess-pgn' } });
    if (!res.ok) { toast(res.status === 404 ? '❌ Partie introuvable sur Lichess' : '❌ Lichess a répondu ' + res.status, 'ko'); return; }
    const pgn = (await res.text()).trim();
    if (!pgn) { toast('❌ Réponse Lichess vide', 'ko'); return; }
    const ta = document.getElementById('ng-pgn');
    if (ta) ta.value = pgn;
    // Import fait autorité : on repart de métadonnées vides puis on repeuple depuis les en-têtes du PGN.
    ['ng-white', 'ng-black', 'ng-event', 'ng-welo', 'ng-belo'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
    const rs = document.getElementById('ng-result'); if (rs) rs.value = '*';
    _ngPrefillFromPgn();
    toast('✓ Partie importée depuis Lichess', 'ok');
  } catch (e) {
    toast('❌ Échec de connexion à Lichess', 'ko');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = prev; }
  }
}

let _lastGameSaveTs = 0;
function saveGameEntry() {
  // Garde anti double-clic : deux clics rapprochés ajouteraient la partie deux fois.
  if (Date.now() - _lastGameSaveTs < 800) return;
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
  _lastGameSaveTs = Date.now();
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

// Partir d'une position (FEN / échiquier vide) pour une partie (tranche C).
function openPositionEntry() {
  window.openPositionSetupForGame?.();   // validation → openGameEditor(startFen) → _boardEntryDone
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

// `editorTreeToPGN` ne rend que du MOVETEXT (plus [SetUp]/[FEN] si le départ est
// custom) et clôt en dur sur « * » : les en-têtes d'origine — joueurs, tournoi,
// résultat — ne survivent PAS à une revue. La fiche (`white`/`black`/`event`/
// `result`, rangée dans `extra` depuis le fix du 15/07) en reste la source de
// vérité, donc l'app affichait juste ; mais le PGN, lui, devenait anonyme et
// terminé par « * » — c'est celui qu'on EXPORTE et qu'un ChessBase relit.
// Même besoin que `_saveEditorChapter`, qui préserve déjà ses en-têtes.
function _pgnWithHeaders(pgn, g) {
  const txt = String(pgn || '');
  const esc = v => String(v ?? '').replace(/"/g, "'");
  const tags = [];
  const add = (k, v) => { if (v && !new RegExp(`\\[${k}\\s`).test(txt)) tags.push(`[${k} "${esc(v)}"]`); };
  add('Event', g.event);
  add('White', g.white);
  add('Black', g.black);
  add('Result', g.result);
  if (!tags.length) return txt;
  // Le token final doit s'accorder avec l'en-tête Result (l'éditeur écrit « * »).
  const body = g.result ? txt.replace(/\s\*\s*$/, ' ' + g.result) : txt;
  return tags.join('\n') + '\n\n' + body;
}

// Retour de l'éditeur de revue : le PGN (annoté par le coach, ou étendu par l'élève) arrive ici.
function _reviewSaveDone(gameId, pgn, role) {
  const g = (G.savedGames || []).find(x => String(x.id) === String(gameId));
  if (!g) return;
  g.pgn = _pgnWithHeaders(pgn, g);
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
  _renameBaseCommit, _renameBaseCancel, _renameBaseKeydown,
  _createBaseFromInput, getBase, _libSetQuery, _libSetResFilter, _libSetSort, _libSetPosFilter,
  openGameTransfer, _gtSync, gameTransferRun, _libOpenBaseGames,
  openNewGameModal, _ngPrefillFromPgn, importLichessGame, saveGameEntry, deleteGame,
  openBoardEntry, openPositionEntry, _boardEntryDone,
  toggleShareGame, openGameReview, _reviewSaveDone,
});
