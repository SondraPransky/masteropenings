// ══════════════════════════════════════════════════════
// GESTION MODULES & CLASSES — extrait d'app.js (§5.3)
// Création/import de modules (PGN), bibliothèque d'ouvertures prêtes à
// l'emploi, liste des modules (cartes coach), partage/assignation, drill de
// démo, onboarding prof, et gestion des classes / cours particuliers.
// Données : `G` (state.js) + `S` (session.js). Cœurs purs importés.
// Fonctions app-level / Supabase résolues au runtime via le pont window.
// `Chess` = global CDN.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { S } from './session.js';
import { extractAllLines, pgnHeader, pgnStartFen, splitPgnGames, fig, figurineTitle } from './core.js';
import { _buildDrillTree, isPlayerMove, buildTreeModule } from './tree.js';
import { countPlayerMoves } from './drill-core.js';
import { renderStaticBoard } from './miniboard.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const toast                    = (...a) => window.toast?.(...a);
const save                     = (...a) => window.save?.(...a);
const saveClasses              = (...a) => window.saveClasses?.(...a);
const goPage                   = (...a) => window.goPage?.(...a);
const closeModal               = (...a) => window.closeModal?.(...a);
const switchCoachSection       = (...a) => window.switchCoachSection?.(...a);
const saveModule    = (...a) => window.saveModule?.(...a);
const deleteModule= (...a) => window.deleteModule?.(...a);
const _sbSaveStudentModule     = (...a) => window._sbSaveStudentModule?.(...a);
const _sbSaveClass             = (...a) => window._sbSaveClass?.(...a);
const _sbDeleteClass           = (...a) => window._sbDeleteClass?.(...a);
const loadStudentModules       = (...a) => window.loadStudentModules?.(...a);
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

function openCreateDrillModal() {
  pgnBatchCancel();   // repart toujours du formulaire mono-module (purge un lot resté ouvert)
  document.getElementById('modal-create-drill').classList.add('on');
}

// Carte « Depuis un fichier .pgn » : ouvre le modal ET le sélecteur de fichier système.
// Le .click() doit rester synchrone (chaîne du geste utilisateur) pour que le dialogue s'ouvre.
function openCreateDrillFromFile() {
  openCreateDrillModal();
  document.getElementById('inp-pgn-file')?.click();
}

// Choix du mode de création d'un module (échiquier / PGN / fichier / position / bibliothèque).
// openPositionSetup (option « Depuis une position ») → lib/setup.js.
function openCreateChoice() {
  document.getElementById('modal-create-choice')?.classList.add('on');
}

// ── Bibliothèque d'ouvertures prêtes à l'emploi ──────────
const OPENINGS_LIBRARY = [
  { name:"Ouverture italienne", side:"w", level:"Débutant",
    desc:"Sortie rapide des pièces et pression sur f7 — idéale pour débuter.",
    pgn:"1. e4 e5 2. Nf3 {Attaque e5 et développe le cavalier.} Nc6 3. Bc4 {Le fou vise f7, le point le plus faible des Noirs.} Bc5 4. c3 {Prépare d4 pour bâtir un grand centre.} Nf6 5. d3 d6 6. O-O O-O *" },
  { name:"Partie espagnole (Ruy Lopez)", side:"w", level:"Intermédiaire",
    desc:"L'ouverture la plus jouée au plus haut niveau : pression durable sur le centre.",
    pgn:"1. e4 e5 2. Nf3 Nc6 3. Bb5 {Le fou attaque le cavalier qui défend e5.} a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 {Renforce e4 et prépare le plan c3-d4.} b5 7. Bb3 d6 *" },
  { name:"Défense sicilienne (Najdorf)", side:"b", level:"Avancé",
    desc:"La réponse la plus combative à 1.e4 : déséquilibre et contre-jeu pour les Noirs.",
    pgn:"1. e4 c5 {Les Noirs contestent le centre de flanc.} 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 {Le coup Najdorf : contrôle b5 et prépare e5 ou e6.} *" },
  { name:"Défense Caro-Kann", side:"b", level:"Intermédiaire",
    desc:"Solide et fiable : une structure saine sans faiblesse pour les Noirs.",
    pgn:"1. e4 c6 {Prépare d5 en soutenant le pion.} 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 {Le fou sort activement avant de jouer e6.} 5. Ng3 Bg6 *" },
  { name:"Système Londonien", side:"w", level:"Débutant",
    desc:"Un plan simple et solide pour les Blancs, jouable contre presque tout.",
    pgn:"1. d4 d5 2. Bf4 {Le fou sort hors de la chaîne de pions — c'est l'idée clé.} Nf6 3. e3 e6 4. Nf3 c5 5. c3 Nc6 *" },
  { name:"Défense française", side:"b", level:"Intermédiaire",
    desc:"Contre-attaque sur le centre blanc ; patience et bon plan requis.",
    pgn:"1. e4 e6 {Prépare d5 pour frapper le centre.} 2. d4 d5 3. Nc3 Nf6 4. e5 Nfd7 {Le cavalier recule pour préparer la rupture c5.} *" }
];

function openLibrary() { renderLibrary(); document.getElementById('modal-library').classList.add('on'); }

function renderLibrary() {
  const el = document.getElementById('library-list');
  if (!el) return;
  const verb = (G.currentRole === 'teacher') ? 'Ajouter' : 'Apprendre';
  el.innerHTML = OPENINGS_LIBRARY.map((o, i) => `
    <div class="lib-row">
      <div class="lib-info">
        <div class="lib-name">${escapeHtml(o.name)} <span class="lib-side">${o.side==='w'?'Blancs':o.side==='b'?'Noirs':'Les deux'}</span></div>
        <div class="lib-desc">${escapeHtml(o.desc)}</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="addFromLibrary(${i})">${verb}</button>
    </div>`).join('');
}

function addFromLibrary(idx) {
  const o = OPENINGS_LIBRARY[idx];
  if (!o) return;
  const asStudent = (G.currentRole !== 'teacher');
  let allLines;
  try { allLines = extractAllLines(o.pgn); } catch(e) { toast('❌ Erreur de chargement', 'ko'); return; }
  const tree = _buildDrillTree(allLines, o.side);
  if (!Object.keys(tree).length) { toast('❌ Ouverture invalide', 'ko'); return; }
  const d = {
    id: Date.now(),
    name: o.name, level: o.level || 'Intermédiaire', side: o.side, pgn: o.pgn,
    mode: 'line', varmode: 'tree', tree,
    sessions: [{ label: 'Arbre complet', startFen: new Chess().fen(), moves: [], kps: [] }],
    hideComments: false, deadline: null,
    fromLibrary: true,
    created: new Date().toLocaleDateString('fr-FR')
  };
  if (asStudent) { d.personal = true; d.ownerStudentId = G.currentUser?.uid || null; }
  G.drills.push(d);
  save();
  if (G.currentUser) {
    if (asStudent) _sbSaveStudentModule(d);
    else saveModule(d);
  }
  closeModal('modal-library');
  toast(`✓ « ${o.name} » ajouté`, 'ok');
  if (asStudent) loadStudentModules();
  else { renderDrillList(); renderClassModuleSelect(); }
}

// ══════════════════════════════════════════════════════
// IMPORT DRILL (création)
// ══════════════════════════════════════════════════════
function previewDrill() {
  const pgn  = document.getElementById('inp-pgn').value.trim();
  const side = document.getElementById('inp-side').value;
  const el   = document.getElementById('drill-preview');
  if (!pgn) { el.style.display='block'; el.innerHTML='<span style="color:var(--dim)">Collez un PGN d\'abord.</span>'; return; }
  // Une partie = un module : on agrège l'aperçu partie par partie (sinon les parties
  // 2..N seraient rejouées depuis la racine de la 1re et l'aperçu mentirait).
  const chunks = splitPgnGames(pgn);
  const games  = chunks.length ? chunks : [pgn];
  let allLines = [], positions = 0, playerPos = 0;
  try {
    for (const c of games) {
      const l = extractAllLines(c);
      const t = _buildDrillTree(l, side);
      allLines = allLines.concat(l);
      positions += Object.keys(t).length;
      playerPos += Object.values(t).filter(n => n.player.length > 0).length;
    }
  } catch(e) { el.style.display='block'; el.innerHTML=`<span style="color:var(--red)">❌ PGN invalide : ${escapeHtml(e.message)}</span>`; return; }
  const lines     = [...allLines].sort((a,b)=>a.depth-b.depth);
  const rows = lines.map(line => {
    const label  = line.depth===0 ? 'Ligne principale' : (line.label.match(/\[[^\]]+\]/g)||[]).pop()?.replace(/[\[\]]/g,'').trim() || line.label;
    const player = line.moves.filter(m=>isPlayerMove(m.fenBefore,side)).length;
    return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text);font-size:.82rem">${escapeHtml(label)}</span>
      <span style="color:var(--cyan);font-family:'JetBrains Mono',monospace;font-size:.78rem">${player} coup${player>1?'s':''} à jouer</span>
    </div>`;
  });
  el.style.display = 'block';
  el.innerHTML = `<div style="display:flex;gap:16px;margin-bottom:8px;font-size:.82rem">
    <span style="font-weight:700;color:var(--cyan)">🌿 ${positions} positions</span>
    <span style="color:var(--dim)">${playerPos} à jouer · ${lines.length} variante${lines.length>1?'s':''}${games.length>1?` · ${games.length} parties → 1 module à ${games.length} chapitres`:''}</span>
  </div>${rows.join('')}`;
}

function loadExample() {
  document.getElementById('inp-name').value  = 'Espagnole – Plan de Breyer';
  document.getElementById('inp-level').value = 'Intermédiaire';
  document.getElementById('inp-side').value  = 'w';
  document.getElementById('inp-pgn').value =
`1. e4 {Contrôle du centre avec le pion e} e5 2. Nf3 {Développement et attaque sur e5} Nc6 3. Bb5 {L'ouverture espagnole : clouage du cavalier} a6 4. Ba4 {Le fou recule pour maintenir la pression} Nf6 5. O-O {Mise en sécurité du roi — moment clé !} Be7 6. Re1 {La tour soutient le centre} b5 7. Bb3 {Le fou se repositionne sur une diagonale active} d6 8. c3 {Prépare d4 — plan de rupture centrale} O-O 9. h3 {Prévient Bg4 qui épinglerait le cavalier f3} Nb8 10. d4 {La rupture centrale tant préparée !} Nbd7 *`;
}

function toggleAdvOpts() {
  const el    = document.getElementById('adv-opts');
  const arrow = document.getElementById('adv-arrow');
  const open  = el.style.display === 'none' || el.style.display === '';
  el.style.display = open ? 'block' : 'none';
  if (arrow) arrow.textContent = open ? '▼' : '▶';
}

function autoFillFromPgn(pgn) {
  const nameEl = document.getElementById('inp-name');
  if (!pgn || nameEl.value.trim()) return;
  // pgnHeader canonique (core.js) ; « ? » = valeur PGN inconnue → ignorée.
  const hdr = k => { const v = pgnHeader(pgn, k); return v && !v.includes('?') ? v : null; };
  const opening = hdr('Opening'), event = hdr('Event'), white = hdr('White');
  const name    = (opening || event || (white ? 'Ouverture – ' + white : '')).trim();
  if (name) nameEl.value = name;
}

// Décodage robuste d'un fichier PGN : UTF-8 d'abord (strip le BOM) ; si
// caractères invalides (Latin-1 / Windows-1252, fréquent en français), retente.
function _decodePgnBuf(buf) {
  let txt;
  try {
    txt = new TextDecoder('utf-8').decode(buf);
    if (/�/.test(txt)) txt = new TextDecoder('windows-1252').decode(buf);
  } catch (err) {
    try { txt = new TextDecoder('windows-1252').decode(buf); } catch (e2) { txt = String(buf || ''); }
  }
  return txt.replace(/^﻿/, '');   // sécurité : retire un BOM résiduel
}

function _readFileBuf(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(/** @type {ArrayBuffer} */ (r.result));
    r.onerror = () => reject(new Error(file.name));
    r.readAsArrayBuffer(file);
  });
}

function loadPgnFile(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';   // autorise le ré-import des mêmes fichiers
  if (!files.length) return;

  if (files.length === 1) {
    // Un seul fichier : flux historique (textarea + auto-remplissage du nom).
    _readFileBuf(files[0]).then(buf => {
      const txt = _decodePgnBuf(buf);
      const ta = document.getElementById('inp-pgn');
      if (ta) { ta.value = txt; if (typeof autoFillFromPgn === 'function') autoFillFromPgn(txt); }
      toast('✓ PGN importé : ' + files[0].name, 'ok');
    }).catch(() => toast('❌ Lecture du fichier impossible', 'ko'));
    return;
  }

  // Plusieurs fichiers : import en LOT — un module par fichier.
  Promise.all(files.map(f => _readFileBuf(f).then(buf => ({ fname: f.name, pgn: _decodePgnBuf(buf) }))))
    .then(reads => { _pgnBatchStart(reads); })
    .catch(err => toast('❌ Lecture impossible : ' + err.message, 'ko'));
}

// ── Import en lot : N fichiers .pgn → N modules ──────────
// Chaque fichier devient une rangée (nom pré-rempli + camp à choisir) ; niveau /
// échéance / commentaires masqués (Options avancées) s'appliquent à tout le lot.
let _pgnBatch = [];

function _pgnBatchStart(reads) {
  _pgnBatch = reads.map(({ fname, pgn }) => {
    // Nom : en-tête PGN significatif, sinon le nom du fichier sans extension.
    const hdr = k => { const v = pgnHeader(pgn, k); return v && !v.includes('?') ? v : null; };
    const name = hdr('Opening') || hdr('Event') || fname.replace(/\.(pgn|txt)$/i, '');
    let positions = 0, games = 0, error = null;
    try {
      // Un fichier = N parties = N modules : on compte partie par partie, sinon les
      // parties 2..N seraient rejouees depuis la racine de la 1re (coups perdus).
      const chunks = splitPgnGames(pgn);
      for (const c of (chunks.length ? chunks : [pgn])) {
        const lines = extractAllLines(c);
        const n = Object.keys(_buildDrillTree(lines, 'w')).length;
        if (n) { games++; positions += n; }
      }
      if (!positions) error = 'aucun coup extractible';
    } catch (e) { error = e.message || 'PGN invalide'; }
    return { fname, pgn, name, side: 'w', positions, games, error };
  });
  _renderPgnBatch();
}

function _renderPgnBatch() {
  const el = document.getElementById('pgn-batch');
  if (!el) return;
  const valid = _pgnBatch.filter(r => !r.error).length;
  const rows = _pgnBatch.map((r, i) => r.error
    ? `<div class="pgnb-row pgnb-err"><span class="pgnb-file" title="${escapeHtml(r.fname)}">${escapeHtml(r.fname)}</span>
         <span class="pgnb-msg">❌ ${escapeHtml(r.error)}</span></div>`
    : `<div class="pgnb-row"><span class="pgnb-file" title="${escapeHtml(r.fname)}">${escapeHtml(r.fname)}</span>
         <input type="text" class="pgnb-name" data-i="${i}" value="${escapeHtml(r.name)}" aria-label="Nom du module">
         <select class="pgnb-side" data-i="${i}" aria-label="L'élève joue">
           <option value="w">♔ Blancs</option><option value="b">♚ Noirs</option><option value="both">⇄ Les deux</option>
         </select>
         <span class="pgnb-pos">${r.games > 1 ? `${r.games} chapitres · ` : ''}${r.positions} pos.</span></div>`).join('');
  const totalMods = valid;
  el.innerHTML = `
    <div class="pgnb-head">${_pgnBatch.length} fichiers sélectionnés — un module par fichier (un PGN à plusieurs parties devient un module à chapitres).
      Vérifie le nom et le camp de chacun ; niveau et échéance (Options avancées) s'appliquent à tous.</div>
    ${rows}
    <div class="pgnb-actions">
      <button class="btn btn-ghost btn-sm" onclick="pgnBatchCancel()">Annuler le lot</button>
      <button class="btn btn-primary btn-sm" onclick="importPgnBatch()" ${valid ? '' : 'disabled'}>
        <i class="ti ti-plus" aria-hidden="true"></i> Créer ${totalMods} module${totalMods > 1 ? 's' : ''}</button>
    </div>`;
  el.style.display = '';
  // Le lot remplace le formulaire mono-module (mêmes gestes, pas les deux à la fois).
  ['cd-single-pgn', 'cd-single-meta', 'cd-footer', 'drill-preview'].forEach(id => {
    const n = document.getElementById(id); if (n) n.style.display = 'none';
  });
}

function pgnBatchCancel() {
  _pgnBatch = [];
  const el = document.getElementById('pgn-batch');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  ['cd-single-pgn', 'cd-single-meta', 'cd-footer'].forEach(id => {
    const n = document.getElementById(id); if (n) n.style.display = '';
  });
}

function importPgnBatch() {
  const level        = document.getElementById('inp-level')?.value || 'Intermédiaire';
  const deadline     = document.getElementById('inp-deadline')?.value || null;
  const hideComments = !!document.getElementById('inp-hide-comments')?.checked;
  // Le camp/nom de chaque rangée est lu dans le DOM (l'utilisateur a pu les éditer).
  document.querySelectorAll('#pgn-batch .pgnb-name').forEach(inp => {
    const r = _pgnBatch[Number(/** @type {HTMLElement} */ (inp).dataset.i)];
    if (r) r.name = /** @type {HTMLInputElement} */ (inp).value.trim() || r.name;
  });
  document.querySelectorAll('#pgn-batch .pgnb-side').forEach(sel => {
    const r = _pgnBatch[Number(/** @type {HTMLElement} */ (sel).dataset.i)];
    if (r) r.side = /** @type {HTMLSelectElement} */ (sel).value;
  });

  let created = 0, failed = 0;
  const baseId = Date.now();   // ⚠ Date.now() seul se répéterait dans la boucle
  _pgnBatch.forEach((r, i) => {
    if (r.error) { failed++; return; }
    // Un fichier = UN module (a chapitres si le PGN contient plusieurs parties).
    let d;
    try {
      d = buildTreeModule({ id: baseId + i, name: r.name, pgn: r.pgn, side: r.side, level, deadline, hideComments });
    } catch (e) { failed++; return; }
    if (!d) { failed++; return; }
    G.drills.push(d);
    saveModule(d);
    created++;
  });
  save();
  renderDrillList();
  renderClassModuleSelect();
  pgnBatchCancel();
  closeModal('modal-create-drill');
  toast(`✓ ${created} module${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}` +
        (failed ? ` — ${failed} fichier${failed > 1 ? 's' : ''} ignoré${failed > 1 ? 's' : ''} (PGN invalide)` : ''), failed ? 'ko' : 'ok');
}

function importDrill() {
  const baseName     = document.getElementById('inp-name').value.trim();
  const level        = document.getElementById('inp-level').value;
  const pgn          = document.getElementById('inp-pgn').value.trim();
  const side         = document.getElementById('inp-side').value;
  const deadline     = document.getElementById('inp-deadline').value || null;
  const hideComments = document.getElementById('inp-hide-comments').checked;

  if (!baseName) { toast('⚠ Donnez un nom au module', 'ko'); return; }
  if (!pgn)      { toast('⚠ Collez un PGN', 'ko'); return; }

  // Un PGN multi-parties (fichier de lecon ChessBase) = UN module a CHAPITRES :
  // buildTreeModule fusionne l'arbre et cree une session par partie.
  let d;
  try {
    d = buildTreeModule({ id: Date.now(), name: baseName, pgn, side, level, deadline, hideComments });
  } catch (e) { toast('❌ PGN invalide : ' + e.message, 'ko'); return; }
  if (!d) { toast('❌ Aucune ligne jouable', 'ko'); return; }

  G.drills.push(d);
  saveModule(d);
  S.idx = G.drills.length - 1;

  save();
  renderDrillList();
  renderClassModuleSelect();
  document.getElementById('inp-name').value='';
  document.getElementById('inp-pgn').value='';
  document.getElementById('inp-deadline').value='';
  document.getElementById('inp-hide-comments').checked=false;
  document.getElementById('drill-preview').style.display='none';
  closeModal('modal-create-drill');
  const nChap = d.sessions.length;
  toast(nChap > 1
    ? `✓ Module créé — ${nChap} chapitres, ${Object.keys(d.tree).length} positions indexées`
    : `✓ Module créé — ${Object.keys(d.tree).length} positions indexées`, 'ok');
}

let _pendingDelId = null;
function deleteDrill(id) {
  _pendingDelId = id;
  // Fermer toute modale/overlay ouverte avant d'afficher la confirmation
  document.querySelectorAll('.modal.on, .overlay.on').forEach(m => m.classList.remove('on'));
  document.getElementById('del-dialog').style.display = 'block';
  document.getElementById('del-backdrop').style.display = 'block';
}
function confirmDel() {
  const id = _pendingDelId;
  cancelDel();
  const toDel = G.drills.find(d=>d.id===id);
  if (toDel && toDel.demo) localStorage.setItem('mc_demo_seen','1');
  G.drills      = G.drills.filter(d=>String(d.id)!==String(id));
  G.results     = G.results.filter(r=>String(r.drillId)!==String(id));
  G.practiceLog = G.practiceLog.filter(l=>String(l.drillId)!==String(id));
  G.savedGames  = G.savedGames.filter(g=>String(g.drillId)!==String(id));
  for (const k of Object.keys(G.masteryData)) {
    if (k.includes(`_${id}_`)) delete G.masteryData[k];
  }
  save();
  deleteModule(id);
  renderDrillList();
  renderClassModuleSelect();
  toast('Module supprimé');
}
function cancelDel() {
  _pendingDelId = null;
  document.getElementById('del-dialog').style.display = 'none';
  document.getElementById('del-backdrop').style.display = 'none';
}

// ── Drill de démo : injecté automatiquement au premier lancement ──────────
function injectDemoDrill() {
  const pgn = `1. e4 {Contrôle du centre avec le pion e} e5 2. Nf3 {Développement et attaque sur e5} Nc6 3. Bb5 {L'ouverture espagnole : clouage du cavalier} a6 4. Ba4 {Le fou recule pour maintenir la pression} Nf6 5. O-O {Mise en sécurité du roi — moment clé !} Be7 6. Re1 {La tour soutient le centre} b5 7. Bb3 {Le fou se repositionne sur une diagonale active} d6 8. c3 {Prépare d4 — plan de rupture centrale} O-O 9. h3 {Prévient Bg4 qui épinglerait le cavalier f3} Nb8 10. d4 {La rupture centrale tant préparée !} Nbd7 *`;
  try {
    const allLines = extractAllLines(pgn);
    if (!allLines.length) return;
    const line = allLines[0];
    G.drills.push({
      id: 9e8,            // id fixe réservé au démo
      name: 'Espagnole – Plan de Breyer',
      level: 'Intermédiaire',
      side: 'w',
      mode: 'line',
      depth: 0,
      lineLabel: 'Ligne principale',
      startFen: line.startFen,
      moves: line.moves,
      kps: [],
      created: 'Démo',
      demo: true
    });
    save();
  } catch(e) {
    console.warn('injectDemoDrill failed:', e);
  }
}

// ── Onboarding prof : guide de démarrage en 3 étapes ──
function renderCoachOnboarding() {
  const el = document.getElementById('coach-onboarding');
  if (!el) return;
  if (localStorage.getItem('mc_onboarding_done')) { el.innerHTML = ''; return; }
  const nbModules = G.drills.filter(d => !d.personal && !d.demo).length;
  const nbClasses = (typeof G.classes !== 'undefined' ? G.classes : []).length;
  const steps = [
    { done: true,          label: 'Compte professeur créé', cta: '' },
    { done: nbModules > 0, label: 'Créez votre premier module',
      cta: `<button class="btn btn-primary btn-sm" onclick="openCreateChoice()">Créer</button>` },
    { done: nbClasses > 0, label: 'Créez une classe et ajoutez vos élèves',
      cta: `<button class="btn btn-primary btn-sm" onclick="switchCoachSection('classes');openClassForm()">Créer une classe</button>` }
  ];
  const doneN = steps.filter(s => s.done).length;
  if (doneN === steps.length) {
    el.innerHTML = `<div class="onb-card">
      <div class="onb-head"><span>🎉 Tout est prêt !</span><button class="onb-x" onclick="dismissOnboarding()" title="Masquer">×</button></div>
      <div class="onb-sub">Vos élèves voient leurs modules assignés et révisent. Suivez leur progression dans l'onglet Élèves.</div>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="onb-card">
    <div class="onb-head">
      <span><i class="ti ti-rocket" aria-hidden="true"></i> Bienvenue ! Démarrez en 3 étapes</span>
      <span class="onb-prog">${doneN}/${steps.length}</span>
      <button class="onb-x" onclick="dismissOnboarding()" title="Masquer">×</button>
    </div>
    ${steps.map(s => `<div class="onb-step ${s.done ? 'on' : ''}">
      <span class="onb-check">${s.done ? '✓' : ''}</span>
      <span class="onb-label">${s.label}</span>
      ${!s.done ? s.cta : ''}
    </div>`).join('')}
  </div>`;
}

function dismissOnboarding() {
  localStorage.setItem('mc_onboarding_done', '1');
  renderCoachOnboarding();
}

// ── Page Modules à l'échelle : recherche + filtres + tri + dossiers manuels. ──
// État local de la liste (persiste entre re-rendus ; l'input de recherche vit dans
// le HTML statique → le focus est conservé, seule la grille est re-rendue).
let _modQuery = '', _modType = 'all', _modSort = 'recent', _modFolder = null;
const _MOD_LEVEL_ORDER = ['Débutant','Intermédiaire','Avancé','Expert','Maître','Grand-Maître'];

function modSearch(v)     { _modQuery = (v || '').trim().toLowerCase(); renderDrillList(); }
function modFilterType(v) { _modType = v || 'all'; renderDrillList(); }
function modSortBy(v)     { _modSort = v || 'recent'; renderDrillList(); }
function modSelectFolder(f) { _modFolder = f; renderDrillList(); }

// Déplace un module vers un dossier (vide = aucun). Persisté localStorage + modules.extra.
function moveDrillToFolder(id) {
  const d = G.drills.find(x => String(x.id) === String(id));
  if (!d) return;
  const folders = [...new Set(G.drills.map(x => x.folder).filter(Boolean))];
  const hint = folders.length ? `\nDossiers existants : ${folders.join(', ')}` : '';
  const v = prompt(`Nom du dossier (vide = aucun)${hint}`, d.folder || '');
  if (v === null) return;   // annulé
  d.folder = v.trim() || null;
  save();
  window.saveModule?.(d);
  if (_modFolder !== null && _modFolder !== d.folder) _modFolder = null;   // garde le module visible
  renderDrillList();
  toast(d.folder ? `✓ Rangé dans « ${d.folder} »` : '✓ Sorti du dossier', 'ok');
}

// Renomme un module — l'action n'existait qu'en CLI (tools/modules-admin.mjs
// --rename) ou en ouvrant l'éditeur plein écran : disproportionné pour changer
// un mot. ⚠ On ne touche QUE `name` : les libellés de chapitre (sessions[].label)
// dérivent des en-têtes du PGN — les réécrire les ferait diverger de leur source.
function renameDrill(id) {
  const d = G.drills.find(x => String(x.id) === String(id));
  if (!d) return;
  const v = prompt('Nouveau nom du module', d.name || '');
  if (v === null) return;                    // annulé
  const name = v.trim();
  if (!name || name === d.name) return;
  d.name = name;
  d.updatedAt = Date.now();
  save();
  window.saveModule?.(d);
  renderDrillList();
  toast(`✓ Renommé « ${name} »`, 'ok');
}

// Renomme le dossier actif sur tous ses modules (vide = dissout le dossier).
function renameModFolder() {
  if (!_modFolder) return;
  const v = prompt('Nouveau nom du dossier (vide = dissoudre le dossier)', _modFolder);
  if (v === null) return;
  const name = v.trim() || null;
  G.drills.forEach(d => { if (d.folder === _modFolder) { d.folder = name; window.saveModule?.(d); } });
  save();
  _modFolder = name;
  renderDrillList();
  toast(name ? `✓ Dossier renommé « ${name} »` : '✓ Dossier dissous', 'ok');
}

// ── Ligne d'ouverture : LA signature de la liste ────────────────────────────
// Un coach reconnaît « 1.e4 c5 2.♘f3 d6 » (la Najdorf) plus vite que n'importe
// quel nom de module. On lit la ligne principale du 1er chapitre, en figurines.
// Mémoïsé : le rendu est appelé à chaque frappe dans la recherche.
// ⚠ On ne passe PAS par extractAllLines : il construit tout l'arbre de variantes
// (52 ms par module, 1,7 s pour 33) alors qu'on ne veut que 6 demi-coups. Ici on
// dégage le movetext (commentaires, variantes, NAG) et on rejoue le début.
// ⚠ On mémoïse l'ANALYSE (coûteuse), jamais le HTML : le HTML se recompose à
// chaque rendu, ce qui le garde libre de tout état de module au chargement.
// Les clés portent `updatedAt` : chaque édition en crée une NOUVELLE et l'ancienne
// ne servira plus jamais. Sans plafond, la Map ne fait que grossir sur une longue
// session d'édition — d'où la purge (repartir de zéro coûte 0,7 ms par module).
const _CACHE_CAP = 400;
function _cachePut(map, key, val) {
  if (map.size >= _CACHE_CAP) map.clear();
  map.set(key, val);
  return val;
}
const _openLineCache = new Map();
function _openingSans(d, plies) {
  const key = d.id + ':' + (d.updatedAt || 0) + ':' + plies;
  const hit = _openLineCache.get(key);
  if (hit) return hit;
  let sans = [];
  try {
    const chunk = splitPgnGames(d.pgn || '')[0] || d.pgn || '';
    const movetext = chunk.replace(/^\s*(?:\[[^\]]*\]\s*)+/, '')
      .replace(/\{[^}]*\}/g, ' ')                    // commentaires
      .replace(/\([^()]*\)/g, ' ')                   // variantes (1 niveau suffit : on lit le début)
      .replace(/\$\d+/g, ' ')
      .replace(/\d+\.(\.\.)?/g, ' ')
      .replace(/\b(?:1-0|0-1|1\/2-1\/2)\b/g, ' ').replace(/\*/g, ' ');
    const toks = movetext.split(/\s+/).filter(Boolean).slice(0, plies + 4);
    const g = new Chess(); if (g.load(d.sessions?.[0]?.startFen || new Chess().fen())) {
      for (const t of toks) {
        if (sans.length >= plies) break;
        const mv = g.move(t, { sloppy: true });
        if (!mv) break;
        sans.push(mv.san);
      }
    }
  } catch (e) { sans = []; }
  return _cachePut(_openLineCache, key, sans);
}

// Mise en forme de la ligne : numéros de coup + figurines.
// ⚠ `fig` vient d'un IMPORT ES (lib/core.js), pas du pont window : au tout premier
// `renderDrillList`, `window.fig` n'existe pas encore, et comme rien ne re-rend la
// liste ensuite, la vue restait en SAN brut TOUTE la session — la signature même
// de ce design absente, sans qu'une page fraîche ne le montre autrement.
function _openingLine(d, plies) {
  const sans = _openingSans(d, plies);
  // Le 1er demi-coup peut être noir (module partant d'une position).
  const startBlack = (d.sessions?.[0]?.startFen || '').split(' ')[1] === 'b';
  let out = '', plain = '', n = 1;
  sans.forEach((san, k) => {
    const isWhite = startBlack ? k % 2 === 1 : k % 2 === 0;
    if (isWhite) { out += `<span class="mv-num">${n}.</span>`; plain += n + '.'; n++; }
    else if (k === 0) { out += `<span class="mv-num">${n}…</span>`; plain += n + '…'; }
    out += fig(escapeHtml(san));
    plain += san;
    if (k < sans.length - 1) { out += ' '; plain += ' '; }
  });
  return { html: out, plain };
}

// ── Sous-titre : les MOTS du dossier, quand ils désambiguïsent ──────────────
// Mesuré sur le corpus réel : 3 modules s'appellent « Gambit Koltanowski » à
// l'identique, et ce qui les distingue est écrit PAR LA COACH dans son dossier
// (« 773 - Koltanowski accéléré - Noirs exd4 »). Le design du 21/07 gardait le
// numéro et jetait les mots — trois lignes indiscernables à l'écran. On rend le
// texte verbatim (jamais réécrit), segment par segment, en ne retirant que ce
// qui répète strictement le nom. Seuls les dossiers-descripteurs (« NNN - … »)
// produisent un sous-titre : un dossier-collection (« Ouvertures en vogue »)
// répéterait le même texte sous chacun de ses modules — c'est le mur de
// pastilles qu'on a déjà supprimé.
const _normTxt = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
function _folderSubtitle(d) {
  const m = (d.folder || '').match(/^\d+\s*-\s*(.+)$/);
  if (!m) return '';
  const nName = _normTxt(d.name);
  const segs = m[1].split(/\s+-\s+/)
    .map(s => s.trim())
    .filter(s => { const ns = _normTxt(s); return ns && !nName.includes(ns); })
    // Dans un segment conservé, les mots de TÊTE qui répètent le nom sautent
    // (« Grunfeld Fc4 et Ce2 » sous « Grünfeld » → « Fc4 et Ce2 ») ; dès qu'un
    // mot nouveau apparaît, le reste est gardé verbatim.
    .map(s => {
      const words = s.split(/\s+/);
      let k = 0;
      while (k < words.length - 1 && _normTxt(words[k]).length >= 3 && nName.includes(_normTxt(words[k]))) k++;
      return words.slice(k).join(' ');
    });
  return segs.join(' · ');
}

// Positions où l'élève doit trouver un coup — la métrique qui compte pour un
// coach, et PAS le nombre de nœuds de l'arbre (c'est cette confusion qui a masqué
// les modules vides de juillet).
// ⚠ Balayage O(n) et non `_treePlayerPositions` : mesuré, la BFS coûte **15,2 s**
// pour 33 modules (1,1 s pour le Grünfeld seul) contre 0,7 ms ici, pour un résultat
// IDENTIQUE — l'arbre étant construit depuis ses propres lignes, aucun nœud n'y est
// inatteignable (vérifié : 0 orphelin sur les 31 fichiers réels). `_treePlayerPositions`
// reste l'autorité là où la justesse prime sur la vitesse (garde-fou d'import).
const _posCache = new Map();
function _posCount(d) {
  const key = d.id + ':' + (d.updatedAt || 0);
  if (_posCache.has(key)) return _posCache.get(key);
  let n = 0;
  const tree = d.tree || {};
  for (const k in tree) {
    const node = tree[k];
    if (node.player?.length && isPlayerMove(node.startFen, d.side)) n++;
  }
  return _cachePut(_posCache, key, n);
}

// ── Détail dépliable d'un module (arbitrage utilisatrice du 22/07 : rangée
// dépliable, pas de page). Un seul module ouvert à la fois (accordéon) : la
// liste reste balayable. Le détail rend ce que la liste ne peut pas dire :
// les CHAPITRES avec leurs libellés (72 en base, 0 visible jusqu'ici), un
// « Jouer » par chapitre, et l'échiquier de la position de départ — qui suit
// le chapitre survolé (sessions[k].startFen est déjà en mémoire, 0 parsing).
let _modOpenId = null;

function modRowClick(ev, id) {
  // Les boutons de la rangée (Jouer, Assigner, ⋯) gardent leur geste propre.
  if (ev.target.closest('button, summary, details, a, input, select')) return;
  _modOpenId = (_modOpenId === String(id)) ? null : String(id);
  renderDrillList();
}
function modRowKey(ev, id) {
  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); modRowClick(ev, id); }
}

// Lance le drill sur UN chapitre précis (S.startChapter consommé par startDrill).
function launchDrillChapter(i, k) {
  S.idx = i; S.startChapter = k;
  goPage('drill');
}

// L'échiquier du détail suit le chapitre survolé / focalisé.
function _mdetShowChap(id, k) {
  const d = G.drills.find(x => String(x.id) === String(id));
  const host = document.getElementById('mdet-board-' + id);
  const fen = d?.sessions?.[k]?.startFen;
  if (host && fen) host.innerHTML = renderStaticBoard(fen, { size: 176, flip: d.side === 'b' });
}

function _mdetHTML({ d, i, due }) {
  const sessions = d.sessions?.length ? d.sessions : [{}];
  const startFen = sessions[0]?.startFen || new Chess().fen();
  const nPos = d.varmode === 'tree' ? _posCount(d) : countPlayerMoves(d);
  const chaps = d.isExercise
    ? `<div class="mdet-exos">${countPlayerMoves(d)} exercices dans ce paquet</div>`
    : sessions.map((s, k) => `
      <button class="mdet-chap" onclick="launchDrillChapter(${i},${k})"
              onmouseenter="_mdetShowChap('${d.id}',${k})" onfocus="_mdetShowChap('${d.id}',${k})"
              title="Jouer ce chapitre">
        <span class="mdet-chap-label">${figurineTitle(escapeHtml(s.label || 'Chapitre ' + (k + 1)))}</span>
        <span class="mdet-chap-play"><i class="ti ti-player-play" aria-hidden="true"></i></span>
      </button>`).join('');
  const facts = [
    `<span><b>${nPos}</b> position${nPos > 1 ? 's' : ''} à réviser</span>`,
    due > 0 ? `<span class="mdet-due"><b>${due}</b> à revoir</span>` : '',
    d.students?.length ? `<span><b>${d.students.length}</b> élève${d.students.length > 1 ? 's' : ''}</span>` : '',
    d.level ? `<span>${escapeHtml(d.level)}</span>` : '',
  ].filter(Boolean).join('');
  return `<div class="mrow-detail" id="mdet-${d.id}">
    <div class="mdet-chaps">${chaps}</div>
    <div class="mdet-side">
      <div class="mdet-board" id="mdet-board-${d.id}" aria-hidden="true">${renderStaticBoard(startFen, { size: 176, flip: d.side === 'b' })}</div>
      <div class="mdet-facts">${facts}</div>
    </div>
  </div>`;
}

function renderDrillList() {
  renderCoachOnboarding();
  const grid = document.getElementById('module-cards-grid');
  const n    = G.drills.length;

  // Update sidebar badge + subtitle
  const countBadge = document.getElementById('csnav-count-modules');
  if (countBadge) countBadge.textContent = n;
  // Sous-titre : ce que le répertoire CONTIENT vraiment (chapitres + positions à
  // réviser), pas seulement un compte de cartes.
  const sub = document.getElementById('cs-modules-sub');
  if (sub) {
    if (!n) sub.textContent = 'Aucun module créé';
    else {
      const chap = G.drills.reduce((a, d) => a + (d.sessions?.length || 1), 0);
      const pos  = G.drills.reduce((a, d) => a + (d.varmode === 'tree' ? _posCount(d) : countPlayerMoves(d)), 0);
      sub.textContent = `${n} module${n>1?'s':''}`
        + (chap > n ? ` · ${chap} chapitres` : '')
        + ` · ${pos} positions à réviser`;
    }
  }

  if (!grid) return;
  const toolbar = document.getElementById('mod-toolbar');
  if (toolbar) toolbar.style.display = n ? '' : 'none';

  if (!n) {
    const foldersEl0 = document.getElementById('mod-folders');
    if (foldersEl0) foldersEl0.innerHTML = '';
    // Si l'onboarding guide deja la creation (en-tete + etape « Creer »), la carte vide
    // reste calme (illustration + texte) pour ne pas empiler 3 CTA identiques. Une fois
    // l'onboarding masque, elle retrouve son bouton focal.
    const onbActive = !localStorage.getItem('mc_onboarding_done');
    grid.innerHTML = `<div class="mcard-empty">
      <div class="mcard-empty-ico"><i class="ti ti-stack-2" aria-hidden="true"></i></div>
      <div class="mcard-empty-title">Aucun module pour l'instant</div>
      <div class="mcard-empty-sub">Créez votre premier module en important un PGN<br>et vos élèves pourront réviser les ouvertures.</div>
      ${onbActive ? '' : `<button class="btn btn-primary" onclick="openCreateChoice()">+ Créer mon premier module</button>`}
    </div>`;
    return;
  }

  const now = Date.now();
  // Coups dus par module en UNE passe sur la mémoire Leitner (sert la bannière + le tri).
  const dueByDrill = {};
  for (const k in G.masteryData) {
    if (G.masteryData[k].due > now) continue;
    const m = k.match(/_(\d+)_/);
    if (m) dueByDrill[m[1]] = (dueByDrill[m[1]] || 0) + 1;
  }

  // ── Chips de dossiers (dérivées de d.folder ; « Sans dossier » seulement si mixte) ──
  const foldersEl = document.getElementById('mod-folders');
  const folderCounts = {};
  let noFolderN = 0;
  G.drills.forEach(d => { if (d.folder) folderCounts[d.folder] = (folderCounts[d.folder] || 0) + 1; else noFolderN++; });
  const folderNames = Object.keys(folderCounts).sort((a,b) => a.localeCompare(b, 'fr'));
  if (_modFolder && !folderCounts[_modFolder]) _modFolder = null;   // dossier disparu
  // ⚠ Les chips étaient un MUR : 19 dossiers = 21 pastilles sur 186px, dont 14
  // ne révèlent qu'UN module (le dossier y répète le nom). Le dossier redevient
  // ce qu'il est — un filtre occasionnel — dans un select compact ; son numéro de
  // série reste visible sur chaque ligne, et le regroupement utile passe au camp.
  if (foldersEl) {
    foldersEl.innerHTML = !folderNames.length ? '' : `
      <label class="mod-folder-pick">
        <span class="sr-only">Filtrer par dossier</span>
        <select onchange="modSelectFolder(this.value === '__all' ? null : this.value)" aria-label="Filtrer par dossier">
          <option value="__all"${_modFolder===null?' selected':''}>Tous les dossiers (${n})</option>
          ${folderNames.map(f => `<option value="${escapeHtml(f)}"${_modFolder===f?' selected':''}>${escapeHtml(f)} · ${folderCounts[f]}</option>`).join('')}
          ${noFolderN ? `<option value=""${_modFolder===''?' selected':''}>Sans dossier · ${noFolderN}</option>` : ''}
        </select>
      </label>
      ${_modFolder ? `<button class="btn btn-ghost btn-sm" onclick="renameModFolder()" title="Renommer le dossier sélectionné"><i class="ti ti-edit" aria-hidden="true"></i> Renommer</button>` : ''}`;
  }

  // ── Pipeline : dossier → type → recherche → tri ──
  let list = G.drills.map((d,i) => ({ d, i, due: dueByDrill[String(d.id)] || 0 }));
  if (_modFolder !== null) list = list.filter(x => (_modFolder === '' ? !x.d.folder : x.d.folder === _modFolder));
  if (_modType === 'openings')  list = list.filter(x => !x.d.isExercise);
  if (_modType === 'exercises') list = list.filter(x => x.d.isExercise);
  if (_modQuery) list = list.filter(x => (x.d.name || '').toLowerCase().includes(_modQuery));
  if (_modSort === 'name')  list.sort((a,b) => (a.d.name||'').localeCompare(b.d.name||'', 'fr'));
  else if (_modSort === 'due')   list.sort((a,b) => b.due - a.due);
  else if (_modSort === 'level') list.sort((a,b) => _MOD_LEVEL_ORDER.indexOf(a.d.level) - _MOD_LEVEL_ORDER.indexOf(b.d.level));
  // 'recent' = ordre de G.drills (id desc, déjà trié au chargement)

  if (!list.length) {
    grid.innerHTML = `<div class="mcard-empty">
      <div class="mcard-empty-ico"><i class="ti ti-search-off" aria-hidden="true"></i></div>
      <div class="mcard-empty-title">Aucun module ne correspond</div>
      <div class="mcard-empty-sub">Essayez une autre recherche, ou effacez les filtres.</div>
      <button class="btn btn-ghost btn-sm" onclick="modSelectFolder(null);modFilterType('all');modSearch('');const s=document.getElementById('mod-search');if(s)s.value=''">Effacer les filtres</button>
    </div>`;
    return;
  }

  // ── Profondeur DISCRIMINANTE de la ligne d'ouverture ──────────────────────
  // Mesuré sur le corpus réel : à 6 demi-coups fixes, 15 modules sur 27
  // partageaient leur ligne avec un autre (tout le répertoire 1.e4 e5 s'écrase
  // sur « 1.e4 e5 2.♘f3 ♘c6 ») — la signature n'identifiait plus rien. À 8 :
  // 2 ambigus. On étend donc chaque ligne JUSQU'À sa divergence d'avec ses
  // voisines (plafonné à 10) : les préfixes partagés restent alignés, et les
  // demi-coups ajoutés sont précisément ceux qui distinguent.
  const _LINE_MAX = 10;
  {
    const deep = list.map(x => _openingSans(x.d, _LINE_MAX));
    list.forEach((x, a) => {
      let need = 6;
      deep.forEach((o, b) => {
        if (a === b) return;
        let l = 0;
        while (l < _LINE_MAX && deep[a][l] && deep[a][l] === o[l]) l++;
        if (l >= 6) need = Math.max(need, Math.min(_LINE_MAX, l + 1));
      });
      x.plies = need;
    });
  }

  // ── Rendu en LIGNES, groupées par camp ────────────────────────────────────
  // Le camp est la seule structure vraie d'un répertoire (« cet élève joue les
  // Noirs ») ; les 19 dossiers, eux, sont à 14/19 des singletons — leur seule
  // information utile est le numéro de série du coach, qui devient une gouttière.
  const _rowHTML = ({ d, i, due, plies }) => {
    const ns = d.sessions?.length || 1;
    const nEx = countPlayerMoves(d);
    const nPos = d.varmode === 'tree' ? _posCount(d) : nEx;
    // Chapitres et positions vivent dans la colonne de droite : une ligne = une
    // ligne. Le nombre de chapitres est un fait du module, pas un sous-titre.
    const stat = (ns > 1 ? `<span class="mrow-chap"><b>${ns}</b> ch.</span>` : '')
               + (d.isExercise ? `<span><b>${nEx}</b> exos</span>` : `<span><b>${nPos}</b> pos.</span>`);
    // Numéro de référence du coach, extrait du dossier (« 760 - Grunfeld… » → 760).
    const num = (d.folder || '').match(/^(\d+)/)?.[1] || '';
    // Les pastilles ne portent QUE des signaux d'action (à réviser, assigné,
    // échéance, type). Le dossier n'en est pas un : son numéro est déjà dans la
    // gouttière et il reste filtrable — l'afficher coûtait une ligne à chaque module.
    const flags = [
      due > 0 ? `<button class="badge" style="background:var(--red-dim);color:var(--red-ink);border:0;cursor:pointer" onclick="event.stopPropagation();reviserDrill(${i})"><i class="ti ti-rotate" aria-hidden="true"></i> ${due} à réviser</button>` : '',
      d.isExercise ? `<span class="badge" style="background:var(--surf2);color:var(--violet)"><i class="ti ti-puzzle" aria-hidden="true"></i> Exercices</span>` : '',
      d.students?.length ? `<span class="badge" style="background:var(--green-dim);color:var(--green-ink)"><i class="ti ti-users" aria-hidden="true"></i> ${d.students.length}</span>` : '',
      window._deadlinePill?.(d) || '',
    ].filter(Boolean).join('');

    const editorItem = d.isExercise
      ? `<button class="mcard-menu-item" onclick="openExercisePacket(${d.id})"><i class="ti ti-puzzle" aria-hidden="true"></i> Modifier les exercices</button>`
      : `<button class="mcard-menu-item" onclick="openPgnEditor(${i})"><i class="ti ti-edit" aria-hidden="true"></i> Éditeur sur échiquier</button>`;
    const maiaItem = d.isExercise ? '' : `<button class="mcard-menu-item" onclick="playVsMaia(${i})"><i class="ti ti-robot" aria-hidden="true"></i> Jouer contre Maia</button>`;

    const open = _modOpenId === String(d.id);
    return `<div class="mrow${open ? ' open' : ''}" role="button" tabindex="0" aria-expanded="${open}"
         aria-label="Détail de ${escapeHtml(d.name)}"
         onclick="modRowClick(event,'${d.id}')" onkeydown="modRowKey(event,'${d.id}')">
      <div class="mrow-num">${num}</div>
      <div class="mrow-main">
        <!-- figurineTitle APRES escapeHtml : il n'insere que des caracteres unicode. -->
        <div class="mrow-name" title="${escapeHtml(d.name)}">${figurineTitle(escapeHtml(d.name))}</div>
        ${_folderSubtitle(d) ? `<span class="mrow-sub" title="${escapeHtml(d.folder)}">${figurineTitle(escapeHtml(_folderSubtitle(d)))}</span>` : ''}
        ${flags ? `<div class="mrow-flags">${flags}</div>` : ''}
      </div>
      <div class="mrow-line" title="${escapeHtml(_openingLine(d, 12).plain)}">${_openingLine(d, plies || 6).html}</div>
      <div class="mrow-stats">${stat}</div>
      <div class="mrow-acts">
        <button class="btn btn-primary btn-sm" onclick="launchDrill(${i})" title="Jouer ce module"><i class="ti ti-player-play" aria-hidden="true"></i> <span class="mrow-btn-lbl">Jouer</span></button>
        <button class="btn btn-blue btn-sm" onclick="shareDrill(${i})" title="Assigner ce module à des élèves"><i class="ti ti-share" aria-hidden="true"></i> <span class="mrow-btn-lbl">Assigner</span></button>
        <details class="mcard-menu" ontoggle="_mcardMenuAnchor(this)">
          <summary class="btn btn-ghost btn-sm" onclick="_mcardMenuPrepare(this)" title="Plus d'actions" aria-label="Plus d'actions pour ${escapeHtml(d.name)}"><i class="ti ti-dots" aria-hidden="true"></i></summary>
          <div class="mcard-menu-list">
            ${maiaItem}
            ${editorItem}
            <button class="mcard-menu-item" onclick="renameDrill('${d.id}')"><i class="ti ti-pencil" aria-hidden="true"></i> Renommer</button>
            <button class="mcard-menu-item" onclick="moveDrillToFolder('${d.id}')"><i class="ti ti-folder-symlink" aria-hidden="true"></i> Déplacer vers un dossier</button>
            <button class="mcard-menu-item danger" onclick="deleteDrill(${d.id})"><i class="ti ti-trash" aria-hidden="true"></i> Supprimer</button>
          </div>
        </details>
        <span class="mrow-chev" aria-hidden="true"><i class="ti ti-chevron-down"></i></span>
      </div>
    </div>${open ? _mdetHTML({ d, i, due }) : ''}`;
  };

  const SIDE_GROUPS = [
    { key: 'w',    glyph: '♔', title: 'Répertoire Blancs' },
    { key: 'b',    glyph: '♚', title: 'Répertoire Noirs' },
    { key: 'both', glyph: '⇄', title: 'Les deux camps' },
  ];
  // Dans un groupe, l'ordre du dossier préserve la série numérotée du coach (760→777).
  const byName = (a, b) => (a.d.folder || '￿').localeCompare(b.d.folder || '￿', 'fr')
                        || (a.d.name || '').localeCompare(b.d.name || '', 'fr');
  const sections = SIDE_GROUPS.map(g => {
    const rows = list.filter(x => (x.d.side || 'w') === g.key);
    if (!rows.length) return '';
    if (_modSort === 'recent' || _modSort === 'name') rows.sort(byName);
    const pos = rows.reduce((a, x) => a + (x.d.varmode === 'tree' ? _posCount(x.d) : countPlayerMoves(x.d)), 0);
    // Largeur commune de la colonne signature, dérivée de la profondeur RÉELLE
    // du groupe (les rangées doivent s'aligner ; une largeur par rangée
    // casserait le balayage vertical, un fixe affame le nom — cf. .mrow).
    const maxPlies = rows.reduce((a, x) => Math.max(a, x.plies || 6), 6);
    const lineW = (2 + 2.2 * maxPlies).toFixed(1);
    return `<section class="mgroup" style="--mrow-linew:${lineW}rem">
      <div class="mgroup-head">
        <span class="mgroup-side" aria-hidden="true">${g.glyph}</span>
        <h3 class="mgroup-title">${g.title}</h3>
        <span class="mgroup-n">${rows.length} module${rows.length > 1 ? 's' : ''} · ${pos} positions</span>
      </div>
      ${rows.map(_rowHTML).join('')}
    </section>`;
  }).filter(Boolean).join('');
  grid.className = '';
  grid.innerHTML = sections;
}

// Ancrage du menu ⋯ d'une carte à l'ouverture.
// ⚠ Il est en `position:fixed`, PAS `absolute` : `.mcard:hover` applique un
// `transform`, qui crée un contexte d'empilement — un menu absolu y reste
// prisonnier et passe DERRIÈRE les cartes suivantes (mesuré le 21/07 :
// elementFromPoint au centre du menu renvoyait la carte d'à côté). Même parade
// que le menu compte (`toggleAcctMenu`, app.js), et on retourne le menu
// vers le haut quand il déborderait sous la ligne de flottaison.
// Pré-positionnement SYNCHRONE au clic sur le <summary>, avant que le navigateur
// n'ouvre le <details>. Indispensable : l'événement `toggle` est ASYNCHRONE, donc
// sans ça le menu est peint AU MOINS une frame à sa position de flux (« il
// apparaît en bas de page puis revient »). La garde CSS `visibility:hidden` fait
// la même chose, mais elle dépend du CSS — ici on ne dépend que du JS.
function _mcardMenuPrepare(sum) {
  const det = sum.closest('details.mcard-menu');
  const list = det?.querySelector('.mcard-menu-list');
  if (!det || !list || det.open) return;      // fermeture : rien à préparer
  const r = sum.getBoundingClientRect();
  const h = list.offsetHeight || 150, w = list.offsetWidth || 210;   // fermé → dims. inconnues
  const below = window.innerHeight - r.bottom;
  const top = (below < h + 12 && r.top > h + 12) ? (r.top - h - 4) : (r.bottom + 4);
  list.style.top = Math.round(top) + 'px';
  list.style.left = Math.round(Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))) + 'px';
  list.style.visibility = 'visible';
}

function _mcardMenuAnchor(det) {
  const list = det.querySelector('.mcard-menu-list');
  const sum = det.querySelector('summary');
  if (!list || !sum) return;
  if (!det.open) { list.style.top = list.style.left = list.style.visibility = ''; return; }
  // Un seul menu ouvert à la fois (sinon deux panneaux flottants se superposent).
  document.querySelectorAll('.mcard-menu[open]').forEach(m => { if (m !== det) m.removeAttribute('open'); });
  const r = sum.getBoundingClientRect();
  const h = list.offsetHeight || 150, w = list.offsetWidth || 210;
  const below = window.innerHeight - r.bottom;
  const top = (below < h + 12 && r.top > h + 12) ? (r.top - h - 4) : (r.bottom + 4);
  list.style.top = Math.round(top) + 'px';
  list.style.left = Math.round(Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))) + 'px';
  list.style.visibility = 'visible';   // place → visible (cf. la garde CSS)
}

// ⚠ Un menu FIXE reste collé au viewport : si la page defile (le clic sur le
// <summary> lui donne le focus, ce qui peut deja faire defiler), il se detache
// de son bouton — mesure le 21/07 : 309px d'ecart. On le re-ancre au defilement,
// et on le ferme si son bouton quitte l'ecran.
function _mcardMenuFollow() {
  const det = document.querySelector('.mcard-menu[open]');
  if (!det) return;
  const sum = det.querySelector('summary');
  const r = sum?.getBoundingClientRect();
  if (!r || r.bottom < 0 || r.top > window.innerHeight) { det.removeAttribute('open'); return; }
  _mcardMenuAnchor(det);
}
window.addEventListener('scroll', _mcardMenuFollow, { passive: true, capture: true });
window.addEventListener('resize', _mcardMenuFollow, { passive: true });

// Ferme les menus ⋯ des cartes au clic ailleurs (un seul handler global).
document.addEventListener('click', e => {
  const t = e.target instanceof Node ? e.target : null;
  document.querySelectorAll('.mcard-menu[open]').forEach(m => { if (!t || !m.contains(t)) m.removeAttribute('open'); });
});

function launchDrill(i) { S.idx=i; goPage('drill'); }

// Partager un module = ouvrir le formulaire de classe avec ce module déjà coché.
// Il ne reste au prof qu'à saisir les élèves puis valider (l'assignation passe par les G.classes).
function shareDrill(i) {
  const d = G.drills[i];
  if (!d) return;
  switchCoachSection('classes'); // affiche la page Classes (la modale s'ouvre par-dessus)
  cancelEditClass();             // repart d'un formulaire « nouvelle classe » vierge
  renderClassModuleSelect();     // reconstruit la liste des cases à cocher
  document.querySelectorAll('#inp-cls-modules input[type=checkbox]').forEach(c => {
    c.checked = String(c.value) === String(d.id);
  });
  const t = document.getElementById('cls-form-title');
  if (t) t.innerHTML = '<i class="ti ti-share" aria-hidden="true"></i> Partager « ' + escapeHtml(d.name || 'module') + ' »';
  _openClassModal();
  const s = document.getElementById('inp-cls-students');
  if (s) setTimeout(() => s.focus(), 150);
  toast('Ajoutez les élèves (pseudo ou email) puis validez', 'ok');
}

// ══════════════════════════════════════════════════════
// CLASSES
// ══════════════════════════════════════════════════════
let _editingClassId = null;

// Bascule classe ↔ cours particulier (élève seul)
function toggleClassMode() {
  const ind = !!document.getElementById('inp-cls-individual')?.checked;
  const nameRow = document.getElementById('cls-name-row'); if (nameRow) nameRow.style.display = ind ? 'none' : '';
  const lbl = document.getElementById('cls-students-label');
  if (lbl) lbl.innerHTML = ind
    ? 'Élève <span style="font-weight:400;color:var(--dim);font-size:.72rem">— pseudo ou email</span>'
    : 'Élèves <span style="font-weight:400;color:var(--dim);font-size:.72rem">— pseudo ou email, un par ligne</span>';
  const ta = document.getElementById('inp-cls-students'); if (ta) { ta.rows = ind ? 1 : 3; ta.placeholder = ind ? 'alex12' : 'alex12\nmarie\nbob@email.com'; }
  if (_editingClassId == null) {
    const t = document.getElementById('cls-form-title'); if (t) t.innerHTML = ind ? '<i class="ti ti-user" aria-hidden="true"></i> Nouveau cours particulier' : '<i class="ti ti-school" aria-hidden="true"></i> Nouvelle classe';
    const b = document.getElementById('cls-save-btn');   if (b) b.innerHTML = ind ? '<i class="ti ti-user-plus" aria-hidden="true"></i> Ajouter l\'élève' : '<i class="ti ti-school" aria-hidden="true"></i> Créer la classe';
  }
}

let _clsSaving = false;
async function saveClass() {
  // Garde de ré-entrance : pendant l'await réseau, un 2e clic créerait une classe dupliquée.
  if (_clsSaving) return;
  _clsSaving = true;
  try {
  const individual    = !!document.getElementById('inp-cls-individual')?.checked;
  const selectEl      = document.getElementById('inp-cls-modules');
  const selectedIds   = selectEl ? [...selectEl.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value) : [];
  // Échéance par module (assignation) : { moduleId: 'YYYY-MM-DD' }, uniquement pour les modules cochés avec une date.
  const moduleDeadlines = {};
  if (selectEl) selectEl.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
    const di = selectEl.querySelector(`.cls-mod-deadline[data-mod="${cb.value}"]`);
    if (di && di.value) moduleDeadlines[cb.value] = di.value;
  });
  const stuRaw        = document.getElementById('inp-cls-students').value.trim();
  let studentEmails   = stuRaw ? stuRaw.split('\n').map(s=>s.trim().toLowerCase()).filter(Boolean) : [];
  if (individual) studentEmails = studentEmails.slice(0, 1);   // cours particulier = un seul élève
  let name = document.getElementById('inp-cls-name').value.trim();
  if (individual) name = studentEmails[0] ? '👤 ' + studentEmails[0] : '';

  if (!name && !individual) { toast('⚠ Donnez un nom à la classe','ko'); return; }
  // Cours particulier : le module est optionnel (on peut l'assigner plus tard via 📤 Partager).
  if (!selectedIds.length && !individual) { toast('⚠ Sélectionnez au moins un module','ko'); return; }
  if (!studentEmails.length){ toast(individual ? '⚠ Indiquez le pseudo ou l\'email de l\'élève' : '⚠ Ajoutez au moins un élève','ko'); return; }

  let cls = (_editingClassId != null) ? G.classes.find(c => c.id === _editingClassId) : null;
  const isEdit = !!cls;
  if (cls) {
    cls.name = name; cls.moduleIds = selectedIds; cls.studentEmails = studentEmails; cls.students = studentEmails; cls.individual = individual; cls.moduleDeadlines = moduleDeadlines;
  } else {
    cls = { id: Date.now(), name, moduleIds: selectedIds, moduleCodes: [], studentEmails, students: studentEmails, individual, moduleDeadlines, created: new Date().toLocaleDateString('fr-FR') };
    G.classes.push(cls);
  }
  saveClasses();
  await _sbSaveClass(cls);
  closeModal('modal-class-form');
  cancelEditClass();
  window.renderClassesPage?.();   // liste OU détail ouvert (re-rendus avec les données à jour)
  window.renderOverview?.();
  window.renderProfView?.();   // le roster change quand on ajoute/retire un élève
  toast('✓ ' + (individual ? 'Cours particulier' : 'Classe') + (isEdit ? ' mis à jour' : ' enregistré'), 'ok');
  } finally { _clsSaving = false; }
}

function openEditClass(id) {
  const cls = G.classes.find(c => c.id === id);
  if (!cls) return;
  _editingClassId = id;
  const indBox = document.getElementById('inp-cls-individual'); if (indBox) indBox.checked = !!cls.individual;
  toggleClassMode();
  document.getElementById('inp-cls-name').value = cls.name;
  document.getElementById('inp-cls-students').value = (cls.studentEmails || cls.students || []).join('\n');
  renderClassModuleSelect();
  const ids = (cls.moduleIds || []).map(String);
  document.querySelectorAll('#inp-cls-modules input[type=checkbox]').forEach(c => { c.checked = ids.includes(String(c.value)); });
  // Repopuler les échéances par module + révéler les date-pickers des modules cochés.
  const dls = cls.moduleDeadlines || {};
  document.querySelectorAll('#inp-cls-modules .cls-mod-deadline').forEach(di => {
    const on  = ids.includes(String(di.dataset.mod));
    const lbl = di.closest('.cls-mod-deadline-lbl');
    if (lbl) lbl.style.display = on ? 'flex' : 'none';
    di.value = on ? (dls[di.dataset.mod] || '') : '';
  });
  const t = document.getElementById('cls-form-title'); if (t) t.innerHTML = cls.individual ? '<i class="ti ti-edit" aria-hidden="true"></i> Modifier le cours particulier' : '<i class="ti ti-edit" aria-hidden="true"></i> Modifier la classe';
  const b = document.getElementById('cls-save-btn');   if (b) b.innerHTML = '<i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer';
  _openClassModal();
}

function cancelEditClass() {
  _editingClassId = null;
  const n = document.getElementById('inp-cls-name');     if (n) n.value = '';
  const s = document.getElementById('inp-cls-students'); if (s) s.value = '';
  document.querySelectorAll('#inp-cls-modules input[type=checkbox]').forEach(c => c.checked = false);
  const ind = document.getElementById('inp-cls-individual'); if (ind) ind.checked = false;
  const t = document.getElementById('cls-form-title');  if (t) t.innerHTML = '<i class="ti ti-school" aria-hidden="true"></i> Nouvelle classe';
  const b = document.getElementById('cls-save-btn');    if (b) b.innerHTML = '<i class="ti ti-school" aria-hidden="true"></i> Créer la classe';
  const x = document.getElementById('cls-cancel-btn');  if (x) x.style.display = 'none';
  toggleClassMode();
}

// Ouvre la modale du formulaire élève/classe (Annuler toujours visible dans la modale).
function _openClassModal() {
  const x = document.getElementById('cls-cancel-btn'); if (x) x.style.display = '';
  document.getElementById('modal-class-form')?.classList.add('on');
}

// Ajouter un élève = ouvrir la modale en mode « cours particulier » (élève seul).
// Il suffit de saisir le pseudo ; le module s'assigne plus tard via « Partager ».
function addStudent() {
  cancelEditClass();
  const ind = document.getElementById('inp-cls-individual');
  if (ind) { ind.checked = true; toggleClassMode(); }
  renderClassModuleSelect();
  const t = document.getElementById('cls-form-title');
  if (t) t.innerHTML = '<i class="ti ti-user" aria-hidden="true"></i> Nouvel élève';
  _openClassModal();
  const s = document.getElementById('inp-cls-students');
  if (s) setTimeout(() => s.focus(), 150);
}

// Créer une classe = ouvrir la modale en mode groupe (vierge).
function openClassForm() {
  cancelEditClass();
  renderClassModuleSelect();
  _openClassModal();
  const n = document.getElementById('inp-cls-name');
  if (n) setTimeout(() => n.focus(), 150);
}

function deleteClass(id) {
  if (!confirm('Supprimer cette classe ? Les élèves n\'y auront plus accès.')) return;
  G.classes = G.classes.filter(c=>c.id!==id);
  saveClasses();
  _sbDeleteClass(id);
  if (_editingClassId === id) cancelEditClass();
  window.closeClassDetail?.();   // si le détail supprimé était ouvert → retour à la liste (re-rend)
  window.renderOverview?.();
  window.renderProfView?.();
  toast('Classe supprimée');
}

// Nom lisible d'un élève à partir de son email d'inscription : privilégie le vrai
// nom d'affichage (depuis les résultats), sinon dérive un prénom de la partie locale
// (« lucas.martin@club.fr » -> « Lucas »). Évite de déverser des emails bruts sur la carte.
function _studentDisplayName(email) {
  const lower = (email || '').toLowerCase();
  const hit = G.results.find(r => (r.studentEmail || '').toLowerCase() === lower);
  if (hit && hit.student) return hit.student;
  const local = lower.split('@')[0].split(/[._-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : email;
}

function renderClassList() {
  renderCoachOnboarding();
  const badge = document.getElementById('csnav-count-classes');
  if (badge) badge.textContent = String(G.classes.length);
  const el = document.getElementById('cls-list');
  if (!el) return;
  if (!G.classes.length) { el.innerHTML=''; return; }
  el.innerHTML = G.classes.map(cls => {
    const dls = cls.moduleDeadlines || {};
    // Fragments HTML déjà échappés (le nom + la date le sont ici) : l'icône d'échéance
    // reste du markup, donc NE PAS re-escaper la liste à l'affichage (sinon l'icône
    // apparaît en texte littéral « <i class=... > »).
    const modNames = (cls.moduleIds || []).map(id => {
      const d = G.drills.find(x => String(x.id) === String(id));
      const nm = escapeHtml(d ? d.name : '— supprimé —');
      const dl = dls[String(id)];
      if (!dl) return nm;
      let dlLabel = dl;
      try { dlLabel = new Date(dl + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); } catch (e) {}
      return `${nm} · <i class="ti ti-calendar" aria-hidden="true"></i> ${escapeHtml(dlLabel)}`;
    });
    const stuList  = (cls.studentEmails || cls.students || []);
    // Carte cliquable → détail de la classe (page Classes) ; les boutons CRUD
    // stoppent la propagation pour ne pas ouvrir le détail.
    return `<div class="cls-card" role="button" tabindex="0" onclick="openClassDetail(${cls.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openClassDetail(${cls.id})}" aria-label="Ouvrir la classe ${escapeHtml(cls.individual ? cls.name.replace(/^👤\s*/,'') : cls.name)}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.88rem"><i class="ti ${cls.individual ? 'ti-user' : 'ti-school'}" aria-hidden="true"></i> ${escapeHtml(cls.individual ? cls.name.replace(/^👤\s*/,'') : cls.name)}${cls.individual ? ' <span style="color:var(--dim);font-weight:400;font-size:.7rem">· cours particulier</span>' : ''}</div>
          <div style="font-size:.72rem;color:var(--dim);margin-top:2px">${modNames.length} module${modNames.length>1?'s':''}${cls.individual ? '' : ` · ${stuList.length} élève${stuList.length>1?'s':''}`}</div>
          ${modNames.length ? `<div style="font-size:.7rem;color:var(--cyan);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class="ti ti-stack-2" aria-hidden="true"></i> ${modNames.join(', ')}</div>` : ''}
          ${stuList.length ? `<div class="cls-stu-chips">${stuList.slice(0,6).map(e=>`<span class="cls-stu-chip">${escapeHtml(_studentDisplayName(e))}</span>`).join('')}${stuList.length>6?`<span class="cls-stu-chip cls-stu-more">+${stuList.length-6}</span>`:''}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm btn-ico" onclick="event.stopPropagation();openEditClass(${cls.id})" title="Modifier" aria-label="Modifier la classe"><i class="ti ti-edit" aria-hidden="true"></i></button>
          <button class="btn btn-ghost btn-sm btn-ico" onclick="event.stopPropagation();deleteClass(${cls.id})" title="Supprimer" aria-label="Supprimer la classe"><i class="ti ti-trash" aria-hidden="true"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderClassModuleSelect() {
  const el = document.getElementById('inp-cls-modules');
  if (!el) return;
  const prev = [...el.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
  const prevDates = {};
  el.querySelectorAll('.cls-mod-deadline').forEach(di => { if (di.value) prevDates[di.dataset.mod] = di.value; });
  if (!G.drills.length) {
    el.innerHTML = '<div style="padding:8px;font-size:.8rem;color:var(--dim)">Aucun module créé</div>';
    return;
  }
  el.innerHTML = G.drills.map(d => {
    const checked = prev.includes(String(d.id));
    const date    = prevDates[String(d.id)] || '';
    return `<div class="cls-mod-row" style="padding:3px 0">
      <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer">
        <input type="checkbox" value="${d.id}" onchange="_toggleModDeadline(${d.id})"${checked?' checked':''}>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.name)}</span>
      </label>
      <label class="cls-mod-deadline-lbl" data-mod="${d.id}" style="display:${checked?'flex':'none'};align-items:center;gap:6px;margin:5px 0 2px 25px;font-size:.68rem;color:var(--dim)">
        <i class="ti ti-calendar" aria-hidden="true"></i> Échéance
        <input type="date" class="cls-mod-deadline" data-mod="${d.id}" value="${date}" title="Échéance de l'assignation (optionnel)" aria-label="Échéance pour ${escapeHtml(d.name)}"
               style="font-size:.72rem;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surf);color:var(--text)">
      </label>
    </div>`;
  }).join('');
}

// Affiche/masque le sélecteur de date d'un module selon l'état de sa case (échéance d'assignation).
function _toggleModDeadline(id) {
  const cb  = document.querySelector(`#inp-cls-modules input[type=checkbox][value="${id}"]`);
  const lbl = document.querySelector(`#inp-cls-modules .cls-mod-deadline-lbl[data-mod="${id}"]`);
  const di  = document.querySelector(`#inp-cls-modules .cls-mod-deadline[data-mod="${id}"]`);
  if (!cb || !lbl || !di) return;
  lbl.style.display = cb.checked ? 'flex' : 'none';   // ligne « Échéance » sous le nom
  if (!cb.checked) di.value = '';
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/lib.
Object.assign(window, {
  openCreateDrillModal, openCreateDrillFromFile, openCreateChoice, openLibrary, renderLibrary, addFromLibrary,
  previewDrill, loadExample, toggleAdvOpts, autoFillFromPgn, loadPgnFile, importDrill,
  importPgnBatch, pgnBatchCancel,
  deleteDrill, confirmDel, cancelDel, injectDemoDrill,
  renderCoachOnboarding, dismissOnboarding, renderDrillList, launchDrill, shareDrill,
  modRowClick, modRowKey, launchDrillChapter, _mdetShowChap,
  _mcardMenuAnchor, _mcardMenuPrepare,
  modSearch, modFilterType, modSortBy, modSelectFolder, renameModFolder, moveDrillToFolder, renameDrill,
  toggleClassMode, saveClass, openEditClass, cancelEditClass, addStudent, openClassForm, deleteClass,
  renderClassList, renderClassModuleSelect, _toggleModDeadline, _studentDisplayName,
});
