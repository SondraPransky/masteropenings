// ══════════════════════════════════════════════════════
// TRANSFERT DE CHAPITRES — copier / deplacer une partie d'un module a l'autre,
// et coller une partie PGN dans un module existant (nouveau chapitre).
//
// Un chapitre = UNE partie du PGN du module (decoupe splitPgnGames). Le PGN
// reste LA source de verite : on ne manipule que lui, puis on rebatit le module
// avec `buildTreeModule` — la meme fabrique que l'import et que la sauvegarde
// d'un chapitre dans l'editeur, donc arbre fusionne, sessions, labels et
// startFen restent coherents (0 logique dupliquee).
//
// ⚠ Trois invariants a ne pas perdre de vue :
//  1. `chapTitles` est cle par gameIdx → retirer/inserer une partie DECALE ses
//     cles (`shiftChapTitles`), sinon les titres edites glissent d'un chapitre.
//  2. Deplacer le DERNIER chapitre d'un module le viderait (buildTreeModule
//     renvoie null) → refuse ; c'est une suppression de module, pas un transfert.
//  3. La cle de maitrise est `${eleve}_${drillId}_${normFen}_${san}` : les
//     positions qui changent de module changent de drillId, donc leur historique
//     Leitner ne suit pas. Annonce dans le modal plutot que masque.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { splitPgnGames, insertPgnGames, removePgnGame, figurineTitle } from './core.js';
import { buildTreeModule, applyChapTitles, shiftChapTitles } from './tree.js';

const toast                = (...a) => window.toast?.(...a);
const save                 = (...a) => window.save?.(...a);
const closeModal           = (...a) => window.closeModal?.(...a);
const saveModule           = (...a) => window.saveModule?.(...a);
const _sbSaveStudentModule = (...a) => window._sbSaveStudentModule?.(...a);
const renderDrillList      = (...a) => window.renderDrillList?.(...a);
const renderClassModuleSelect = (...a) => window.renderClassModuleSelect?.(...a);
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

// Etat du dialogue en cours (source + mode). Jamais reassigne ailleurs.
let _CT = { srcId: null, chapIdx: null, mode: 'copy' };

const _mod = id => G.drills.find(x => String(x.id) === String(id));
// Index de PARTIE du chapitre : une partie sans coup jouable ne cree pas de
// session, donc sessions[k] et splitPgnGames(pgn)[k] peuvent se decaler.
const _gameIdx = (d, k) => d?.sessions?.[k]?.gameIdx ?? k;
const _chapLabel = (d, k) => d?.sessions?.[k]?.label || `Chapitre ${k + 1}`;

// Modules qui peuvent accueillir un chapitre : les modules « arbre » du coach,
// hors paquets d'exercices (leurs positions ne sont pas des lignes) et hors
// couches d'edition eleve (elles ne portent qu'un diff).
function _targets(exceptId) {
  return G.drills.filter(d => d.varmode === 'tree' && !d.isExercise && !d.overlayOf
                              && String(d.id) !== String(exceptId))
                 // 25 destinations au volume reel : l'ordre de G.drills n'est pas
                 // cherchable a l'oeil, l'alphabetique si (meme regle que le select
                 // de modules de la page drill).
                 .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
}

// Rebatit un module depuis son nouveau PGN et l'ecrit. Retourne false (sans rien
// muter) si le PGN reconstruit n'est pas exploitable — l'appelant abandonne alors
// AVANT d'avoir touche a l'autre module.
function _rebuild(d, newPgn, chapTitles) {
  const rebuilt = buildTreeModule({
    id: d.id, name: d.name, pgn: newPgn, side: d.side, level: d.level,
    deadline: d.deadline, hideComments: d.hideComments,
  });
  if (!rebuilt) return false;
  applyChapTitles(rebuilt.sessions, chapTitles);
  d.pgn = newPgn; d.tree = rebuilt.tree; d.sessions = rebuilt.sessions;
  d.chapTitles = chapTitles;
  d.updatedAt = Date.now();
  return true;
}

function _persist(...mods) {
  save();
  if (G.currentUser) {
    for (const d of mods) {
      if (d.personal) _sbSaveStudentModule(d);
      else if (G.currentRole === 'teacher') saveModule(d);
    }
  }
  renderDrillList();
  renderClassModuleSelect();
}

// ── Copier / deplacer un chapitre ───────────────────────────────────────────
function openChapterTransfer(id, k) {
  const d = _mod(id);
  if (!d) return;
  const targets = _targets(id);
  _CT = { srcId: String(id), chapIdx: k, mode: 'copy' };

  let m = document.getElementById('modal-chap-transfer');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal-chap-transfer';
    m.className = 'overlay';
    document.body.appendChild(m);
  }
  const nChap = splitPgnGames(d.pgn || '').length;
  const opts = targets.map(t => {
    const nc = (t.sessions?.length || 1);
    return `<option value="${escapeHtml(String(t.id))}">${escapeHtml(t.name)}`
         + ` — ${nc} chapitre${nc > 1 ? 's' : ''}${t.side !== d.side ? ' (camp opposé)' : ''}</option>`;
  }).join('');

  m.innerHTML = `<div class="modal" style="max-width:520px;width:96vw;padding:24px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div class="modal-title" style="margin:0">Copier ou déplacer ce chapitre</div>
      <button class="btn btn-ghost btn-sm" onclick="closeModal('modal-chap-transfer')" aria-label="Fermer">✕</button>
    </div>
    <div class="ct-src">${figurineTitle(escapeHtml(_chapLabel(d, k)))}
      <small>depuis « ${escapeHtml(d.name)} »</small></div>
    ${!targets.length ? `
      <div class="ct-note">Aucun autre module d'ouverture ne peut l'accueillir pour l'instant.</div>
      <div class="ct-acts"><button class="btn btn-ghost" onclick="closeModal('modal-chap-transfer')">Fermer</button></div>
    ` : `
      <label class="ct-lbl" for="ct-dest">Module de destination</label>
      <select id="ct-dest" class="ct-sel">${opts}</select>
      <div class="ct-modes" role="radiogroup" aria-label="Type de transfert">
        <label class="ct-mode"><input type="radio" name="ct-mode" value="copy" checked
               onchange="chapterTransferMode('copy')"><span><b>Copier</b><small>le chapitre reste aussi dans ce module</small></span></label>
        <label class="ct-mode"><input type="radio" name="ct-mode" value="move"${nChap < 2 ? ' disabled' : ''}
               onchange="chapterTransferMode('move')"><span><b>Déplacer</b><small>${nChap < 2
                 ? 'impossible : c\'est le seul chapitre de ce module'
                 : 'le chapitre quitte ce module'}</small></span></label>
      </div>
      <div class="ct-note"><i class="ti ti-info-circle" aria-hidden="true"></i>
        Le PGN du chapitre est repris tel quel (commentaires et variantes compris).
        Les positions changent de module : leur historique de révision ne suit pas.</div>
      <div class="ct-acts">
        <button class="btn btn-ghost" onclick="closeModal('modal-chap-transfer')">Annuler</button>
        <button class="btn btn-primary" onclick="chapterTransferRun()">Valider</button>
      </div>
    `}
  </div>`;
  m.classList.add('on');
}

function chapterTransferMode(mode) { _CT.mode = mode; }

function chapterTransferRun() {
  const src = _mod(_CT.srcId);
  const destId = document.getElementById('ct-dest')?.value;
  const dest = _mod(destId);
  if (!src || !dest) { toast('❌ Module introuvable', 'ko'); return; }

  const k = _CT.chapIdx;
  const gi = _gameIdx(src, k);
  const chunk = splitPgnGames(src.pgn || '')[gi];
  if (!chunk) { toast('❌ Chapitre introuvable dans le PGN', 'ko'); return; }
  const label = _chapLabel(src, k);
  const move = _CT.mode === 'move';
  if (move && splitPgnGames(src.pgn || '').length < 2) {
    toast('⚠ C\'est le seul chapitre de ce module — copie-le plutôt', 'ko'); return;
  }

  // Destination d'abord : si elle echoue, la source n'a pas bouge.
  const destAt = splitPgnGames(dest.pgn || '').length;         // ajout en fin
  const destPgn = insertPgnGames(dest.pgn || '', chunk);
  const destTitles = { ...(dest.chapTitles || {}) };
  // Le titre edite voyage avec son chapitre (sinon il repartirait des en-tetes).
  if (src.chapTitles?.[String(gi)]) destTitles[String(destAt)] = src.chapTitles[String(gi)];
  const destSnap = { pgn: dest.pgn, tree: dest.tree, sessions: dest.sessions,
                     chapTitles: dest.chapTitles, updatedAt: dest.updatedAt };
  if (!_rebuild(dest, destPgn, destTitles)) {
    toast('❌ Chapitre illisible dans ce module — rien n\'a été modifié', 'ko'); return;
  }

  if (move) {
    const srcPgn = removePgnGame(src.pgn || '', gi);
    const srcTitles = shiftChapTitles(src.chapTitles, gi, -1);
    if (!_rebuild(src, srcPgn, srcTitles)) {
      Object.assign(dest, destSnap);   // rollback de la destination
      toast('❌ Le module source deviendrait vide — rien n\'a été modifié', 'ko'); return;
    }
  }

  closeModal('modal-chap-transfer');
  _persist(dest, src);
  toast(`✓ « ${label} » ${move ? 'déplacé' : 'copié'} vers « ${dest.name} »`, 'ok');
}

// ── Coller une partie dans un module (nouveau chapitre) ─────────────────────
function openChapterPaste(id) {
  const d = _mod(id);
  if (!d) return;
  _CT.srcId = String(id);
  let m = document.getElementById('modal-chap-paste');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal-chap-paste';
    m.className = 'overlay';
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="modal" style="max-width:560px;width:96vw;padding:24px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div class="modal-title" style="margin:0">Coller une partie dans ce module</div>
      <button class="btn btn-ghost btn-sm" onclick="closeModal('modal-chap-paste')" aria-label="Fermer">✕</button>
    </div>
    <div class="ct-src">${escapeHtml(d.name)}<small>la partie collée devient un nouveau chapitre</small></div>
    <label class="ct-lbl" for="cp-pgn">PGN</label>
    <textarea id="cp-pgn" class="ct-area" rows="9" spellcheck="false"
      placeholder="[Event &quot;Le bon plan contre 5...a6&quot;]&#10;[White &quot;La théorie en 2026&quot;]&#10;&#10;1.e4 c5 2.Nf3 d6 { … } *"></textarea>
    <div class="ct-note"><i class="ti ti-info-circle" aria-hidden="true"></i>
      Plusieurs parties collées d'un coup deviennent autant de chapitres. Le titre du
      chapitre vient des en-têtes <code>[White]</code> / <code>[Black]</code> du PGN.</div>
    <div class="ct-acts">
      <button class="btn btn-ghost" onclick="closeModal('modal-chap-paste')">Annuler</button>
      <button class="btn btn-primary" onclick="chapterPasteRun()">Ajouter le chapitre</button>
    </div>
  </div>`;
  m.classList.add('on');
  setTimeout(() => document.getElementById('cp-pgn')?.focus(), 30);
}

function chapterPasteRun() {
  const d = _mod(_CT.srcId);
  const pgn = (document.getElementById('cp-pgn')?.value || '').trim();
  if (!d) { toast('❌ Module introuvable', 'ko'); return; }
  if (!pgn) { toast('⚠ Colle un PGN d\'abord', 'ko'); return; }

  const before = splitPgnGames(d.pgn || '').length;
  const beforeChap = d.sessions?.length || 0;
  const newPgn = insertPgnGames(d.pgn || '', pgn);
  if (splitPgnGames(newPgn).length === before) { toast('⚠ Rien à ajouter dans ce PGN', 'ko'); return; }

  const snap = { pgn: d.pgn, tree: d.tree, sessions: d.sessions, chapTitles: d.chapTitles, updatedAt: d.updatedAt };
  if (!_rebuild(d, newPgn, { ...(d.chapTitles || {}) })) {
    toast('❌ PGN invalide — rien n\'a été modifié', 'ko'); return;
  }
  // Un PGN sans coup jouable ne cree AUCUN chapitre : buildTreeModule reussit
  // (les anciens chapitres suffisent) mais le collage n'a rien produit.
  const added = (d.sessions?.length || 0) - beforeChap;
  if (added < 1) {
    Object.assign(d, snap);
    toast('⚠ Aucun coup jouable dans ce PGN — rien n\'a été ajouté', 'ko'); return;
  }

  closeModal('modal-chap-paste');
  _persist(d);
  toast(`✓ ${added} chapitre${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} à « ${d.name} »`, 'ok');
}

Object.assign(window, {
  openChapterTransfer, chapterTransferMode, chapterTransferRun,
  openChapterPaste, chapterPasteRun,
});

export { openChapterTransfer, chapterTransferRun, openChapterPaste, chapterPasteRun };
