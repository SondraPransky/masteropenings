# Opening Tactical Knowledge Base (OTKB)

Usine Python **locale** qui indexe les **puzzles d'ouverture Lichess** pour faire
émerger les motifs tactiques caractéristiques de chaque ouverture (fiche
« ADN tactique »), avec un **explorateur interactif** (échiquier Chessground) et
un **solveur de puzzles**. Projet **autonome** — aucun lien de code avec EECoach.
Voir [`SPEC.md`](SPEC.md), source de vérité, et [`CLAUDE.md`](CLAUDE.md), le guide
opérationnel.

## Décisions verrouillées

- **Archi B** : usine locale (ce repo, jamais déployé) → artefact SQLite réduit
  consommé plus tard par le web. Le seul pont = cet artefact.
- **Passe 1 = zéro réseau** (CSV pur) : ingestion, ADN, explorateur FEN-lookup.
  Filtre : `OpeningTags` non vide **ET** `fullmove < 25` (= tous les puzzles taggés).
- **FEN normalisée** (placement + trait + roque + en-passant), indexée = clé de
  jointure entre puzzles et positions de parties.
- **Modèle hybride** : strings brutes sur `puzzles` + dimensions
  `openings`/`themes` + jonctions ; tables snake_case.

## Prérequis

Python ≥ 3.13. Extras : `analysis` (python-chess), `ui` (nicegui), `pass2`
(httpx). Tests : `pip install -e .[dev]`.

```bash
pip install -e ".[analysis,ui]"     # explorateur + analyse offline
```

## Données (base construite, gitignorée)

- CSV Lichess `lichess_db_puzzle.csv` (racine, ~1,1 Go, 6 057 356 lignes).
- Base `data/otkb.db` : **1 207 204 puzzles**, 1586 ouvertures, 69 thèmes.
- Index `positions` peuplé à **~68 %** (821 200 parties) via
  l'import du dataset pré-joint HF + le reliquat API (passe 2, en cours ;
  `download-run` reprenable et increvable).
- ⚠️ Le CSV ne contient **ni ECO ni Elo joueurs** (seulement `GameUrl`).

## Commandes

```bash
python -m otkb init-db                                # crée data/otkb.db
python -m otkb ingest --csv lichess_db_puzzle.csv     # passe 1 (~5 min)
python -m otkb update --csv newer.csv                 # updater incrémental (offline)
python -m otkb adn Sicilian_Defense [--json|--html f.html]  # fiche ADN (texte, JSON ou HTML autonome)
python -m otkb analyze                                 # passe 2-bis (offline, python-chess)
python -m otkb explore --moves "e2e4 e7e5 g1f3"        # compteurs d'une position (CLI)
python -m otkb explore --moves "..." --out dossier.pgn [--limit N] [--sort rating_asc] [--min-rating 1000 --max-rating 1500] [--full]  # dossier PGN des puzzles PASSANT PAR la position (tri/filtre difficulté ; --full = partie complète depuis le coup 1 avec [%start])
python -m otkb ui [--port 8080] [--no-show]           # explorateur interactif (NiceGUI)
python -m otkb import-dataset                          # import HF (parties → positions)
python -m otkb download-run [--max-batches N]          # passe 2 API (réseau, token)
python -m otkb export-web [--out data/otkb-web.sqlite] # artefact SQLite réduit (sql.js, offline)
python -m pytest -q                                    # tests (sans réseau)
```

## Explorateur interactif (`otkb ui`)

Application web locale (NiceGUI), 100 % offline. Trois onglets :

- **Explorateur** — échiquier **Chessground** (le board de Lichess, pièces
  cburnett) en glisser-déposer ; compteurs live (puzzles démarrant / parties
  passant par la position), motifs et ouvertures de la position, suites de coups
  les plus jouées ; saisie d'une position par FEN ou coups. Depuis une position,
  **liste des puzzles** (triable/paginée) et **solveur** : résolution au glisser
  coup par coup, indice, solution animée, puzzle suivant.
- **Meilleurs puzzles** — les puzzles les plus populaires d'une ouverture, avec
  aperçu d'échiquier ; « Résoudre » ouvre le solveur.
- **Comparaison** — ADN de 2-3 familles côte à côte (volume, niveau, motifs).

Thème clair/sombre, layout responsive. Les assets Chessground sont vendus en
local dans `otkb/ui/static/` (aucun réseau au runtime).

## Roadmap

- [x] **v0.1** — ingestion CSV + SQLite + ADN (CLI/json) + 2-bis + downloader stub.
- [x] **v0.2** — explorateur NiceGUI (Chessground) + comparaison + solveur de
  puzzles + meilleurs puzzles par ouverture.
- [~] **v0.4** — passe 2 : download batch → positions (≈68 % ; reliquat API).
- [ ] **v1.0** (en cours) — artefact web réduit (sql.js) ✅ `export-web` ·
  updater incrémental ✅ `update` ; reste exports complets, optimisation.

## Architecture

```
otkb/
  config.py  fen.py  openings.py  models.py  logging_setup.py  cli.py
  db/         schema.sql (schéma) + database.py (accès sqlite3 brut)
  assets/     themes.json (mapping is_motif / label_fr)
  ingest/     lecture CSV streaming + pipeline (passe 1)
  adn/        agrégation ADN (texte / json)
  explorer/   requêtes par position + insights (thèmes/ouvertures/suites/top)
  analysis/   passe 2-bis (cases critiques + sacrifices, python-chess offline)
  pgn/  exporters/  reconstruct/  downloader/  importers/
  ui/         app NiceGUI (explorateur/solveur/comparaison) + static/ (Chessground)
tests/        tests sans réseau (+ fixtures/)
data/         CSV / cache / .db   (GITIGNORÉ)
```

## Règles de garde

- **Rien de lourd dans git** : CSV / cache / `.db` sont gitignorés.
- **Aucun secret versionné** : token Lichess via `LICHESS_TOKEN` ou
  `config.local.toml` (gitignoré). Optionnel, sans scope.
- Le seul artefact partagé avec le web = le SQLite réduit (même schéma).
```
