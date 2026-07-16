---
name: EECoach
description: Outil de formation et de suivi pour un club d'échecs — révision d'ouvertures, exercices, revue de parties.
colors:
  indigo-primary: "#4f46e5"
  indigo-dim: "#4f46e514"
  indigo-glow: "#4f46e54d"
  zinc-page: "#fafafa"
  zinc-surface: "#ffffff"
  zinc-surface-2: "#f4f4f5"
  zinc-surface-3: "#e4e4e7"
  zinc-border: "#e4e4e7"
  zinc-border-hover: "#d4d4d8"
  zinc-ink: "#18181b"
  zinc-ink-2: "#3f3f46"
  zinc-dim: "#65656d"
  green-ok: "#16a34a"
  green-ink: "#166534"
  green-glow: "#16a34a40"
  gold-warn: "#d97706"
  gold-ink: "#92400e"
  gold-glow: "#d9770640"
  red-error: "#dc2626"
  red-ink: "#be123c"
  red-glow: "#dc262640"
  blue-info: "#2563eb"
  blue-ink: "#1e40af"
  blue-glow: "#2563eb40"
  violet-review: "#7c3aed"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, sans-serif"
    fontSize: "1.05rem–1.15rem"
    fontWeight: 800
    letterSpacing: "-0.3px à -0.6px"
  body:
    fontFamily: "Hanken Grotesk, -apple-system, sans-serif"
    fontSize: "0.835rem–0.9rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.72rem–0.84rem"
    fontWeight: 500
rounded:
  bar: "2px"
  chip: "4px"
  sm: "6px"
  md: "8px"
  card: "12px"
  panel: "14px"
  hero: "16px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "22px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.indigo-primary}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
  button-tonal:
    backgroundColor: "{colors.indigo-dim}"
    textColor: "{colors.indigo-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
  button-ghost:
    backgroundColor: "{colors.zinc-surface}"
    textColor: "{colors.zinc-ink-2}"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
  button-danger:
    backgroundColor: "{colors.red-error}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
  card:
    backgroundColor: "{colors.zinc-surface}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
  input:
    backgroundColor: "{colors.zinc-surface}"
    textColor: "{colors.zinc-ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
---

# Design System: EECoach

## 1. Overview

**Creative North Star: « Le Cahier d'échecs »**

EECoach est le cahier d'exercices soigné d'une académie d'échecs : du papier clair (zinc, jamais crème), une notation monospacée qui appartient visiblement au jeu, et **une seule encre indigo** réservée à ce qui compte — l'action principale, la sélection, la progression. Le système écrit peu et souligne encore moins : la hiérarchie vient de la structure (sections, bordures 1px, poids typographiques), pas de la décoration. L'outil s'efface devant la tâche ; un élève de dix ans comme un adulte du club doit réviser sans réfléchir à l'interface.

Ce que le système **rejette explicitement** (anti-références PRODUCT.md) : le dashboard SaaS générique (cartes identiques, gros KPI + gradient, fond crème, eyebrows en capitales) ; la densité-cockpit de chess.com/lichess ; l'app enfantine sur-gamifiée (couleurs criardes, mascottes) ; le corporate froid et gris. La seule chaleur autorisée vient du jeu lui-même : figurines ♔♞, notation algébrique, mini-échiquiers.

**Key Characteristics:**
- Fond zinc neutre (#fafafa), surfaces blanches, bordures 1px — jamais de teinte crème/beige.
- Un seul hue d'accent (indigo #4f46e5) décliné en trois poids : plein > tonal > ghost.
- Couleurs sémantiques d'état uniquement (vert/ambre/rouge/violet), chacune avec sa variante `-ink` AA pour le texte petit et sa variante `-dim` pour les fonds.
- La signature échecs : monospace pour la notation et les données, figurines dans le texte, échiquier au centre.
- Gamification en signaux discrets (streak, anneaux, badges) — lisible d'un coup d'œil, jamais tape-à-l'œil.
- Thème sombre complet par bascule de tokens (`[data-theme="dark"]`), où les variantes `-ink` s'aliassent sur les tokens de base.

## 2. Colors

Stratégie **Restrained** : neutres zinc + un accent indigo ≤10% de toute surface ; les autres couleurs n'existent que pour dire un état.

### Primary
- **Encre indigo** (#4f46e5) : L'UNIQUE accent. Action principale (1 bouton plein par zone), sélection courante, coup courant dans la notation, progression. Ses déclinaisons : `indigo-dim` (rgba 8%) pour les fonds tonals, `indigo-glow` (rgba 30%) pour bordures/focus. En dark : #818cf8.

### Neutral
- **Papier zinc** (#fafafa) : fond de page. Blanc cassé à chroma zéro — jamais réchauffé vers le crème.
- **Surface** (#ffffff) / **Surface 2** (#f4f4f5) / **Surface 3** (#e4e4e7) : cartes, panneaux, contrôles imbriqués.
- **Bordure** (#e4e4e7), **bordure hover** (#d4d4d8) : la délimitation par défaut de toute surface.
- **Encre** (#18181b), **encre secondaire** (#3f3f46), **estompé** (#65656d — calibré 4.55:1 sur **surface-3**, la plus foncée : c'est la contrainte réelle, pas surface-2) : les trois niveaux de texte. Un compte ou une donnée n'est PAS de l'estompé → `--text-2` (cf. `.csnav-badge`).

### Tertiary (sémantique d'état — jamais décorative)
- **Vert maîtrise** (#16a34a, ink #166534) : correct, appris, gagné.
- **Ambre attention** (#d97706, ink #92400e) : échéance proche, à surveiller, achievements.
- **Rouge erreur** (#dc2626, ink #be123c) : faute, retard, destructif.
- **Bleu indice** (#2563eb, ink #1e40af) : hints, informations.
- **Violet révision** (#7c3aed) : répétition espacée, annotations du coach dans l'arbre.

### Named Rules
**La règle de l'encre (-ink).** Toute couleur sémantique qui colore du TEXTE petit (<14px bold) sur fond clair ou teinté utilise sa variante `-ink`, jamais le token de base (qui plafonne à ~3.2:1). Les états sont toujours doublés d'une icône ou d'un libellé — jamais la couleur seule.
> **Calibrage (corrigé le 16/07/2026 — 17 échecs AA trouvés) : une encre se mesure contre son propre `-dim`, PAS contre `--surf`.** C'est l'appariement réel des pastilles du produit (`_tierBg` + `_tierPct`, `.badge-green`, `.feedback`…), et il coûte ~1 point de ratio. Calibré sur surface plate, `--green-ink` (alors #15803d) rendait 5.0:1 sur `--surf` mais **4.49:1** sur `--green-dim` → toutes les pastilles vertes de l'app échouaient. Même piège pour `--dim`, calibré sur `--surf2` (4.81) mais utilisé sur `--surf3` (4.16). **Tout nouveau token `-ink` se vérifie sur `-dim` × {surf, surf2, surf3, page}, dans les 2 thèmes.**
> **En dark**, les `-ink` s'aliassent sur le token de base **seulement s'il tient sur son `-dim`** (vérifié : vert 6.32, ambre 5.34). Le rouge n'y rendait que 4.34 → il a sa propre encre `#fca5a5`. Et les boutons PLEINS y prennent une **encre foncée** (`#18181b`) : l'accent dark est clair, le blanc n'y rend que 2.98:1.
**La règle des trois variantes.** Chaque couleur sémantique a exactement **trois** déclinaisons, et aucun site n'écrit un rgba à la main : `-dim` (fond teinté) · `-ink` (texte petit, AA) · `-glow` (bordure/anneau). Le trio existe pour vert/ambre/rouge/bleu comme pour l'indigo (`--cyan-glow`).
> **Le symptôme à surveiller : une famille parallèle.** Trois fois de suite, le même défaut a été trouvé — une palette voisine vivant à côté des tokens, presque toujours dans une **bordure** pendant que le fond et le texte étaient déjà tokenisés : rose-600 à côté de red-600 (clair, 14 sites), rose-400 + emerald-400 + sky-400 à côté de red/green/blue-400 (**dark**, 14 sites), yellow-400/500 à côté d'amber (les deux thèmes). Toutes balayées le 16/07/2026. La cause racine : `-glow` n'existait pas, donc chaque bordure improvisait sa propre teinte. Un `var(--gold-glow, rgba(202,138,4,.25))` traînait même dans le code — un fallback vers un token jamais créé. Si tu écris un rgba dans une bordure, c'est que le token manque : crée-le.
**La règle du hue unique.** Un seul bouton PLEIN indigo par zone d'écran. Le deuxième niveau est TONAL (fond `indigo-dim`, texte indigo), le troisième est GHOST (bordure neutre). Il n'existe pas de deuxième accent plein.

## 3. Typography

**Display Font:** Bricolage Grotesque (fallback Hanken Grotesk)
**Body Font:** Hanken Grotesk (fallback -apple-system, sans-serif)
**Label/Mono Font:** JetBrains Mono (fallback ui-monospace)

**Character:** Un grotesque à caractère pour les titres (Bricolage, 800, tracking serré −0.3 à −0.6px), un humaniste discret pour tout le reste, et le monospace comme signature du jeu — toute notation (e4, Cf3, O-O), tout chiffre de donnée passe en JetBrains Mono avec `tabular-nums`.

### Hierarchy
- **Display** (800, 1.05–1.15rem, balance) : logo, hero, titres de modals. `text-wrap: balance` obligatoire.
- **Title** (700, 0.92–1.02rem) : titres de sections (`.sh-section-label`, `.cs-title`) — de vrais `<h2>`.
- **Body** (400–500, 0.835–0.9rem, lh 1.5) : texte courant, boutons. `text-wrap: pretty` sur le corps.
- **Label** (600–700, 0.64–0.78rem) : badges, pastilles, métadonnées. Plancher 0.7rem (~11px) — public incluant des enfants.
- **Mono/Data** (500–700, 0.72–1.85rem, `tabular-nums`) : notation, KPI, compteurs qui se mettent à jour en direct.

### Named Rules
**La règle de la figurine.** Un coup d'échecs ne s'écrit jamais en lettre seule quand la figurine existe : `fig()` convertit (Cf3 → ♞f3) partout où un coup est affiché.
**La règle des capitales.** `text-transform: uppercase` est réservé aux séparateurs de navigation (`.csnav-group`). Aucun eyebrow, aucun titre en capitales.

## 3 bis. Rounding

L'échelle complète : **2px** (barres) · **4px** (petites pastilles carrées) · **6px** `--rs` (boutons, inputs) · **8px** `--r` (cartes standard) · **12px** (cartes de module, hero) · **14px** (panneaux, modals, états vides) · **16px** (grandes surfaces) · **999px** (pilules).

### Named Rules
**La règle du bas de l'échelle.** Une barre de progression fait 3 à 6px de haut : à 6px de radius elle devient une pilule, ce qui n'est pas la forme voulue. **2px** (et 3-4px pour les rails un peu plus épais) est donc un palier légitime, pas de la dérive — il vaut pour `.prog-bar`, `.eleve-progbar`, `.srdash-bar`, `.ed-mini-bar`, le pouce de scrollbar. Ne pas « corriger » ces valeurs vers 6px.
**La règle de la pilule.** Une pastille se ferme avec **999px**, jamais avec un nombre magique qui *donne* un rond à la taille actuelle. `padding: 2px 8px; border-radius: 20px` a l'air d'une pilule tant que le padding ne bouge pas — c'est une coïncidence, pas un système. (7 sites corrigés le 16/07/2026 ; il en restait 14 déjà corrects.)

## 4. Elevation

**Plat par défaut.** Les surfaces au repos sont délimitées par une bordure 1px (#e4e4e7), pas par une ombre. Les ombres — toujours **teintées** zinc/indigo, jamais du noir pur — n'apparaissent qu'en réponse à un état : survol d'une carte actionnable, modal ouvert, toast, dropdown. La profondeur permanente n'existe pas.

### Shadow Vocabulary
- **xs** (`0 1px 2px rgba(24,24,27,.05)`) : tabs actifs, relief minimal.
- **sm** (`0 1px 2px rgba(24,24,27,.06)`) : cartes calmes (hero --calm).
- **base** (`0 1px 3px rgba(24,24,27,.08), 0 1px 2px rgba(24,24,27,.05)`) : toasts, dropdowns.
- **lg** (`0 10px 30px rgba(30,27,75,.12), 0 4px 8px rgba(24,24,27,.06)`) : modals — la pointe indigo (#1e1b4b) est délibérée.

### Named Rules
**La règle de l'ombre teintée.** Aucune ombre `rgba(0,0,0,…)` : toute ombre porte le hue zinc (#18181b) ou indigo profond (#1e1b4b). Si une ombre paraît « sale », c'est qu'elle est noire.

## 5. Components

Caractère : **sobres et sûrs**. Affordances standard, rien ne se réinvente — la familiarité est gagnée, la personnalité vient du contenu échiquéen, pas des contrôles.

### Buttons
- **Shape:** coins doucement arrondis (6px) ; padding 8px 15px (5px 12px en `.btn-sm`).
- **Primary:** indigo plein (#4f46e5, texte blanc) — un seul par zone.
- **Tonal (.btn-blue):** fond indigo-dim, texte indigo, bordure indigo-glow — l'important non-principal.
- **Ghost:** surface blanche, bordure neutre, texte encre-2 — support et navigation locale.
- **Danger (.btn-red):** rouge plein, destructif uniquement.
- **Hover / Focus / Press:** hover = fond/bordure (120ms, propriétés explicites — jamais `transition: all`) ; focus = double anneau (`0 0 0 2px surf, 0 0 0 4px indigo-glow`) ; press = `scale(.96)` (.98 sur grandes cartes).
- **Icône seule:** toujours `aria-label` + classe `.btn-ico` (pseudo-élément → cible 40px). Sur tactile, `.btn-sm` remonte à `min-height: 38px`.

### Cards / Containers
- **Corner Style:** 8px (cartes standard) à 12px (cartes de module `.mcard`, hero).
- **Background:** surface blanche, bordure 1px ; tint sémantique (`-dim`) quand la carte EST un état (alerte, warn).
- **Shadow Strategy:** aucune au repos ; hover teinté indigo sur les cartes actionnables uniquement.
- **Internal Padding:** 14–22px.

### Inputs / Fields
- **Style:** surface blanche, bordure 1px, radius 6px ; monospace pour les champs PGN/FEN.
- **Focus:** `border-color + box-shadow` 150ms vers l'indigo-glow.

### Navigation
- Nav haute sticky 58px, blanc translucide + `backdrop-filter: blur(16px)`, bordure basse. Sidebar coach 210px (rangée horizontale scrollable en mobile) : boutons ghost, actif = fond indigo-dim + texte indigo, badges compteurs `tabular-nums`.

### L'Échiquier (composant signature)
Canvas central avec pièces cburnett (SVG locaux), coordonnées, flèches/formes d'annotation. Les mini-échiquiers (`renderStaticBoard`, grille 8 rangées explicites) portent les positions dans les tables, tooltips (`wsTip`) et cartes d'exercices. C'est LA source d'identité visuelle — tout écran qui parle d'une position la montre.

## 6. Do's and Don'ts

### Do:
- **Do** réserver l'indigo plein à UNE action principale par zone ; tout le reste est tonal ou ghost.
- **Do** utiliser les variantes `-ink` pour tout texte sémantique petit, et doubler chaque état couleur d'une icône ou d'un libellé.
- **Do** passer toute notation et toute donnée chiffrée en JetBrains Mono `tabular-nums` (les compteurs bougent en direct).
- **Do** montrer l'échiquier (mini ou tooltip) chaque fois qu'on parle d'une position.
- **Do** respecter `prefers-reduced-motion` sur chaque animation ; easings ease-out, 120–300ms, propriétés explicites.
- **Do** donner ≥40px de cible tactile (`.btn-ico`, `min-height` sous `hover:none`) — le public inclut des enfants sur téléphone.

### Don't:
- **Don't** reproduire « le dashboard SaaS générique » (PRODUCT.md) : cartes identiques, gros KPI + gradient, fond crème/beige, eyebrows en petites capitales tracked.
- **Don't** viser la densité de chess.com/lichess (« le site d'échecs surchargé ») : pas de panneaux partout, le calme est un choix.
- **Don't** sur-gamifier (« l'app enfantine ») : pas de confetti, pas de mascotte, pas de couleur criarde ; la coche « sans faute » dessinée reste l'exception rare.
- **Don't** retomber dans « le corporate froid et gris » : la chaleur passe par les figurines, le ton du copy et l'encouragement — pas par un beige plaqué.
- **Don't** utiliser `--gold` pour un deuxième accent : l'ambre est un état (échéance/attention), l'or des badges, jamais une décoration.
- **Don't** écrire `transition: all`, une ombre noire pure, un `border-left` coloré >1px, ou un gradient text — bannis.
