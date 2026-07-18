# Gate de release — validation connectée Supabase

Le vrai aller-retour réseau Supabase (auth + REST + RLS) sur **2 comptes**
(élève + coach). C'est la gate de release du Pilier 1 (CLAUDE.md §6 #7) :
tant qu'elle n'est pas verte, on ne lance pas.

## Prérequis (déjà faits côté Supabase)

- `alter table profiles add column if not exists extra jsonb default '{}';`
- `supabase/migration-006-shared-games.sql`

## Comptes de test

Créer deux comptes sur le site live (confirmer les emails si demandé) :

- un **coach** — rôle `teacher`
- un **élève** — rôle `student`

Pas besoin de les relier à une classe à la main : le script crée une classe
temporaire coach→élève, puis la supprime.

## Lancer

Renseigner dans `.env` (déjà gitignoré) :

```
GATE_COACH_EMAIL=...
GATE_COACH_PWD=...
GATE_STUDENT_EMAIL=...
GATE_STUDENT_PWD=...
```

Puis :

```
npm run gate
```

## Ce qui est vérifié

| # | Acteur | Vérifie |
|---|--------|---------|
| 1 | élève | bases `profiles.extra` (write→read) |
| 2 | élève | mastery (write→read) |
| 3 | élève | insert + read d'une partie bibliothèque (`drill_id=null`) |
| 4 | RLS | le coach **ne voit pas** une partie non partagée |
| 4b | RLS | le coach **ne peut pas** annoter une partie non partagée |
| 5 | élève | partage (`extra.shared=true`) via UPDATE |
| 6 | coach | **lit** la partie partagée de son élève (`my_student_ids`) |
| 7 | coach | **annote** la partie partagée (`games_update`) |
| 8 | élève | revoit l'annotation coach (`%author coach` + `reviewedAt`) |
| 9 | élève | insert + read d'un `result` |
| 10 | élève | insert + read d'une session `practice` |
| 11 | coach | **paquet d'exercices multi-coups** : `modules.sessions[].kps[].line` (jsonb) round-trip + flags `isExercise` / `extra.exType` (type de tactique) |
| 12 | élève | **partie Lichess** : PGN annoté (en-têtes + `%clk`) round-trip à l'identique dans `games.pgn` |
| 13 | coach + élève | **outillage coach** : `classes.extra.targetedReviews` (révisions ciblées) + `classes.extra.deadlines` (échéances) round-trip ; l'élève lit sa révision ciblée (RLS `classes_read`) |
| 14 | coach | **suivi élève** : lit le `result` + la `practice` de son élève rattachés à son module (RLS `results_read`/`practice_read` via `drill_id`) |
| 15 | élève + coach | **couche d'édition élève** (le seul vrai risque données restant) : l'élève greffe un overlay sur le module coach — ligne `modules` à 2 propriétaires (`teacher_id`=coach lit, `owner_student_id`=élève écrit), `extra.overlayOf` + `tree`=diff. Prouve : insert élève (`modules_insert_owner`), relecture élève, lecture coach (`modules_read` OR `teacher_id`), identité dénormalisée `overlayBy`, discriminant anti-pollution `overlayOf`, et la **réponse coach qui préserve `owner_student_id`** (`_sbSaveCoachOverlayReply` ne vole pas la ligne). *(Isolation entre 2 élèves distincts = hors gate 2-comptes.)* |

Le script **crée puis supprime** ses données (classe, partie, result,
practice, module) et **restaure** `profiles.extra` / `mastery` de l'élève.
Sortie : `✅ GATE VERTE` (exit 0) ou `❌ GATE ROUGE` (exit 1).
