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
- **Modularisation aboutie** : ~15 modules `lib/*` (voir Carte des fichiers). `app.js` réduit de **4412 → 1275 lignes (−71 %)** — il ne reste que login/auth, la couche Supabase `_sb*`, l’init, les helpers UI et le pont `window`. ⚠️ **Le gain s’érode** : `app.js` (1275) et `lib/drill.js` (1116) repassent au-dessus de 1000 lignes → candidats décomposition (cf. audit qualité juillet 2026).
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
| RLS : `_sbLoadStudentModules` lit **toutes** les `classes` puis filtre côté client | Moyen | Un élève connecté peut lire les classes des autres → à durcir avant l’ouverture multi-coachs. |
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
| `lib/drill.js` | Drill — **toute l'UI** : modes ligne / positions clés-flash / arbre-étude, phases apprentissage & test, fin de drill (`showEndModal`, `replayErrors`). `S` partagé ; app-level/SR via pont `window` | ~48 Ko |
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
   - ✅ **P1.1b fait** (saisie sur l'échiquier) : l'éditeur devient un **producteur de PGN** en « mode partie » — `_E.target='game'` (`openGameEditor(pgn)` charge le PGN déjà tapé, masque les champs module, adapte le titre) ; `saveEditorDrill` branche vers `_saveEditorGame` qui sérialise l'arbre → PGN et le rend au modal via `window._boardEntryDone` (le modal reste ouvert **dessous**, éditeur `z-index:200`). Bouton **« ⛃ Saisir sur l'échiquier »** dans `modal-new-game` → `openBoardEntry`. `closeEditorModal` restaure le mode module (target/champs/titre) → **flux module inchangé**. Métadonnées toujours saisies dans le modal (une seule place). Vérifié navigateur (round-trip PGN, garde plateau vide, module intact).
3. ✅ **P1.2 fait** — créer / **renommer** plusieurs bases + choisir la base de destination + nature de l’entrée. `renameBase(id)` (prompt, boutons ✏️ sur cartes + vue détail, persiste via `save`/`_sbSaveBases`) ; modal `modal-new-game` : select `ng-base` (peuplé/présélectionné sur la base ouverte, redirige la cible à l’enregistrement) + select `ng-nature` (Partie/Analyse → `rec.nature`, icône 📝/♟️ dans la liste). Vérifié navigateur (redirection base, nature analyse, renommage). *(Import en ligne = post-lancement.)*
4. ✅ **P1.3 fait** — bouton **partager au coach** : `toggleShareGame(id)` (flag `shared` dans `games.extra`, `lib/library.js`), bouton 📤 Partager / ✓ Partagé sur chaque entrée. Coach : `renderPartiesTab` (`lib/coach.js`) décompose désormais **parties Maia** (sans `baseId`) vs **section « Parties partagées par les élèves »** (`baseId` + `shared`) — corrige au passage l’affichage `undefined` des entrées bibliothèque dans cet onglet. *(Filtrage fin par `teacher_id` de la classe = à la gate connectée / multi-coachs.)*
5. ✅ **P1.4 fait** — **revue coach** additive : `openReviewEditor(pgn,{gameId,role,white,black})` ouvre la partie dans l’éditeur en `_E.target='review'` (champs module masqués, titre/bouton adaptés). Coach (`role:'coach'`, bouton **🧑‍🏫 Annoter** dans la section partagée) : tout coup ajouté est tagué `author:'coach'` (`editorApplyMove`) **sans réécrire** les coups de l’élève ; `_saveEditorReview` sérialise l’arbre annoté → `_reviewSaveDone(gameId,pgn,role)` (library) écrit `g.pgn` + `g.reviewedAt`. Encodage `author` round-trip via `[%author coach]` dans le commentaire PGN (`lib/editor-core.js` : `_parseShapes`/`pgnToEditorTree`/`_commentWithShapes`). Nœuds coach **colorés en violet** (`#7c3aed`) dans la notation.
6. ✅ **P1.5 fait** — l’élève rouvre sa partie via **🔎 Revoir / 📖 Voir la revue** (`openGameReview`, `role:'student'`) : mêmes annotations, ajouts du coach **en violet**, badge **✨ Annotée** sur l’entrée. Vérifié navigateur (round-trip `author`, partage→annotation→relecture, section coach). Typecheck + 77 tests OK.
7. ✅ **Gate release FAITE (12 juillet 2026)** — **validation connectée Supabase** verte (round-trip parties / bases / partage / annotations + RLS négatif), sur 2 comptes réels. Reproductible : `npm run gate`. Détail → §2 (gate de release) + `tests/gate/README.md`.

### Post-lancement
- **Import de parties en ligne** (Lichess / Chess.com) dans « Ma bibliothèque » : URL de partie Lichess → GET API publique → PGN (faible coût, gros gain d’usage). Chess.com ensuite.
- **Exercices** (tactiques / mats) : « position → trouve le bon coup » → **réutilise le mode `positions` / flash existant** (peu coûteux le moment venu). Le prof pourra assigner des **bases d’exercices** comme il assigne déjà des ouvertures.
- **Bibliothèque d’exercices partagée entre coachs** (+ durcissement RLS multi-coachs, cf. §3).
- Une éventuelle **v2 en React / Tailwind / shadcn** (re-platform assumé) et une passe de **polish visuel global** — décidés explicitement, jamais mid-sprint.

### Fait — §6 #4 Assignation : échéance par module dans la classe
- **Modèle** : une classe porte `moduleDeadlines = { moduleId: 'YYYY-MM-DD' }`, persisté dans `classes.extra.deadlines` (jsonb) → aucune migration (`lib/dbmap.js`).
- **Coach** : formulaire de classe (`lib/modules.js`) — date-picker par module (`_toggleModDeadline`) ; `saveClass` collecte, `openEditClass` repeuple ; `renderClassList` affiche l’échéance.
- **Élève** : `_sbLoadStudentModules` applique l’échéance d’assignation **la plus proche** (prime sur la `deadline` du module) ; `_shModuleCard` affiche un badge (⚠ retard / ⏰ Nj / 📅 date).
- **Suivi par module × élève** : `renderClassesTab` (coach.js) décompose chaque classe par module (pastille échéance + `✅ faits/roster`) × élève (fait `%·récence` / en retard / pas commencé).

### Fait — refonte création & dashboard coach (juillet 2026)
- **Fusion onglets Élèves + Classes** : la sidenav coach n’a plus d’onglet « Classes » ; la gestion des classes (formulaire + liste + suivi) vit dans l’onglet **Élèves** (sous la progression). `switchCoachSection('eleves')` rend aussi les classes ; `switchCoachSection('classes')` supprimé (repointé sur `'eleves'`).
- **Bouton « Créer » unifié** : les 3 boutons (Bibliothèque/Échiquier/Nouveau module) remplacés par un seul **+ Créer** → `modal-create-choice` (Sur l’échiquier · Coller un PGN · **Depuis une position** · Bibliothèque). `openCreateChoice` (`lib/modules.js`).
- **Éditeur de position** (`lib/setup.js`, `modal-position-setup`) : échiquier de placement (palette pièces + gomme, un seul roi/camp), **trait**, champ **FEN bidirectionnel**. `openPositionSetup` (module) / `openPositionSetupForGame` (partie). Roques/en-passant : défaut (aucun droit), pas d’UI dédiée.
  - **Round-trip position custom** : `editorTreeToPGN(root, startFen)` préfixe `[SetUp]`/`[FEN]` si non-standard ; `extractAllLines` (core.js) honore l’en-tête `[FEN]` ; `openReviewEditor` ré-extrait le FEN d’un PGN de partie ; `openPgnEditorNew`/`openGameEditor` acceptent un `startFen` ; `saveEditorDrill` écrit `sessions[0].startFen`. Vérifié : module custom (setup→éditeur→save→réouverture→**drill démarre depuis la position**) et partie custom (bouton « Depuis une position » du modal Nouvelle partie → round-trip FEN).

### Fait — refonte cœur SR (Leitner) + perf + notation unifiée (juillet 2026)
Chantier « cœur de projet » (performance révision/SR + affichage des coups), livré en 6 tranches (typecheck + 78 tests + build verts, vérif navigateur end-to-end) :
- **Répétition espacée : SM-2 → Leitner à échelons** (comme Chessable/Chess.com). `leitnerSchedule`/`DEFAULT_LADDER_HOURS` (core.js) remplacent `sm2Schedule`. Record `{level, due}` (avant `{ef, interval, reps, due}`) : bon coup → palier +1 (plafonné), raté → palier 1 ; chaque position a son niveau. Défaut = 8 paliers Chessable (`4h·1j·3j·1sem·2sem·1mois·3mois·6mois`). **Consommateurs** : « appris » = niveau ≥4 (coach.js), « maîtrisées » = niveau ≥6 (sr.js). Migration quasi nulle (pas d’utilisateurs réels) ; un ancien record sans `level` repart du niveau 0. **Décision** : FSRS écarté (post-lancement), pas de re-platform. Cf. §7 (Supabase source de vérité).
- **Échelle éditable par le coach** : réglages SR (`modal-sr-settings`) — presets Standard/Agressif/Détendu + paliers éditables (valeur + unité, ±paliers). Persistée **globalement** (single-coach) `localStorage mc_sr_ladder` ; lue par `sm2Update` via `window._srGetLadder`. Migration-free.
- **SR nouveaux/dus** : nouvelles positions = **flash du bon coup + commentaire PUIS test** (`_srShowFlash`/`srFlashDone`, `S.srFlash` bloque l’interaction ; marquées `_taught`) au lieu du test à froid. **Plafond de dus/session** réglable global (`mc_sr_duelimit`, 0 = illimité, les plus en retard d’abord) + **bandeau backlog** (barre SR + toast).
- **Perf « objectivement-mauvais »** : (a) **pièces cburnett bundlées en local** `pieces/cburnett/*.svg` (fini le CDN Lichess `lila@master`), copie au build (`vite.config.js`), fallback CDN sur `onerror` ; base `import.meta.env.BASE_URL`. (b) `G.oppSeen` écrit en **localStorage débouncé** (600 ms + flush `pagehide`/`visibilitychange`) au lieu d’un `JSON.stringify` par coup adverse. (c) map des positions suspendues **parsée une fois** par `_srBuildQueue`. Board redraw (64 cases) volontairement **non touché** (territoire « mesurer d’abord »).
- **Notation unifiée (mode ligne/test + apprentissage + devine-le-coup)** : composant à classes CSS `.mv` (flux soigné, coup courant surligné, futurs cachés, nœud coach violet) remplaçant les styles inline et le tableau d’apprentissage. **Clic-navigation** : `renderNotation` (test/ligne) → aperçu lecture-seule d’une position passée (`S.preview` honoré par `currentGame()`, **ne mute jamais `S.lineGame`** ; bandeau « revenir au coup courant » ; `canInteract` bloqué en aperçu) ; `renderLearnNotation` → `learnGoto(ply)` (rejoue la ligne). **Éditeur PGN et arbre d’étude (`renderStudyTree`) volontairement non touchés** (zones critiques / rendu arborescent).

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
