# Opening Tactical Knowledge Base — SPEC v2 (source de vérité)

> Usine Python locale qui indexe les **puzzles d'ouverture Lichess** pour faire
> émerger la **signature tactique** de chaque ouverture. Projet **autonome**,
> satellite d'EECoach (repo `maiachess`), **sans aucun lien de code** avec lui.
>
> **v2 = conception verrouillée après grill** (voir §B). Cette version affine et
> remplace le handoff v1. Les 8 décisions du grill sont la référence.

---

## A. Vision & objectif pédagogique ultime

Quand un coach bâtit un cours d'ouverture, il ne veut pas coller des tactiques au
hasard : il veut les motifs **caractéristiques** de l'ouverture. Le projet répond à :

> **« Si je joue cette ouverture pendant des années, quelles tactiques
> rencontrerai-je le plus souvent ? »**

Ce n'est **pas** un convertisseur CSV→PGN, ni un navigateur de puzzles. C'est un
**moteur d'analyse d'ouvertures** qui relie ouvertures → variantes → positions →
puzzles → thèmes, et construit une **fiche « ADN tactique »** par ouverture.

Philosophie : les logiciels d'ouverture enseignent les *coups* ; les logiciels de
tactique enseignent des *positions hors contexte*. On combine les deux — étudier
les tactiques **dans leur contexte d'ouverture**.

---

## B. Décisions verrouillées (grill)

| # | Sujet | Décision |
|---|---|---|
| 1 | **Filtre passe 1** | `OpeningTags` ≠ ∅ **ET** `fullmove < 25` (borne naturelle Lichess = tous les taggés ; seuil exclusif dans `Settings`). Mesuré sur le CSV réel : 1 207 205 puzzles taggés, 100 % < 25. |
| 2 | **Schéma** | Hybride : champs bruts sur `Puzzles` + dimensions `Openings`/`Themes` + jonctions |
| 3 | **Navigation** | **FEN-lookup** (`normalized_fen`) **+ agrégation par `OpeningTags`**. Pas d'arbre de coups SAN. **Aucun download par partie en v1.** |
| 4 | **Profondeur ADN** | Métadonnées d'abord (pur CSV). Analyse de coups (cases critiques / sacrifices) = tranche 2-bis (python-chess **offline**) |
| 5 | **Thèmes** | Asset statique curated → `is_motif` + `label_fr` sur `Themes`. % = part des puzzles portant le motif (somme peut dépasser 100 %) |
| 6 | **Familles / ECO** | Familles par **préfixe global** (post-pass sur `Openings`). **ECO NULL** en v1 ; livre d'ouvertures = enrichissement ultérieur |
| 7 | **Sortie ADN** | **Rapport texte CLI + `--json`** (format pivot pour HTML/web) |
| 8 | **Seuil `N`** | **Abandonné en v1.** On publie tout ; l'élagage web se décidera à la tranche 6 |

**Défaut « meilleur puzzle »** (proposé, configurable) : tri par `Popularity`
décroissante, départage `NbPlays`.

---

## C. Architecture globale — décision B (verrouillée)

Deux mondes, un seul pont :

- **Usine Python locale** (CE repo, **jamais déployé**) : ingestion, indexeur, base
  SQLite, ADN, + explorateur desktop offline (le « projet parallèle » voulu).
- **EECoach web** (repo `maiachess`, vanilla-JS/Vite/Supabase/GitHub Pages) :
  consomme un **artefact SQLite réduit** produit par l'usine. Ne voit jamais les
  puzzles bruts.
- **Le pont = l'artefact SQLite** (même schéma, pour que WASM-local → API Postgres
  ne soit pas une réécriture, juste un changement d'accès).

Frontière physique : CSV Lichess, cache de parties, `.db` vivent dans `data/`,
**tous gitignorés**. Rien de lourd n'entre dans git.

---

## D. Périmètre par phase (qui fait quoi, et surtout QUAND)

### v1 — usine analytique 100 % CSV, zéro réseau

Produit : index FEN-lookup + agrégation ouvertures/thèmes + fiche ADN (CLI/JSON).
Dépendances runtime : **stdlib seule** (sqlite3, tomllib, dataclasses).

Livrables ADN v1 (tout depuis le CSV) :
- nombre de puzzles, rating moyen, **coup moyen d'apparition** (`AVG(fullmove)`),
- **motifs dominants %** (thèmes `is_motif`, libellés FR),
- **variantes les plus tactiques** (agrégation par `OpeningTags`).

### v1-bis (tranche 2-bis) — analyse de coups **offline** (python-chess, zéro réseau)

Rejoue la **solution** (`Moves` UCI) depuis le FEN du puzzle, sans rien télécharger :
- **cases critiques** (cases d'arrivée des coups de solution),
- **sacrifices** (détection ; définition à trancher : capture perdante de matériel
  et/ou thème Lichess `sacrifice`), **pièces sacrifiées**, **sacrifice sur `<case>`**.

### v2+ — reconstruction de parties (download, différé)

Nécessaire **uniquement** pour ce que le CSV ne contient pas :
- **noms & Elo des joueurs** (⚠️ absents du CSV — la ligne ADN « joueurs les plus
  représentés » et les filtres « Elo joueurs » en dépendent),
- l'index `Positions` coup-par-coup complet, la génération PGN annotée, l'arbre SAN
  littéral, l'Updater incrémental.
Prévoir cache + reprise dès la conception ; activer plus tard.

### Futur / IA (ne pas construire, ne pas bloquer)

Structures de pions, clustering (structure/pièces/sacrifice/motif), recommandations
pédagogiques (« 50 puzzles indispensables »), heatmaps, comparaison graphique,
autres sources (Chess.com, Chesstempo), sync cloud, export ChessBase. Le modèle de
données doit les permettre (extensibilité), pas les implémenter.

**Cartographie des features de vision → phase :**

| Feature (cahier) | Données dispo | Phase |
|---|---|---|
| Fiche ADN (nb, rating, coup moyen, motifs %, variantes) | CSV | **v1** |
| ADN : cases critiques, pièces/case sacrifiées | solution UCI | **v1-bis** (offline) |
| ADN : joueurs les plus représentés | partie (download) | **v2+** |
| Cartographie (arbre ouverture→variante + stats/nœud) | tags + CSV (données) / rendu | **v1** données, viz plus tard |
| Comparaison de 2 ouvertures (métadonnées) | CSV (+ sacrifices v1-bis) | **v1 / v1-bis** |
| Heatmaps tactiques (cases sacrifices/attaques) | solution UCI | **v1-bis** données, viz futur |
| Structures de pions, clustering, reco IA | dérivable / futur | **Futur** |

---

## D-bis. Stack technique & feuille de route versionnée (grill 2)

Prompt à deux niveaux : **vision** (§A) + **spécifications techniques** (ci-dessous).
Développer comme un **logiciel open source pro** (lisible, documenté, modulaire,
SRP), **pas** un prototype. Par étapes versionnées, pas tout d'un coup.

### Stack (décidée après grill 2)

| Domaine | Choix | Note |
|---|---|---|
| Langage | **Python 3.13+**, `typing`, `dataclasses`, `pathlib`, `logging` | strict typing |
| Tests | **pytest** | tranches testables sans réseau |
| Base | **`sqlite3` brut + `schema.sql`** | ❌ pas de SQLAlchemy/Alembic : la base est un **cache dérivé**, on **reconstruit** au lieu de migrer ; `SCHEMA_VERSION` détecte l'obsolescence. Aligné sql.js (web). |
| Ingestion | **`csv` stdlib en streaming** | ❌ pandas hors pipeline (mémoire plate sur 1 Go+ ; agrégation en SQL). pandas dispo pour explorations perso only. |
| Échecs | **python-chess** | seulement tranche 2-bis (analyse offline) + passe 2 |
| UI | **CLI + `--json` d'abord** ; **NiceGUI** à v0.2 | CLI = socle testable + format pivot ; NiceGUI = explorateur interactif offline (board JS embarqué). Le web EECoach (sql.js) reste une UI distincte. |
| Réseau | **httpx** + retry + backoff | passe 2 (v0.4). ❌ pas parallèle : batch `_ids` ×300 séquentiel (cf. §D-ter) |
| Traitement | séquentiel + lots de 300 | download passe 2 ; `asyncio` seulement si réellement utile ailleurs |

Dépendances runtime **v0.1 = stdlib seule**. Le reste est en extras
(`analysis`, `ui`, `pass2`) activés à leur tranche.

### Feuille de route versionnée (réconciliée avec le grill)

- **v0.1** — Ingestion CSV + SQLite + **ADN (CLI + `--json`)** + **squelette
  downloader** (interfaces, table `downloads`, cache/reprise — *sans lancer* le
  fetch). ⚠️ Ordre inversé vs le brouillon initial : l'ADN CSV d'abord, le
  download **différé** (grill #3/#4/#8).
- **v0.2** — Explorateur d'ouvertures interactif (NiceGUI, FEN-lookup).
- **v0.3** — Analyse de coups offline (2-bis : cases critiques, sacrifices) +
  ADN enrichie + exporters (fiche HTML/PGN).
- **v0.4** — Passe 2 : download parallèle, `positions`, PGN annoté, joueurs/Elo.
- **v1.0** — Updater incrémental ✅ (`update`), artefact web réduit ✅ (`export-web`,
  accéléré ~2,2×), fiche ADN HTML autonome ✅ (`adn --html`), recherche par position
  ~500× ✅ (index couvrant), **dossiers de puzzles par position** ✅ (`explore --out`,
  tri/filtre difficulté, format minimal ou partie complète `--full`, bouton UI) ;
  **reste** : finir la passe 2 (386 k parties), optimisation continue facultative.

### Architecture (structure modérée, grandit par tranche)

Un package `otkb/`, SRP, sous-packages créés **quand une tranche apporte du code**
(pas de dossiers vides). Mapping cible :

| Module | Home | Tranche |
|---|---|---|
| database | `otkb/db/` ✅ | v0.1 |
| models · config | `otkb/models.py` · `otkb/config.py` ✅ | v0.1 |
| builder/ingestion | `otkb/ingest/` | v0.1 |
| statistics/ADN | `otkb/adn/` | v0.1 |
| downloader (stub) | `otkb/downloader/` | v0.1 (interfaces) |
| explorer | `otkb/explorer/` | v0.2 |
| exporters | `otkb/exporters/` | v0.3+ |
| trainer · updater · api · importers | créés à leur tranche | v0.4+ |

---

## D-ter. Phase 2 (v0.4) — reconstruction : méthode & livrable final

**Livrable final (non optionnel)** : une **base complète des ~1,2 M parties-puzzles**,
où chaque puzzle d'ouverture devient un **exercice reconstruit depuis le coup 1**.
« Différé » ≠ « abandonné » : le grill n'a fait que réordonner (ADN d'abord).

État final des tables :
- `games` : ~1,2 M **PGN complets** + joueurs + Elo + ECO.
- `positions` : **toutes les positions** du coup 1 jusqu'au puzzle, indexées par
  `normalized_fen` (~30-40 M lignes ; SQLite ~3-8 Go).
- `puzzles` : relié à sa partie + son **PGN annoté** (`{[%start]}`).

**Méthode de récupération (décidée) :**

- **Adressage direct par `game_id`**, jamais la base de parties massive de Lichess.
  On extrait `game_id` de `GameUrl` (`.../{id}[/color]#ply`) ; le `#ply` donne
  déjà la position cible dans la partie. ❌ Pas de scan de dumps To-scale.
- **Endpoint bulk par IDs** : `POST https://lichess.org/api/games/export/_ids`,
  **jusqu'à 300 IDs par requête** → ~4 000 requêtes au lieu de ~1,2 M.
- **Séquentiel + backoff**, PAS parallèle. Doc Lichess : *une requête à la fois ;
  sur `429`, attendre 60 s*. Le batch-300 remplace le parallélisme (le cahier
  disait « parallèle » — corrigé : contre-productif ici).
- **PGN allégé** : `?moves=true&tags=true&clocks=false&evals=false`.
- **Token** : **optionnel, aucun scope requis** (les endpoints d'export sont
  publics). Le vrai levier de vitesse est le batch `_ids`, **pas** l'auth ; un
  token no-scope ne fait qu'éviter le throttling anonyme par IP. Stratégie :
  démarrer **anonyme**, ajouter un token seulement si `429` répétés. Lu depuis
  **`LICHESS_TOKEN`** (env) ou `config.local.toml`. ⚠️ **JAMAIS** dans un fichier
  versionné, le code, ni les logs.
- **Cache + reprise** via `downloads` (`pending|done|error|skipped`, `attempts`,
  `last_error`) : un lot échoué/interrompu se rejoue sans tout refaire.

**Reconstruction par partie (python-chess)** : rejouer coup par coup jusqu'à
`normalized_fen == puzzle.normalized_fen` (compteurs ignorés) → **vérification** ;
indexer les positions intermédiaires ; générer le PGN annoté (jouer `Moves[0]` =
coup de l'adversaire qui pose le puzzle, **puis `Moves[1]` = 1er coup de l'élève**,
insérer `{[%start]}` là où l'élève reprend la main, ajouter `Moves[2:]`).

---

## E. Données & schéma

**Source** : CSV officiel des puzzles Lichess. Champs :
`PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes,
GameUrl, OpeningTags`. **Pas d'ECO, pas de joueurs, pas d'Elo joueurs.**
Token API Lichess saisissable (pour le download v2+).

**FEN normalisée** (clé de jointure) : conserver **uniquement** placement + trait
+ droits au roque + case en-passant. **Jeter** demi-coups et numéro de coup. Index
SQL sur cette FEN. La comparaison de positions (python-chess) ignore les mêmes deux
compteurs.

**Génération PGN** (v2+) : ne jamais tronquer ; garder depuis le coup 1 jusqu'à la
position du puzzle ; jouer le coup de l'adversaire (`Moves[0]`) **puis le 1er coup
de l'élève (`Moves[1]`)** ; insérer aussitôt `{[%start]}` (là où l'élève reprend la
main) ; puis le reste de la solution (`Moves[2:]`).

**Tables SQLite** (11, toutes créées dès la tranche 1) :

- **Actives v1** : `Puzzles` (brut + dérivés), `Openings` (tag, family, variation,
  name, eco), `Themes` (name, **is_motif, label_fr**), `PuzzleOpenings`,
  `PuzzleThemes`, `Statistics` (cache ADN reconstructible), `Settings`.
- **Créées vides, peuplées v2+** : `Games`, `Positions` (cœur passe 2 :
  `normalized_fen, game_id, puzzle_id, ply, opening_id, eco, opening_tags,
  white_elo, black_elo, puzzle_rating, themes`), `Downloads`, `Updates`.

Modèle pensé **extensible** (futur IA) — ne pas bloquer, ne pas construire.

**Dérivation famille** : post-pass global sur `Openings` — la famille d'un tag est
le plus long tag **connu (toutes ouvertures confondues)** qui en est préfixe strict
sur frontière `_`. À défaut, le tag est sa propre famille.

---

## F. Modules (architecture cible)

UI (CLI d'abord) · Base de données · Downloader (v2+) · Builder/Ingestion ·
Générateur PGN (v2+) · Indexeur · Explorateur · ADN/Statistiques · Updater (v2+) ·
Configuration. Exigences : type hints, dataclasses, logging, tests unitaires, doc.
Traitement **interruptible/reprenable** et incrémental (INSERT OR IGNORE,
transactions). Updater (v2+) : ne traiter que les nouveautés, réutiliser le cache,
ne jamais tout reconstruire (manuel / mensuel / bimestriel / off).

---

## G. Ordre de construction

1. **Squelette + config + DB** ✅ — 12 tables, couche d'accès, FEN normalisée +
   index, dataclasses, logging, tests.
2. **Ingestion CSV (passe 1, zéro réseau)** ✅ — parser streaming, filtre ouverture,
   dimensions + jonctions, post-pass familles, asset thèmes. Base réelle : 1 207 204
   puzzles, 1586 ouvertures, 69 thèmes, 820 Mo.
3. **Fiche ADN v1** ✅ — agrégation SQL → rapport **CLI texte + `--json`**.
2-bis. **Analyse de coups offline** (python-chess) ✅ — cases critiques, sacrifices,
   pièces sacrifiées (`puzzle_analysis`) ; ADN enrichie.
   Exercices PGN ✅ (`pgn/` : minimal offline + annoté). Exporters ✅.
   Downloader ✅ (`game_id`, file `downloads`, client batch `_ids`) — fetch non lancé.
   Reconstruction ✅ (`reconstruct/` : rejeu + vérif FEN + index `positions`).
4. **Explorateur desktop** (NiceGUI, v0.2) — coller FEN/PGN, jouer, voir puzzles+thèmes.
5. **Passe 2 — RUN du download** (v0.4) — exécuter le fetch batch réel + reconstruire
   les ~1,2 M parties → `games`/`positions` peuplées. *(nécessite réseau + token)*
6. **Export artefact web** (v1.0) ✅ — `otkb export-web` : `.sqlite` réduit compatible
   sql.js (offline), dérivé de `otkb.db`. Garde passe 1 + 2-bis + caches ADN (puzzles
   aux colonnes élaguées — retirés `rating_deviation`/`game_url`/`game_id` + les
   redondants `opening_tags`/`themes`, reconstructibles sans perte via jonctions —
   la vue `puzzle_display` les restitue en colonnes à coût nul), jonctions,
   dimensions, `statistics`/`family_*`, `puzzle_analysis`) ; écarte le bloc
   passe 2 (`positions`/`games`/`downloads`/`updates`). Complet ≈ 659 Mo, p95 ≈ 153 Mo.
   Schéma = sous-ensemble de `schema.sql`. `otkb/exporters/web_export.py`.

**Principe** : petites tranches testables ; l'usine reste fonctionnelle à chaque
étape ; aucune valeur de la passe 1 ne dépend du réseau.

---

## H. Règles de garde

- **Aucun code partagé** avec EECoach ; ne pas importer son `CLAUDE.md`.
- **Rien de lourd dans git** : CSV, cache, `.db` → `.gitignore` dès le départ.
- Seul artefact partagé avec le web = le **SQLite réduit** (même schéma).
- **Demander confirmation avant tout commit/push.**
