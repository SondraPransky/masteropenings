# PLAN — OTKB comme plateforme d'entraînement aux ouvertures

> Document issu d'un cadrage (`/grill-me`) après une semaine de dérive. Il fige la
> **direction produit** et le **périmètre v1**. À lire avant tout nouveau code sur
> la partie « web / élève ». Ne remplace pas [`SPEC.md`](SPEC.md) (l'usine de
> données) ; il définit ce qu'on construit **par-dessus** l'usine.

## 1. La leçon de la dérive

Le besoin réel n'est **pas** « les puzzles qui *démarrent* à une position exacte »
(ce que l'artefact web réduit permettait facilement, et que j'ai construit à tort),
mais **« tous les puzzles qui *suivent* / passent par une position »** — le workflow
enseignant qui existe déjà en local (`explore --moves --out --full`, index
`positions`, PGN avec `{[%start]}`). Toute la conception ci-dessous part de là.

## 2. Vision — plateforme en couches

```
OTKB (usine à données, LOCAL, corpus complet ~10,8 Go, index positions 34,6 M)
   │
   ├── Outil COACH (local, NiceGUI, déjà en place)
   │     ouverture/position → dossier PGN des puzzles qui PASSENT PAR la position
   │     corpus INTÉGRAL, filtre difficulté, parties complètes {[%start]}
   │
   └── export → SUPABASE (nouveau projet dédié, palier GRATUIT)
         corpus RÉDUIT (puzzles populaires) + index positions (FEN hashée)
              │
              └── APP ÉLÈVE (web statique, recyclée de `web/`)
                    v1  : explorer une position → puzzles qui SUIVENT → résoudre
                    +1  : séries partagées par lien
                    +2  : comptes élèves, assignation, suivi de progression
```

## 3. Décisions figées

| Sujet | Décision |
|---|---|
| Utilisateurs | Toi (préparer du matériel) **et** tes élèves (app en ligne) |
| App élève | **Nouvelle app dédiée** (distincte d'EECoach) |
| Cœur métier | « puzzles qui **suivent** une position » (through-position), pas « démarrent à » |
| Outil coach | **Local**, corpus intégral — déjà fonctionnel (onglet « Dossiers élèves ») |
| Backend en ligne | **Nouveau projet Supabase dédié**, palier **gratuit** (500 Mo) |
| Corpus en ligne | **Réduit** (puzzles populaires) pour tenir dans le gratuit |
| Corpus « tous » | En **local** seulement (outil coach). L'intégral en ligne = upgrade payant, plus tard |
| Front élève | **Recycler** échiquier (Chessground) + solveur (chess.js) du `web/` ; **remplacer** la couche données (sql.js → Supabase) ; **ajouter** la navigation par position |
| Design | **À revoir** avant de construire (le look actuel n'est pas validé) |
| Livrable **v1** | Socle Supabase + **explorateur élève** (exploration libre). Rien d'autre |

## 4. v1 — périmètre précis

**But :** un élève ouvre l'app, atteint une position (échiquier jouable + sélecteur
d'ouverture), et obtient **tous les puzzles dont une partie passe par cette
position**, filtrables par difficulté, à **résoudre** en ligne.

**Dans la v1 :**
- Base Supabase : `puzzles` (réduits) + `positions` (index through, FEN hashée) +
  dimensions utiles (`openings`, `themes`).
- App statique (Netlify/GitHub Pages) recyclée de `web/` :
  - échiquier jouable (coups légaux) + sélecteur d'ouverture (asset `openings_moves`) ;
  - requête through → liste des puzzles qui suivent, filtre rating ;
  - solveur (glisser-déposer, indice, solution, suivant).

**HORS v1 (couches suivantes, à ne pas commencer) :**
- Séries préparées + partage par lien.
- Comptes élèves, assignation, suivi de progression.
- Corpus intégral en ligne (reste local).
- Export PGN côté élève (le coach le fait en local).

## 5. Ce qui change pour l'existant

- **`otkb/` (usine + outil coach local)** : **inchangé**, il marche. On y AJOUTE un
  exporter « seed Supabase » (corpus réduit + index positions).
- **`web/`** : devient la base de l'app élève. `web/js/db.js` (sql.js) → client
  Supabase ; on **retire** l'ancien modèle « ouverture par tag » au profit de la
  **navigation par position** ; le design est retravaillé d'abord.
- **`web/data/otkb-web.sqlite`** (artefact sql.js 90 Mo) : plus la source de l'app
  élève (remplacé par Supabase). À conserver pour l'instant — **déclencheur du
  retrait acté le 17/07** (wayfinder, ticket 006) : dès que l'app élève interroge
  Supabase, retirer l'artefact sql.js + la page de garde `index.html` dans le même
  changement que la bascule de `web/js/db.js`. `export-web` et la fiche ADN HTML
  restent des outils locaux pérennes.

## 6. Séquence de travail (une brique validée à la fois)

1. **Design** de l'explorateur élève — maquette (look + UX exacte), validée avant code.
2. **Seed Supabase** — exporter le corpus réduit + l'index positions ; définir le
   schéma (FEN hashée) et les requêtes ; vérifier que ça tient dans 500 Mo.
3. **App élève** — brancher le front recyclé sur Supabase + navigation par position,
   dans le design validé. Déployer.

## 7. Points techniques à trancher au moment du seed (implémentation)

- **Réduction du corpus** : seuil de popularité pour tenir dans 500 Mo (à mesurer).
- **Index positions compact** : `positions(fen_hash BIGINT, puzzle_id)` + index sur
  `fen_hash` ; l'app calcule le même hash côté client. Restreindre aux positions
  d'ouverture (ply faible) si nécessaire.
- **Sécurité** : lecture publique (RLS `select` anon) sur les tables de puzzles.

## 8. RESTE À FAIRE (synthèse — mise à jour 16/07)

### ✅ Acquis (ne pas refaire)
- Usine + passe 2 complètes (1,2 M puzzles, index `positions` 34,6 M lignes, 100 %).
- **Outil coach local opérationnel** : onglet « Dossiers élèves » (ouverture →
  dossier PGN des puzzles qui passent par la position, filtre difficulté,
  `{[%start]}`). C'est le cœur métier, et il marche.
- Explorateur réparé + fiche ADN HTML + carte thermique + thème.
- **Refonte UX complète de l'outil coach (16/07)** : l'Explorateur EST la page
  (onglets Dossiers/Meilleurs puzzles/Comparaison supprimés), composition « Flux »
  validée sur maquettes (suites en pastilles soulignées → tableau des puzzles →
  aperçu 320 px), **niveaux élève FIDE multi-sélection**, retour solveur réparé,
  navigation aux flèches ← →, cache `position_children` (suites instantanées
  partout, position de départ comprise), chargement 15 s → ~3 s.
- **Perf réglée** (voir §9), **y compris l'export PGN** depuis le 16/07 : plus rien
  de lent côté outil coach — cette fois vérifié sur le livrable, pas sur l'aperçu.
- **Cohérence des dossiers réparée (16/07)** : la pagination triée par difficulté
  renvoyait les puzzles les MOINS populaires parmi les ex æquo, et l'export
  contredisait la liste affichée. Cf. §9 et `_ThroughSort`.
- Direction produit cadrée (ce document) + `family-dna.json` + page de garde.

### 🔜 Produit — la séquence validée (une brique VALIDÉE à la fois)
1. **Design de l'app élève** ← *prochaine action*. Maquette (look + UX exacte) à
   valider **avant tout code**. Le coach a explicitement demandé à revoir le design.
2. **Seed Supabase** — nouveau projet dédié, palier gratuit (500 Mo) :
   - choisir le seuil de réduction du corpus (mesurer pour tenir dans 500 Mo) ;
   - schéma compact : `positions(fen_hash BIGINT, puzzle_id)` + index sur `fen_hash` ;
   - ⚠️ le hash FEN doit être **identique côté Python (seed) et JS (app)** — à tester ;
   - RLS : lecture publique anonyme.
3. **App élève** — recycler `web/` (échiquier Chessground + solveur chess.js gardés),
   remplacer `web/js/db.js` (sql.js → client Supabase), **ajouter la navigation par
   position** (le modèle actuel « par tag d'ouverture » n'est PAS le cœur métier).
   Déployer (Netlify/GitHub Pages).

### ⏸️ Couches suivantes (ne pas commencer)
- Séries préparées + partage par lien.
- Comptes élèves, assignation, suivi de progression.
- Corpus intégral en ligne (reste local ; upgrade payant le jour venu).

### 🧹 Dette technique — RÉSORBÉE le 17/07 (wayfinder, cf. `wayfinder/map.md`)
- ~~**Tri par popularité ≈ 2,1 s**~~ → **réglé le 17/07** : cache `position_popularity`
  (WITHOUT ROWID, positions fréquentes seulement, ~12 M lignes ≈ 1 Go — pas les
  +2,7 Go envisagés) construit en passe 3/3 de `build-counts`. Tri poussé dans le
  cache via `through_query` (`pop_cached`) ; repli jointure pour les positions
  rares (instantané). **Mesuré sur 1.e4 : page de 45 en 3 597 ms → 0,8 ms**
  (filtré 1500-2000 : 1 235 ms → 1,3 ms), ordre strictement identique, fichier
  DB inchangé (le cache loge dans les pages libérées par l'index supprimé).
  ⚠️ Le tri popularité est désormais départagé par `puzzle_id`
  (comme tous les tris à travers), plus par `nb_plays` — invariant `_ThroughSort`.
- ~~`positions.puzzle_rating` nullable alors que tout en dépend~~ → **réglé le 16/07**
  par le trigger `trg_positions_rating_not_null` (`schema.sql`), appliqué à la base
  réelle. Un NULL est désormais refusé à l'écriture au lieu d'exclure le puzzle des
  dossiers en silence. `NOT NULL` restait impossible (34,6 M lignes à reconstruire).
  Coût mesuré : +90 % sur l'INSERT brut, soit +67 s sur une reconstruction complète
  qui dure des heures (~0,7 %). L'écrivain (`reconstruct/replay.py`) ne fait plus de
  repli silencieux `getattr(puzzle, "rating", None)` non plus.
- ~~**`idx_positions_normfen` redondant**~~ → **supprimé le 17/07** après vérification
  (EXPLAIN QUERY PLAN sur la base réelle : aucun chemin interactif ne l'utilisait ;
  seul le scan offline de `build-counts` est un peu plus large). DROP en 223 s,
  ~2,7 Go de pages libérées (réutilisées par `position_popularity` — pas de VACUUM).
- ~~**`build-counts` à relancer** si le corpus est ré-ingéré~~ → **réglé le 17/07**
  (« les deux ») : reconstruction AUTO en fin de `download-run`/`import-dataset`
  (`rebuild_position_caches_if_stale`) + marqueur de fraîcheur O(1)
  (`position_caches_maxid`, settings) avec bandeau d'avertissement dans l'UI et
  `explore` si jamais interrompu.
- ~~**`init_schema` silencieux sur l'index de 8 min**~~ → **réglé le 17/07** :
  `Database._warn_heavy_indexes` loggue AVANT toute création d'index lourd sur une
  `positions` peuplée (> 1 M lignes, volumétrie O(1) via MAX(position_id)).
- **`web/data/otkb-web.sqlite` (90 Mo) + page de garde** : retrait **à la bascule
  Supabase** (déclencheur acté §5), pas avant.
- ~~**Prints CLI fatals hors console UTF-8**~~ → **réglé le 17/07** :
  `force_safe_stdio()` (`logging_setup.py`, appelé en tête de `cli.main`) passe
  stdout/stderr en `errors="replace"` — une sortie redirigée cp1252 (Windows)
  remplace « ≥ »/« → » par `?` au lieu de tuer la commande (build-counts avait
  crashé après 128 s de calcul). `PYTHONUTF8=1` n'est plus nécessaire.
- Évals Stockfish (jointure par `normalized_fen`) = enrichissement ultérieur.

## 9. Perf — état mesuré (ne pas re-découvrir)

| Opération | Avant | Après |
|---|---|---|
| Explorateur — un coup | 0,40 s | **0,005 s** |
| Dossiers — compteur filtré | 13,92 s | **0,10 s** |
| Dossiers — aperçu de la liste | 16,49 s | **0,003 s** |
| **Dossiers — PGN réellement téléchargé** | **14,29 s** | **0,06 s** (16/07) |

⚠️ La dernière ligne a longtemps manqué à ce tableau, et c'est instructif : la passe
perf du 15/07 avait optimisé `list_puzzles_through` (l'**aperçu** à l'écran) mais
jamais `export_through_position` (le **fichier** que le coach télécharge), qui a sa
propre requête et était resté sur le filtre par jointure. Le tableau affichait donc
« 0,003 s » pour un clic qui en coûtait 14,3. Corrigé le 16/07 en donnant à la
sélection un point unique de vérité (`through_query`).

Trois causes, trois correctifs : (1) PRAGMA par défaut inadaptés à 15+ Go (2 Mo de
cache, pas de mmap) ; (2) compteur « à travers » qui parcourait jusqu'à 1,2 M lignes
→ cache `position_counts` des ~25 k positions fréquentes (`otkb build-counts`) ;
(3) filtre de difficulté qui joignait `puzzles` (779 k lookups) → index
`idx_positions_normfen_rating` + filtre/tri dans `positions.puzzle_rating`, et
dédoublonnage **en flux** (`GROUP BY puzzle_rating, puzzle_id`) au lieu d'un
`COUNT(DISTINCT)` coûteux. Base : 15,7 → **18,4 Go**.

⚠️ **Faits de données vérifiés** (ne pas re-mesurer) : `puzzle_rating` est peuplé sur
**34 579 908 / 34 579 908** lignes (0 NULL, 0 incohérence) ; **0 puzzle n'a deux
ratings** (1 207 204 puzzles = 1 207 204 paires) — c'est ce qui rend le `GROUP BY`
exact ; il existe **3 540 doublons** `(fen, puzzle_id)` (0,01 %, parties repassant
par une position) — donc **un `COUNT(*)` nu serait FAUX**.

## 10. Risques connus

- Le corpus réduit en ligne = tous les puzzles **populaires**, pas les 188 k d'une
  grosse famille. Assumé pour la v1 (le coach a l'intégral en local).
- Recalculer un hash FEN identique côté Python (seed) et côté JS (app) — à tester.
- Le design est un préalable non tranché : ne pas coder l'app avant validation.

## 11. Mise à l'échelle EN LIGNE multi-coachs — plan figé (grill 18/07/2026)

> Cadrage `/grill-me` (côté EECoach). **Décision produit : l'explorateur, intégré à
> EECoach comme 8e section coach via le pont localhost, doit passer EN LIGNE pour
> PLUSIEURS COACHS** (rôle `teacher`, pas les élèves) — hébergé, PAS la machine du
> coach. **Corpus INTÉGRAL conservé** (l'utilisatrice a écarté le corpus réduit du §2 :
> les coachs doivent tomber sur n'importe quel puzzle). Trafic borné (coachs). Post-lancement.

**Écarté** : migrer les 18 Go dans EECoach (ne résout rien) ; RocksDB (sur-dim +
mismatch : OTKB est **relationnel** read-heavy à 34,6 M, pas KV write-heavy à l'échelle
Lichess — SQLite reste le bon backend) ; réutiliser lila-openingexplorer (indexe des
parties, pas des puzzles through-position).

**Réduction 18,4 → ~2-3 Go, corpus intact** (standard échecs : Polyglot/Lichess hashent
la position, ne stockent jamais la FEN texte) :
1. `VACUUM` (−1,7 Go de pages libres).
2. **`normalized_fen TEXT (58 o)` → `fen_hash INTEGER` Zobrist (8 o)** dans la table + les
   2 index qui le répètent → −~5 Go. `python-chess` fournit `chess.polyglot.zobrist_hash`.
   Migration par **REBUILD** (pas `ALTER` en place). Collisions négligeables (34,6 M « 2³²).
3. Drop l'index redondant `idx_positions_normfen_rating` (trier le petit résultat à la volée) → −~3 Go.
4. `sqlite_zstd_vfs` (zstd lecture-seule transparent) → ~2-3 Go. Optionnel.

> ⚠️ **Le risque §10 « hash FEN identique Python↔JS » DISPARAÎT** : le pont hashe la FEN
> **côté serveur** (le front envoie la position, pas le hash) → une seule implémentation (python-chess).

**Concurrence + auth** : SQLite en **WAL** + connexion lecture-seule/requête (remplace le
pont mono-thread). **Gate JWT coach** : le pont valide le JWT Supabase EECoach (PyJWT +
clé publique JWKS asymétrique, filtre `role=teacher`), CORS restreint à l'origine Pages.

**Hébergement — X TRANCHÉ (18/07, question latence)** (communs : ~2-3 Go + WAL + JWT ;
EECoach change à peine : `ODP_BRIDGE_URL` → URL hébergée + header Bearer) :
- **X. Instance managée — CHOISI** (Fly.io/Railway/VPS Hetzner ~5 €/mo) = le **bridge Python
  existant** durci, base SQLite sur **disque local NVMe**, app+donnée colocalisées. C'est la
  **pratique standard** (déploiement SQLite classique) ET le plus **rapide** : 1 aller-retour
  réseau/requête (~30-80 ms depuis la France), lookups ~1 ms NVMe/RAM. Check-list « pas
  lent » : région **Europe** (un serveur US = +100 ms/clic) ; **always-on** (désactiver
  l'auto-stop Fly, sinon réveil de plusieurs secondes) ; **RAM ≥ base chaude ~2-4 Go** + mmap
  (les index en cache OS — rendu possible PAR la réduction, impossible à 18 Go) ; NVMe, pas
  de volume réseau ; garder les caches précalculés (`position_counts`, thermique).
- **Y. Serverless Worker + R2** — écarté : chaque traversée de B-tree = une **cascade de
  range requests HTTP** (3-6+ allers-retours séquentiels, 100-500 ms à froid, variable). Ne
  redevient intéressant qu'en cas d'ouverture à un trafic large (élèves/public). (R2 : 10 Go
  gratuits + zéro egress ; pattern `sql.js-httpvfs`.)

Détail complet + sources → mémoire EECoach `otkb-explorer-scaling`.
