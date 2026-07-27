# CLAUDE.md — Opening Tactical Knowledge Base (OTKB)

Guide opérationnel pour Claude Code. **Source de vérité = [`SPEC.md`](SPEC.md)** —
le lire avant toute décision de conception. Ce fichier en est le résumé actionnable.

## Ce qu'est le projet

Usine Python **locale** qui indexe les puzzles d'ouverture Lichess pour produire
la **fiche « ADN tactique »** de chaque ouverture (motifs dominants, variantes les
plus tactiques, coup moyen d'apparition…). Satellite d'EECoach (repo `maiachess`),
**aucun code partagé**. L'usine produit un **artefact SQLite réduit** que le web
consommera (sql.js) — c'est le seul pont.

## Règles de garde (NON négociables)

- 🌐 **Phase 1 (v0.1) = ZÉRO réseau.** Toute la valeur (ingestion, ADN, explorer
  FEN-lookup) sort du CSV seul. Le download est la phase 2 (v0.4).
- 📦 **Rien de lourd dans git** : CSV, cache de parties, `*.db` sont gitignorés.
  Vérifier `.gitignore` avant tout commit.
- 🔑 **Aucun secret dans un fichier versionné.** Token Lichess **optionnel, aucun
  scope** (export public) — le levier de vitesse est le batch `_ids`, pas l'auth.
  Lu depuis `LICHESS_TOKEN` (env) ou `config.local.toml` (gitignoré). Jamais dans
  le code, le SPEC, ce fichier, ni les logs.
- ✋ **Demander confirmation avant tout commit/push.**
- 🚫 **Ne pas importer le `CLAUDE.md` d'EECoach** (vanilla-JS/Supabase, non pertinent).

## Décisions verrouillées (2 grills) — ne pas re-litiger

| Sujet | Décision |
|---|---|
| Filtre passe 1 | `OpeningTags` ≠ ∅ **ET** `fullmove < 25` (= tous les taggés ; seuil dans `settings`) |
| Schéma | **hybride** : brut sur `puzzles` + dimensions `openings`/`themes` + jonctions ; tables **snake_case** |
| Navigation v1 | **FEN-lookup** + **agrégation par `OpeningTags`** ; pas d'arbre SAN ; **pas de download en v1** |
| ADN | métadonnées d'abord (pur CSV) ; cases critiques/sacrifices = tranche 2-bis (python-chess **offline**) |
| Thèmes | asset curated `otkb/assets/themes.json` → `is_motif` + `label_fr` ; % = part des puzzles portant le motif |
| Familles / ECO | familles par **préfixe global** (`recompute_families`) ; **ECO NULL** en v1 |
| Sortie ADN | **CLI texte + `--json`** (format pivot) |
| DB | **`sqlite3` brut + `schema.sql`** ; ❌ pas de SQLAlchemy/Alembic (base = cache reconstructible → on rebuild) |
| Ingestion | **`csv` stdlib streaming** ; ❌ pandas hors pipeline |
| UI | CLI d'abord ; **NiceGUI** (v0.2) ; échiquier = **Chessground** (lib Lichess, pièces cburnett) vendu en local dans `otkb/ui/static/`, offline |
| Réseau (v0.4) | **httpx séquentiel + batch `_ids` ×300 + backoff 429** ; ❌ pas parallèle |

## Faits de données (mesurés sur le vrai CSV, ne pas re-découvrir)

- `lichess_db_puzzle.csv` : **racine du projet**, 1,1 Go, **6 057 357** lignes.
- Colonnes : `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags`.
- **1 207 205** puzzles taggés (19,9 %) — le corpus v1. 100 % ont `fullmove < 25`.
- ⚠️ **Le CSV ne contient NI ECO NI joueurs/Elo joueurs** (que `GameUrl`). Ces
  infos → phase 2 (download). `Rating` = difficulté du **puzzle**, pas Elo joueur.
- ⚠️ **`positions.puzzle_rating` est OBLIGATOIRE** (trigger `trg_positions_rating_not_null`) :
  tout le filtre de difficulté l'interroge, donc un NULL exclurait le puzzle des
  dossiers **en silence**. Toute écriture dans `positions` — code **ou fixture de
  test** — doit le renseigner.
- FEN puzzle = position AVANT le coup qui pose le puzzle ; `Moves[0]` = coup de
  l'adversaire, `Moves[1:]` = la solution. `GameUrl` finit par `#ply`.

## Roadmap versionnée

- **v0.1** ✅ — ingestion CSV + SQLite + ADN (CLI/json) + 2-bis + stub downloader.
- **v0.2** ✅ — explorateur **NiceGUI** : échiquier **Chessground** (drag&drop,
  pièces cburnett, offline) + compteurs live + thèmes/ouvertures/suites par
  position + **solveur de puzzles** (liste triable/paginée, indice, solution,
  suivant) + onglet **Meilleurs puzzles** par ouverture + **comparaison** de
  familles + thème clair/sombre + responsive. Voir `otkb/ui/`.
- **v0.4** ✅ — **passe 2** : download batch → rejeu → vérif FEN →
  `positions` → base des ~1,2 M exercices (cf. SPEC §D-ter). **100 % drainé**
  (`download-run`, reprenable et increvable) : `downloads` = 1 207 204 `done`,
  0 `pending` ; `positions` ≈ 34,6 M lignes. Le mode `--full` couvre désormais
  tous les puzzles.
- **v1.0** (quasi complète) — **artefact web réduit** ✅ (`export-web` : SQLite
  sql.js dérivé, offline) · **updater incrémental** ✅ (`update` : ré-ingère un
  CSV plus récent, +nouveaux seulement, journal `updates`) · **fiche ADN HTML** ✅
  (`adn --html` : page autonome offline, CSS inline, thème clair/sombre) ·
  **export-web accéléré** ✅ (PRAGMA cible jetable → ~2,2×, page_size 8192) ·
  **recherche par position ~500×** ✅ (index couvrant `idx_positions_normfen_puzzle`) ·
  **workflow enseignant** ✅ : dossier PGN des puzzles **passant par** une position
  (`explore --out`), triable par difficulté, filtrable par plage de rating,
  format **minimal ou partie complète** (`--full`, avec `{[%start]}`) ; bouton
  « Télécharger un dossier » + interrupteur dans l'UI. **Passe 2 terminée à 100 %**
  (cf. v0.4) — plus aucun gros reste ; seuls des points facultatifs subsistent.

## ⭐ DIRECTION PRODUIT (cadrée le 15/07, soir) — lire [`PLAN.md`](PLAN.md)

Après une semaine de dérive, la direction est **figée dans [`PLAN.md`](PLAN.md)**
(issu d'un `/grill-me`). En bref :

- **Cœur métier = « puzzles qui SUIVENT / passent par une position »** (through-position,
  index `positions`), **PAS** « qui démarrent à » (l'erreur de la semaine).
- **Plateforme en couches** : OTKB reste l'usine LOCALE (corpus complet) → (1) outil
  coach local (onglet « Dossiers élèves », déjà là) ; (2) app élève web dédiée
  (≠ EECoach), servie par un **nouveau Supabase gratuit** (corpus RÉDUIT + index
  positions à FEN hashée).
- **v1** = socle Supabase + explorateur élève (exploration libre par position).
  Séries/liens/comptes = couches suivantes. **Corpus « tous » = local seulement.**
- **Séquence** : (1) design de l'app élève (à valider) → (2) seed Supabase → (3) app.
  Le `web/` actuel sera **recyclé** (échiquier/solveur gardés, sql.js→Supabase),
  **design à revoir avant tout code**. Ne rien coder côté Supabase/app avant validation.

## REPRENDRE PLUS TARD — état au 15/07

**Explorateur NiceGUI RÉPARÉ** (`1991d08`, vérifié vrai Chrome : échiquier + 33
pièces, survit au changement d'onglet, 0 erreur console). ⚠️ **L'Explorateur DOIT
rester l'onglet par défaut** : l'init Chessground ne tourne qu'une fois et cherche
`#otkb-cg`, absent si un autre onglet est actif au chargement (c'est ce qui l'avait
cassé).

**UI refondue sur l'identité EECoach (16/07)** — zinc/indigo, polices vendues
(`otkb/ui/static/fonts/`), thème sombre token-level ; l'ancienne identité
« planche-spécimen » ne reste que sur la fiche ADN HTML et la page de garde web.
**L'Explorateur EST la page — plus AUCUN onglet** : « Dossiers élèves » absorbé
(son sélecteur d'ouverture par nom vit à côté du champ FEN), « Meilleurs
puzzles » et « Comparaison » SUPPRIMÉS (16/07, « on se concentre sur
l'explorateur ») — leurs caches d'ADN famille ne sont plus construits au
démarrage de l'UI (le CLI `adn`/`export-web` construit les siens).
Composition « Flux » validée sur maquette (artifact) : bande « Suites les plus
jouées » (pastilles SOULIGNÉES, cache `position_children`, clic = jouer le coup)
AU-DESSUS du tableau des puzzles « qui suivent » (seuil 2 demi-coups, tri par
en-tête, clavier OK, tableau borné 660 px) + aperçu épinglé 320 px (2ᵉ Chessground
viewOnly, survol/focus 100 % client) + **niveaux élève FIDE multi-sélection**
(`otkb/ui/levels.py` — 3 échelles distinctes documentées dedans ; pastilles à
bascule, plages fusionnées/disjointes via `levels_ranges`) + dialogue de
téléchargement PGN au même vocabulaire. À gauche : échiquier, contrôles
(« Quitter le puzzle » remplace Départ/Annuler en mode solveur), thermique seule.
⚠️ Les vignettes SVG (`board.py::_SVG_COLORS`) utilisent les cases brown lichess
= celles de Chessground : ne pas les « thémer » en zinc, c'était le défaut.
⚠️ « Popularité » comme tri des puzzles « à travers » dans l'UI : la raison PERF a
disparu le 17/07 (cache `position_popularity`, tri instantané), mais le tri UI
reste « difficulté seulement » parce que la pagination multi-niveaux
(`_walk_ranges`) découpe par plages de rating — incompatible avec un ordre
popularité inter-plages. Ne l'offrir dans l'UI qu'en repensant ce découpage.
⚠️ Tout accès DB dans un handler NiceGUI passe par `run.io_bound`, et tout
`ui.run_javascript` par le wrapper `_js()` (timeout 1 s par défaut sinon, dont
l'échec TUAIT la page — spinner éternel). ⚠️ JAMAIS de sondage serveur→client en
boucle (`run_javascript` répété) : c'est le client qui SIGNALE (`otkb_cgready`)
— l'ancien sondage retardait tout le contenu de ~15 s au chargement.

**Passe PERF terminée** (`4216df6`, `ba0ba7a`, `f7022ca`) — l'outil était lent
*précisément* sur les positions d'ouverture. Tout est mesuré (détail dans « Base
mesurée ») : explorateur **0,40 s → 0,005 s** par coup · dossier filtré
**16,5 s → 0,003 s** · compteur filtré **13,9 s → 0,10 s**.

**Revue qualité de la passe perf (16/07)** — deux défauts qu'elle avait laissés :
1. **L'export PGN n'avait jamais été optimisé** : `ba0ba7a` ne touche pas
   `pgn_export.py`, qui gardait sa propre requête et le vieux filtre par jointure →
   le dossier réellement téléchargé mettait **14,3 s** quand l'aperçu était
   instantané. La sélection a désormais un point unique de vérité, `through_query`
   (`explorer/insights.py`) → **0,06 s**.
2. **La pagination triée par difficulté était incohérente** : le tri poussé dans
   l'index et le tri d'affichage divergeaient → page 1 = les puzzles les MOINS
   populaires parmi les ex æquo, et l'export contredisait l'écran. Modèle de tri
   unique (`_ThroughSort`), tout départagé par `puzzle_id`.

**Passe 2 finie (100 %)** : `downloads` 1 207 204 `done` / 0 `pending`, `positions`
≈ 34,6 M lignes. **Correctif `{[%start]}`** (`bb4497f`) : marqueur après `Moves[1]`.
**Artefact web** : colonnes redondantes `opening_tags`/`themes` retirées
(reconstruites par jointure — ⚠️ le consommateur doit joindre, ou lire la vue
`puzzle_display`) → complet **659 Mo**, p95 **153 Mo**. Site `web/` statique
existant — **à recycler**, cf. [`PLAN.md`](PLAN.md).

➡️ **RESTE À FAIRE : voir la section dédiée de [`PLAN.md`](PLAN.md)** (produit :
design app élève → seed Supabase → app ; + dette technique connue).

## Architecture (grandit par tranche, SRP, pas de dossier vide)

```
otkb/
  config.py          réglages (+ config.local.toml, + env LICHESS_TOKEN)
  fen.py             normalisation FEN (4 champs) + fullmove/side
  openings.py        parse tags + compute_family (préfixe global)
  models.py          dataclasses
  logging_setup.py
  cli.py             python -m otkb <cmd>
  db/                schema.sql (tables + caches) + database.py (accès sqlite3 brut)
  assets/            themes.json (mapping is_motif/label_fr)
  ingest/            reader (csv streaming) + pipeline (points 1→6)
  adn/               queries (agrégation SQL) + report (texte/json)
  explorer/          query (compteurs/get_puzzle) + insights (thèmes/ouvertures/
                     suites par position, familles, top puzzles, caches)
  ui/                app NiceGUI : l'Explorateur = LA page (suites, tableau des
                     puzzles, solveur intégré, niveaux élève — levels.py) ; board
                     (état + rendu SVG des vignettes) ; data (façade cachée,
                     verrou sqlite) ; static/ = assets Chessground vendus
  pgn/               exercice minimal (FEN, offline) + annoté ({[%start]})
  analysis/          2-bis : cases critiques + sacrifices (python-chess offline)
  downloader/        game_id, file downloads, client httpx batch _ids (fetch=v0.4)
  reconstruct/       rejeu + vérif FEN + index positions (points 10-12)
  exporters/         export PGN d'une ouverture + artefact web réduit (web_export)
                     ·  importers/  dataset HF → positions
tests/               tests SANS réseau (+ fixtures/)
data/                CSV/cache/.db  — GITIGNORÉ
```

Dépendances : phase 1 = **stdlib seule**. `pgn`/`analysis`/`reconstruct` utilisent
**python-chess** (extra `analysis`, offline). `downloader.client` utilise **httpx**
(extra `pass2`, import paresseux) — réseau uniquement en v0.4.

## Commandes

```bash
python -m otkb init-db                                   # crée data/otkb.db
python -m otkb ingest --csv lichess_db_puzzle.csv        # passe 1 (~5 min plein)
python -m otkb update --csv newer.csv [--source-label X] # updater incrémental (offline, +nouveaux)
python -m otkb adn Sicilian_Defense [--json|--html f.html]  # fiche ADN (texte/JSON/HTML autonome)
python -m otkb analyze                                   # passe 2-bis (offline, python-chess)
python -m otkb build-counts [--min-count 50]             # caches des positions fréquentes (3 passes) : compteurs « à travers » + suites (position_children) + tri popularité (position_popularity) → explorateur, suites ET tri popularité instantanés ; pose le marqueur de fraîcheur
python -m otkb exercise <puzzle_id> [--out f.pgn]       # exercice minimal (offline)
python -m otkb export Sicilian_Defense --out sicilian.pgn
python -m otkb explore --moves "e2e4 e7e5 g1f3" [--out d.pgn --limit N --sort rating_asc --min-rating X --max-rating Y --full]  # puzzles à/à travers une position (+ dossier PGN en lot ; tri/filtre difficulté ; --full = partie complète depuis coup 1)
python -m otkb ui [--port 8080] [--no-show]              # explorateur interactif (NiceGUI, extra ui)
python -m otkb download-prepare [--opening X]            # file de download (offline, sans fetch)
python -m otkb download-run [--max-batches N]            # RUN réseau (v0.4, token) → positions
python -m otkb export-web [--out data/otkb-web.sqlite]   # artefact SQLite réduit (sql.js, offline)
python -m pytest -q                                      # tests (sans réseau)
```

**Artefact web réduit** (`export-web`, offline) : dérive de `otkb.db` une base
sql.js compacte = passe 1 + 2-bis + caches ADN (puzzles aux **colonnes élaguées** :
retirés `rating_deviation`/`game_url`/`game_id` + les **redondants** `opening_tags`/
`themes` reconstructibles sans perte via jonctions — vue **`puzzle_display`** les
restitue en colonnes à coût nul : `SELECT opening_tags, themes FROM puzzle_display
WHERE puzzle_id=?`), jonctions, dimensions, `statistics`/`family_*`,
`puzzle_analysis`, **sans** le bloc passe 2 (`positions`/`games`/`downloads`/`updates`).
Corpus complet FEN-lookup : 1,2 M puzzles → `data/otkb-web.sqlite` ≈ **659 Mo**
(gitignoré via `*.sqlite` ; était 774 Mo avant retrait `opening_tags`/`themes`).
`--min-popularity N` allège pour le navigateur (les caches ADN restent calculés
sur le corpus complet, les « meilleurs puzzles » restent inclus) : mesuré
`N=95` → **~153 Mo** (278 k puzzles), `N=90` → ~54 % du corpus.
Schéma = **sous-ensemble** de `db/schema.sql` (mêmes noms) : `otkb/exporters/web_schema.sql`.

**Base mesurée** : 1 207 204 puzzles, 1586 ouvertures, 69 thèmes (passe 1 ≈ 820 Mo).
Avec l'index `positions` peuplé à **100 %** (1 207 204 parties, ≈ 34,6 M lignes
pour **18,2 M positions distinctes** — 1,9 occurrence en moyenne) : `data/otkb.db`
≈ **18,4 Go** (dont ~2,7 Go pour `idx_positions_normfen_rating`).

**PERF (mesurée, ne pas re-découvrir)** — l'explorateur était lent *précisément*
sur les positions d'ouverture (les plus fréquentes). Tout le temps partait dans le
compteur « à travers » ; les autres panneaux coûtent ~0 s. Trois correctifs :
1. **PRAGMA** (`database.py`) : les défauts (2 Mo de cache, pas de mmap) donnaient
   4,4 s à froid vs 0,26 s à chaud sur 15+ Go → cache 256 Mo + mmap 4 Go.
2. **`position_counts`** (cache, `otkb build-counts`) : seules ~25 k positions
   (≥ 50 occurrences) sont coûteuses à compter → 0,40 s → **0,005 s** par coup.
3. **`idx_positions_normfen_rating`** + filtre/tri sur `positions.puzzle_rating`
   (dénormalisé, vérifié **0 NULL sur 34,6 M**, 0 incohérence) au lieu de joindre
   `puzzles` : dossier filtré+trié 16,5 s → **0,003 s**.
4. **Sélection canonique `through_query`** (`explorer/insights.py`) — point unique
   de vérité « quels puzzles passent par cette position » (filtre, tri, pagination).
   L'export PGN avait sa PROPRE requête et était donc resté sur le vieux filtre par
   jointure : le dossier réellement téléchargé mettait encore **14,3 s** quand
   l'aperçu à l'écran était instantané → **0,06 s**. Les consommateurs (liste UI,
   `export_through_position`) ne diffèrent plus que par les colonnes hydratées.
⚠️ **Tri : `puzzle_id` départage TOUS les tris** (3ᵉ colonne de l'index, donc
gratuit). Les tris par rating ne sont PAS départagés par popularité : ce départage
n'est pas poussable dans l'index, et le laisser diverger du tri interne cassait la
pagination (page 1 = les puzzles les MOINS populaires parmi les ex æquo, et
l'export contredisait l'écran). Sur `1.e4`, **89 des 90 premiers puzzles sont ex
æquo** : c'est le cas nominal, pas un cas limite. Cf. `_ThroughSort`.
~~Reste connu : tri par `popularity` ≈ 2,1 s~~ → **réglé le 17/07** (wayfinder) :
cache `position_popularity` (passe 3/3 de `build-counts`, positions fréquentes
seulement, ~12 M lignes ≈ 1 Go) ; tri poussé via `through_query(pop_cached=…)`,
repli jointure instantané sur les positions rares. Départage par `puzzle_id`
(plus de sous-départage `nb_plays` — non poussable, invariant `_ThroughSort`).
Même passe 17/07 : `idx_positions_normfen` SUPPRIMÉ (redondant, vérifié) ;
fraîcheur des caches de positions = marqueur `position_caches_maxid` (settings)
+ reconstruction auto en fin de `download-run`/`import-dataset` + bandeau UI ;
`init_schema` prévient avant de créer un index lourd sur une base peuplée.
Caches reconstructibles (`statistics`, `family_motifs`, `family_top_puzzles`)
construits à la volée par `otkb ui` (voir `UiData.ensure_stats`).

## Conventions de code

Python 3.13+, `typing` strict, `dataclasses`, `pathlib`, `logging`. Tests `pytest`
sans réseau. Traitement interruptible/reprenable (`INSERT OR IGNORE`, commits par
lot). Chaque module = une responsabilité. Documenter ; petites tranches testables.
