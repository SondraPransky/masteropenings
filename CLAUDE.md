# CLAUDE.md — EECoach

## 1. Vision du Projet

Transformer l’application existante en un outil complet de formation et de suivi pour un club d’échecs.

L’application doit permettre :
- La révision d’ouvertures et d’exercices (tactiques, mats)
- Aux élèves de saisir et envoyer leurs propres parties au coach
- Une **bibliothèque d’exercices partagée** entre coachs
- L’**assignation** d’exercices par les entraîneurs
- Un suivi de progression détaillé

**Principe** : On fait évoluer l’application de façon progressive, sans tout réécrire.

## 2. État Actuel du Projet (Juillet 2026)

### Points forts
- Migration Supabase bien avancée
- Début de modularisation réussi (`state.js`, `lib/core.js`, `lib/dbmap.js`, `lib/tree.js`)
- Passage à **Vite + modules ES**
- **Déployé en ligne** : GitHub Pages via GitHub Actions → `https://sondrapransky.github.io/masteropenings/` (redéploie à chaque push sur `main`)
- `CLAUDE.md` présent et utilisé

### Problèmes majeurs
- `app.js` reste **très volumineux** (~254 Ko, ~5000 lignes) malgré les extractions
- Beaucoup de logique encore mélangée dans `app.js`
- Responsabilités encore trop centralisées

## 3. Dette Technique

| Problème                          | Impact     | Priorité |
|----------------------------------|------------|----------|
| Taille excessive de `app.js`     | Très élevé | **Critique** |
| Mélange des responsabilités      | Élevé      | Critique |
| Manque d’extraction des domaines | Élevé      | Haute    |
| Transition incomplète vers modules | Moyen    | Haute    |

## 4. Architecture Actuelle

- **Build** : Vite (modules ES)
- **Backend** : Supabase (source de vérité). Clé « publishable » PUBLIQUE (protégée par RLS) → OK committée ; **jamais** de clé « secret » dans le code.
- **État global** : `state.js` → objet `G` (bon pattern)
- **Modules extraits** : `lib/core.js` (SM-2, parsing PGN), `lib/dbmap.js` (mappers objet↔SQL), `lib/tree.js` (arbres d’ouverture)
- **Vendors** : `chess.js` et `@supabase/supabase-js` chargés en CDN (globals `window.Chess` / `window.supabase`) ; dans un module ES, un identifiant non déclaré se résout sur `globalThis`, donc pas besoin de les importer.
- **Pont `window`** : `app.js` expose ~280 fonctions aux `onclick=""` via `Object.assign(window, {…})` — à réduire au fil des extractions.

`app.js` reste le fichier principal et contient encore la majorité de la logique.

### Carte des fichiers

| Fichier | Rôle | Taille |
|---------|------|--------|
| `app.js` | Cœur applicatif : login, accueil élève, gestion modules/classes, échiquier (canvas, drag, dispatch), Maia, accès Supabase, pont `window` | ~128 Ko · 2500 lignes |
| `index.html` | Structure statique des écrans (montés/pilotés par `app.js`) | ~46 Ko |
| `style.css` | Styles : design system (variables `--cyan`, `--surf`, `--border`…) + tous les écrans | ~54 Ko |
| `state.js` | État global réassignable → objet `G` (source unique) | ~1,5 Ko |
| `lib/session.js` | État session de drill → objet `S` partagé (jamais réassigné, muté) entre `app.js` et `lib/drill.js` | ~1,5 Ko |
| `lib/core.js` | Logique pure : SM-2, normalisation/parsing PGN | ~5 Ko |
| `lib/dbmap.js` | Mappers objet ↔ lignes SQL (Supabase) | ~6,5 Ko |
| `lib/tree.js` | Arbres d’ouverture, positions du joueur, indices matériels | ~3,5 Ko |
| `lib/editor-core.js` | Éditeur — cœur pur : sérialisation PGN ↔ arbre, formes, NAG, `_SHAPE_COL` (testé, round-trip) | ~7 Ko |
| `lib/editor.js` | Éditeur de variantes — UI : plateau, drag, annotations (NAG/formes), sauvegarde (DOM) | ~27 Ko |
| `lib/drill-core.js` | Drill — cœur pur : sessions, choix du coup adverse (LRU/forced path), `oppSeenKey`, délais commentaires (testé) | ~4 Ko |
| `lib/drill.js` | Drill — **toute l'UI** : modes ligne / positions clés-flash / arbre-étude, phases apprentissage & test, fin de drill (`showEndModal`, `replayErrors`). `S` partagé ; app-level/SR via pont `window` | ~48 Ko |
| `lib/sr.js` | Répétition espacée : file de session (nouveaux/dus + quota), réponse/étape, bilan + prévision, suspension, réglages, tableau de bord élève | ~20 Ko |
| `lib/coach.js` | Vue coach — suivi élèves : onglets présence/progression/classes/parties, heatmap, exports CSV/PGN/JSON. État local (`selectedStudent`, `_profTab`) ; ne lit que `G` | ~36 Ko |
| `home.html` + `data.js` | Page marketing autonome (copiée telle quelle dans `dist/` au build) | — |

> Découpage de l’éditeur **terminé** (§5.1) : cœur pur `lib/editor-core.js` (testé) + UI `lib/editor.js` (DOM, état `_E` local ; fonctions app-level résolues au runtime via le pont `window` ; assets partagés `pieceImgs`/`PIECE_CDN` exposés sur `window` par `app.js`). Le sélecteur de promotion reste dans `app.js` (partagé avec l’échiquier principal).

> Découpage du drill engine **en cours** (§5.2).
> - **Étape A faite** : cœur pur `lib/drill-core.js` (testé) — logique déterministe sans DOM ni état `S` : `_commentDelay`, `_drillSessions`, `countPlayerMoves`, `computeForcedPath`, `pickOppMove`, `treeUnseenCount`, `oppSeenKey`. Dans `app.js`, `_pickOppMove`/`_treeUnseenCount`/`_computeForcedPath` sont des **wrappers minces** qui lisent `S`/`G.oppSeen` et délèguent au cœur pur.
> - **Étape B faite** : état session `S` promu en module partagé `lib/session.js` (jamais réassigné, seulement muté → `import` ES en lecture seule suffit). Importé par `app.js` **et** `lib/drill.js`.
> - **Étape C en cours** : extraction de l’UI **un mode à la fois** vers `lib/drill.js`, fonctions app-level (board, feedback, score, enregistrement) résolues au runtime via le pont `window` (patron identique à `lib/editor.js`).
>   - **Mode ligne fait** : `startLineDrill`, `advanceLine`, `tryMoveInLine`, `skipLinePosition`, `updateLinePosInfo`, `renderNotation`, `endLineDrill`, `togglePauseAdversary` (+ `_pendingAdversaryMv` désormais local au module).
>   - **Mode positions clés/flash fait** : `loadPosition`, `updatePosInfo`, `renderPosStrip`, `tryMoveInPositions`, `endPositionsDrill`. Couplage bidirectionnel avec le moteur SR (resté dans `app.js`) : `drill.js` bridge `_srToggleBar`/`_srUpdateBar`/`_srAnswer`/`_srBilan` via `window`, et le SR appelle `window.loadPosition?.()` etc. `_materialHint` importé de `lib/tree.js`.
>   - **Mode arbre/étude fait** : révision arbre (`startTreeDrill`, `advanceTree`, `tryMoveInTree`, `_treeEnd`) + wrappers stateful (`_pickOppMove`, `_treeUnseenCount`, `_computeForcedPath` → `G.oppSeen`) + phase apprentissage arbre (`startStudyPhase`, `studyGoPath`, `renderStudyTree`, navigation, « devine le coup » : `toggleStudyGuess`/`tryStudyGuess`/`_studyGuess*`). Imports ajoutés dans `drill.js` : `G` (state.js), `_normFen` (core.js), `pickOppMove`/`computeForcedPath`/`treeUnseenCount`/`oppSeenKey` (drill-core.js), `pgnToEditorTree`/`nagGlyphs` (editor-core.js).
>   - Côté `app.js`, toutes ces fonctions sont appelées via `window.xxx?.()`. **Type-check** : le pont `window` est déclaré dans `types/globals.d.ts` (0 erreur).
> - **SR extrait** : le moteur de répétition espacée est désormais dans `lib/sr.js` (27 fonctions : `srStart`, `_srBuildQueue`, `_srAnswer`, `_srBilan`, `_srForecast`, suspension, réglages, `renderSrDashboard`). Couplage bidirectionnel avec `lib/drill.js` via le pont `window` : `sr.js` appelle `window.loadPosition?.()` (mode positions), et `drill.js` appelle `window._srToggleBar/_srUpdateBar/_srAnswer/_srBilan`. Imports : `S`, `G`, `_treePlayerPositions`/`_materialHint` (tree.js), `_drillSessions` (drill-core.js).
>   - **Phases apprentissage/test + fin de drill faites** : `startLearnPhase`, `learnNext/Prev`, `renderLearn*`, `updateLearnProgress`, `enterTestPhase`, `showEndModal`, `replayErrors`. `showEndModal` étant désormais local à `drill.js`, son pont `window` a été supprimé et ses 3 appels sont directs. Nouveaux ponts : `clearLog`, `closeModal`, `isLineMode`, `startDrill`, `nextDrill`.
> - **Découpage du drill engine TERMINÉ** (§5.2) : `app.js` 4412 → 3064 lignes. Il ne reste dans `app.js` que l'échiquier (canvas/drag/dispatch `tryMove`/`canInteract`), Maia, les vues et l'accès Supabase.
>
> ✅ **Bug pré-existant corrigé** (antérieur au refactor, cf. commit `72027c8`) : le bouton « ↩ Erreurs seules » du mode ligne ne filtrait rien — `replayErrors()` posait `S.errorOnlySet`, puis `enterTestPhase()` → `startLineDrill()` faisait `S.errorOnlySet = null` avant qu'`advanceLine()` ne le lise. **Le reset vit désormais dans `startLearnPhase`** : `startLineDrill` est traversé par deux chemins (démarrage du test *et* rejeu des erreurs), alors que `startLearnPhase` n'est atteint que depuis `startDrill`/`nextSession`, les deux entrées d'une session neuve. Le chemin arbre (`varmode === 'tree'`) n'était pas touché.
>
> **§5.3 en cours — vues.**
> - **Vue coach faite** : `lib/coach.js` (18 fonctions : `renderProfView`, `showStudentDetail`, `_buildProgressionHTML`, `renderHeatmap`, `renderClassesTab`, `renderPartiesTab`, exports). Bloc idéalement isolé : état module local (`selectedStudent`, `selectedDrillFilter`, `_profTab`) qui ne fuit nulle part, aucune dépendance à `S`/`localStorage`/`Chess` — seulement `G` + 5 ponts `window` (`escapeHtml`, `fig`, `switchCoachSection`, `sm2Get`, `toast`). 7 sites d'appel entrants convertis.
> - **Prochaines étapes** : accueil élève (`renderStudentHome`, `_moduleStats`, `_shModuleCard`, `_seen*`, `importStudentDrill`…) → `lib/student.js`. Puis gestion modules/classes → `lib/modules.js`. Enfin l'échiquier (canvas, drag, `tryMove`/`canInteract`) → `lib/board.js`.

### Commandes
- **Dev** : `npm run dev` (Vite, HMR) — ou `npx serve .` (ESM natif, sans build)
- **Build prod** : `npm run build` → `dist/` (app bundlée + `home.html`/`data.js` copiés)
- **Tests** : `npm test` (Vitest, logique pure) · `npm run typecheck`
- **E2E** : `npm run test:e2e:public` (sans compte) / `npm run test:e2e` (nécessite un `.env` gitignoré)
- **Déploiement** : `git push origin main` → GitHub Actions (`.github/workflows/deploy.yml`) build Vite + publie `dist/` sur Pages, automatiquement.
  - ⚠️ Après avoir touché aux dépendances : `npm install` **puis committer `package-lock.json`** — sinon `npm ci` échoue en CI.

## 5. Stratégie de Refactoring Recommandée

**Approche** : Extraction progressive et sécurisée (pattern Strangler Fig).

**Ordre de priorité des extractions** :

1. **Éditeur PGN** (`modal-pgn-editor` + logique associée) → `lib/editor.js`
2. **Drill Engine** (logique des modes `line` / `flash` / `tree`, sessions, etc.) → `lib/drill.js`
3. **Vues et rendu** (coach + élève) → `lib/views.js` ou `lib/coach.js` + `lib/student.js`
4. **Logique SM-2 / Mastery** → `lib/mastery.js`

**Règles d’extraction** :
- Faire des extractions **petites et testables**
- Toujours garder l’application fonctionnelle après chaque extraction
- Utiliser `G` (de `state.js`) comme point central d’état
- Documenter les nouvelles fonctions dans ce fichier si nécessaire

## 6. Priorités Actuelles

1. **Réduire la taille de `app.js`** (extractions progressives)
2. Améliorer le moteur de révision et les exercices
3. Créer une bibliothèque d’exercices partagée
4. Implémenter l’assignation d’exercices
5. Améliorer le suivi des progrès des élèves
6. Améliorer le design et l’UX

## 7. Règles de Développement

- Supabase est la source de vérité.
- Toute modification importante dans `app.js` doit être justifiée.
- Privilégier les extractions petites et incrémentales.
- Toujours tester après une extraction.
- Utiliser `state.js` (`G`) pour l’état partagé.

## 8. Pièges Connus

- Attention à la cohérence entre localStorage et Supabase pendant la transition.
- L’éditeur PGN et le Drill Engine sont des zones sensibles.
- Beaucoup de code expose encore des fonctions via `window` → à réduire progressivement.
- Un `import` ES est en lecture seule : pour partager un état **réassignable** entre modules, passer par les propriétés de `G` (`G.drills = …`), jamais par un `let` importé.
- Certains noms d’état entrent en collision avec des chaînes littérales (`'classes'`, `'results.csv'`) : attention aux remplacements globaux.

## 9. Instructions pour Claude Code

Tu es un ingénieur senior pragmatique.

- Lis systématiquement ce fichier avant toute modification importante.
- Propose des extractions **petites, testables et sécurisées**.
- Demande confirmation avant de toucher aux zones critiques (`app.js`, éditeur, drill engine).
- Documente les décisions d’architecture dans ce fichier.
- Privilégie la maintenabilité à long terme.

---

**Fin du CLAUDE.md**
