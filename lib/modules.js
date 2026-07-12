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
import { extractAllLines } from './core.js';
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

// Choix du mode de création d'un module (échiquier / PGN / position / bibliothèque).
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
      <button class="btn btn-gold btn-sm" onclick="addFromLibrary(${i})">${verb}</button>
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
  const opening = pgn.match(/\[Opening\s+"([^"?]+)"\]/)?.[1];
  const event   = pgn.match(/\[Event\s+"([^"?]+)"\]/)?.[1];
  const white   = pgn.match(/\[White\s+"([^"?]+)"\]/)?.[1];
  const name    = (opening || event || (white ? 'Ouverture – ' + white : '')).trim();
  if (name) nameEl.value = name;
}

function loadPgnFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const txt = String(reader.result || '');
    const ta = document.getElementById('inp-pgn');
    if (ta) { ta.value = txt; if (typeof autoFillFromPgn === 'function') autoFillFromPgn(txt); }
    toast('✓ PGN importé : ' + file.name, 'ok');
  };
  reader.onerror = () => toast('❌ Lecture du fichier impossible', 'ko');
  reader.readAsText(file);
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
      cta: `<button class="btn btn-gold btn-sm" onclick="openCreateDrillModal()">Créer</button>` },
    { done: nbClasses > 0, label: 'Créez une classe et ajoutez vos élèves',
      cta: `<button class="btn btn-gold btn-sm" onclick="switchCoachSection('classes')">Créer une classe</button>` }
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
      <span>👋 Bienvenue ! Démarrez en 3 étapes</span>
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

  if (!n) {
    grid.innerHTML = `<div class="mcard-empty">
      <div class="mcard-empty-ico">📦</div>
      <div class="mcard-empty-title">Aucun module pour l'instant</div>
      <div class="mcard-empty-sub">Créez votre premier module en important un PGN<br>et vos élèves pourront réviser les ouvertures.</div>
      <button class="btn btn-gold" onclick="openCreateDrillModal()">+ Créer mon premier module</button>
    </div>`;
    return;
  }

  const now = Date.now();
  grid.innerHTML = G.drills.map((d,i) => {
    const ns = d.sessions?.length || 1;
    const nEx = countPlayerMoves(d);
    const count = d.isExercise ? nEx+(nEx===1?' exercice':' exercices')
                : d.varmode==='tree' ? Object.keys(d.tree||{}).length+' pos.'
                : nEx+(nEx===1?' coup':' coups');
    const side  = d.side==='w' ? '♔ Blancs' : d.side==='b' ? '♚ Noirs' : '⇄ Les deux';

    const dueCount = Object.keys(G.masteryData).filter(k=>k.includes(`_${d.id}_`)&&G.masteryData[k].due<=now).length;
    const dueBanner = dueCount>0
      ? `<div class="mcard-due-banner" onclick="event.stopPropagation();reviserDrill(${i})">↻ ${dueCount} coup${dueCount>1?'s':''} à réviser</div>`
      : '';

    const levelColor = {Débutant:'var(--green)',Intermédiaire:'var(--blue)',Avancé:'var(--cyan)',Expert:'var(--violet)',Maître:'var(--gold)',GrandMaître:'var(--red)'}[d.level?.replace('-','')]||'var(--dim)';

    const badges = [
      `<span class="badge badge-blue">${escapeHtml(d.level)}</span>`,
      d.isExercise ? `<span class="badge" style="background:var(--surf2);color:var(--violet)">🧩 Exercices</span>`
           : ns>1 ? `<span class="badge" style="background:var(--cyan-dim);color:var(--cyan)">⇶ ${ns} sessions</span>`
           : `<span class="badge badge-gold">● 1 ligne</span>`,
      d.varmode==='tree' ? `<span class="badge" style="background:var(--blue-dim);color:var(--blue)">🌿 Arbre</span>` : '',
      d.demo    ? `<span class="badge" style="background:var(--gold-dim);color:var(--gold)">✦ Démo</span>` : '',
      d.hideComments ? `<span class="badge" style="background:var(--surf2);color:var(--dim)">🔇 Confirmé</span>` : '',
      d.students?.length ? `<span class="badge" style="background:var(--green-dim);color:var(--green)">👥 ${d.students.length}</span>` : '',
      window._deadlinePill?.(d),
    ].filter(Boolean).join('');

    const editorBtn = d.isExercise
      ? `<button class="btn btn-ghost btn-sm" onclick="openExercisePacket(${d.id})" title="Modifier les exercices">🧩</button>`
      : `<button class="btn btn-ghost btn-sm" onclick="openPgnEditor(${i})" title="Éditeur sur échiquier">🎹</button>`;
    const maiaBtn = d.isExercise ? '' : `<button class="btn btn-ghost btn-sm" onclick="playVsMaia(${i})" title="Jouer contre Maia">🤖</button>`;

    return `<div class="mcard">
      ${dueBanner}
      <div class="mcard-name">${escapeHtml(d.name)}</div>
      <div class="mcard-meta">${count} · ${side} · ${escapeHtml(d.created||'—')}</div>
      <div class="mcard-badges">${badges}</div>
      <div class="mcard-footer">
        <button class="btn btn-gold btn-sm" onclick="launchDrill(${i})">▶ Jouer</button>
        <button class="btn btn-blue btn-sm" onclick="shareDrill(${i})" title="Assigner ce module à des élèves">📤 Partager</button>
        ${maiaBtn}
        ${editorBtn}
        <button class="btn btn-ghost btn-sm" onclick="deleteDrill(${d.id})" title="Supprimer">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function launchDrill(i) { S.idx=i; goPage('drill'); }

// Partager un module = ouvrir le formulaire de classe avec ce module déjà coché.
// Il ne reste au prof qu'à saisir les élèves puis valider (l'assignation passe par les G.classes).
function shareDrill(i) {
  const d = G.drills[i];
  if (!d) return;
  switchCoachSection('classes');
  cancelEditClass();            // repart d'un formulaire « nouvelle classe » vierge
  renderClassModuleSelect();    // reconstruit la liste des cases à cocher
  document.querySelectorAll('#inp-cls-modules input[type=checkbox]').forEach(c => {
    c.checked = String(c.value) === String(d.id);
  });
  const t = document.getElementById('cls-form-title');
  if (t) t.textContent = '📤 Partager « ' + (d.name || 'module') + ' »';
  const s = document.getElementById('inp-cls-students');
  if (s) { s.scrollIntoView({ behavior:'smooth', block:'center' }); setTimeout(() => s.focus(), 300); }
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
    const t = document.getElementById('cls-form-title'); if (t) t.textContent = ind ? '👤 Nouveau cours particulier' : '🏫 Nouvelle classe';
    const b = document.getElementById('cls-save-btn');   if (b) b.textContent = ind ? "👤 Ajouter l'élève" : '🏫 Créer la classe';
  }
}

async function saveClass() {
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
  cancelEditClass();
  renderClassList();
  window.renderClassesTab?.();
  toast('✓ ' + (individual ? 'Cours particulier' : 'Classe') + (isEdit ? ' mis à jour' : ' enregistré'), 'ok');
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
    const on = ids.includes(String(di.dataset.mod));
    di.style.display = on ? '' : 'none';
    di.value = on ? (dls[di.dataset.mod] || '') : '';
  });
  const t = document.getElementById('cls-form-title'); if (t) t.textContent = cls.individual ? '✏️ Modifier le cours particulier' : '✏️ Modifier la classe';
  const b = document.getElementById('cls-save-btn');   if (b) b.textContent = '💾 Enregistrer';
  const x = document.getElementById('cls-cancel-btn'); if (x) x.style.display = '';
  document.getElementById('inp-cls-name').scrollIntoView({ behavior:'smooth', block:'center' });
}

function cancelEditClass() {
  _editingClassId = null;
  const n = document.getElementById('inp-cls-name');     if (n) n.value = '';
  const s = document.getElementById('inp-cls-students'); if (s) s.value = '';
  document.querySelectorAll('#inp-cls-modules input[type=checkbox]').forEach(c => c.checked = false);
  const ind = document.getElementById('inp-cls-individual'); if (ind) ind.checked = false;
  const t = document.getElementById('cls-form-title');  if (t) t.textContent = '🏫 Nouvelle classe';
  const b = document.getElementById('cls-save-btn');    if (b) b.textContent = '🏫 Créer la classe';
  const x = document.getElementById('cls-cancel-btn');  if (x) x.style.display = 'none';
  toggleClassMode();
}

// Ajouter un élève = ouvrir le formulaire en mode « cours particulier ».
// Il suffit de saisir le pseudo ; le module s'assigne plus tard via 📤 Partager.
function addStudent() {
  switchCoachSection('classes');
  cancelEditClass();
  const ind = document.getElementById('inp-cls-individual');
  if (ind) { ind.checked = true; toggleClassMode(); }
  renderClassModuleSelect();
  const t = document.getElementById('cls-form-title');
  if (t) t.textContent = '👤 Nouvel élève';
  const s = document.getElementById('inp-cls-students');
  if (s) { s.scrollIntoView({ behavior:'smooth', block:'center' }); setTimeout(() => s.focus(), 300); }
  toast('Saisis le pseudo de l\'élève puis valide', 'ok');
}

function deleteClass(id) {
  if (!confirm('Supprimer cette classe ? Les élèves n\'y auront plus accès.')) return;
  G.classes = G.classes.filter(c=>c.id!==id);
  saveClasses();
  _sbDeleteClass(id);
  if (_editingClassId === id) cancelEditClass();
  renderClassList();
  window.renderClassesTab?.();
  toast('Classe supprimée');
}

function renderClassList() {
  renderCoachOnboarding();
  const el = document.getElementById('cls-list');
  if (!el) return;
  if (!G.classes.length) { el.innerHTML=''; return; }
  el.innerHTML = G.classes.map(cls => {
    const dls = cls.moduleDeadlines || {};
    const modNames = (cls.moduleIds || []).map(id => {
      const d = G.drills.find(x => String(x.id) === String(id));
      const nm = d ? d.name : '— supprimé —';
      const dl = dls[String(id)];
      return dl ? `${nm} · 📅 ${dl}` : nm;
    });
    const stuList  = (cls.studentEmails || cls.students || []);
    return `<div style="padding:10px 12px;background:var(--surf2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.88rem">${cls.individual ? '👤' : '🏫'} ${escapeHtml(cls.individual ? cls.name.replace(/^👤\s*/,'') : cls.name)}${cls.individual ? ' <span style="color:var(--dim);font-weight:400;font-size:.7rem">· cours particulier</span>' : ''}</div>
          <div style="font-size:.72rem;color:var(--dim);margin-top:2px">${modNames.length} module${modNames.length>1?'s':''}${cls.individual ? '' : ` · ${stuList.length} élève${stuList.length>1?'s':''}`}</div>
          ${modNames.length ? `<div style="font-size:.7rem;color:var(--cyan);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📦 ${modNames.map(escapeHtml).join(', ')}</div>` : ''}
          ${stuList.length ? `<div style="font-size:.7rem;color:var(--dim);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">👤 ${stuList.slice(0,4).map(escapeHtml).join(', ')}${stuList.length>4?' +'+(stuList.length-4):''}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" onclick="openEditClass(${cls.id})" title="Modifier">✏️</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteClass(${cls.id})" title="Supprimer">🗑</button>
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
    return `<div class="cls-mod-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:1px 0">
      <label style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;margin:0">
        <input type="checkbox" value="${d.id}" onchange="_toggleModDeadline(${d.id})"${checked?' checked':''}>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.name)}</span>
      </label>
      <input type="date" class="cls-mod-deadline" data-mod="${d.id}" value="${date}" title="Échéance de l'assignation (optionnel)"
             style="display:${checked?'':'none'};font-size:.72rem;padding:2px 5px;border:1px solid var(--border);border-radius:6px;background:var(--surf);color:var(--text)">
    </div>`;
  }).join('');
}

// Affiche/masque le sélecteur de date d'un module selon l'état de sa case (échéance d'assignation).
function _toggleModDeadline(id) {
  const cb = document.querySelector(`#inp-cls-modules input[type=checkbox][value="${id}"]`);
  const di = document.querySelector(`#inp-cls-modules .cls-mod-deadline[data-mod="${id}"]`);
  if (!cb || !di) return;
  di.style.display = cb.checked ? '' : 'none';
  if (!cb.checked) di.value = '';
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/lib.
Object.assign(window, {
  openCreateDrillModal, openCreateChoice, openLibrary, renderLibrary, addFromLibrary,
  previewDrill, loadExample, toggleAdvOpts, autoFillFromPgn, loadPgnFile, importDrill,
  deleteDrill, confirmDel, cancelDel, injectDemoDrill,
  renderCoachOnboarding, dismissOnboarding, renderDrillList, launchDrill, shareDrill,
  toggleClassMode, saveClass, openEditClass, cancelEditClass, addStudent, deleteClass,
  renderClassList, renderClassModuleSelect, _toggleModDeadline,
});
