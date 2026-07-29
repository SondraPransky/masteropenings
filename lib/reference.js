// ══════════════════════════════════════════════════════
// lib/reference.js — FONCTION « RÉFÉRENCE » (façon ChessBase)
//
// Pour une position, montre les coups les plus joués + le score Blancs/Nulle/Noirs
// et une liste de parties de référence. Source : l'explorateur Lichess base MAÎTRES
// (`explorer.lichess.ovh/masters`) — parties OTB de forts joueurs.
// Arbitrages du grill (29/07) : Maîtres seulement, clic sur un coup = il se joue.
//
// ⚠ L'appel DIRECT depuis le navigateur renvoie 401 (Lichess bloque l'endpoint par
// quota/IP). On passe donc par un PROXY Edge Function Supabase (`lichess-ref`) qui
// ajoute le token Lichess côté serveur — le token ne peut pas vivre dans ce code
// public (fuite). Voir supabase/functions/lichess-ref/index.ts pour le déploiement.
// Repli gracieux inchangé : si l'appel échoue, le panneau affiche « base
// indisponible » et le reste de l'app fonctionne.
//
// Composant unique, réutilisé par l'éditeur (création de module) et la lecture d'une
// partie d'élève. `renderReferencePanel({hostId, fen, onMove})` : montre un état de
// chargement, va chercher les données, rend le panneau ; un clic sur un coup appelle
// `onMove(san)` — le CALLER décide (ajouter au répertoire, ou explorer la partie).
// ══════════════════════════════════════════════════════
import { fig, pgnMainlineSans } from './core.js';
import { renderStaticBoard } from './miniboard.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-client.js';
// escapeHtml vit dans app.js (pont window) — shim local, patron coach-core.
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

// Proxy serveur (le token Lichess y est ajouté). La clé publishable part en apikey :
// elle est publique (protégée par RLS), et la fonction est déployée --no-verify-jwt.
const REF_BASE = `${SUPABASE_URL}/functions/v1/lichess-ref`;
const _refCache = new Map();     // fen normalisé → data | 'error'
let _refToken = 0;               // anti-course : seul le dernier rendu s'affiche
let _refOnMove = null;           // callback du panneau courant (clic sur un coup)
// ── Visionneuse d'une partie de référence, EN PLACE dans le panneau (pas de pop-up) ──
let _refOnInsert = null;         // callback « insérer en citation » (fourni par l'éditeur seulement)
let _refHostId   = null;         // id de l'hôte du panneau courant
let _refFen      = null;         // FEN de la position courante (la partie passe par là)
let _refFlip     = false;        // orientation de l'échiquier de la visionneuse
let _refData     = null;         // dernières données (pour revenir à la liste sans re-fetch)
let _refView     = null;         // { id, sans, fens, startIdx, cutIdx, cite }
const _refGameCache = new Map(); // id partie → pgn | 'error'

// Clé de cache = le FEN tronqué aux 4 premiers champs (position + trait + roques +
// e.p.), les compteurs de coups ne changent pas la stat d'ouverture.
function _refKey(fen) { return String(fen || '').split(' ').slice(0, 4).join(' '); }

async function _refGet(fen) {
  const key = _refKey(fen);
  if (_refCache.has(key)) return _refCache.get(key);
  try {
    const r = await fetch(`${REF_BASE}?fen=${encodeURIComponent(fen)}&topGames=6&moves=12`,
      { headers: { Accept: 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    // Le proxy peut relayer une erreur Lichess en corps JSON avec un 2xx improbable :
    // si `moves` manque, on traite comme indisponible (repli gracieux).
    if (!j || j.error) throw new Error('proxy error');
    _refCache.set(key, j);
    return j;
  } catch (e) {
    _refCache.set(key, 'error');
    return 'error';
  }
}

function _pct(n, total) { return total ? Math.round(n / total * 100) : 0; }

// Barre Blancs / Nulle / Noirs (du point de vue des Blancs) — couleurs conventionnelles
// d'échecs, lisibles sur les 2 thèmes (ce sont des DONNÉES, pas des tokens d'UI).
function _wdlBar(w, d, b) {
  const t = w + d + b; if (!t) return '';
  const pw = _pct(w, t), pd = _pct(d, t), pb = 100 - pw - pd;
  return `<div class="ref-wdl" role="img" aria-label="Blancs ${pw}%, nulles ${pd}%, Noirs ${pb}%">
    <span class="ref-wdl-w" style="width:${pw}%">${pw >= 12 ? pw : ''}</span>
    <span class="ref-wdl-d" style="width:${pd}%">${pd >= 12 ? pd : ''}</span>
    <span class="ref-wdl-b" style="width:${pb}%">${pb >= 12 ? pb : ''}</span>
  </div>`;
}

const _refResult = w => w === 'white' ? '1-0' : w === 'black' ? '0-1' : '½-½';
// Citation texte d'une partie de référence (joueurs, année, résultat).
function _refCite(g) {
  const wn = g.white?.name || '?', bn = g.black?.name || '?';
  return `${wn} – ${bn}${g.year ? ', ' + g.year : ''} · ${_refResult(g.winner)}`;
}

function _gamesHTML(topGames) {
  if (!topGames || !topGames.length) return '';
  const rows = topGames.map(g => {
    const wn = g.white?.name || '?', bn = g.black?.name || '?';
    const inner = `<span class="ref-game-players">${escapeHtml(wn)} – ${escapeHtml(bn)}</span>
      <span class="ref-game-meta">${g.year || ''} · ${_refResult(g.winner)}</span>`;
    // Clic = ouvre la partie EN PLACE dans le panneau (plus de lien vers Lichess).
    return g.id
      ? `<button type="button" class="ref-game" onclick="_refClickGame('${escapeHtml(g.id)}')" title="Voir la partie ici">${inner}</button>`
      : `<div class="ref-game">${inner}</div>`;
  }).join('');
  return `<div class="ref-games-head">Parties de référence</div><div class="ref-games">${rows}</div>`;
}

function _panelHTML(data) {
  if (data === 'error') {
    return `<div class="ref-msg"><i class="ti ti-cloud-off" aria-hidden="true"></i> Base de référence indisponible.</div>`;
  }
  const total = (data.white || 0) + (data.draws || 0) + (data.black || 0);
  const opening = data.opening ? `${data.opening.eco ? data.opening.eco + ' · ' : ''}${data.opening.name}` : 'Hors répertoire connu';
  if (!data.moves || !data.moves.length) {
    return `<div class="ref-head"><div class="ref-head-title"><i class="ti ti-books" aria-hidden="true"></i> Référence — Maîtres</div>
      <div class="ref-head-sub">${escapeHtml(opening)}${total ? ` · ${total.toLocaleString('fr-FR')} parties` : ''}</div></div>
      <div class="ref-msg"><i class="ti ti-info-circle" aria-hidden="true"></i> Aucune partie de maître ne va au-delà d'ici.</div>`;
  }
  const rows = data.moves.map(m => {
    const g = (m.white || 0) + (m.draws || 0) + (m.black || 0);
    const share = _pct(g, total);
    return `<button type="button" class="ref-move" onclick="_refClickMove('${escapeHtml(m.san)}')" title="Jouer ${escapeHtml(m.san)}">
      <div class="ref-move-top">
        <span class="mono-move">${fig(escapeHtml(m.san))}</span>
        <span class="ref-move-n">${g.toLocaleString('fr-FR')} · ${share}%</span>
      </div>
      ${_wdlBar(m.white || 0, m.draws || 0, m.black || 0)}
    </button>`;
  }).join('');
  return `<div class="ref-head">
      <div class="ref-head-title"><i class="ti ti-books" aria-hidden="true"></i> Référence — Maîtres</div>
      <div class="ref-head-sub">${escapeHtml(opening)} · ${total.toLocaleString('fr-FR')} parties</div>
    </div>
    <div class="ref-moves">${rows}</div>
    ${_gamesHTML(data.topGames)}
    <div class="ref-foot"><i class="ti ti-info-circle" aria-hidden="true"></i> Clique un coup pour l'avancer sur l'échiquier</div>`;
}

// Point d'entrée : rend le panneau dans `hostId` pour la position `fen`.
// `onMove(san)` = clic sur un coup Maîtres. `onInsert(sans[], cite)` = « insérer en
// citation » depuis la visionneuse (fourni SEULEMENT par l'éditeur ; absent en lecture
// d'une partie d'élève). `flip` oriente l'échiquier de la visionneuse.
// Idempotent et anti-course (un changement rapide de position n'affiche jamais un périmé).
async function renderReferencePanel({ hostId, fen, onMove, onInsert, flip }) {
  const host = document.getElementById(hostId);
  if (!host) return;
  _refOnMove = onMove || null;
  _refOnInsert = onInsert || null;
  _refHostId = hostId;
  _refFen = fen;
  _refFlip = !!flip;
  _refView = null;                     // toute nouvelle position ferme la visionneuse
  const myToken = ++_refToken;
  const cached = _refCache.get(_refKey(fen));
  if (cached === undefined) {
    host.innerHTML = `<div class="ref-msg"><i class="ti ti-loader-2 ref-spin" aria-hidden="true"></i> Recherche dans la base…</div>`;
  }
  const data = await _refGet(fen);
  if (myToken !== _refToken) return;   // une position plus récente a été demandée
  _refData = data;
  host.innerHTML = _panelHTML(data);
}

function _refClickMove(san) { _refOnMove?.(san); }

// ── Visionneuse d'une partie de référence (en place, pas de pop-up) ─────────────
// Récupère le PGN de la partie : direct d'abord (API principale lichess.org, CORS
// ouvert, éprouvée par l'import Lichess P1), repli proxy `?game=` si l'IP est bloquée.
async function _refFetchGame(id) {
  if (_refGameCache.has(id)) return _refGameCache.get(id);
  let pgn = null;
  try {
    const r = await fetch(`https://lichess.org/game/export/${encodeURIComponent(id)}?moves=true&tags=true&clocks=false&evals=false`,
      { headers: { Accept: 'application/x-chess-pgn' } });
    if (r.ok) pgn = await r.text();
  } catch (e) {}
  if (!pgn || !pgn.trim()) {
    try {
      const r = await fetch(`${REF_BASE}?game=${encodeURIComponent(id)}`,
        { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` } });
      if (r.ok) { const t = await r.text(); if (t && t.trim() && !/^\s*\{"error/.test(t)) pgn = t; }
    } catch (e) {}
  }
  const val = (pgn && pgn.trim()) ? pgn : 'error';
  _refGameCache.set(id, val);
  return val;
}

async function _refClickGame(id) {
  const host = document.getElementById(_refHostId); if (!host) return;
  const g = _refData?.topGames?.find(x => x.id === id);
  host.innerHTML = `<div class="ref-msg"><i class="ti ti-loader-2 ref-spin" aria-hidden="true"></i> Chargement de la partie…</div>`;
  const pgn = await _refFetchGame(id);
  if (pgn === 'error') {
    host.innerHTML = `<div class="ref-view-head"><button type="button" class="ref-back" onclick="_refBackToList()"><i class="ti ti-arrow-left" aria-hidden="true"></i> retour</button></div>
      <div class="ref-msg"><i class="ti ti-cloud-off" aria-hidden="true"></i> Partie indisponible.</div>`;
    return;
  }
  const chess = new Chess();
  const fens = [chess.fen()], sans = [];
  for (const s of pgnMainlineSans(pgn)) { const mv = chess.move(s, { sloppy: true }); if (!mv) break; sans.push(mv.san); fens.push(chess.fen()); }
  // La partie passe par la position courante (c'est une référence POUR cette position).
  const key = f => String(f).split(' ').slice(0, 4).join(' ');
  const cur = key(_refFen || '');
  let startIdx = fens.findIndex(f => key(f) === cur);
  if (startIdx < 0) startIdx = 0;                    // repli : toute la partie
  _refView = { id, sans, fens, startIdx, cutIdx: sans.length, cite: g ? _refCite(g) : '' };
  _refRenderViewer();
}

function _refRenderViewer() {
  const host = document.getElementById(_refHostId); if (!host || !_refView) return;
  const v = _refView;
  const board = renderStaticBoard(v.fens[v.cutIdx], { size: 190, flip: _refFlip });
  let moves = '';
  for (let i = v.startIdx; i < v.sans.length; i++) {
    const parts = v.fens[i].split(' ');
    const white = parts[1] === 'w';
    const num = white ? `<span class="ref-vm-num">${parts[5]}.</span>`
              : (i === v.startIdx ? `<span class="ref-vm-num">${parts[5]}…</span>` : '');
    const incl = (i < v.cutIdx) ? ' inc' : '';
    moves += `${num}<button type="button" class="ref-vm${incl}" onclick="_refSetCut(${i + 1})">${fig(escapeHtml(v.sans[i]))}</button> `;
  }
  const nInc = v.cutIdx - v.startIdx;
  host.innerHTML = `
    <div class="ref-view-head">
      <button type="button" class="ref-back" onclick="_refBackToList()"><i class="ti ti-arrow-left" aria-hidden="true"></i> retour à la référence</button>
    </div>
    ${v.cite ? `<div class="ref-view-cite">${escapeHtml(v.cite)}</div>` : ''}
    <div class="ref-view-board">${board}</div>
    <div class="ref-view-hint">Clique un coup pour choisir jusqu'où couper.</div>
    <div class="ref-view-moves">${moves || '<span class="ref-none">La partie s\'arrête à cette position.</span>'}</div>
    ${_refOnInsert ? `<button type="button" class="btn btn-primary btn-sm ref-insert" onclick="_refInsertUpToCut()"${nInc ? '' : ' disabled'}><i class="ti ti-download" aria-hidden="true"></i> Insérer ${nInc} coup${nInc > 1 ? 's' : ''} en citation</button>` : ''}`;
}

function _refSetCut(idx) {
  if (!_refView) return;
  _refView.cutIdx = Math.max(_refView.startIdx, Math.min(idx, _refView.sans.length));
  _refRenderViewer();
}

function _refInsertUpToCut() {
  if (!_refView || !_refOnInsert) return;
  const seg = _refView.sans.slice(_refView.startIdx, _refView.cutIdx);
  if (!seg.length) { window.toast?.('⚠ Choisis au moins un coup à insérer', 'ko'); return; }
  _refOnInsert(seg, _refView.cite);
  _refBackToList();
}

function _refBackToList() {
  _refView = null;
  const host = document.getElementById(_refHostId);
  if (host && _refData) host.innerHTML = _panelHTML(_refData);
}

Object.assign(window, {
  renderReferencePanel, _refClickMove,
  _refClickGame, _refSetCut, _refInsertUpToCut, _refBackToList,
});
export { renderReferencePanel };
