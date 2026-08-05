// ══════════════════════════════════════════════════════
// lib/coach-games.js — PARTIES PARTAGÉES : dashboard coach (« qu'est-ce que Tom
// m'a envoyé ? »).
// État local : _pgQuery / _pgStatus / _pgSeenTs (ils ne sortent pas d'ici).
// Socle → coach-core.js ; appels latéraux → pont window (openReviewEditor, exportPGN).
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { toast, escapeHtml } from './coach-core.js';
// Pur, hors famille coach-* (comme l'import de `G`) : la comparaison d'une
// partie au répertoire (lib/tree.js). Les appels latéraux restent sur window.
import { compareGameToRepertoire } from './tree.js';
import { moveLabel } from './coach-core.js';
import { renderStaticBoard } from './miniboard.js';

let _pgQuery = '', _pgStatus = 'all', _pgSeenTs = 0;

// ── Position FINALE d'une partie, mémoïsée ─────────────────────────────────
// Rejouer un PGN coûte un objet Chess : on ne le fait qu'UNE fois par partie,
// et le résultat sert de vignette dans la liste. Partie illisible → null, et la
// rangée retombe sur la pastille de résultat (aucune vignette vide).
const _fenFin = new Map();
function _finalFen(g) {
  const k = String(g.id);
  if (_fenFin.has(k)) return _fenFin.get(k);
  let fen = null;
  try { const c = new Chess(); if (c.load_pgn(g.pgn || '')) fen = c.fen(); } catch (e) {}
  _fenFin.set(k, fen);
  return fen;
}

// ── Sortie de répertoire d'une partie partagée (arbitrage 28/07) ────────────
// Confrontée aux modules du coach ; mémoïsée par partie + état des modules.
const _pgRepCache = new Map();
function _pgRep(g) {
  const stamp = (G.drills || []).reduce((a, d) => a + (d.updatedAt || 0), 0);
  const key = g.id + ':' + (g.pgn || '').length + ':' + stamp;
  if (_pgRepCache.has(key)) return _pgRepCache.get(key);
  if (_pgRepCache.size > 300) _pgRepCache.clear();
  let r = null;
  try { r = compareGameToRepertoire(g.pgn, G.drills || []); } catch (e) { /* PGN illisible */ }
  _pgRepCache.set(key, r);
  return r;
}

function _pgRepHTML(g) {
  const r = _pgRep(g);
  if (!r?.exit) return '';
  const fg = x => window.fig ? window.fig(x) : x;
  const num = moveLabel(r.exit.moveNo, r.exit.color);
  const exp = r.exit.expected.map(s => fg(escapeHtml(s))).join(' ou ');
  return `<div class="pg-rep"><i class="ti ti-route-off" aria-hidden="true"></i>
    Sortie du répertoire au coup ${num} : ${fg(escapeHtml(r.exit.played))} — attendu ${exp}
    <span class="pg-rep-mod">(${escapeHtml(r.d.name)})</span>
    <button class="pg-rep-btn" onclick="repCreateExercise('${escapeHtml(String(g.id))}')"
            title="Créer un exercice de cette position (le coup du répertoire à retrouver)">
      <i class="ti ti-puzzle" aria-hidden="true"></i> Créer l'exercice</button>
  </div>`;
}

// « Créer l'exercice » : la position de la sortie devient un exercice flash —
// le coup du répertoire à retrouver. Paquet via buildExercisePacket (la fabrique
// canonique, lib/exercises.js) ; garde anti-doublon par nom.
function repCreateExercise(gameId) {
  const g = (G.savedGames || []).find(x => String(x.id) === String(gameId));
  const r = g && _pgRep(g);
  if (!r?.exit) { toast('⚠ Pas de sortie de répertoire détectée', 'ko'); return; }
  const name = `Sortie de répertoire — ${g.student || (g.white + '–' + g.black)} (${r.d.name})`;
  if (G.drills.some(d => d.name === name)) { toast('⚠ Cet exercice existe déjà (paquet du même nom)', 'ko'); return; }
  const kp = {
    fen: r.exit.fenBefore,
    san: r.exit.expected[0],
    altSans: r.exit.expected.slice(1),
    line: [r.exit.expected[0]],
    comment: `Dans ta partie ${g.white || '?'} – ${g.black || '?'}, ${r.exit.played} a été joué ici. Retrouve le coup du répertoire.`,
  };
  const mod = window.buildExercisePacket?.({ name, kps: [kp], exType: 'Répertoire' });
  if (!mod) { toast('❌ Fabrique d\'exercices indisponible', 'ko'); return; }
  G.drills.push(mod);
  window.save?.();
  window.saveModule?.(mod);
  window.renderDrillList?.();
  renderPartiesTab();
  toast(`✓ Exercice créé : « ${name} » — assigne-le depuis Modules`, 'ok');
}

function _sharedGames() { return (G.savedGames || []).filter(g => g.baseId && g.shared); }

// Badge sidebar « Parties » = nb de parties à annoter (rouge si > 0).
function _updatePartiesBadge() {
  const todo = _sharedGames().filter(g => !g.reviewedAt).length;
  const b = document.getElementById('csnav-count-parties');
  if (!b) return;
  b.textContent = String(todo);
  b.style.display = todo ? '' : 'none';
  b.classList.toggle('new', todo > 0);
}

function pgSearch(v) {
  _pgQuery = (v || '').trim().toLowerCase();
  const el = document.getElementById('pg-groups');
  if (el) el.innerHTML = _pgGroupsHTML();   // re-rendu ciblé : l'input garde le focus
}
function pgFilterStatus(s) { _pgStatus = s || 'all'; renderPartiesTab(); }

// Rangées groupées par élève, filtrées par statut + recherche.
function _pgGroupsHTML() {
  let games = _sharedGames();
  if (_pgStatus === 'todo') games = games.filter(g => !g.reviewedAt);
  if (_pgStatus === 'done') games = games.filter(g => g.reviewedAt);
  if (_pgQuery) games = games.filter(g =>
    [(g.student||''),(g.event||''),(g.white||''),(g.black||'')].some(s => s.toLowerCase().includes(_pgQuery)));
  if (!games.length) return `<div class="pg-empty-note">Aucune partie ne correspond.</div>`;

  const byStu = {};
  games.forEach(g => {
    const k = g.student || 'Élève';
    if (!byStu[k]) byStu[k] = [];
    byStu[k].push(g);
  });
  const groups = Object.entries(byStu).map(([stu, arr]) => ({
    stu, arr: arr.sort((a,b)=>(b.ts||0)-(a.ts||0)),
    todo: arr.filter(g=>!g.reviewedAt).length,
    last: Math.max(...arr.map(g=>g.ts||0)),
  })).sort((a,b) => b.todo - a.todo || b.last - a.last);

  // Une SEULE boîte par élève, des rangées séparées par des filets — pas 7 cartes
  // empilées : en sombre, --surf sur --bg ne rend que 1,12:1, donc l'empilement de
  // cartes ne se lisait pas comme une structure mais comme un aplat. La hiérarchie
  // vient des filets et des poids, jamais d'un écart de surface qui n'existe pas.
  return groups.map(gr => `<div class="pg-stu-sec">
    <div class="pg-stu-head">
      <span class="pg-stu-name">${escapeHtml(gr.stu)}</span>
      <span class="pg-stu-stats">${gr.arr.length} partie${gr.arr.length>1?'s':''}</span>
    </div>
    <div class="pg-list">
    ${gr.arr.map(g => {
      const dt = g.ts ? new Date(g.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) : '';
      // L'élève est déjà le titre du groupe : la rangée ne nomme que l'ADVERSAIRE.
      const me = (gr.stu || '').toLowerCase();
      const adv = (g.white||'').toLowerCase() === me ? (g.black||'?') : (g.white||'?');
      const cote = (g.white||'').toLowerCase() === me ? 'Blancs' : 'Noirs';
      const isNew = (g.ts||0) > _pgSeenTs && !g.reviewedAt;
      // ⚠ UNE seule couleur d'action par rangée. « Annotée » est un travail FINI :
      // il n'appelle rien, donc il se dit en gris avec une coche. Le rouge est
      // réservé à « À annoter », le seul état sur lequel le coach doit agir.
      const statut = g.reviewedAt
        ? `<span class="pg-state pg-state-done" title="Tu l'as annotée"><i class="ti ti-check" aria-hidden="true"></i> Annotée</span>`
        : `<span class="pg-state pg-state-todo">${isNew ? '<span class="pg-new">nouveau</span> ' : ''}À annoter</span>`;
      // La vignette EST la position finale : une liste de parties d'échecs montre
      // des échiquiers. Repli sur la pastille de résultat si le PGN est illisible.
      const fen = _finalFen(g);
      const vignette = fen
        ? `<span class="pg-mini" title="Position finale · ${escapeHtml(g.result||'*')}">${renderStaticBoard(fen, { size: 44 })}</span>`
        : `<span class="game-result" title="Résultat">${g.result||'*'}</span>`;
      return `<div class="pg-row${g.reviewedAt ? '' : ' pg-row-todo'}">
        ${vignette}
        <button class="pg-row-open" onclick="annotateSharedGame('${escapeHtml(String(g.id))}')">
          <span class="pg-row-who">${escapeHtml(adv)}</span>
          <span class="pg-row-meta">${escapeHtml(cote)} · ${escapeHtml(g.event||'—')} · ${dt} · <span class="pg-res-inline">${escapeHtml(g.result||'*')}</span>${g.nature==='analyse'?' · Analyse':''}</span>
        </button>
        ${statut}
        ${_pgRepHTML(g)}
      </div>`;
    }).join('')}
    </div>
  </div>`).join('');
}

function _sharedGamesHTML() {
  const shared = _sharedGames();
  if (!shared.length) return '';
  const todo = shared.filter(g => !g.reviewedAt).length;
  const done = shared.length - todo;
  return `<div class="pg-wrap">
    <div class="pg-toolbar">
      <span class="pg-count"><i class="ti ti-inbox" aria-hidden="true"></i> <b>${shared.length}</b> partie${shared.length>1?'s':''} reçue${shared.length>1?'s':''}${todo?` · <b class="pg-todo-count">${todo} à annoter</b>`:' · tout est annoté ✓'}</span>
      <div class="pg-chips">
        <button class="mod-folder-chip${_pgStatus==='todo'?' on':''}" onclick="pgFilterStatus('todo')">À annoter <span class="mod-chip-n">${todo}</span></button>
        <button class="mod-folder-chip${_pgStatus==='done'?' on':''}" onclick="pgFilterStatus('done')">Annotées <span class="mod-chip-n">${done}</span></button>
        <button class="mod-folder-chip${_pgStatus==='all'?' on':''}" onclick="pgFilterStatus('all')">Toutes <span class="mod-chip-n">${shared.length}</span></button>
      </div>
      <div class="eleve-search mod-search pg-search">
        <i class="ti ti-search" aria-hidden="true"></i>
        <input type="search" placeholder="Élève, tournoi, joueur…" autocomplete="off" value="${escapeHtml(_pgQuery)}"
               aria-label="Rechercher une partie" oninput="pgSearch(this.value)">
      </div>
    </div>
    <div id="pg-groups">${_pgGroupsHTML()}</div>
  </div>`;
}

// Ouvre une partie partagée en LECTURE d'abord (grand échiquier + Référence) ;
// le bouton « Annoter » y bascule vers l'éditeur (grill 29/07). Le nom historique
// est gardé : il est câblé dans ~6 onclick + coach-student-page.
function annotateSharedGame(id) {
  const g = (G.savedGames || []).find(x => String(x.id) === String(id));
  if (!g) { toast('⚠ Partie introuvable','ko'); return; }
  // Un seul écran (03/08) : l'éditeur ancré en densité lecture — les annotations
  // sont visibles en lisant, ✎ révèle les outils. Fini la pop-up par-dessus.
  // ⚠ L'écran vit DANS la section Parties : appelée depuis ailleurs (Vue d'ensemble,
  // page profil élève), il faut d'abord la rendre VISIBLE — sinon il s'ouvre dans une
  // section masquée et « rien ne se passe » (audit 03/08). _csecShow et PAS
  // switchCoachSection : son pipeline re-rend la liste en asynchrone
  // (loadTeacherGames().then(renderPartiesTab)) et refermerait l'écran.
  window._csecShow?.('parties');
  window.openGameDocked?.(g.pgn || '', { gameId: g.id, role: 'coach', white: g.white, black: g.black, side: g.side });
}

function renderPartiesTab() {
  const el = document.getElementById('prof-parties-content');
  // (Re)rendre la section = revenir a la LISTE : l'ecran de lecture est un drill-down
  // qui la masque. Sans ce reset, revenir sur Parties garderait la lecture. Et si
  // l'editeur est ANCRE dans la section, le restituer a <body> — sinon le prochain
  // editeur de module s'ouvrirait invisible, dans un hote masque.
  if (window._E?.docked) window.closeEditorModal?.();
  const gv = document.getElementById('pg-gameview'); if (gv) gv.style.display = 'none';
  const hd = document.querySelector('#csec-parties .cs-header'); if (hd) hd.style.display = '';
  if (el) el.style.display = '';
  // Marqueur « nouveau » : parties arrivées depuis la DERNIÈRE visite de cette page.
  // On capture le repère avant de le mettre à jour (les nouveautés du rendu courant
  // restent marquées ; elles ne le seront plus à la prochaine visite).
  _pgSeenTs = +localStorage.getItem('mc_coach_games_seen') || 0;
  const sharedHTML = _sharedGamesHTML();
  if (!sharedHTML) {
    el.innerHTML='<div class="empty" style="padding:40px"><div class="empty-ico"><i class="ti ti-chess" aria-hidden="true"></i></div>Aucune partie partagée pour l\'instant.<br><span style="font-size:.8rem">Une partie apparaîtra ici dès qu\'un élève vous en partage une depuis sa bibliothèque.</span></div>';
    _updatePartiesBadge();
    return;
  }
  el.innerHTML = sharedHTML;
  _updatePartiesBadge();
  localStorage.setItem('mc_coach_games_seen', String(Date.now()));
  // Assistant faiblesses : lance l'analyse des parties pas encore passées au
  // moteur (ré-entrant, no-op si tout est analysé). Couvre aussi le dev local,
  // où _coachLoad (l'autre déclencheur) ne tourne pas (sb=null).
  window.startWeaknessQueue?.();
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/library.js.
Object.assign(window, {
  renderPartiesTab, annotateSharedGame, repCreateExercise,
  pgSearch, pgFilterStatus, _updatePartiesBadge,
  _pgRepOf: _pgRep,   // sortie de répertoire mémoïsée (consommée par game-view + page profil)
});
