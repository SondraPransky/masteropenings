-- ════════════════════════════════════════════════════════════
--  EECoach — Migration 008 : LIEN PARENTS (rapport lecture seule)
--  À EXÉCUTER dans : Supabase → SQL Editor → coller → Run. Idempotent.
--
--  Objectif (arbitrage 28/07) : une URL SECRÈTE par élève, sans compte,
--  révocable par le coach, qui montre aux parents la RÉGULARITÉ, la
--  RÉUSSITE et le TRAVAIL EN COURS — jamais les parties ni les annotations
--  (l'élève garde son espace).
--
--  Modèle (migration-free côté schéma) : les jetons vivent dans le profil
--  du COACH — profiles.extra.parentLinks = { "<token>": {"email":…, "name":…,
--  "display":…} }. Le coach écrit son propre profil (RLS existante), et la
--  révocation = retirer la clé. Un token ne donne accès qu'à L'AGRÉGAT
--  ci-dessous, via cette fonction SECURITY DEFINER — jamais aux tables.
-- ════════════════════════════════════════════════════════════

create or replace function public.parent_report(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with lk as (
    -- Le coach qui a émis ce jeton, et l'identité de l'élève qu'il désigne.
    select p.extra->'parentLinks'->p_token as info
    from profiles p
    where p.extra->'parentLinks' ? p_token
    limit 1
  ),
  ident as (
    select lower(coalesce(info->>'email',''))   as email,
           coalesce(info->>'name','')           as name,
           coalesce(info->>'display', info->>'name', '') as display
    from lk where info is not null
  ),
  res as (
    -- 60 jours de résultats de CET élève (email OU nom, comme _resultKeys côté app).
    select r.ts, r.correct, r.drill_name
    from results r, ident i
    where (lower(coalesce(r.student_email,'')) = i.email and i.email <> '')
       or (coalesce(r.student_name,'') = i.name and i.name <> '')
  ),
  win as (
    select * from res
    where ts >= (extract(epoch from now()) * 1000)::bigint - 60::bigint * 86400000
  ),
  days as (
    select to_char(to_timestamp(ts / 1000), 'YYYY-MM-DD') as d,
           count(*)::int as n,
           count(*) filter (where correct)::int as ok
    from win group by 1
  ),
  recent as (
    -- « Travail en cours » = ce que l'élève a RÉELLEMENT révisé (pas les parties).
    select drill_name as name, max(ts) as last, count(*)::int as n,
           count(*) filter (where correct)::int as ok
    from win where drill_name is not null and drill_name <> ''
    group by 1 order by max(ts) desc limit 6
  )
  select case when not exists (select 1 from ident) then null else jsonb_build_object(
    'display', (select display from ident),
    'days',    coalesce((select jsonb_agg(jsonb_build_object('d', d, 'n', n, 'ok', ok) order by d) from days), '[]'::jsonb),
    'recent',  coalesce((select jsonb_agg(jsonb_build_object('name', name, 'last', last, 'n', n, 'ok', ok) order by last desc) from recent), '[]'::jsonb),
    'generatedAt', (extract(epoch from now()) * 1000)::bigint
  ) end;
$$;

-- Appelable SANS session (le parent n'a pas de compte) : le token EST le secret.
revoke all on function public.parent_report(text) from public;
grant execute on function public.parent_report(text) to anon, authenticated;
