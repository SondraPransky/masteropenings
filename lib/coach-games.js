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

let _pgQuery = '', _pgStatus = 'all', _pgSeenTs = 0;

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
  const num = r.exit.moveNo + (r.exit.color === 'b' ? '…' : '.');
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

  return groups.map(gr => `<div class="pg-stu-sec">
    <div class="pg-stu-head">
      <span class="pg-stu-name"><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(gr.stu)}</span>
      <span class="pg-stu-stats">${gr.arr.length} partie${gr.arr.length>1?'s':''}${gr.todo?` · <b class="pg-todo-count">${gr.todo} à annoter</b>`:''}</span>
    </div>
    ${gr.arr.map(g => {
      const dt = g.ts ? new Date(g.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) : '';
      const who = (g.white||'?') + ' – ' + (g.black||'?');
      const isNew = (g.ts||0) > _pgSeenTs && !g.reviewedAt;
      const badge = g.reviewedAt
        ? `<span class="pg-annotated" title="Annotée par toi"><i class="ti ti-sparkles" aria-hidden="true"></i> Annotée</span>`
        : isNew ? `<span class="pg-new">nouveau</span>` : '';
      return `<div class="game-row">
        <div class="game-row-main">
          <div class="game-row-l">
            <span class="game-result ${g.result==='1-0'?'win':g.result==='0-1'?'loss':'draw'}">${g.result||'*'}</span>
            <div class="game-row-info">
              <div class="game-row-who">${escapeHtml(who)} ${badge}</div>
              <div class="game-row-meta"><i class="ti ti-trophy" aria-hidden="true"></i> ${escapeHtml(g.event||'—')} · ${dt}${g.nature==='analyse'?' · <i class="ti ti-notes" aria-hidden="true"></i> Analyse':''}</div>
            </div>
          </div>
          <button class="btn ${g.reviewedAt?'btn-ghost':'btn-primary'} btn-sm" onclick="annotateSharedGame('${escapeHtml(String(g.id))}')"><i class="ti ${g.reviewedAt?'ti-book':'ti-eye'}" aria-hidden="true"></i> ${g.reviewedAt?'Revoir la revue':'Voir la partie'}</button>
        </div>
        ${_pgRepHTML(g)}
      </div>`;
    }).join('')}
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
  window.openGameView?.(g.pgn || '', { gameId: g.id, role: 'coach', white: g.white, black: g.black, side: g.side });
}

function renderPartiesTab() {
  const el = document.getElementById('prof-parties-content');
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
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/library.js.
Object.assign(window, {
  renderPartiesTab, annotateSharedGame, repCreateExercise,
  pgSearch, pgFilterStatus, _updatePartiesBadge,
});
