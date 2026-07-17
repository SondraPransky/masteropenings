// ══════════════════════════════════════════════════════
// VUE COACH — point d'entrée (barrel). Extrait d'app.js (§5.3), puis découpé en
// 8 modules de page + un socle (juillet 2026) : le fichier avait atteint 1236 lignes.
//
//   coach-core.js       socle : helpers purs + état partagé `CS` (patron `S`)
//   coach-overview.js   Vue d'ensemble (atterrissage prescriptif)
//   coach-students.js   Page Élèves : recherche + LISTE des élèves (drill-down)
//   coach-student-page.js  Page profil d'UN élève (vue exhaustive)
//   coach-weakspots.js  Page Points faibles : cartes-modules → table + tooltip
//   coach-assign.js     Assignation ciblée (2 chemins) + undo
//   coach-classes.js    Page Classes : liste → détail d'une classe
//   coach-games.js      Parties partagées + parties Maia
//   coach-export.js     Exports CSV / PGN / JSON
//   coach-explorer-core.js   Explorateur OTKB : socle (état partagé `EX` + helpers purs)
//   coach-explorer.js        Explorateur OTKB : échiquier + orchestrateur + solveur + tableau
//   coach-explorer-export.js Explorateur OTKB : dialogue « Dossier de puzzles » (export PGN)
//
// RÈGLE D'ARCHITECTURE (graphe acyclique par construction) :
//   - helpers purs et état partagé → `import` ES depuis coach-core.js, et lui seul ;
//   - appel d'un module coach vers un autre → pont `window` (window.foo?.(…)).
//
// app.js importe CE fichier (`import './lib/coach.js'`) : les imports ci-dessous
// sont à effet de bord — chaque module s'expose lui-même au pont window.
// ══════════════════════════════════════════════════════
import './coach-core.js';
import './coach-overview.js';
import './coach-students.js';
import './coach-student-page.js';
import './coach-weakspots.js';
import './coach-assign.js';
import './coach-classes.js';
import './coach-games.js';
import './coach-export.js';
import './coach-explorer-core.js';
import './coach-explorer.js';
import './coach-explorer-export.js';
