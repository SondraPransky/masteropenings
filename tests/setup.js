// En navigateur, `Chess` est un global fourni par le CDN chess.js.
// Côté Node (tests), on l'injecte de la même façon pour que lib/core.js
// (extractAllLines / normalizeSAN) fonctionne à l'identique.
import pkg from 'chess.js';
globalThis.Chess = pkg.Chess || pkg;
