-- ════════════════════════════════════════════════════════════
--  Migration 004 — Durcissement RLS · PHASE 1 (résultats / pratique / parties)
--  À EXÉCUTER dans : Supabase → SQL Editor → coller → Run. Idempotent.
--
--  Avant : insert/select `using (true)` → tout utilisateur connecté pouvait
--          ÉCRIRE des résultats au nom de n'importe qui et LIRE ceux de tous.
--  Après : - un élève n'écrit QUE ses propres lignes (student_id = auth.uid())
--          - un élève ne LIT que les siennes
--          - un prof LIT (et peut SUPPRIMER) les lignes liées à SES modules
--
--  NB : modules/classes ont déjà des policies d'écriture par propriétaire ;
--       leur LECTURE reste ouverte pour l'instant → durcie en Phase 2.
-- ════════════════════════════════════════════════════════════

-- Petit helper lisible : les ids (texte) des modules du prof connecté.
--   results.drill_id / practice.drill_id / games.drill_id sont du TEXTE,
--   modules.id est un bigint → cast id::text.

-- ── results ───────────────────────────────────────────────
drop policy if exists "results_read"   on public.results;
drop policy if exists "results_insert" on public.results;
drop policy if exists "results_delete" on public.results;

create policy "results_insert" on public.results
  for insert to authenticated
  with check (student_id = auth.uid());

create policy "results_read" on public.results
  for select to authenticated
  using (
    student_id = auth.uid()
    or drill_id in (select id::text from public.modules where teacher_id = auth.uid())
  );

create policy "results_delete" on public.results
  for delete to authenticated
  using (
    student_id = auth.uid()
    or drill_id in (select id::text from public.modules where teacher_id = auth.uid())
  );

-- ── practice ──────────────────────────────────────────────
drop policy if exists "practice_read"   on public.practice;
drop policy if exists "practice_insert" on public.practice;
drop policy if exists "practice_delete" on public.practice;

create policy "practice_insert" on public.practice
  for insert to authenticated
  with check (student_id = auth.uid());

create policy "practice_read" on public.practice
  for select to authenticated
  using (
    student_id = auth.uid()
    or drill_id in (select id::text from public.modules where teacher_id = auth.uid())
  );

create policy "practice_delete" on public.practice
  for delete to authenticated
  using (
    student_id = auth.uid()
    or drill_id in (select id::text from public.modules where teacher_id = auth.uid())
  );

-- ── games ─────────────────────────────────────────────────
drop policy if exists "games_read"   on public.games;
drop policy if exists "games_insert" on public.games;
drop policy if exists "games_delete" on public.games;

create policy "games_insert" on public.games
  for insert to authenticated
  with check (student_id = auth.uid());

create policy "games_read" on public.games
  for select to authenticated
  using (
    student_id = auth.uid()
    or drill_id in (select id::text from public.modules where teacher_id = auth.uid())
  );

create policy "games_delete" on public.games
  for delete to authenticated
  using (
    student_id = auth.uid()
    or drill_id in (select id::text from public.modules where teacher_id = auth.uid())
  );

-- ── Recharger le cache de schéma de PostgREST ─────────────
notify pgrst, 'reload schema';
