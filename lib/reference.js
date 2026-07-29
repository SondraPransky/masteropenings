// ══════════════════════════════════════════════════════
// lib/reference.js — FONCTION « RÉFÉRENCE » (façon ChessBase)
//
// Pour une position, montre les coups les plus joués + le score Blancs/Nulle/Noirs
// et une liste de parties de référence. Source : l'explorateur Lichess base MAÎTRES
// (`explorer.lichess.ovh/masters`) — parties OTB de forts joueurs, en DIRECT depuis
// le navigateur (gratuit, sans clé). Arbitrages du grill (29/07) : Maîtres seulement,
// clic sur un coup = il se joue sur l'échiquier.
//
// ⚠ CORS ouvert (Lichess sert son propre site + de nombreux tiers). Depuis un ENV
// datacenter l'endpoint peut répondre 401 (blocage d'IP) — donc à VÉRIFIER sur le
// site déployé, pas en preview locale. Repli gracieux : si l'appel échoue, le
// panneau affiche « base indisponible » et le reste de l'app fonctionne.
//
// Composant unique, réutilisé par l'éditeur (création de module) et la lecture d'une
// partie d'élève. `renderReferencePanel({hostId, fen, onMove})` : montre un état de
// chargement, va chercher les données, rend le panneau ; un clic sur un coup appelle
// `onMove(san)` — le CALLER décide (ajouter au répertoire, ou explorer la partie).
// ══════════════════════════════════════════════════════
import { fig } from './core.js';
// escapeHtml vit dans app.js (pont window) — shim local, patron coach-core.
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

const REF_BASE = 'https://explorer.lichess.ovh/masters';
const _refCache = new Map();     // fen normalisé → data | 'error'
let _refToken = 0;               // anti-course : seul le dernier rendu s'affiche
let _refOnMove = null;           // callback du panneau courant (clic sur un coup)

// Clé de cache = le FEN tronqué aux 4 premiers champs (position + trait + roques +
// e.p.), les compteurs de coups ne changent pas la stat d'ouverture.
function _refKey(fen) { return String(fen || '').split(' ').slice(0, 4).join(' '); }

async function _refGet(fen) {
  const key = _refKey(fen);
  if (_refCache.has(key)) return _refCache.get(key);
  try {
    const r = await fetch(`${REF_BASE}?fen=${encodeURIComponent(fen)}&topGames=6&moves=12`,
      { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
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

function _gamesHTML(topGames) {
  if (!topGames || !topGames.length) return '';
  const dot = w => w === 'white' ? '1–0' : w === 'black' ? '0–1' : '½–½';
  const rows = topGames.map(g => {
    const wn = g.white?.name || '?', bn = g.black?.name || '?';
    const url = g.id ? `https://lichess.org/${escapeHtml(g.id)}` : '';
    const inner = `<span class="ref-game-players">${escapeHtml(wn)} – ${escapeHtml(bn)}</span>
      <span class="ref-game-meta">${g.year || ''} · ${dot(g.winner)}</span>`;
    return url
      ? `<a class="ref-game" href="${url}" target="_blank" rel="noopener">${inner}</a>`
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
// `onMove(san)` est appelé au clic sur un coup. Idempotent et anti-course (un
// changement rapide de position n'affiche jamais un résultat périmé).
async function renderReferencePanel({ hostId, fen, onMove }) {
  const host = document.getElementById(hostId);
  if (!host) return;
  _refOnMove = onMove || null;
  const myToken = ++_refToken;
  const cached = _refCache.get(_refKey(fen));
  if (cached === undefined) {
    host.innerHTML = `<div class="ref-msg"><i class="ti ti-loader-2 ref-spin" aria-hidden="true"></i> Recherche dans la base…</div>`;
  }
  const data = await _refGet(fen);
  if (myToken !== _refToken) return;   // une position plus récente a été demandée
  host.innerHTML = _panelHTML(data);
}

function _refClickMove(san) { _refOnMove?.(san); }

Object.assign(window, { renderReferencePanel, _refClickMove });
export { renderReferencePanel };
