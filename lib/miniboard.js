// ══════════════════════════════════════════════════════
// MINIBOARD — échiquier DOM statique (lecture seule) + palette partagée.
// Extrait de exercises.js (`_exMiniBoard`) pour réutilisation et pour donner
// UNE source aux couleurs de cases. NB : board.js (canvas) et les éditeurs
// interactifs (setup/editor) gardent leur propre rendu — leur logique par case
// diffère ; seules les COULEURS pourraient se partager (non fait ici : zones
// critiques). Pièces via window.PIECE_CDN (fallback CDN géré à l'affichage).
// ══════════════════════════════════════════════════════

// Palette cburnett : cases claires / sombres + surbrillances sélection / coup.
export const BOARD_LIGHT = '#f0d9b5';
export const BOARD_DARK  = '#b58863';
export const BOARD_SEL   = '#7dd3fc';   // case sélectionnée
export const BOARD_MOVE  = '#bbf7d0';   // case from/to du dernier coup

// Rend un mini-échiquier statique (lecture seule) depuis un FEN — placement
// uniquement, vue des Blancs. `size` = côté en px. Renvoie une chaîne HTML.
export function renderStaticBoard(fen, { size = 92 } = {}) {
  const rows = ((fen || '').trim().split(/\s+/)[0] || '').split('/');
  let cells = '';
  for (let i = 0; i < 8; i++) {
    const row = [];
    for (const ch of (rows[i] || '8')) {
      if (/\d/.test(ch)) { for (let k = 0; k < +ch; k++) row.push(null); }
      else row.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
    }
    while (row.length < 8) row.push(null);
    row.forEach((p, f) => {
      const bg = (i + f) % 2 === 0 ? BOARD_LIGHT : BOARD_DARK;
      const pc = p ? `<img src="${window.PIECE_CDN}${p}.svg" draggable="false" style="width:90%;height:90%">` : '';
      cells += `<div style="background:${bg};display:flex;align-items:center;justify-content:center">${pc}</div>`;
    });
  }
  return `<div style="display:grid;grid-template-columns:repeat(8,1fr);width:${size}px;height:${size}px;flex:0 0 ${size}px;border-radius:6px;overflow:hidden;border:1px solid var(--border)">${cells}</div>`;
}
