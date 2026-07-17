// ══════════════════════════════════════════════════════
// VUE COACH — Explorateur : SOCLE partagé (patron `CS`/coach-core).
//
// L'explorateur est gros (échiquier + orchestrateur + solveur + tableau +
// dialogue d'export). Ce socle porte ce qui traverse plusieurs de ses modules :
// l'URL du pont, l'état partagé `EX` (muté, jamais réassigné — un binding importé
// est en lecture seule, cf. la règle du CLAUDE.md), et les helpers PURS que le
// core-consumer ET le dialogue d'export dupliquaient mot pour mot (niveaux FIDE,
// application d'un coup UCI).
//
// RÈGLE (identique à coach-core) : ce fichier n'importe rien de ses frères
// `coach-explorer*` → le graphe reste acyclique. `escapeHtml` vient de coach-core.
// ══════════════════════════════════════════════════════
import { escapeHtml } from './coach-core.js';

export const ODP_BRIDGE_URL = 'http://localhost:8127';

// État partagé de l'explorateur (lu par le dialogue d'export). MUTÉ en place,
// jamais réassigné. `posParam` est une référence de fonction posée par le
// core-consumer à l'init (elle lit sa position d'exploration courante).
export const EX = {
  nfen: null,          // FEN normalisée de la dernière position explorée (/context)
  levels: ['all'],     // niveaux élève FIDE sélectionnés dans le tableau
  levelDefs: [],       // définitions des pastilles (servi par /levels)
  posParam: () => '',  // → 'moves=…' | 'fen=…' de la position courante
};

// Applique un coup UCI (« e2e4 », « e7e8q ») sur une partie chess.js.
// Renvoie l'objet coup, ou null si illégal. Remplace l'idiome
// g.move({from:uci.slice(0,2), to:uci.slice(2,4), promotion:uci[4]}) répété ~8×.
export function playUci(game, uci) {
  return game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

// Bascule d'un niveau FIDE (même règle que toggle_level, otkb/ui/levels.py :
// « Tous » est exclusif ; sélection re-triée dans l'ordre des définitions).
// PURE : renvoie le nouveau tableau, ne mute rien.
export function toggleLevel(current, key, defs) {
  if (key === 'all') return ['all'];
  const sel = current.filter(k => k !== 'all' && k !== key);
  if (!current.includes(key)) sel.push(key);
  const order = defs.map(l => l.key);
  sel.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return sel.length ? sel : ['all'];
}

// Pastilles de niveaux (le tableau ET le dialogue d'export les rendaient à
// l'identique, ne différant que par le handler onclick).
export function levelChipsHTML(defs, selected, handler) {
  return defs.map(lv =>
    `<button type="button" class="exp-levelchip${selected.includes(lv.key) ? ' on' : ''}"
      title="${escapeHtml(lv.label)}" onclick="${handler}('${escapeHtml(lv.key)}')">${escapeHtml(lv.short)}</button>`
  ).join('');
}
