---
name: OTKB
description: Usine à exercices d'ouverture pour entraîneurs — explorer une position, voir les puzzles qui en découlent, préparer un dossier de séance. Identité partagée avec EECoach.
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
    fontWeight: 800
    letterSpacing: "-0.3px à -0.6px"
  body:
    fontFamily: "Hanken Grotesk, -apple-system, sans-serif"
    fontSize: "0.835rem–0.9rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontWeight: 500
rounded:
  bar: "2px"
  chip: "4px"
  sm: "6px"
  md: "8px"
  card: "12px"
  panel: "14px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "22px"
  section: "24px"
---

# Design System: OTKB

## 1. Overview

**North Star : le même cahier que l'élève, côté professeur.**

OTKB partage l'identité d'**EECoach** (le produit élève du club) : papier zinc clair,
une seule encre indigo, notation monospacée qui appartient visiblement au jeu. Le
lien est délibéré — c'est le même club, la même académie, vue depuis l'atelier de
préparation plutôt que depuis la table de révision. Là où EECoach est calme et aéré
(un élève, une révision à la fois), OTKB assume une **densité d'outil** : l'entraîneur
balaie des dizaines de puzzles pour composer une séance. La densité vient de la
structure (grille d'aperçus, tableau, panneaux), jamais de l'entassement décoratif.

Ce que le système **rejette** (anti-références PRODUCT.md) : ChessBase (dense mais
austère, gris Windows) ; le dashboard SaaS générique (cartes identiques, gros KPI +
gradient, fond crème, eyebrows capitales) ; le site d'échecs grand public ; le
tableau de bord analytics. La seule chaleur vient du jeu : figurines ♔♞, notation,
mini-échiquiers.

**Contrainte de plateforme : 100 % offline.** OTKB tourne en local (NiceGUI + Quasar,
échiquier Chessground vendu dans `otkb/ui/static/`). Aucun CDN. Les trois polices
sont **vendues localement** en `.woff2` dans `otkb/ui/static/fonts/` avec des
`@font-face` (comme Chessground a été vendu depuis jsdelivr) — jamais de
`fonts.googleapis.com`. Fallback système propre si une police manque.

**Key Characteristics:**
- Fond zinc neutre (#fafafa), surfaces blanches, bordures 1px — jamais de crème/beige.
- Un seul hue d'accent (indigo #4f46e5) en trois poids : plein > tonal > ghost.
- Couleurs sémantiques d'état uniquement (vert/ambre/rouge/bleu/violet), chacune avec
  sa variante `-ink` (texte AA), `-dim` (fond) et `-glow` (bordure/anneau).
- Signature échecs : monospace `tabular-nums` pour notation et données, figurines
  dans le texte, mini-échiquier partout où une position est évoquée.
- Densité assumée : le through-position s'affiche en **grille d'aperçus** balayable,
  pas en colonne de cartes empilées.
- Thème sombre complet. ⚠️ NiceGUI/Quasar basculent via **`body.body--dark`** (pas
  `[data-theme]`) : les tokens dark s'y accrochent.

## 2. Colors

Stratégie **Restrained** : neutres zinc + un accent indigo ≤10% de toute surface ;
les autres couleurs n'existent que pour dire un état.

### Primary
- **Encre indigo** (#4f46e5) : L'UNIQUE accent. Action principale (un bouton plein par
  zone), sélection courante, coup courant, progression. `indigo-dim` (8%) pour les
  fonds tonals, `indigo-glow` (30%) pour bordures/focus. En dark : #818cf8.

### Neutral
- **Papier zinc** (#fafafa) : fond de page. Blanc cassé à chroma zéro — jamais réchauffé.
- **Surface** (#ffffff) / **Surface 2** (#f4f4f5) / **Surface 3** (#e4e4e7) : cartes,
  panneaux, contrôles imbriqués.
- **Bordure** (#e4e4e7), **bordure hover** (#d4d4d8) : délimitation par défaut.
- **Encre** (#18181b) / **encre-2** (#3f3f46) / **estompé** (#65656d) : trois niveaux
  de texte. Un compte ou une donnée n'est PAS de l'estompé → encre-2.

### État (sémantique — jamais décorative)
- **Vert** (#16a34a, ink #166534) : correct, résolu, réussi.
- **Ambre** (#d97706, ink #92400e) : attention, difficulté élevée.
- **Rouge** (#dc2626, ink #be123c) : faute, destructif.
- **Bleu** (#2563eb, ink #1e40af) : indice, information.
- **Violet** (#7c3aed) : annotation, marqueur.

### Named Rules
**La règle de l'encre (-ink).** Toute couleur sémantique qui colore du TEXTE petit sur
fond clair ou teinté utilise sa variante `-ink`, jamais le token de base (~3.2:1). Une
encre se vérifie contre son propre `-dim` (l'appariement réel des pastilles), pas
contre la surface : `-ink` × {surf, surf2, surf3, page}, dans les deux thèmes. Les
états sont toujours doublés d'une icône ou d'un libellé — jamais la couleur seule
(daltonisme + projection).
**La règle des trois variantes.** Chaque couleur sémantique a exactement `-dim` /
`-ink` / `-glow`. Aucun rgba écrit à la main dans une bordure : si tu en écris un,
c'est que le token `-glow` manque — crée-le.
**La règle du hue unique.** Un seul bouton PLEIN indigo par zone. Le deuxième niveau
est TONAL (fond indigo-dim, texte indigo), le troisième GHOST (bordure neutre). Pas
de deuxième accent plein. L'ambre est un état, jamais une décoration.

## 3. Typography

**Display :** Bricolage Grotesque (fallback Hanken Grotesk, puis sans-serif système).
**Body :** Hanken Grotesk (fallback -apple-system, sans-serif).
**Mono/Data :** JetBrains Mono (fallback ui-monospace, monospace).

Vendues en local (`otkb/ui/static/fonts/`, `@font-face` `font-display: swap`). Un
grotesque à caractère pour les titres (800, tracking −0.3 à −0.6px), un humaniste
discret pour le reste, le monospace comme signature : toute notation (e4, ♞f3, O-O),
tout chiffre de donnée passe en JetBrains Mono `tabular-nums`.

### Hierarchy
- **Display** (800, 1.05–1.15rem, `text-wrap: balance`) : logo, titres de dialogues.
- **Title** (700, 0.92–1.02rem) : titres de sections — de vrais `<h2>`.
- **Body** (400–500, 0.835–0.9rem, lh 1.5, `text-wrap: pretty`) : texte, boutons.
- **Label** (600–700, 0.7–0.78rem) : badges, pastilles, métadonnées. Plancher 0.7rem.
- **Mono/Data** (500–700, `tabular-nums`) : notation, compteurs live, ratings.

### Named Rules
**La règle de la figurine.** Un coup ne s'écrit jamais en lettre seule quand la
figurine existe : Cf3 → ♞f3 partout où un coup est affiché (`to_figurine` existe déjà).
**La règle des capitales.** `text-transform: uppercase` réservé aux séparateurs de
navigation. Aucun eyebrow, aucun titre en capitales.

## 3 bis. Rounding

**2px** (barres de progression) · **4px** (petites pastilles carrées) · **6px**
(boutons, inputs) · **8px** (cartes standard) · **12px** (cartes de module, panneaux
principaux) · **14px** (dialogues, états vides) · **999px** (pilules). Une pastille se
ferme avec 999px, jamais un nombre magique calibré sur le padding courant.

## 4. Elevation

**Plat par défaut.** Surfaces au repos délimitées par une bordure 1px, pas une ombre.
Les ombres — toujours **teintées** zinc/indigo, jamais du noir pur — n'apparaissent
qu'en réponse à un état : survol d'une carte actionnable, dialogue, dropdown, toast.

- **xs** `0 1px 2px rgba(24,24,27,.05)` : relief minimal (tab actif).
- **sm** `0 1px 2px rgba(24,24,27,.06)` : cartes calmes.
- **base** `0 1px 3px rgba(24,24,27,.08), 0 1px 2px rgba(24,24,27,.05)` : dropdowns, toasts.
- **lg** `0 10px 30px rgba(30,27,75,.12), 0 4px 8px rgba(24,24,27,.06)` : dialogues (pointe indigo délibérée).

**La règle de l'ombre teintée.** Aucune ombre `rgba(0,0,0,…)` : hue zinc (#18181b) ou
indigo profond (#1e1b4b). Une ombre noire paraît « sale ».

## 5. Components

Caractère **sobre et sûr** : affordances standard, la personnalité vient du contenu
échiquéen, pas des contrôles. NiceGUI/Quasar par-dessous — styliser via les variables
CSS et les classes Quasar (`.q-card`, `.q-btn`, `.q-tab`…), sans réinventer.

### Buttons
- **Shape :** 6px ; padding 8px 15px (5px 12px en petit).
- **Primary :** indigo plein (#4f46e5, texte blanc) — un seul par zone.
- **Tonal :** fond indigo-dim, texte indigo, bordure indigo-glow — l'important non-principal.
- **Ghost :** surface blanche, bordure neutre, texte encre-2 — support, navigation locale.
- **Danger :** rouge plein, destructif uniquement.
- **Hover/Focus/Press :** hover = fond/bordure (120ms, propriétés explicites, jamais
  `transition: all`) ; focus = double anneau (`0 0 0 2px surf, 0 0 0 4px indigo-glow`) ;
  press = `scale(.97)`. Icône seule : `aria-label` + cible ≥ 40px.

### Cards / Panels
- **Corner :** 8px (standard) à 12px (panneaux principaux). Pas de carte imbriquée dans une carte.
- **Background :** surface blanche, bordure 1px ; tint `-dim` seulement quand la carte EST un état.
- **Shadow :** aucune au repos ; hover teinté indigo sur les cartes actionnables.
- **Padding :** 14–22px.

### Inputs / Fields
- Surface blanche, bordure 1px, radius 6px ; **monospace pour les champs PGN/FEN/coups UCI**.
- Focus : `border-color + box-shadow` 150ms vers l'indigo-glow.

### Navigation
- Onglets hauts (Explorateur / Dossiers / Meilleurs / Comparaison). Actif = indicateur
  indigo. ⚠️ **L'Explorateur DOIT rester l'onglet par défaut** (l'init Chessground ne
  tourne qu'une fois et cherche `#otkb-cg`). Libellés en clair, pas en capitales tracked.

### L'échiquier (composant signature)
Chessground (lib Lichess, pièces cburnett, vendu local) au centre de l'Explorateur.
Les **mini-échiquiers** (vignettes SVG `img_tag`) portent les positions dans les listes
de puzzles, l'aperçu des dossiers, les meilleurs puzzles. C'est LA source d'identité :
tout élément qui parle d'une position la MONTRE. La vignette d'un puzzle affiche la
position **telle que l'élève la voit** (après le coup adverse, plateau orienté au trait).

### La liste de puzzles « à travers » (le cœur métier)
Grille/liste dense d'aperçus, mise à jour à chaque coup joué. Chaque entrée : mini-
échiquier + trait (libellé, pas couleur seule) + difficulté (mono) + thèmes + action
« Résoudre ». Balayable, paginée, triée par difficulté (le tri par popularité est
banni de ce panneau : jointure ~2 s, recalculée à chaque coup — cf. `_TH_SORTS`).

## 6. Do's and Don'ts

### Do
- Réserver l'indigo plein à UNE action principale par zone ; le reste tonal ou ghost.
- Variantes `-ink` pour tout texte sémantique petit ; chaque état doublé d'icône/libellé.
- Toute notation et donnée chiffrée en JetBrains Mono `tabular-nums`.
- Montrer un mini-échiquier chaque fois qu'on parle d'une position.
- Densité par la structure (grille, tableau) — c'est le geste métier du coach.
- `prefers-reduced-motion` sur chaque animation ; ease-out, 120–300ms, propriétés explicites.
- Vérifier les contrastes pour la **projection** (franc plutôt que subtil).

### Don't
- **Don't** viser l'austérité ChessBase (grilles grises, police système, zéro respiration) —
  la densité se marie au calme zinc, pas au cockpit Windows.
- **Don't** reproduire le dashboard SaaS (cartes identiques, gros KPI + gradient, fond
  crème, eyebrows capitales).
- **Don't** empiler des cartes de même poids : hiérarchiser (le through-position domine,
  le reste est du contexte).
- **Don't** coder une info par la seule couleur (trait, difficulté, carte thermique).
- **Don't** charger une police par CDN (offline strict) ; les vendre en local.
- **Don't** écrire `transition: all`, une ombre noire pure, un `border-left` coloré >1px,
  un gradient text — bannis.
- **Don't** déplacer l'Explorateur de la position d'onglet par défaut (casse Chessground).
