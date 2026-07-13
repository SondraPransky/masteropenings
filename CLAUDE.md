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

## 2. État Actuel du Projet (mise à jour : juillet 2026)

**Phase : le refactoring est terminé → on entre dans la construction produit.**
Cible de déploiement : **mi-septembre 2026**. Lancement **single-coach** (un prof — toi — + ses élèves) ; le **multi-coachs viendra après**. Pas encore d’utilisateurs réels.

### Points forts
- Backend **Supabase** (source de vérité) opérationnel : auth, modules, classes, résultats, pratique, parties, mastery.
- **Modularisation aboutie** : ~16 modules `lib/*` (voir Carte des fichiers). `app.js` réduit de **4412 → 1275 lignes (−71 %)** — il ne reste que login/auth, la couche Supabase `_sb*`, l’init, les helpers UI et le pont `window`. **Décomposition dette (13 juillet 2026)** : `lib/drill.js` était repassé > 1000 → phase « Apprentissage » (étude arbre + parcours ligne guidé) extraite dans **`lib/study.js`** (460 l.) → `drill.js` **1123 → 693 l.** Couplage nul hors pont `window` (seul `_setStudyLayout` re-bridgé côté drill). **`app.js` (1324) analysé puis laissé tel quel (décision assumée)** : son volume est surtout la couche `_sb*` (≈430 l., intentionnelle §4) ; l'auth-UI est soudée à ce backend (`showLoginError` appelé par 11 sites `_sb*`, `updateNav` lit `ACCOUNTS_ON`, `signInGoogle` utilise `sb`) → une extraction serait net-négative (flux auth dispersé, résolution `globalThis` sur 11 appels). Seule cible à fort volume restante = l'orchestration de la page drill (~230 l.), écartée car elle touche l'entrée du drill engine (zone critique) pour un gain non prioritaire.
- **Vite + modules ES** ; tests Vitest (logique pure) + `typecheck` ; **déployé** sur GitHub Pages (Actions, redéploie à chaque push sur `main`) → `https://sondrapransky.github.io/masteropenings/`.

### Angle mort à lever avant le lancement (**gate de release**)
- ✅ **LEVÉ (12 juillet 2026) — GATE VERTE.** Le vrai aller-retour réseau Supabase est confirmé en session connectée sur 2 comptes (élève + coach) : bases (`profiles.extra`), `profiles.mastery`, parties (insert/read/partage/annotation), `results`, `practice`, **+ 2 contrôles RLS négatifs** (le coach ne voit pas / ne peut pas annoter une partie non partagée). Migrations prérequises appliquées (`profiles.extra`, `migration-006-shared-games.sql`), confirmation email **OFF**. Gate reproductible : `npm run gate` (`tests/gate/gate.mjs` — auth + REST via `fetch`, 0 dépendance ; crée puis supprime ses données, restaure le profil élève). Creds dans `.env` (gitignoré) ; comptes de test : `testcoach@test.com` / `testeleve@test.com` (mdp `test1234`). Voir `tests/gate/README.md`. **21/21 checks OK.**
- **Chemin connecté (historique)** : avant le 12/07/2026, tout était validé en anonyme (via `G`/`S` injectés) ou avec des stubs — le réseau connecté n'avait jamais été confirmé. C'est désormais couvert par la gate ci-dessus.
- **Trous du chemin connecté corrigés côté code (juillet 2026)** — audit de la gate Pilier 1 : (A) `_sbSaveGame` était `insert`-only → partage/annotation en échec ; ajout `_sbUpdateGame` (UPDATE) utilisé par `toggleShareGame`/`_reviewSaveDone`. (B) Nouvelle policy `games_update` (RLS). (C) L’élève ne rechargeait pas ses parties → `_sbLoadStudentGames` câblé au login élève. (D) Loaders coach (`_sbLoadTeacherResults`/`Practice`/`Games`) **jamais appelés** → câblés au login coach. (E) `_sbLoadTeacherGames` étendu aux parties bibliothèque partagées (`drill_id` null) + policy `games_read` élargie (helper `my_student_ids()`). (F) `_sbDeleteGame` câblé. **⚠️ À lancer côté Supabase : `supabase/migration-006-shared-games.sql`.** **Reste à faire : la validation connectée réelle** (write→read parties/bases/partage/annotation sur 2 comptes élève+coach) — non couverte en anonyme.

## 3. Dette Technique (résiduelle)

La dette « critique » (taille d’`app.js`) est **résolue** (extractions §5 terminées). Reste :

| Point | Impact | Note |
|-------|--------|------|
| Chemin connecté Supabase non testé | **Élevé** | Gate de release (§2). Aucune couverture E2E connectée. |
| ~~RLS classes lisibles par tous~~ **RÉSOLU** | — | La policy `classes_read` (migration-005) restreint déjà la lecture aux classes dont l’élève est membre. **Vérifié appliqué sur le live** (12/07/2026, probe : élève voit 0 classe non-membre). Le `select('*')` côté client ne ramène que ses classes ; le filtre client est redondant. |
| Pont `window` encore large (~66 fonctions) | Faible | Cosmétique, par choix (`onclick` inline). Nettoyé de 32 exports morts (juillet 2026). |
| Couche `_sb*` toujours dans `app.js` | Faible | Volontaire : noyau backend cohérent. |

## 4. Architecture Actuelle

- **Build** : Vite (modules ES)
- **Backend** : Supabase (source de vérité). Clé « publishable » PUBLIQUE (protégée par RLS) → OK committée ; **jamais** de clé « secret » dans le code.
- **État global** : `state.js` → objet `G` (bon pattern)
- **Modules `lib/*`** : ~15 modules extraits — voir la **Carte des fichiers** ci-dessous (cœurs purs testés `*-core.js` + UI). Cœurs partagés : `state.js` (`G`), `lib/session.js` (`S`).
- **Vendors** : `chess.js` et `@supabase/supabase-js` chargés en CDN (globals `window.Chess` / `window.supabase`) ; dans un module ES, un identifiant non déclaré se résout sur `globalThis`, donc pas besoin de les importer.
- **Pont `window`** : `app.js` **et** les modules `lib/*` exposent leurs fonctions via `Object.assign(window, {…})` ; les autres modules les résolvent au runtime (`window.foo?.(…)`). Types déclarés dans `types/globals.d.ts` (0 erreur typecheck).

`app.js` est désormais un **noyau mince** (auth + couche `_sb*` + init + helpers) ; la logique métier vit dans `lib/*`.

### Carte des fichiers

| Fichier | Rôle | Taille |
|---------|------|--------|
| `app.js` | Cœur applicatif : login/auth Supabase, accès Supabase (`_sb*`), init, helpers (`escapeHtml`/`fig`/`toast`/`setFeedback`/`updateScores`…), `currentGame`/`isLineMode`, `save`/`saveClasses`/`goPage`, pont `window` | ~52 Ko · 1275 lignes |
| `index.html` | Structure statique des écrans (montés/pilotés par `app.js`) | ~46 Ko |
| `style.css` | Styles : design system (variables `--cyan`, `--surf`, `--border`…) + tous les écrans | ~54 Ko |
| `state.js` | État global réassignable → objet `G` (source unique) | ~1,5 Ko |
| `lib/session.js` | État session de drill → objet `S` partagé (jamais réassigné, muté) entre `app.js` et `lib/drill.js` | ~1,5 Ko |
| `lib/core.js` | Logique pure : **Leitner à échelons** (`leitnerSchedule`/`DEFAULT_LADDER_HOURS`), normalisation/parsing PGN | ~5 Ko |
| `lib/dbmap.js` | Mappers objet ↔ lignes SQL (Supabase) | ~6,5 Ko |
| `lib/tree.js` | Arbres d’ouverture, positions du joueur, indices matériels | ~3,5 Ko |
| `lib/editor-core.js` | Éditeur — cœur pur : sérialisation PGN ↔ arbre, formes, NAG, `_SHAPE_COL` (testé, round-trip) | ~7 Ko |
| `lib/editor.js` | Éditeur de variantes — UI : plateau, drag, annotations (NAG/formes), sauvegarde (DOM) | ~27 Ko |
| `lib/drill-core.js` | Drill — cœur pur : sessions, choix du coup adverse (LRU/forced path), `oppSeenKey`, délais commentaires (testé) | ~4 Ko |
| `lib/drill.js` | Drill — **UI des modes de révision** : mode ligne / positions clés-flash / arbre-étude (moteur), phase test, fin de drill (`showEndModal`, `replayErrors`). `S` partagé ; app-level/SR via pont `window`. **Phase « Apprentissage » extraite → `lib/study.js`** | 693 lignes |
| `lib/study.js` | Drill — **phase « Apprentissage »** (extraite de `drill.js`, juillet 2026) : phase étude arbre (`startStudyPhase`/`renderStudyTree` + sous-variantes, carte pédagogique `renderStudyBubble`, « devine le coup » `toggleStudyGuess`/`tryStudyGuess`) + parcours ligne guidé (`startLearnPhase`/`renderLearn*`/`learnGoto`). `S` partagé ; ponts `window` (dont `startTreeDrill` → drill.js). Importé après `drill.js` dans `app.js` | 460 lignes |
| `lib/sr.js` | Répétition espacée : file de session (nouveaux/dus + quota), réponse/étape, bilan + prévision, suspension, réglages, tableau de bord élève | ~20 Ko |
| `lib/coach.js` | Vue coach — suivi élèves : onglets présence/progression/classes/parties, heatmap, exports CSV/PGN/JSON. État local (`selectedStudent`, `_profTab`) ; ne lit que `G` | ~36 Ko |
| `lib/student.js` | Accueil élève — cartes de modules (assignés + perso), stats, série, anneaux, import/suppression de révisions perso | ~16 Ko |
| `lib/modules.js` | Gestion modules & classes — création/import PGN (`previewDrill`, `importDrill`, `loadPgnFile`), bibliothèque d'ouvertures (`OPENINGS_LIBRARY`), cartes coach (`renderDrillList`), partage/assignation (`shareDrill`), drill de démo, onboarding prof, CRUD classes/cours particuliers. État local (`_pendingDelId`, `_editingClassId`) ; lit `G`/`S`, ponts `window` pour app-level/Supabase | ~32 Ko |
| `lib/maia.js` | Moteur Maia (ONNX Runtime Web) — chargement lazy du runtime + modèle (`loadMaia`), inférence (`_getMaiaMove`, miroir FEN/UCI), partie libre vs Maia (`playVsMaia`, `startPostTheory`, `enginePlay`, `quitMaiaGame`, `tryMovePostTheory`). État moteur local (`_maiaState`/`_maiaSession`/`_maiaThinking`) ; lit `G`/`S`, `ort`/`Chess` globals, board/feedback/`saveGame` via `window`. Lit `window._lastMoveXY` (board) pour positionner le sélecteur de promo | ~16 Ko |
| `lib/board.js` | Échiquier — rendu canvas (`drawBoard`/`drawCoords`, pièces SVG cburnett), interaction pointeur (mouse/touch/click → `tryMove` dispatch), drag & drop (ghost), sélecteur de promotion (`showPromoPicker`/`pickPromo`/`cancelPromo`), nav clavier ← →. État module `BSIZE`/`SQ`/`DR`, `_lastMoveXY` exposé `window`. Importe `S`, `_SHAPE_COL` ; ponts `window` `currentGame`/`isLineMode` + drill/maia/editor. ⚠️ Listeners `#board` attachés au chargement du module | ~16 Ko |
| `lib/mastery.js` | Mastery & enregistrement — **Leitner** (`sm2Update`/`sm2Get` sur `G.masteryData` ; nom `sm2Update` conservé pour le pont window, mais moteur = `leitnerSchedule`), synchro mastery multi-appareils (debounce 2,5 s → `_sbSaveMastery`, gardée par `G.currentUser`), enregistrement des sessions : résultats (`recordResult`), pratique (`recordPracticeSession`), parties Maia (`saveGame`). Cœur pur = `leitnerSchedule` (core.js) ; échelle du coach lue via `window._srGetLadder`. Writers `_sb*` restés dans app.js via `window` | ~8 Ko |
| `home.html` + `data.js` | Page marketing autonome (copiée telle quelle dans `dist/` au build) | — |

> **Refactoring (§5) terminé.** `app.js` **4412 → 1275 lignes (−71 %)** par extraction progressive (Strangler Fig) : éditeur (`editor-core`/`editor`), drill engine (`drill-core`/`drill`/`sr`/`session`), vues (`coach`/`student`/`modules`), échiquier (`board`), Maia (`maia`), SM-2/mastery (`mastery`). Détail par fichier → **Carte des fichiers** ci-dessus ; pas-à-pas → `git log` (commits `REFACTO :`). Patron appliqué : cœur pur testé + UI, fonctions app-level résolues via `window`, état partagé par `G`/`S`. Restés dans `app.js` par choix : couche `_sb*`, `save`/`saveClasses`/`goPage`, `currentGame`/`isLineMode`, `setBoardComment`/`setBoardPrompt`, sélecteur de promo (partagé board/éditeur).

### Commandes
- **Dev** : `npm run dev` (Vite, HMR) — ou `npx serve .` (ESM natif, sans build)
- **Build prod** : `npm run build` → `dist/` (app bundlée + `home.html`/`data.js` copiés)
- **Tests** : `npm test` (Vitest, logique pure) · `npm run typecheck`
- **E2E** : `npm run test:e2e:public` (sans compte) / `npm run test:e2e` (nécessite un `.env` gitignoré)
- **Déploiement** : `git push origin main` → GitHub Actions (`.github/workflows/deploy.yml`) build Vite + publie `dist/` sur Pages, automatiquement.
  - ⚠️ Après avoir touché aux dépendances : `npm install` **puis committer `package-lock.json`** — sinon `npm ci` échoue en CI.

## 5. Stratégie de Développement

**Le refactoring est terminé** (voir §2 + résumé dans §4). Principes qui restent valables pour toute évolution :

- Changements **petits, testables, vérifiés** (Vitest pour la logique pure ; vérif navigateur pour l’UI) ; garder l’app fonctionnelle à chaque étape.
- **`G` (state.js) = état partagé** ; état de session = `S` (session.js). Un `import` ES est en lecture seule → passer par les propriétés de `G` pour l’état réassignable.
- **Migration-free d’abord** : les tables Supabase exposent une colonne `extra` (jsonb) sur `modules` / `classes` / `games` → y ranger les nouveaux champs plutôt que migrer le schéma (patron déjà utilisé : `classes.extra.deadlines`).
- **Ne jamais committer/pousser sans feu vert.** Commits `TOPIC : desc` (FEAT / FIX / REFACTO…), sans accents, avec `Co-Authored-By`.

## 6. Roadmap de Lancement — cible mi-septembre 2026

Lancement **single-coach** (toi + tes élèves). Priorité produit = **Pilier 1 : parties de l’élève + revue coach**. Bibliothèque partagée entre coachs et exercices tactiques/mats = **post-lancement**.

### Pilier 1 — Parties élève + revue coach (must-have, sans coupe)

**Décisions design (grill-me, juillet 2026) :**
- **Stack : on reste vanilla.** Pas de re-platform React / Tailwind / shadcn avant le lancement — « moderne » est un **objectif design**, pas un changement de stack (une v2 React = décision post-lancement assumée). Réf : lichess lui-même = TS/Snabbdom + board `chessground` **framework-agnostique** ; le cœur échecs (board, éditeur, drill, Maia) ne gagne **rien** à React.
- **Esthétique : académie structurée × outil clean** (Chessable × Linear), dans les tokens existants : hiérarchie forte, cadrage « travail → fais-le → progresse », mais sobre (blanc, neutres zinc, **indigo en accent précis**, cartes discrètes, micro-interactions subtiles) ; gamification existante (série/anneaux) en **signaux discrets**.
- **IA** : élève → **onglets haut** « Révision » | **« Ma bibliothèque »** (ajuster `updateNav`, aujourd’hui masqué pour l’élève) ; coach → revue dans la section **« Parties »** existante (`csec-parties`).

**Modèle de données :**
- **Base personnelle** = `{ id, name, owner }` = **dossier PGN générique** nommé par l’élève (stocké côté profil élève). Migration-free.
- **Entrée** = un PGN (réutilise la table `games`, `drill_id = null`, `base_id` dans `extra`) portant une **nature** (`partie` | `analyse`) ; **une base peut mélanger les deux**. Une entrée `partie` = en-têtes PGN (Blancs/Noirs/Event/Elo via `chess.js` `header()`) + résultat + action **partager au coach**. Les parties vs Maia peuvent se ranger auto dans une base dédiée.
- **Annotation coach = couche additive-only** : le coach n’écrase **jamais** les coups de l’élève ; il **ajoute** sous-variantes (le bon coup là où l’élève s’est trompé) + commentaires, chaque nœud tagué `author:'coach'` et **rendu en couleur** dans le même arbre. L’éditeur (`editor.js` / `editor-core.js`) round-trip déjà PGN ↔ arbre (commentaires / variantes / NAG) → ajouter `author` au nœud + le colorer.
- **Layout « Ma bibliothèque »** : drill-down en cartes (bases → entrées), mobile-friendly ; la vue des entrées d’une base = **liste recherchable/triable** (Blancs/Noirs/date/résultat — inspiration CARA). Couleurs/label coach + UX partage/notif (`sh-notif`) : peaufinés **en live** par tranche.

Tranches à livrer **dans l’ordre** (chacune démontrable) :
1. ✅ **P1.0 fait** — modèle base + page **« Ma bibliothèque »**. `G.bases` (`{id,name,created}`, localStorage `mc_bases` + Supabase `profiles.extra.bases` défensif via `_sbSaveBases`/`_sbLoadBases`) ; `lib/library.js` (`renderMyLibrary`/`createBase`/`openBase`/`deleteBase` — préfixés pour éviter la collision avec `renderLibrary` de modules.js) ; onglets élève **Révision | Ma bibliothèque** (`updateNav` toggle `.tab-teacher`/`.tab-student`, `page-library`). Renommer base → P1.2 ; saisie de partie → P1.1. ⚠️ Migration à lancer côté Supabase : `alter table profiles add column if not exists extra jsonb default '{}';` (validée à la gate connectée).
2. **P1.1** — saisie de partie (**éditeur échiquier + coller PGN**) + métadonnées PGN. *(Import en ligne Lichess/Chess.com = post-lancement.)*
   - ✅ **P1.1a fait** (coller PGN) : modal `modal-new-game` (Blancs/Noirs/Tournoi/Elo/Résultat + textarea PGN) ; `saveGameEntry` valide via `chess.js` `load_pgn`, injecte les en-têtes (`header()`), pousse dans `G.savedGames` (`baseId`, `nature:'partie'`, `pgn`) ; `_ngPrefillFromPgn` pré-remplit depuis un PGN collé avec en-têtes. `games.extra` porte `base_id`/`nature` (`lib/dbmap.js`). Liste des parties dans le détail de base (Blancs–Noirs · résultat · tournoi · date, triée par date) + suppression. Vérifié navigateur (avec/sans en-têtes, PGN invalide rejeté).
   - ✅ **P1.1c fait** (gestion de base façon CARA) : la vue détail d'une base (`lib/library.js`) porte une **barre recherche + filtre résultat + tri**. Recherche live (Blancs/Noirs/tournoi + `[Opening]` du PGN), filtre 1-0 / 0-1 / nulle, tri (date ↑↓ / Blancs A→Z / Noirs A→Z / résultat). État `_libQuery`/`_libResFilter`/`_libSort` (remis à zéro à l'ouverture d'une base) ; re-rendu ciblé `#lib-entries` (l'input garde le focus). Migration-free (tout dans `G.savedGames`). Emojis des entrées → Tabler au passage. *(Import en ligne Lichess/Chess.com + déduplication = post-lancement, phase suivante.)* Vérifié navigateur (recherche/filtre/tri sur 5 parties de test).
   - ✅ **P1.1b fait** (saisie sur l'échiquier) : l'éditeur devient un **producteur de PGN** en « mode partie » — `_E.target='game'` (`openGameEditor(pgn)` charge le PGN déjà tapé, masque les champs module, adapte le titre) ; `saveEditorDrill` branche vers `_saveEditorGame` qui sérialise l'arbre → PGN et le rend au modal via `window._boardEntryDone` (le modal reste ouvert **dessous**, éditeur `z-index:200`). Bouton **« ⛃ Saisir sur l'échiquier »** dans `modal-new-game` → `openBoardEntry`. `closeEditorModal` restaure le mode module (target/champs/titre) → **flux module inchangé**. Métadonnées toujours saisies dans le modal (une seule place). Vérifié navigateur (round-trip PGN, garde plateau vide, module intact).
3. ✅ **P1.2 fait** — créer / **renommer** plusieurs bases + choisir la base de destination + nature de l’entrée. `renameBase(id)` (prompt, boutons ✏️ sur cartes + vue détail, persiste via `save`/`_sbSaveBases`) ; modal `modal-new-game` : select `ng-base` (peuplé/présélectionné sur la base ouverte, redirige la cible à l’enregistrement) + select `ng-nature` (Partie/Analyse → `rec.nature`, icône 📝/♟️ dans la liste). Vérifié navigateur (redirection base, nature analyse, renommage). *(Import en ligne = post-lancement.)*
4. ✅ **P1.3 fait** — bouton **partager au coach** : `toggleShareGame(id)` (flag `shared` dans `games.extra`, `lib/library.js`), bouton 📤 Partager / ✓ Partagé sur chaque entrée. Coach : `renderPartiesTab` (`lib/coach.js`) décompose désormais **parties Maia** (sans `baseId`) vs **section « Parties partagées par les élèves »** (`baseId` + `shared`) — corrige au passage l’affichage `undefined` des entrées bibliothèque dans cet onglet. *(Filtrage fin par `teacher_id` de la classe = à la gate connectée / multi-coachs.)*
5. ✅ **P1.4 fait** — **revue coach** additive : `openReviewEditor(pgn,{gameId,role,white,black})` ouvre la partie dans l’éditeur en `_E.target='review'` (champs module masqués, titre/bouton adaptés). Coach (`role:'coach'`, bouton **🧑‍🏫 Annoter** dans la section partagée) : tout coup ajouté est tagué `author:'coach'` (`editorApplyMove`) **sans réécrire** les coups de l’élève ; `_saveEditorReview` sérialise l’arbre annoté → `_reviewSaveDone(gameId,pgn,role)` (library) écrit `g.pgn` + `g.reviewedAt`. Encodage `author` round-trip via `[%author coach]` dans le commentaire PGN (`lib/editor-core.js` : `_parseShapes`/`pgnToEditorTree`/`_commentWithShapes`). Nœuds coach **colorés en violet** (`#7c3aed`) dans la notation.
6. ✅ **P1.5 fait** — l’élève rouvre sa partie via **🔎 Revoir / 📖 Voir la revue** (`openGameReview`, `role:'student'`) : mêmes annotations, ajouts du coach **en violet**, badge **✨ Annotée** sur l’entrée. Vérifié navigateur (round-trip `author`, partage→annotation→relecture, section coach). Typecheck + 77 tests OK.
7. ✅ **Gate release FAITE (12 juillet 2026)** — **validation connectée Supabase** verte (round-trip parties / bases / partage / annotations + RLS négatif), sur 2 comptes réels. Reproductible : `npm run gate`. Détail → §2 (gate de release) + `tests/gate/README.md`.

### Post-lancement
- ✅ **Import Lichess FAIT (13 juillet 2026)** — dans « Ma bibliothèque » : le modal « Nouvelle partie » porte une ligne **Importer depuis Lichess** (input URL + bouton, `#ng-lichess-url`/`#ng-lichess-btn`). `importLichessGame` (`lib/library.js`) : `_lichessGameId` extrait l'ID 8 car. (URL, URL POV joueur 12 car., ou ID brut) → `fetch('https://lichess.org/game/export/{id}', {Accept:'application/x-chess-pgn'})` (**CORS ouvert**, 0 dépendance/clé) → PGN dans `#ng-pgn`, métadonnées repeuplées via `_ngPrefillFromPgn` (import fait autorité : champs vidés puis re-remplis). États gérés (bouton loading, 404/erreur/vide/URL invalide). **Migration-free** : réutilise entièrement `saveGameEntry`. Vérifié navigateur (import réel `q7ZvsdUF` → White/Black/Event/Result prefill → save → persiste base ; URL invalide rejetée sans fetch ; 0 erreur console). **Chess.com = prochaine étape.**
- **Exercices** (tactiques / mats) : « position → trouve le bon coup » → **réutilise le mode `positions` / flash existant** (peu coûteux le moment venu). Le prof pourra assigner des **bases d’exercices** comme il assigne déjà des ouvertures.
- **Bibliothèque d’exercices partagée entre coachs** (+ durcissement RLS multi-coachs, cf. §3).
- Une éventuelle **v2 en React / Tailwind / shadcn** (re-platform assumé) et une passe de **polish visuel global** — décidés explicitement, jamais mid-sprint.

### Fait — §6 #4 Assignation : échéance par module dans la classe
- **Modèle** : une classe porte `moduleDeadlines = { moduleId: 'YYYY-MM-DD' }`, persisté dans `classes.extra.deadlines` (jsonb) → aucune migration (`lib/dbmap.js`).
- **Coach** : formulaire de classe (`lib/modules.js`) — date-picker par module (`_toggleModDeadline`) ; `saveClass` collecte, `openEditClass` repeuple ; `renderClassList` affiche l’échéance.
- **Élève** : `_sbLoadStudentModules` applique l’échéance d’assignation **la plus proche** (prime sur la `deadline` du module) ; `_shModuleCard` affiche un badge (⚠ retard / ⏰ Nj / 📅 date).
- **Suivi par module × élève** : `renderClassesTab` (coach.js) décompose chaque classe par module (pastille échéance + `✅ faits/roster`) × élève (fait `%·récence` / en retard / pas commencé).

### Fait — refonte UX nav (T1–T4, juillet 2026)
Chantier issu de l'audit UX (artefact « Audit UX & plan de refonte »), livré en 4 tranches non-cassantes (typecheck + 78 tests + smoke test navigateur 2 rôles) :
- **T1 — Nettoyage nav** : suppression du stub `page-prof` + de la redirection `goPage('prof')` (0 appelant). Libellés d'onglets clarifiés : coach « Réviser »→**« Aperçu »** (`ti-eye`) + « Coach »→**« Tableau de bord »** ; élève « Révision »→**« Réviser »**. Système de boutons sémantique documenté dans `style.css` (primaire=`btn-gold`/`btn-primary` indigo · secondaire=`btn-blue` · tertiaire=`btn-ghost` · danger=`btn-red`).
- **T2 — Barre nav allégée** : `reviser-tout-btn` retiré du `<nav>` (redondant avec le CTA du hero élève `sh-hero`) ; `btn-back-student` déplacé du `<nav>` vers l'entête de `page-drill` (id conservé, CSS default `inline-flex`, piloté par `goPage`/`updateNav`). Décision : les onglets haut coach **restés** (bascule Tableau de bord ↔ Aperçu échiquier, `page-drill` étant hors sidebar) — les masquer aurait isolé l'échiquier.
- **T3 — Accueil élève** : `sh-dashboard` (répétition espacée) rétrogradé **sous** les modules/perso, sous un libellé « Mes statistiques ». Le hero conserve le CTA primaire unique « ▶ Commencer la révision ». Réordonnancement HTML pur (cibles `render*` inchangées).
- **T4 — Dégroupage sidebar coach** : la section « Élèves » (fusion précédente) est **scindée** — `csec-eleves` = suivi & progression ; nouveau `csec-classes` = formulaire + liste + suivi par module. Nouveau bouton sidebar `csnav-classes` (`ti-school`). `switchCoachSection` gère `'classes'` (charge results/practice puis `renderClassesTab`) ; `'eleves'` ne rend plus les classes. Appelants repointés sur `'classes'` : `shareDrill`, `addStudent`, CTA onboarding (`lib/modules.js`).
- **T5 — Icônes chrome → Tabler** : les emojis des boutons de chrome les plus visibles remplacés par des icônes Tabler (déjà chargées) : actions « révisions perso » élève (`ti-books`/`ti-edit`/`ti-upload`), contrôles drill (`ti-rotate`/`ti-arrows-exchange`/`ti-bulb`/`ti-eye`), menu `modal-create-choice` (`.create-choice-ico` → `ti-chess-knight`/`ti-clipboard-text`/`ti-settings`/`ti-puzzle`/`ti-books`, coloré `--cyan`). L'emoji reste réservé au contenu (encouragements, hero). *Reste itératif : emojis des boutons rendus dynamiquement dans `lib/*`.*
- **T6 — Aplatir les modals d'exercices** (design validé via grill-me/maquette, option « workbench 2 colonnes ») : `modal-exercise-packet` devient un plan de travail 2 colonnes (`.ex-workbench` : liste `#ex-list` à gauche, éditeur à droite `.ex-right`). Les modals empilés `modal-exercise-solution` + `modal-exercise-fen` sont **supprimés** — leur contenu (mini-échiquier autonome `#ex-sol-board` + champs coup/alt/commentaire) vit désormais dans le panneau de droite (`#ex-sol-editor`), le FEN devient un champ inline `#ex-fen-row`. `lib/exercises.js` : `_exOpenSolution` peuple le panneau au lieu d'ouvrir un modal ; nouveau `_exResetPanel`/`exFenCancel` ; `exSolAdd` réinitialise le panneau après ajout. `modal-position-setup` (partagé) et `modal-exercise-pgn` (import lot) restent des fenêtres à part (par choix). Vérifié JS end-to-end (FEN/échiquier/clic-plateau/édition/save/reset, 0 modal empilé restant) ; screenshots du plateau bloqués en preview (images pièces CDN).
- **T7 — Menu compte + clarté dashboard élève + passe emojis→Tabler** :
  - **Menu compte** (`#acct-menu` nav) : avatar (initiale) + prénom + chevron → dropdown (nom complet, badge rôle, « Se déconnecter »). Remplace `nav-user`/`btn-logout`. `toggleAcctMenu` + fermeture clic-extérieur ; dropdown en `position:fixed` ancré par JS (le `<nav>` a `overflow:hidden`). `updateNav` réécrit pour piloter le menu.
  - **Dashboard élève clarifié** (`renderSrDashboard`, `lib/sr.js`) : langage sans jargon — « Ma progression » + phrase d'explication ; 3 tuiles lisibles (« à réviser aujourd'hui » / « positions bien retenues » / « bonnes réponses (30 j) ») au lieu de 4 (« Rétention 30j »/« Cartes vues » supprimés) ; graphe « Ce qui t'attend les prochains jours ». CSS `.srdash-*` agrandi.
  - **Emojis chrome → Tabler (élève + coach)** : cartes module élève (`_shModuleCard`), cartes module coach (`renderDrillList`), pastilles maîtrise/échéance (`coach.js`), onglet Parties, cartes de classe + formulaire, boutons Ajouter un élève / Export. **Conservés** : symboles d'échecs `♔♚⇄`, icônes d'états vides (illustratives), emojis des `toast()` (feedback = contenu). Glyphes vérifiés rendus.
- **Bouton « Créer » unifié** : les 3 boutons (Bibliothèque/Échiquier/Nouveau module) remplacés par un seul **+ Créer** → `modal-create-choice` (Sur l’échiquier · Coller un PGN · **Depuis une position** · Bibliothèque). `openCreateChoice` (`lib/modules.js`).
- **Éditeur de position** (`lib/setup.js`, `modal-position-setup`) : échiquier de placement (palette pièces + gomme, un seul roi/camp), **trait**, champ **FEN bidirectionnel**. `openPositionSetup` (module) / `openPositionSetupForGame` (partie). Roques/en-passant : défaut (aucun droit), pas d’UI dédiée.
  - **Round-trip position custom** : `editorTreeToPGN(root, startFen)` préfixe `[SetUp]`/`[FEN]` si non-standard ; `extractAllLines` (core.js) honore l’en-tête `[FEN]` ; `openReviewEditor` ré-extrait le FEN d’un PGN de partie ; `openPgnEditorNew`/`openGameEditor` acceptent un `startFen` ; `saveEditorDrill` écrit `sessions[0].startFen`. Vérifié : module custom (setup→éditeur→save→réouverture→**drill démarre depuis la position**) et partie custom (bouton « Depuis une position » du modal Nouvelle partie → round-trip FEN).

### Fait — refonte UX cohérence (T8, juillet 2026)
Chantier issu d’une revue UX « on comprend rien » (organisation / boutons / fonctionnalités). Livré en 6 tranches non-cassantes (typecheck + 78 tests + build verts, vérif navigateur styles calculés — les screenshots canvas timeout dans l’env). Diagnostic : le produit manquait de **grilles de cohérence** (nav, boutons, vocabulaire) plus que de features.
- **A — Boutons : accent indigo unique.** `.btn-blue` n’est plus un 2e plein saturé (`--blue`) mais le **secondaire tonal** dans la teinte du primaire (`--cyan-dim` fond / `--cyan` texte / `--cyan-glow` bordure). Hiérarchie à un seul hue : **plein > tonal > ghost**. Doc du système réécrite (`style.css` ~L258) ; `.btn-gold` reste un **alias** de `.btn-primary` (préférer `btn-primary`) ; override dark `[data-theme=dark] .btn-blue{color:#000}` corrigé (n’applique le blanc qu’au `:hover`).
- **B — Vocabulaire (collisions/jargon).** Bouton élève « Biblio » (ouvertures prêtes) → **« Ouvertures prêtes »** pour lever la collision avec l’onglet **« Ma bibliothèque »** (bases perso). Modal `modal-library` + option create-choice → **« Ouvertures prêtes à l’emploi »**. Sidebar/section coach « Heatmap » → **« Points faibles »** (labels seulement ; ids/fonctions `renderHeatmap`, `csec-heatmap`, `hm-drill-filter` inchangés).
- **C — Emojis chrome → Tabler (suite de T5/T7).** Titres de modals, icônes d’états vides (`.empty-ico`/`.mcard-empty-ico`/`.lib-empty-ico`, statiques **et** rendus JS : `lib/modules.js` L339, `lib/coach.js` ×3, `lib/library.js` ×2), 4 cartes Export (accent `--cyan`), boutons proéminents des modals Nouvelle partie / Position.
- **C bis — Emojis résiduels (2e passe).** Sidebar du drill : `📖 Apprentissage`, `🎯 Devine/Tester`, `⏸ Auto`/`▶ Adv.` (posés dynamiquement en `textContent` par `lib/drill.js` → passés en `innerHTML` avec `<i class="ti…">`, swaps de label purs, escaping via `escapeHtml`), `👤`/`⏸ Suspendre` ; œil mot de passe (`👁`/`🙈` → `ti-eye`/`ti-eye-off` dans `togglePwd`, app.js) ; modals éditeur/`create-drill` (`🎹💾🗑💬📁⚙👁⬆✓`) ; badges dynamiques `renderDrillList` (`⇶ sessions` → `ti-stack-2`, `✦ Démo` → `ti-flask`). **Conservés (contenu, par choix)** : `👋🏆🏁` (warmth/célébration), tous les `setFeedback`/`addLog`/`toast` (feedback transitoire), symboles d’échecs `♔♚⇄⬜⬛`, `✕` de fermeture (glyphe UI monochrome), `✓` de statut, options de `<select>` (`🎓📋♔♚`, limitation technique), bouton dev localhost. Scan DOM final : 0 emoji de chrome résiduel.
- **Passe polish findings design (verdict : faux positifs, code laissé intact).** Le hook `impeccable` signalait `side-tab` (`.study-var` : rail d’indentation **2px neutre** `var(--border)` sur les blocs de variantes — indent-guide, pas l’accent coloré épais d’une carte) et `layout-transition` sur 4 barres de progression (`.sr-prog-fill`/`.prog-fill`/`.sh-mod-progress-fill`/`.eleve-progfill`). **Non modifié** : ce sont des barres **pilulaires** (`border-radius`) → `transform: scaleX()` (le « fix » lint) **déformerait les extrémités arrondies** ; elles se mettent à jour ponctuellement (pas par frame) donc aucun coût de layout thrash réel ; une porte déjà `prefers-reduced-motion`. L’animation `width` est ici le choix visuellement correct. Décision assumée (ne pas dégrader du code correct pour satisfaire un lint générique).
- **D — Nav coach unifiée.** Suppression des 2 onglets du haut coach (`.tab-teacher` forcés `display:none` dans `updateNav`) : la **sidebar devient la nav unique**. L’échiquier reste atteint par **« Jouer »** (`launchDrill`) sur chaque carte de module ; `page-drill` reçoit un retour **role-aware** — `goBackFromDrill()` (app.js) + `#btn-back-label` piloté par `goPage` (élève « Mes modules » / coach « Tableau de bord »). Revient sur la décision T2 (onglets gardés « pour ne pas isoler l’échiquier ») : plus nécessaire puisque « Jouer » est l’entrée contextuelle.
- **E — Menu « Créer » à 2 niveaux.** `modal-create-choice` : 5 choix égaux → **2 principaux** (Sur l’échiquier · Coller un PGN) + intitulé « Autres options » avec **3 compacts** (`.create-choice.sm` : Ouvertures prêtes · Depuis une position · Paquet d’exercices). Rien retiré.
- **F — Modal « Nouvelle partie » allégé.** Essentiels visibles (Blancs / Noirs / Résultat / PGN) ; Base / Nature / Tournoi / Elo B / Elo N repliés dans `<details class="ng-details">` (natif, fermé par défaut). **Tous les `id` conservés** → `saveGameEntry`/`_ngPrefillFromPgn` intacts.

### Fait — cohérence des CTA de création (juillet 2026)
Signalé utilisateur : « 3 boutons Créer sur la page modules qui ne renvoient même pas à la même modale ». Bug réel : l’entrée de création module avait été unifiée (T7 → `openCreateChoice()` = LE menu de choix) mais **2 entrées oubliées** court-circuitaient le menu (`openCreateDrillModal()` = direct « Coller un PGN »).
- **Module (coach)** : `renderCoachOnboarding` (étape « Créer ») et l’état vide JS `renderDrillList` repointés `openCreateDrillModal()` → **`openCreateChoice()`**. Les 3 entrées (onboarding + en-tête + carte vide) vont désormais au même menu.
- **Redondance 1er lancement** : la carte vide `renderDrillList` masque son bouton quand l’onboarding est actif (`!localStorage mc_onboarding_done`) — l’onboarding + l’en-tête portent déjà l’action ; le bouton focal **revient** une fois l’onboarding masqué.
- **Cohérence élève ↔ coach** : « Mes révisions perso » avait **3 boutons ghost** (Ouvertures prêtes / Créer / Importer) là où le coach a **un** « + Créer » → menu. Unifié : un seul bouton `openStudentCreateChoice()` (`lib/student.js`) → nouveau `modal-student-create-choice` (miroir de `modal-create-choice`, 3 options : Sur l’échiquier `openPgnEditorNew('student')` · Coller un PGN `openStudentImport` · Ouvertures prêtes `openLibrary`). Même pattern de création dans les deux rôles.

### Fait — refonte dashboard élève + points faibles (juillet 2026)
Review `/frontend-design` (design + fonctionnalités) sur l’app peuplée (test E2E). Livré en lots :
- **A — Cohérence + filtre classe** : emojis chrome → Tabler sur détail élève / points faibles / heatmap / suivi par module (`lib/coach.js`). **Filtre par classe** ajouté (`prof-class-filter`/`hm-class-filter`) : restreint roster + KPIs + points faibles + heatmap aux élèves de la classe ; composable avec le filtre module. Helpers `_classFilter`/`_populateClassFilter`/`_matchStudentSet` ; `_buildProfRoster` accepte un roster optionnel.
- **B — Points faibles actionnables** : `renderHeatmap` refondu — grille de cases → **cartes** « à revoir en priorité » (coup + taux d’échec + **pastilles des élèves qui échouent** + commentaire, tri par nb d’élèves puis taux) + **bande d’aperçu** compacte. Groupement enrichi de `failStudents`. Styles `.wsx-*`.
- **C — Mini-échiquier** : FEN de chaque position **résolu depuis le PGN du module** à l’affichage (`_drillFenMap` via `pgnToEditorTree`, cache par rendu) → `renderStaticBoard` (`miniboard.js`). **Aucun changement du drill engine ni des données** (approche voulue pour éviter la zone critique).
- **D — Actions** : (1) **« Voir la position »** — modale `modal-weakspot` (grand échiquier + coup + commentaire + élèves qui échouent), `openWeakspotPosition` + stash `_wsCards`. (2) **« Assigner une révision ciblée »** (version complète) — vrai modèle d’assignation coach→élève, migration-free : `class.targetedReviews` (↔ `classes.extra.targetedReviews` via `dbmap.js`). `assignTargetedReview` (coach) route la position (drillId/san/**fen**/comment) vers les classes contenant les élèves qui échouent (dédup par drillId+san, union des élèves) + `saveClasses`/`_sbSaveClass`. Côté élève : `renderStudentHome` lit ses classes → section **« À revoir — demandé par ton coach »** (`#sh-targeted`, styles `.sh-targeted-*`) ; `openTargetedReview(drillId)` → `startStudentDrill`. **Vérifié E2E** : coach assigne Rb3 → écrit dans les 2 classes avec les bons sous-ensembles → l’élève membre voit la carte + « Réviser » lance le module. *(Raffinement futur : sauter à la position exacte dans l’arbre plutôt que lancer le module.)*
- **E — Dashboard élève prescriptif** : KPI « Sessions » (souvent 0) → **« À revoir »** (positions SR dues de l’élève) ; table « Positions difficiles » → liste **« À revoir avec cet élève »** (coup + module + nb d’échecs + **commentaire du prof** = le pourquoi). Styles `.ed-review-*`.
Tout vérifié navigateur sur données peuplées (2 modules, 7 élèves) ; typecheck + tests + build verts.

### Fait — fusion onglets « Élèves » + « Classes » (juillet 2026)
Demande utilisateur : ne plus séparer élèves et classes → **un seul onglet « Élèves »** où l'on voit la liste des élèves ET des classes, avec ajout d'élève seul/en classe, création de classe, édition/suppression. Revient sur le split T4 (`csec-eleves`/`csec-classes`).
- **Sidebar** : bouton `csnav-classes` **supprimé** ; section `csec-classes` **supprimée**. `switchCoachSection` : `'classes'` retiré du tableau ; `'eleves'` rend désormais `renderClassList` + `renderProfView` + `renderClassesTab`.
- **Page `csec-eleves` unifiée** : en-tête (**+ Ajouter un élève** `btn-primary` · **+ Créer une classe** `btn-blue` · filtre module) → KPIs → points faibles → roster+détail → bloc `.cls-block` (« Mes classes » `#cls-list` avec éditer/supprimer + « Suivi par module » `#prof-classes-content`). Nouveaux styles `.cs-subhead`/`.cls-block`.
- **Formulaire en modale** (`modal-class-form`, choix design validé) : le formulaire (mêmes ids `inp-cls-*`/`cls-form-title`/`cls-save-btn`/`cls-cancel-btn`) migre de l'inline vers une modale. Ouvreurs : `addStudent()` (mode élève seul), nouveau `openClassForm()` (mode groupe), `openEditClass()` (édition), `shareDrill()` (module pré-coché) → tous via helper `_openClassModal()`. `saveClass()` ferme la modale + rafraîchit `renderProfView`/`renderClassList`/`renderClassesTab` ; `deleteClass()` rafraîchit aussi le roster.
- **Repoints** `switchCoachSection('classes')` → `'eleves'` : onboarding « Créer une classe » (`+openClassForm()`), `shareDrill`, `addStudent`. Test e2e `coach.authed.spec.js` mis à jour (plus de `#csnav-classes` ; vérifie `#modal-class-form`). Vérifié navigateur : CRUD complet (ajout élève→carte+roster, édition modale pré-remplie, suppression→retrait, état vide correct), 0 erreur console.

### Fait — audit incohérences UI site-wide (juillet 2026)
Chasse systématique aux incohérences de boutons/labels (scan de tous les `onclick`/labels, HTML + `lib/*`) :
- **F1/F2 — glyphes Unicode d'action → Tabler.** L'éditeur disait `↔ Flip` (anglais + Unicode) là où le drill fait « Retourner » + `ti-arrows-exchange` : aligné. Convertis aussi : `↻ Actualiser` (`ti-refresh`), `↑ Ligne princ.` (`ti-arrow-up`), `＋/－ Palier` (`ti-plus`/`ti-minus`), `▶ Commencer/Continuer` (`ti-player-play`). Boutons de fin de drill (`lib/drill.js`, posés en `textContent` → `innerHTML`) : `🔄 Réviser les erreurs`, `↩ Erreurs seules` (`ti-arrow-back-up`), `▶ Poursuivre` (`ti-player-play`), `↺ Rejouer` (`ti-rotate`), `✅ Tout revu` (`ti-check`). **Gardés** : le `→` de fin des CTA (pattern cohérent : « Se connecter → », « Module suivant → »…) et le caret de dépliage `▶`/`▸` (disclosure, cf. `.ng-details`).
- **F3 — « Ajouter un élève »** (action principale de la section Élèves) : `btn-blue` (tonal) → `btn-primary` (plein), comme les autres primaires de section.
- **F4 — deux classes pour le primaire.** `btn-gold` (coach/modules) et `btn-primary` (login/biblio/élève) rendaient identique mais coexistaient (28 usages). Tout unifié sur **`.btn-primary`** ; règle `.btn-gold` retirée du CSS + doc du système mise à jour. `--gold` reste réservé aux badges/achievements.
- **F5 — vocabulaire « Parties ».** Titre section coach « Parties Maia » → **« Parties »** (la section contient aussi les parties partagées) ; sous-titre précisé « Parties Maia et parties partagées ». Le sous-libellé Maia reste dans la décomposition interne (`renderPartiesTab`) et le KPI.

### Fait — passe polish premium (redesign skill, juillet 2026)
Audit `redesign-existing-projects` : le design system est déjà solide (fonts à caractère Bricolage/Hanken/JetBrains, accent indigo unique, tokens zinc, états hover/active/focus, reduced-motion). La plupart des « AI tells » ne s’appliquent pas → **pas de redesign**, seulement des micro-polish non-identitaires + 3 touches visibles validées :
- **Sûr / non-identitaire** : ombres **teintées** zinc/indigo (au lieu du noir pur, tokens `--shadow*`) ; `text-wrap: balance` sur les titres display + `pretty` sur le corps ; `min-height: 100vh` **puis** `100dvh` (fallback progressif — le `dvh` seul était droppé et retombait à 0 sur certains moteurs). `100vh`/`100dvh` aussi sur le wrapper login (inline).
- **Hero élève (`.sh-hero`)** : dégradé **radial** + halo (`inset` highlight) au lieu du linéaire plat (light + dark).
- **Login (`#page-login`)** : halo indigo radial doux derrière la carte (profondeur, surface « vitrine »).
- **Cartes** : ombre du hover `.mcard` **teintée** indigo (était noir pur) ; hover discret ajouté aux cartes Export (`#csec-export .card`, elles portent une action). Les `.card` info non-cliquables **non** touchées (pas de fausse affordance).

### Fait — refonte cœur SR (Leitner) + perf + notation unifiée (juillet 2026)
Chantier « cœur de projet » (performance révision/SR + affichage des coups), livré en 6 tranches (typecheck + 78 tests + build verts, vérif navigateur end-to-end) :
- **Répétition espacée : SM-2 → Leitner à échelons** (comme Chessable/Chess.com). `leitnerSchedule`/`DEFAULT_LADDER_HOURS` (core.js) remplacent `sm2Schedule`. Record `{level, due}` (avant `{ef, interval, reps, due}`) : bon coup → palier +1 (plafonné), raté → palier 1 ; chaque position a son niveau. Défaut = 8 paliers Chessable (`4h·1j·3j·1sem·2sem·1mois·3mois·6mois`). **Consommateurs** : « appris » = niveau ≥4 (coach.js), « maîtrisées » = niveau ≥6 (sr.js). Migration quasi nulle (pas d’utilisateurs réels) ; un ancien record sans `level` repart du niveau 0. **Décision** : FSRS écarté (post-lancement), pas de re-platform. Cf. §7 (Supabase source de vérité).
- **Échelle éditable par le coach** : réglages SR (`modal-sr-settings`) — presets Standard/Agressif/Détendu + paliers éditables (valeur + unité, ±paliers). Persistée **globalement** (single-coach) `localStorage mc_sr_ladder` ; lue par `sm2Update` via `window._srGetLadder`. Migration-free.
- **SR nouveaux/dus** : nouvelles positions = **flash du bon coup + commentaire PUIS test** (`_srShowFlash`/`srFlashDone`, `S.srFlash` bloque l’interaction ; marquées `_taught`) au lieu du test à froid. **Plafond de dus/session** réglable global (`mc_sr_duelimit`, 0 = illimité, les plus en retard d’abord) + **bandeau backlog** (barre SR + toast).
- **Perf « objectivement-mauvais »** : (a) **pièces cburnett bundlées en local** `pieces/cburnett/*.svg` (fini le CDN Lichess `lila@master`), copie au build (`vite.config.js`), fallback CDN sur `onerror` ; base `import.meta.env.BASE_URL`. (b) `G.oppSeen` écrit en **localStorage débouncé** (600 ms + flush `pagehide`/`visibilitychange`) au lieu d’un `JSON.stringify` par coup adverse. (c) map des positions suspendues **parsée une fois** par `_srBuildQueue`. Board redraw (64 cases) volontairement **non touché** (territoire « mesurer d’abord »).
- **Notation unifiée (mode ligne/test + apprentissage + devine-le-coup)** : composant à classes CSS `.mv` (flux soigné, coup courant surligné, futurs cachés, nœud coach violet) remplaçant les styles inline et le tableau d’apprentissage. **Clic-navigation** : `renderNotation` (test/ligne) → aperçu lecture-seule d’une position passée (`S.preview` honoré par `currentGame()`, **ne mute jamais `S.lineGame`** ; bandeau « revenir au coup courant » ; `canInteract` bloqué en aperçu) ; `renderLearnNotation` → `learnGoto(ply)` (rejoue la ligne). **Éditeur PGN volontairement non touché** (zone critique). L’**arbre d’étude (`renderStudyTree`) a depuis reçu une passe pédagogique présentationnelle** (cf. ci-dessous), sans changer la logique de l’arbre.

### Fait — hiérarchie pédagogique de l’arbre d’étude (juillet 2026)
Retour utilisateur (screenshot) : l’apprentissage affichait **tout l’arbre annoté d’un coup** (fiche de référence, pas une leçon) → surcharge pour un élève. Après maquette + choix utilisateur (**sous-variantes visibles mais nettement secondaires** ; **NAGs conservés** — pas de repli, pas de traduction). Changement **présentationnel uniquement** dans `renderStudyTree` (`lib/drill.js`) + CSS `.study-var` :
- **Ligne principale dominante** : texte fort (13.5px / 600), coup courant surligné indigo (inchangé).
- **Sous-variantes reculées** : plus de **blocs colorés** (retrait des `background:${col}1f` / `border-left-color:${col}` inline et de la palette de profondeur `VAR_COL`) ; texte **estompé + plus petit** par profondeur (`.86em` puis `.8em`, poids 400, `var(--text-2)`→`var(--dim)`) ; simple **rail neutre** `var(--border)` + flèche `↳` en `var(--dim)` comme guide d’indentation. Toujours visibles et cliquables.
- Aucune logique d’arbre modifiée (navigation `studyGoPath`, `nagGlyphs`, comments, mastery marks intacts). Vérifié navigateur (styles calculés) + typecheck/78 tests/build.
- **Carte pédagogique du coup courant** (`renderStudyBubble`, `lib/drill.js`) : l’ancienne bulle 💡 devient une **carte** — en-tête = coup courant (numéro + figurine `fig` + NAG `nagGlyphs`), corps = **commentaire VERBATIM du PGN** du coach (jamais réécrit). Styles `.study-bubble`/`.study-card-head`/`.study-card-move`/`.study-card-body` (fond `--cyan-dim`, bordure `--cyan-glow`, icône `ti-bulb`) ; suppression de l’avatar/flèche de bulle. Masquée si le nœud n’a pas de commentaire (garde inchangée). Vérifié : en-tête figurine+NAG, corps verbatim, masquage sans commentaire.

## 7. Règles de Développement

- **Supabase est la source de vérité.** Clé « publishable » PUBLIQUE OK ; jamais de clé « secret ».
- Toute modification importante dans `app.js` (noyau) doit être justifiée.
- Features **petites et incrémentales** ; **vérifier au navigateur** (et Vitest pour la logique pure) avant de committer.
- `state.js` (`G`) pour l’état partagé, `S` (session.js) pour la session.
- Privilégier le **migration-free** (`extra` jsonb) ; si un vrai changement de schéma est nécessaire, le signaler explicitement (c’est toi qui gères Supabase).

## 8. Pièges Connus

- **Cohérence localStorage ↔ Supabase** : l’app écrit les deux ; en connecté, `_sb*` prime au chargement. Attention aux désynchros.
- L’**éditeur PGN** et le **drill engine** sont des zones sensibles ; l’**échiquier** (`lib/board.js`) attache ses listeners `#board` **au chargement du module** (ordre d’import).
- Le **pont `window`** : un identifiant non déclaré dans un module ES se résout sur `globalThis`, mais on passe explicitement par `window.foo?.(…)` pour les fonctions d’un autre module (déclarées dans `types/globals.d.ts`).
- Un `import` ES est en lecture seule : pour partager un état **réassignable**, passer par les propriétés de `G` (`G.drills = …`), jamais par un `let` importé.
- Certains noms d’état entrent en collision avec des chaînes littérales (`'classes'`, `'results.csv'`) : attention aux remplacements globaux.
- **RLS non durcie** (§3) : `_sbLoadStudentModules` lit toutes les `classes` côté client — à corriger avant l’ouverture multi-coachs.

## 9. Instructions pour Claude Code

Tu es un ingénieur senior pragmatique. **Objectif courant : le Pilier 1 (roadmap §6) pour un lancement mi-septembre.**

- Lis systématiquement ce fichier avant toute modification importante.
- Propose des changements **petits, testables et sécurisés** ; démontre chaque tranche au navigateur.
- **Demande confirmation avant de toucher aux zones critiques** (`app.js`, éditeur, drill engine, échiquier) et **avant tout commit/push**.
- Documente les décisions d’architecture et de données dans ce fichier (roadmap §6, modèle `extra` jsonb).
- Privilégie la maintenabilité à long terme.

---

**Fin du CLAUDE.md**
