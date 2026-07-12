# Product

## Register

product

## Platform

web

## Users

Un **club d'échecs** (école d'échecs francophone). Deux rôles, un seul produit :

- **Le coach** (aujourd'hui : un seul prof) — crée des modules d'ouvertures/exercices, les assigne à des classes/élèves avec échéances, suit la progression, et **revoit/annote** les parties que ses élèves lui partagent.
- **Les élèves** (enfants, ados, adultes du club) — révisent les modules assignés via **répétition espacée** (SM-2), gèrent leurs révisions perso, saisissent/collent leurs propres parties dans « Ma bibliothèque », les partagent au coach, et jouent contre le moteur **Maia** après révision.

Contexte d'usage : entre les cours et à la maison, souvent au téléphone pour l'élève, sur ordinateur pour le coach qui prépare/suit. La tâche prime : réviser, créer un module, suivre un élève.

## Product Purpose

Outil complet **de formation et de suivi** pour un club : révision d'ouvertures et d'exercices, assignation par le coach, boucle « l'élève envoie ses parties → le coach annote → l'élève relit », et suivi de progression détaillé. Backend Supabase (source de vérité), moteur Maia (ONNX) pour jouer, `chess.js` pour la logique. SPA vanilla-JS / Vite, déployée sur GitHub Pages.

Lancement **single-coach** visé mi-septembre 2026 (toi + tes élèves) ; le multi-coachs et la bibliothèque d'exercices partagée viennent après. Succès = un élève ouvre l'app, sait immédiatement quoi réviser, le fait, et voit sa progression ; le coach prépare un module et suit sa classe sans friction.

## Brand Personality

**Académie structurée × outil clean** (esprit Chessable × Linear). Sérieux et encourageant, jamais scolaire-austère ni criard. Cadrage **« travail → fais-le → progresse »** : hiérarchie forte, l'app dit quoi faire, on le fait, on voit le résultat. Sobre — blanc, neutres zinc, **indigo comme accent précis** — mais **ancrée dans les échecs** (échiquier, notation algébrique, tons bois) pour qu'elle appartienne visiblement au jeu, pas au SaaS générique. La gamification existante (série, anneaux de progression) reste un **signal discret**, pas un feu d'artifice.

## Anti-references

- **Le dashboard SaaS générique** (cartes identiques, gros KPI + gradient, fond crème/beige, eyebrows en petites capitales) — le défaut IA à fuir.
- **Le site d'échecs surchargé** (densité chess.com/lichess : panneaux partout, pubs, bruit visuel) — on veut le calme, pas le cockpit.
- **L'app enfantine sur-gamifiée** (couleurs criardes, badges clinquants, mascottes) — le public inclut des enfants mais le club veut du sérieux, pas un jeu pour bébés.
- **Le corporate froid et gris** (institutionnel, sans chaleur) — l'élève doit avoir envie d'y revenir.

## Design Principles

- **L'outil s'efface devant la tâche.** Familiarité gagnée : composants standard, affordances cohérentes, zéro affordance réinventée pour la « personnalité ». Un élève ou un coach doit faire sa tâche sans réfléchir à l'interface.
- **Structurer, pas décorer.** Chaque dispositif (hiérarchie, sections, états) encode quelque chose de vrai sur le travail — révision due, module assigné, partie annotée — pas de la déco.
- **Appartenir aux échecs.** La seule chaleur/signature vient du jeu : échiquier, notation monospacée, tons bois — jamais un accent SaaS plaqué. Ça distingue sans surcharger.
- **Signaux discrets.** Progression, série, échéances : lisibles d'un coup d'œil, jamais tape-à-l'œil. La motivation se gagne par la clarté, pas par le clinquant.
- **Accessible au club.** Public intergénérationnel incluant des enfants : libellés clairs, tailles confortables, cibles tactiles généreuses, et jamais l'information par la seule couleur.

## Accessibility & Inclusion

- **Cible WCAG AA** : contraste corps ≥ 4.5:1, focus clavier visible, navigation clavier (l'éditeur/drill supportent déjà ← →).
- **Lisible pour jeunes & débutants** : vocabulaire simple en français, tailles de texte confortables, cibles tactiles généreuses (usage mobile élève).
- **Daltonisme** : les états (résultat gagné/perdu, correct/erreur, échéance en retard) sont signalés par **icône + texte**, pas uniquement par le vert/rouge.
- **Reduced-motion** : `prefers-reduced-motion` respecté (déjà amorcé) ; toute animation a une alternative sobre.
