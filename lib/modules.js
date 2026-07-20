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
import { extractAllLines, pgnHeader } from './core.js';
import { _buildDrillTree, isPlayerMove } from './tree.js';
import { countPlayerMoves } from './drill-core.js';

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
  let allLines;
  try { allLines = extractAllLines(pgn); } catch(e) { el.style.display='block'; el.innerHTML=`<span style="color:var(--red)">❌ PGN invalide : ${escapeHtml(e.message)}</span>`; return; }
  const tree      = _buildDrillTree(allLines, side);
  const positions = Object.keys(tree).length;
  const playerPos = Object.values(tree).filter(n=>n.player.length>0).length;
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
    <span style="color:var(--dim)">${playerPos} à jouer · ${lines.length} variante${lines.length>1?'s':''}</span>
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

function loadPgnFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    // Décodage robuste : UTF-8 d'abord (strip le BOM) ; si caractères invalides
    // (fichier Latin-1 / Windows-1252, fréquent pour les PGN français), on retente.
    let txt;
    const buf = /** @type {ArrayBuffer} */ (reader.result);
    try {
      txt = new TextDecoder('utf-8').decode(buf);
      if (/�/.test(txt)) txt = new TextDecoder('windows-1252').decode(buf);
    } catch (err) {
      try { txt = new TextDecoder('windows-1252').decode(buf); } catch (e2) { txt = String(buf || ''); }
    }
    txt = txt.replace(/^﻿/, '');   // sécurité : retire un BOM résiduel
    const ta = document.getElementById('inp-pgn');
    if (ta) { ta.value = txt; if (typeof autoFillFromPgn === 'function') autoFillFromPgn(txt); }
    toast('✓ PGN importé : ' + file.name, 'ok');
  };
  reader.onerror = () => toast('❌ Lecture du fichier impossible', 'ko');
  reader.readAsArrayBuffer(file);
  e.target.value = '';   // autorise le ré-import du même fichier
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

  let allLines;
  try { allLines = extractAllLines(pgn); }
  catch(e) { toast('❌ PGN invalide : '+e.message, 'ko'); return; }
  if (!allLines.length) { toast('❌ Aucune ligne jouable', 'ko'); return; }

  const tree = _buildDrillTree(allLines, side);
  if (!Object.keys(tree).length) { toast('⚠ Aucun coup extractible', 'ko'); return; }

  const newDrill = {
    id: Date.now(),
    name: baseName,
    level, side, pgn,
    mode: 'line', varmode: 'tree', tree,
    sessions: [{ label: 'Arbre complet', startFen: new Chess().fen(), moves: [], kps: [] }],
    hideComments, deadline,
    created: new Date().toLocaleDateString('fr-FR'),
    updatedAt: Date.now()
  };
  G.drills.push(newDrill);
  S.idx = G.drills.length - 1;

  save();
  saveModule(newDrill);
  renderDrillList();
  renderClassModuleSelect();
  document.getElementById('inp-name').value='';
  document.getElementById('inp-pgn').value='';
  document.getElementById('inp-deadline').value='';
  document.getElementById('inp-hide-comments').checked=false;
  document.getElementById('drill-preview').style.display='none';
  closeModal('modal-create-drill');
  toast(`✓ Module créé — ${Object.keys(tree).length} positions indexées`, 'ok');
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

function renderDrillList() {
  renderCoachOnboarding();
  const grid = document.getElementById('module-cards-grid');
  const n    = G.drills.length;

  // Update sidebar badge + subtitle
  const countBadge = document.getElementById('csnav-count-modules');
  if (countBadge) countBadge.textContent = n;
  const sub = document.getElementById('cs-modules-sub');
  if (sub) sub.textContent = n === 0 ? 'Aucun module créé' : n + ' module' + (n>1?'s':'') + ' créé' + (n>1?'s':'');

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
  if (foldersEl) {
    foldersEl.innerHTML = !folderNames.length ? '' : [
      `<button class="mod-folder-chip${_modFolder===null?' on':''}" onclick="modSelectFolder(null)">Tous <span class="mod-chip-n">${n}</span></button>`,
      ...folderNames.map(f => `<button class="mod-folder-chip${_modFolder===f?' on':''}" data-f="${escapeHtml(f)}" onclick="modSelectFolder(this.dataset.f)"><i class="ti ti-folder" aria-hidden="true"></i> ${escapeHtml(f)} <span class="mod-chip-n">${folderCounts[f]}</span>${_modFolder===f?` <span class="mod-chip-edit" onclick="event.stopPropagation();renameModFolder()" title="Renommer le dossier"><i class="ti ti-edit" aria-hidden="true"></i></span>`:''}</button>`),
      noFolderN && folderNames.length ? `<button class="mod-folder-chip${_modFolder===''?' on':''}" onclick="modSelectFolder('')">Sans dossier <span class="mod-chip-n">${noFolderN}</span></button>` : ''
    ].filter(Boolean).join('');
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

  grid.innerHTML = list.map(({ d, i, due }) => {
    const ns = d.sessions?.length || 1;
    const nEx = countPlayerMoves(d);
    const count = d.isExercise ? nEx+(nEx===1?' exercice':' exercices')
                : d.varmode==='tree' ? Object.keys(d.tree||{}).length+' pos.'
                : nEx+(nEx===1?' coup':' coups');
    const side  = d.side==='w' ? '♔ Blancs' : d.side==='b' ? '♚ Noirs' : '⇄ Les deux';

    const dueBanner = due>0
      ? `<div class="mcard-due-banner" role="button" tabindex="0" onclick="event.stopPropagation();reviserDrill(${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();reviserDrill(${i})}"><i class="ti ti-rotate" aria-hidden="true"></i> ${due} coup${due>1?'s':''} à réviser</div>`
      : '';

    // Carte COMPACTE : type + assignation + échéance seulement (niveau/démo/confirmé
    // restent visibles dans l'éditeur — pas indispensables pour scanner 100 cartes).
    const badges = [
      d.isExercise ? `<span class="badge" style="background:var(--surf2);color:var(--violet)"><i class="ti ti-puzzle" aria-hidden="true"></i> Exercices</span>`
        : d.varmode==='tree' ? `<span class="badge" style="background:var(--blue-dim);color:var(--blue)"><i class="ti ti-binary-tree" aria-hidden="true"></i> Arbre</span>`
        : ns>1 ? `<span class="badge" style="background:var(--cyan-dim);color:var(--cyan)"><i class="ti ti-stack-2" aria-hidden="true"></i> ${ns} sessions</span>` : '',
      d.students?.length ? `<span class="badge" style="background:var(--green-dim);color:var(--green)"><i class="ti ti-users" aria-hidden="true"></i> ${d.students.length}</span>` : '',
      window._deadlinePill?.(d),
    ].filter(Boolean).join('');

    const editorItem = d.isExercise
      ? `<button class="mcard-menu-item" onclick="openExercisePacket(${d.id})"><i class="ti ti-puzzle" aria-hidden="true"></i> Modifier les exercices</button>`
      : `<button class="mcard-menu-item" onclick="openPgnEditor(${i})"><i class="ti ti-edit" aria-hidden="true"></i> Éditeur sur échiquier</button>`;
    const maiaItem = d.isExercise ? '' : `<button class="mcard-menu-item" onclick="playVsMaia(${i})"><i class="ti ti-robot" aria-hidden="true"></i> Jouer contre Maia</button>`;

    return `<div class="mcard">
      ${dueBanner}
      <div class="mcard-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</div>
      <div class="mcard-meta">${count} · ${side}${d.folder?` · <i class="ti ti-folder" aria-hidden="true"></i> ${escapeHtml(d.folder)}`:''}</div>
      ${badges ? `<div class="mcard-badges">${badges}</div>` : ''}
      <div class="mcard-footer">
        <button class="btn btn-primary btn-sm" onclick="launchDrill(${i})"><i class="ti ti-player-play" aria-hidden="true"></i> Jouer</button>
        <button class="btn btn-blue btn-sm" onclick="shareDrill(${i})" title="Assigner ce module à des élèves"><i class="ti ti-share" aria-hidden="true"></i> Partager</button>
        <details class="mcard-menu">
          <summary class="btn btn-ghost btn-sm" title="Plus d'actions" aria-label="Plus d'actions pour ${escapeHtml(d.name)}"><i class="ti ti-dots" aria-hidden="true"></i></summary>
          <div class="mcard-menu-list">
            ${maiaItem}
            ${editorItem}
            <button class="mcard-menu-item" onclick="moveDrillToFolder('${d.id}')"><i class="ti ti-folder-symlink" aria-hidden="true"></i> Déplacer vers un dossier</button>
            <button class="mcard-menu-item danger" onclick="deleteDrill(${d.id})"><i class="ti ti-trash" aria-hidden="true"></i> Supprimer</button>
          </div>
        </details>
      </div>
    </div>`;
  }).join('');
}

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
  deleteDrill, confirmDel, cancelDel, injectDemoDrill,
  renderCoachOnboarding, dismissOnboarding, renderDrillList, launchDrill, shareDrill,
  modSearch, modFilterType, modSortBy, modSelectFolder, renameModFolder, moveDrillToFolder,
  toggleClassMode, saveClass, openEditClass, cancelEditClass, addStudent, openClassForm, deleteClass,
  renderClassList, renderClassModuleSelect, _toggleModDeadline, _studentDisplayName,
});
