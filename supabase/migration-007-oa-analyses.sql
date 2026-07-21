-- ════════════════════════════════════════════════════════════
--  EECoach — Migration 007 : analyses d'ouvertures OA (worker Supabase, D18)
--  À EXÉCUTER dans : Supabase → SQL Editor → coller → Run. Idempotent.
--
--  Objectif : le worker local `python -m oa.eecoach_worker` analyse les
--  modules du coach (erreurs humaines par tranche Elo, trous du répertoire,
--  diagnostics — package `oa/` vendoré) et dépose UNE ligne par module ici.
--  La SPA (section coach « Analyse d'ouvertures ») ne fait que lire.
--
--  RLS coach-only : le diagnostic appartient au coach ; les élèves n'y
--  accèdent jamais (ils reçoivent des PAQUETS d'exercices créés depuis
--  ces erreurs, via la table modules comme d'habitude).
--  Le doc `data` est plafonné côté worker (~<300 Ko/module).
-- ════════════════════════════════════════════════════════════

create table if not exists public.oa_analyses (
  module_id  text primary key,                     -- id du module EECoach analysé
  teacher_id uuid not null default auth.uid(),     -- le coach propriétaire
  updated_at timestamptz not null default now(),   -- fraîcheur de l'analyse
  data       jsonb not null default '{}'           -- doc compact : meta + errors + gaps + diagnostics
);

alter table public.oa_analyses enable row level security;

-- Le coach ne voit et n'écrit QUE ses propres analyses.
drop policy if exists "oa_analyses_select" on public.oa_analyses;
create policy "oa_analyses_select" on public.oa_analyses
  for select to authenticated using (teacher_id = auth.uid());

drop policy if exists "oa_analyses_insert" on public.oa_analyses;
create policy "oa_analyses_insert" on public.oa_analyses
  for insert to authenticated with check (teacher_id = auth.uid());

drop policy if exists "oa_analyses_update" on public.oa_analyses;
create policy "oa_analyses_update" on public.oa_analyses
  for update to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

drop policy if exists "oa_analyses_delete" on public.oa_analyses;
create policy "oa_analyses_delete" on public.oa_analyses
  for delete to authenticated using (teacher_id = auth.uid());

-- ── Recharger le cache de schéma de PostgREST ───────────────
notify pgrst, 'reload schema';
