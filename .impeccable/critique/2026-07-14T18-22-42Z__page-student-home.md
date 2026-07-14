---
target: page-student-home
total_score: 28
p0_count: 0
p1_count: 0
timestamp: 2026-07-14T18-22-42Z
slug: page-student-home
---
# Critique — page-student-home (accueil élève)

⚠️ DEGRADED: single-context (spawn de sous-agents restreint par la configuration de session ; A puis B exécutés séquentiellement, isolés)

## Design Health Score

| # | Heuristique | Score | Constat clé |
|---|-----------|-------|-----------|
| 1 | Visibilité de l'état du système | 3 | Riche (streak, dus, badges Nouveau/Mis à jour/échéances, barres de progression, bannière notif) ; feedback du bouton « Actualiser » non confirmé |
| 2 | Correspondance avec le monde réel | 3 | Français simple, vocabulaire échecs ; « positions dues » légèrement jargon (mais expliqué dans « Ma progression ») |
| 3 | Contrôle et liberté | 3 | Retour role-aware depuis le drill ; caractère « dismissible » de la bannière notif non confirmé |
| 4 | Cohérence et standards | 3 | Système unifié (boutons/icônes Tabler) ; MAIS badge « En retard » en tokens bruts inline (échappe au fix -ink du coach) et variantes « à réviser / À revoir » |
| 5 | Prévention des erreurs | 3 | PGN validé, anti double-clic (harden), peu d'actions destructives sur cette page |
| 6 | Reconnaissance plutôt que rappel | 3 | Tout visible ; bouton Maia des cartes = icône seule sans aria-label (title seul) |
| 7 | Flexibilité et efficacité | 2 | ←/→ dans le drill, boutons play focusables ; aucun accélérateur sur l'accueil |
| 8 | Design épuré | 3 | Hiérarchie post-T3 saine (1 CTA hero, stats rétrogradées) ; concentration de signaux en haut (notif + streak + hero) |
| 9 | Récupération d'erreur | 3 | Toasts (PGN invalide, échec d'écriture depuis harden) |
| 10 | Aide et documentation | 2 | Sous-titres explicatifs ; pas d'aide contextuelle au-delà |
| **Total** | | **28/40** | **Good — consolider les zones faibles** |

## Verdict anti-patterns

**Évaluation LLM : PASSE.** Identité propre (figurines ♔, notation, indigo précis, copy française chaleureuse-sobre) ; aucun tell des bans absolus sur cette page. Le hero radial + streak reste dans la ligne « signaux discrets ».

**Scan déterministe (detect.mjs sur index.html)** : 2 findings — `layout-transition` L581 (barre de progression `width`, même famille que les 4 faux positifs documentés) et `em-dash-overuse` (23 tirets cadratins ; en français le tiret cadratin est légitime, faux positif majoritaire).

**Overlay navigateur (detect.js injecté, 89 hits app entière)** : quasi tout vient des modals cachés (`dark-glow`/`thin-border-wide-shadow` sur `.modal` = ombres teintées délibérées de la passe premium) et des `all-caps` de nav documentés. Pertinent pour l'élève : `tiny-text` 10.4px sur des badges/métadonnées de cartes (labels, pas du corps — mais public enfant, PRODUCT.md exige « tailles confortables »).

## Impression générale
Page saine et prescriptive : on sait quoi faire en 2 secondes (hero « À réviser aujourd'hui » + 1 CTA). Le plus gros manque n'est pas visuel mais structurel : la page n'a **aucun heading sémantique**, et deux détails d'a11y échappés aux passes coach.

## Ce qui marche
- **Le cadrage prescriptif** : hero à état (travail dû / à jour / vide), CTA unique, sections dans le bon ordre (modules → exercices → perso → stats).
- **Les signaux de progression discrets** : badges maîtrise/échéance, barres par carte, streak — lisibles sans criard, conformes à la marque.
- **La séparation Ouvertures / Exercices** (section dédiée, masquée si vide) réduit la charge cognitive.

## Priority Issues
1. **[P2] Zéro heading sémantique sur la page** — tous les titres de section sont des `div.sh-section-label`. Un lecteur d'écran ne peut pas naviguer par titres (public inclusif = exigence PRODUCT.md). Fix : `sh-section-label` → `<h2>`, libellé hero → `<h2>` ; styles inchangés. → /impeccable polish
2. **[P2] Badge « En retard » en tokens bruts** — `_deadlineBadge` (lib/student.js) inline `background:var(--red-dim);color:var(--red)` (~4.1:1 à ~10px bold) : la même faille corrigée côté coach via `-ink`. Fix : `--red-ink`/`--gold-ink`. → /impeccable polish
3. **[P2] Bouton Maia des cartes sans aria-label** (title seul) — incohérent avec le bouton play voisin qui en a un. → /impeccable polish
4. **[P3] Badges 10.4px** (.65rem) sur les cartes — petits pour des enfants sur mobile ; passer à ≥11px aiderait sans casser la densité. → /impeccable typeset
5. **[P3] Micro-vocabulaire** : « à réviser » (tuile) vs « À revoir » (pastilles coach) vs « Réviser » (bouton) — unifier là où c'est le même concept. → /impeccable clarify

## Persona Red Flags
**Sam (lecteur d'écran)** : navigation par headings impossible (0 heading) ; bouton Maia annoncé sans nom ; les cartes `div onclick` sont muettes mais le bouton play focusable est une alternative valable. C'est LE persona qui souffre.
**Casey (élève mobile distrait)** : 0 overflow à 375px, cibles ≥38-40px (post-harden/adapt), état local persistant (localStorage) — bon. Le CTA hero est en haut d'écran (hors zone pouce) mais la page est courte.
**Jordan (débutant, enfant)** : premier écran clair (« Salut X », un bouton), sous-titres explicatifs, pas de jargon bloquant. Le badge « mat en N » et « 0/2 résolus » parlent bien.

## Observations mineures
- La bannière `#sh-notif` (« 5 nouveaux modules ») semble non-dismissible — elle disparaît à l'ouverture des modules, acceptable.
- `#sh-exercise-section` affichait un module de test « GATE edit-line » comme exercice — artefact de données locales, pas un bug UI.
- Le hero dit « choisies par la répétition espacée » : bonne vulgarisation, garder.

## Questions à considérer
- Le streak 🔥 est un signal discret aujourd'hui — que se passe-t-il émotionnellement quand il RETOMBE à zéro ? (peak-end : prévoir un message bienveillant plutôt qu'une disparition sèche.)
- Les stats (« Ma progression ») méritent-elles d'être visibles par défaut, ou repliées comme le « Suivi par module » coach ?
- Un élève avec 6 modules + 40 exercices verra une page très longue : un « continuer là où j'en étais » en hero suffirait-il à raccourcir le scroll ?
