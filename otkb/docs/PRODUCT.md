# Product

## Register

product

## Platform

web

## Users

**Des entraîneurs d'échecs** (au départ un, potentiellement plusieurs collègues).
OTKB est l'**usine à exercices** locale du coach : il explore une ouverture, voit
les puzzles tactiques qui en découlent, les calibre par niveau d'élève, et prépare
un dossier de séance. Pas d'élève ici — l'app élève en ligne est un projet séparé
(cf. `PLAN.md`). Le public de cette interface, c'est donc l'entraîneur, sur
ordinateur, parfois avec l'écran **projeté en cours**.

Comme l'outil peut être partagé entre entraîneurs, il ne peut pas reposer sur des
raccourcis connus d'un seul utilisateur : libellés explicites, lisibilité immédiate,
zéro jargon interne non expliqué.

## Product Purpose

Indexer les 1,2 M puzzles d'ouverture Lichess pour répondre à **une** question de
préparation : « à partir de cette position, quels exercices tactiques mes élèves
vont-ils rencontrer, et lesquels conviennent à leur niveau ? ». Le cœur métier est
**les puzzles qui SUIVENT / passent par une position** (through-position), pas ceux
qui y démarrent — distinction structurante, souvent la première mal comprise.

Le coach navigue un échiquier, lit une liste de puzzles qui se met à jour à chaque
coup (avec aperçu de la position), en résout pour juger, filtre par difficulté, puis
exporte un dossier PGN pour sa séance. Succès = ouvrir l'outil, atteindre une
position, et voir d'un coup d'œil les bons exercices — sans réfléchir à l'interface.

## Brand Personality

**Académie structurée × instrument clean** — l'identité partagée avec EECoach (le
produit élève du même club, esprit *Chessable × Linear*). Sérieux et sobre, jamais
austère ni criard. Papier zinc neutre (jamais crème), **une seule encre indigo**
réservée à l'action principale et à la sélection, la hiérarchie portée par la
structure (sections, bordures 1px, poids typographiques) et non par la décoration.
La seule chaleur vient du jeu : figurines ♞, notation monospacée, mini-échiquiers.
L'outil s'efface devant la tâche.

## Anti-references

- **ChessBase et son cockpit austère** : dense, oui — c'est le bon réflexe de
  densité — mais son look Windows des années 2000 (grilles grises, polices système,
  zéro respiration) est exactement ce qu'on ne veut PAS. Densité SANS austérité.
- **Le dashboard SaaS générique** : cartes arrondies identiques, gros KPI + dégradé,
  fond crème/beige, eyebrows en petites capitales tracked. Le défaut IA à fuir.
- **Le site d'échecs grand public** (chess.com / lichess) : ce n'est pas un outil de
  jeu, c'est un instrument de préparation. Pas de bruit visuel, pas de gamification.
- **Le tableau de bord analytics** : l'outil sert à trouver des exercices, pas à
  contempler des métriques. Pas de KPI géants ni de graphiques décoratifs.

## Design Principles

- **L'outil s'efface devant la tâche.** Composants standard, affordances cohérentes,
  rien de réinventé « pour la personnalité ». Un entraîneur qui découvre l'outil doit
  faire sa tâche sans mode d'emploi.
- **Densité au service du balayage.** L'écran doit montrer beaucoup de puzzles à la
  fois et les rendre comparables d'un coup d'œil — c'est le geste métier. La densité
  se gagne par la structure (tableau, grille d'aperçus), pas par l'entassement.
- **Le through-position est le héros.** Ce que l'interface met le plus en avant, ce
  sont les puzzles qui suivent la position courante. Tout le reste (motifs,
  ouvertures, suites) est du contexte secondaire.
- **Appartenir aux échecs.** La signature vient du jeu : mini-échiquier pour chaque
  position évoquée, notation en monospace, figurines. Jamais un accent SaaS plaqué.
- **Lisible partout, pour tous.** Contrastes vérifiés (usage en projection), jamais
  l'information par la seule couleur (trait, difficulté, carte thermique), thème
  sombre de première classe.

## Accessibility & Inclusion

- **Cible WCAG AA** : contraste corps ≥ 4.5:1, focus clavier visible, navigation au
  clavier. Contrastes calibrés pour tenir aussi **en vidéoprojection** (ambiances
  lumineuses défavorables) : privilégier le franc au subtil.
- **Daltonisme** : trait aux Blancs/Noirs, niveau de difficulté, cases chaudes de la
  carte thermique — toujours doublés d'un libellé, d'une icône ou d'un motif, jamais
  la couleur seule.
- **Thème sombre indispensable** : bascule complète de tokens, de première classe et
  non un ajout — l'outil s'utilise aussi en soirée.
- **Reduced-motion** : `prefers-reduced-motion` respecté ; toute animation a une
  alternative sobre.
