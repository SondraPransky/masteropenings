# EECoach — Outil de révision d'ouvertures

## Vue d'ensemble
Outil pédagogique d'échecs pour coaches. Public cible : élèves 10–16 ans. Un coach crée des modules (drills) depuis des PGN annotés, partage un code à ses élèves, et analyse leurs erreurs position par position. Textes d'erreur doux, labels pédagogiques, interface simple — les coaches sont non-techniques.

**Pas de build step.** Tout est dans des fichiers HTML/JS/CSS statiques, édités directement.

## Structure du projet

```
index.html      # Application principale (~4400 lignes) — tout est là
admin.html      # Tableau de bord prof séparé (accès PIN, gestion élèves)
landing.html    # Page de présentation publique
data.js         # Contenu modifiable de landing.html (textes, stats, FAQ…)
```

### admin.html
Tableau de bord standalone pour le coach, protégé par PIN (`mc_prof_pin`).  
Lit les mêmes clés localStorage que `index.html`. Fonctions : sessions par élève, erreurs, maîtrise SM-2, parties PGN, suppression des données élève.  
Clé supplémentaire : `mc_accounts` (liste des comptes élèves enregistrés).

## Prévisualisation locale
```
npx serve . -p 5174
```
→ `http://localhost:5174`

## Fichier principal : index.html

Le fichier est organisé en sections séparées par `// ══…══` :

| Lignes ~  | Section                          |
|-----------|----------------------------------|
| 1–300     | CSS design système               |
| 300–1100  | CSS composants                   |
| 1100–1500 | HTML squelette + pages           |
| 1500–2250 | JS utilitaires + chess helpers   |
| 2250–3600 | JS drill engine (startDrill, etc.) |
| 3600–4039 | JS Vue Prof                      |
| 4039–4429 | JS éditeur PGN visuel            |

## Stack
- **chess.js 0.10.3** — validation des coups, génération FEN
- **ONNX Runtime Web 1.18.0** — moteur Maia (43 MB, chargé à la demande)
- **Canvas 560×560** — échiquier principal (pièces cburnett SVG inline)
- **Inter + JetBrains Mono** (Google Fonts)
- Vanilla HTML/JS/CSS — aucune dépendance build

## localStorage
| Clé             | Contenu                                      |
|-----------------|----------------------------------------------|
| `mc_drills`     | tableau des drills                           |
| `mc_results`    | résultats par coup/position                  |
| `mc_practice`   | sessions de pratique (score global)          |
| `mc_games`      | parties Maia sauvegardées (PGN)              |
| `mc_mastery`    | données SM-2 par `student_drillId_posKey`    |
| `mc_student`    | nom de l'élève courant                       |
| `mc_accounts`   | comptes élèves enregistrés (utilisé par admin.html) |
| `mc_prof_pin`   | PIN d'accès au tableau de bord admin         |
| `mc_theme`      | `'light'` \| `'dark'`                       |

## Structure d'un drill (`drills[i]`)
```js
{
  id:       number,       // timestamp
  name:     string,
  level:    string,       // '900'|'1300'|'1600'|'1900'|'2200'|'2500'
  side:     'w'|'b',
  mode:     'line'|'flash'|'tree',
  varmode:  'main'|'all'|'shallow',
  pgn:      string,       // source de vérité — PGN complet avec variantes
  sessions: [],           // lignes extraites via extractAllLines(pgn)
  deadline: string|null,  // date ISO optionnelle
}
```

## Pages et navigation
```js
goPage('coach')   // Créer module
goPage('drill')   // Réviser
goPage('prof')    // Vue prof
```
Les pages sont des `<div id="page-X">` affichées/cachées via classe `on`.

## Fonctions clés
```js
startDrill(i)           // Lance un drill depuis la liste
renderDrillBoard()      // Redessine l'échiquier canvas
toast(msg, type)        // Notification temporaire ('ok'|'warn'|'err')
renderProfView()        // Reconstruit la Vue Prof complète
showProfTab(tab)        // tab: 'presence'|'progression'|'parties'|'export'
showStudentDetail(name) // Sélectionne un élève dans Présence
openPgnEditor(i)        // Ouvre l'éditeur visuel sur le drill i
saveEditorDrill()       // Sauvegarde l'arbre éditeur → d.pgn + d.sessions
pgnToEditorTree(pgn, startFen)  // Parse PGN → arbre éditeur (avec .parent)
editorTreeToPGN(node)   // Arbre éditeur → PGN string standard
extractAllLines(pgn)    // PGN → tableau de sessions drillables (≥2 coups)
```

## État global important
```js
// Éditeur PGN
_E = { drillIdx, root, path, node, startFen, flipped, sel, lastFrom, lastTo }
// Nœud éditeur : { san, fenBefore, fenAfter, comment, children[], parent }

// Drill en cours
S = { ok, ko }         // score session
drills                 // tableau complet (synced avec localStorage)
results                // mc_results désérialisé
practiceLog            // mc_practice désérialisé
masteryData            // mc_mastery désérialisé
```

## Moteur Maia
- Modèle : `https://www.maiachess.com/maia3/maia3_simplified.onnx` (43 MB, CORS *)
- Liste de coups : chargée depuis GitHub à `MAIA_MOVES_URL` (4352 UCI, **pas un fichier local**)
  ```js
  const MAIA_MOVES_URL = 'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/main/src/lib/engine/data/all_moves_maia3.json';
  ```
- Chargé lazily au premier lancement d'une partie post-théorie
- Miroir FEN pour les positions où c'est aux Noirs de jouer

## Modes de drill
| Mode     | `mode`  | Comportement                                              |
|----------|---------|-----------------------------------------------------------|
| Flash    | `flash` | Positions clés une par une, choix parmi les candidats    |
| Ligne    | `line`  | Rejouer toute la ligne depuis le début, adversaire auto  |
| Arbre    | `tree`  | Adversaire choisit aléatoirement parmi les variantes PGN |

## Conventions CSS
- Variables `--bg`, `--surf`, `--surf2`, `--text`, `--dim`, `--cyan` (indigo), `--gold`, `--green`, `--red`, `--violet`
- Dark mode via `[data-theme="dark"]` sur `<html>`
- Cartes : classe `card`, coins `--r` (10px), ombre `--shadow-sm`
- Modales : classe `modal` + `on` pour afficher ; overlay `.overlay` + `on`

## Pièges connus
- **`extractAllLines()`** exige ≥ 2 coups par variante — les variations à 1 coup sont ignorées. Pour construire l'arbre éditeur, utiliser `pgnToEditorTree()` à la place.
- **`openPgnEditor()`** lit en priorité `d.pgn` (arbre complet) puis fallback sur `d.sessions`. Ne jamais reconstruire l'arbre uniquement depuis sessions.
- **`showProfTab()`** attend les valeurs exactes `'presence'`, `'progression'`, `'parties'`, `'export'` — pas `'prog'` ou abréviations.
- **Canvas échiquier** : 560×560px, case = 70px. Coordonnées : `x = file*70 + 35`, `y = (7-rank)*70 + 35` (pour les Blancs).
- **SM-2 key format** : `sm2Get(student, drillId, posKey)` où `posKey = drillId + '_' + posIdx + '_' + san`.

