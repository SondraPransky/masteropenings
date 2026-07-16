// ══════════════════════════════════════════════════════
// lib/coach-games.js — PARTIES PARTAGÉES : dashboard coach (« qu'est-ce que Tom
// m'a envoyé ? ») + parties d'entraînement vs Maia (repliées).
// État local : _pgQuery / _pgStatus / _pgSeenTs (ils ne sortent pas d'ici).
// Socle → coach-core.js ; appels latéraux → pont window (openReviewEditor, exportPGN).
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { toast, escapeHtml } from './coach-core.js';

let _pgQuery = '', _pgStatus = 'all', _pgSeenTs = 0;

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
  if (!games.length) return `<div style="color:var(--dim);font-size:.82rem;padding:18px 4px">Aucune partie ne correspond.</div>`;

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
      <span class="pg-stu-stats">${gr.arr.length} partie${gr.arr.length>1?'s':''}${gr.todo?` · <b style="color:var(--red)">${gr.todo} à annoter</b>`:''}</span>
    </div>
    ${gr.arr.map(g => {
      const dt = g.ts ? new Date(g.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) : '';
      const who = (g.white||'?') + ' – ' + (g.black||'?');
      const isNew = (g.ts||0) > _pgSeenTs && !g.reviewedAt;
      const badge = g.reviewedAt
        ? `<span class="pg-annotated" title="Annotée par toi"><i class="ti ti-sparkles" aria-hidden="true"></i> Annotée</span>`
        : isNew ? `<span class="pg-new">nouveau</span>` : '';
      return `<div class="game-row">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <span class="game-result ${g.result==='1-0'?'win':g.result==='0-1'?'loss':'draw'}">${g.result||'*'}</span>
            <div style="min-width:0">
              <div style="font-weight:600;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(who)} ${badge}</div>
              <div style="font-size:.72rem;color:var(--dim)"><i class="ti ti-trophy" aria-hidden="true"></i> ${escapeHtml(g.event||'—')} · ${dt}${g.nature==='analyse'?' · <i class="ti ti-notes" aria-hidden="true"></i> Analyse':''}</div>
            </div>
          </div>
          <button class="btn ${g.reviewedAt?'btn-ghost':'btn-primary'} btn-sm" onclick="annotateSharedGame('${escapeHtml(String(g.id))}')"><i class="ti ${g.reviewedAt?'ti-book':'ti-school'}" aria-hidden="true"></i> ${g.reviewedAt?'Revoir la revue':'Annoter'}</button>
        </div>
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
      <span class="pg-count"><i class="ti ti-inbox" aria-hidden="true"></i> <b>${shared.length}</b> partie${shared.length>1?'s':''} reçue${shared.length>1?'s':''}${todo?` · <b style="color:var(--red)">${todo} à annoter</b>`:' · tout est annoté ✓'}</span>
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

// Ouvre une partie partagée dans l'éditeur en mode revue coach (P1.4).
function annotateSharedGame(id) {
  const g = (G.savedGames || []).find(x => String(x.id) === String(id));
  if (!g) { toast('⚠ Partie introuvable','ko'); return; }
  window.openReviewEditor?.(g.pgn || '', { gameId: g.id, role: 'coach', white: g.white, black: g.black });
}

function renderPartiesTab() {
  const el = document.getElementById('prof-parties-content');
  // Marqueur « nouveau » : parties arrivées depuis la DERNIÈRE visite de cette page.
  // On capture le repère avant de le mettre à jour (les nouveautés du rendu courant
  // restent marquées ; elles ne le seront plus à la prochaine visite).
  _pgSeenTs = +localStorage.getItem('mc_coach_games_seen') || 0;
  const partiesFilter = (document.getElementById('parties-drill-filter') || document.getElementById('prof-drill-filter'))?.value || 'all';
  const sharedHTML = _sharedGamesHTML();
  // Parties Maia uniquement (les entrées bibliothèque ont un baseId → traitées ci-dessus)
  const maia = (G.savedGames || []).filter(g => !g.baseId);
  const games = partiesFilter==='all' ? maia : maia.filter(g=>String(g.drillId)===partiesFilter);
  if (!games.length && !sharedHTML) {
    el.innerHTML='<div class="empty" style="padding:40px"><div class="empty-ico"><i class="ti ti-chess" aria-hidden="true"></i></div>Aucune partie enregistrée</div>';
    _updatePartiesBadge();
    return;
  }
  const sorted = [...games].sort((a,b)=>b.ts-a.ts);
  // Parties Maia = historique d'entraînement, pas du travail à faire → repliées.
  const maiaHTML = !games.length ? '' : `<details class="pg-maia">
    <summary><i class="ti ti-robot" aria-hidden="true"></i> Parties d'entraînement vs Maia <span style="color:var(--dim);font-weight:400">(${games.length})</span></summary>
    ${sorted.map((g,i)=>{
    const resClass = g.result==='1-0'?(g.side==='w'?'win':'loss'):g.result==='0-1'?(g.side==='b'?'win':'loss'):'draw';
    const dt = new Date(g.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});
    const side = g.side==='w'?'♔ Blancs':g.side==='b'?'♚ Noirs':'⇄';
    return `<div class="game-row" onclick="togglePGN(${i})">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="game-result ${resClass}">${g.result}</span>
          <div>
            <div style="font-weight:600;font-size:.85rem"><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(g.student)} — ${escapeHtml(g.drillName)}</div>
            <div style="font-size:.72rem;color:var(--dim)">${side} · ${g.level} · ${dt}</div>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();exportPGN(${i})"><i class="ti ti-download" aria-hidden="true"></i> PGN</button>
      </div>
      <div id="pgn-view-${i}" style="display:none;margin-top:10px;padding:10px;background:var(--bg);border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:.7rem;line-height:1.7;color:var(--dim);white-space:pre-wrap;word-break:break-all">${escapeHtml(g.pgn)}</div>
    </div>`;
  }).join('')}
  </details>`;
  el.innerHTML = sharedHTML + maiaHTML;
  _updatePartiesBadge();
  localStorage.setItem('mc_coach_games_seen', String(Date.now()));
}

function togglePGN(i) {
  const el = document.getElementById(`pgn-view-${i}`);
  if (el) el.style.display = el.style.display==='none' ? 'block' : 'none';
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/library.js.
Object.assign(window, {
  renderPartiesTab, togglePGN, annotateSharedGame,
  pgSearch, pgFilterStatus, _updatePartiesBadge,
});
