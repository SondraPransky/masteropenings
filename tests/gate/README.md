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
| 11 | coach | **paquet d'exercices multi-coups** : `modules.sessions[].kps[].line` (jsonb) round-trip + flag `isExercise` |
| 12 | élève | **partie Lichess** : PGN annoté (en-têtes + `%clk`) round-trip à l'identique dans `games.pgn` |

Le script **crée puis supprime** ses données (classe, partie, result,
practice, module) et **restaure** `profiles.extra` / `mastery` de l'élève.
Sortie : `✅ GATE VERTE` (exit 0) ou `❌ GATE ROUGE` (exit 1).
