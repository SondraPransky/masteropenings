-- ════════════════════════════════════════════════════════════
--  EECoach — Migration 006 : parties bibliothèque partagées (Pilier 1)
--  À EXÉCUTER dans : Supabase → SQL Editor → coller → Run. Idempotent.
--
--  Objectif : le coach doit pouvoir LIRE et ANNOTER (UPDATE) les parties
--  qu'un élève de l'une de ses classes a partagées (games.extra.shared = true),
--  et l'élève doit pouvoir mettre à jour les siennes (flag de partage).
--  Les entrées « bibliothèque » ont drill_id = null (≠ parties Maia liées à un module).
-- ════════════════════════════════════════════════════════════

-- Helper : ids des élèves membres d'une classe du prof connecté.
-- SECURITY DEFINER → lit profiles/classes sans RLS (pas de récursion dans les policies).
create or replace function public.my_student_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}')
  from public.profiles p
  where exists (
    select 1 from public.classes c
    where c.teacher_id = auth.uid()
      and c.students ?| array_remove(array[lower(p.pseudo), lower(p.email)], null)
  );
$$;
grant execute on function public.my_student_ids() to authenticated;

-- ── Lecture : ajoute les parties partagées des élèves du prof ──
drop policy if exists "games_read" on public.games;
create policy "games_read" on public.games for select to authenticated using (
  student_id = auth.uid()
  or drill_id in (select id::text from public.modules where teacher_id = auth.uid())
  or (coalesce(extra->>'shared','') = 'true' and student_id = any(public.my_student_ids()))
);

-- ── Mise à jour : l'élève sur les siennes ; le prof sur les parties partagées de ses élèves ──
-- (partage : toggleShareGame ; annotation coach : _reviewSaveDone → _sbUpdateGame)
drop policy if exists "games_update" on public.games;
create policy "games_update" on public.games for update to authenticated
  using (
    student_id = auth.uid()
    or (coalesce(extra->>'shared','') = 'true' and student_id = any(public.my_student_ids()))
  )
  with check (
    student_id = auth.uid()
    or (coalesce(extra->>'shared','') = 'true' and student_id = any(public.my_student_ids()))
  );

-- ── Recharger le cache de schéma de PostgREST ───────────────
notify pgrst, 'reload schema';
