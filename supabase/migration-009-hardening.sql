-- ════════════════════════════════════════════════════════════════════════════
--  Migration 009 — durcissement de sécurité (audit d'octobre 2026)
--  À exécuter dans : Supabase → SQL Editor → Run. Idempotente (rejouable).
--
--  Les 5 failles corrigées (toutes exploitables par un simple compte élève,
--  la création de compte étant ouverte à tous) :
--
--  1. FUITE DE DONNÉES D'ENFANTS. `profiles_read` laissait chaque élève lire la
--     ligne ENTIÈRE du profil de son coach — donc `extra.studentPhotos` (les
--     photos de TOUS les élèves), `extra.studentBriefs` (les bilans IA de
--     faiblesses de chaque élève) et `extra.parentLinks` (les jetons des liens
--     parents de tous les élèves → le rapport d'activité de n'importe quel
--     camarade). → un élève ne lit plus que SON profil ; le nom du coach passe
--     par la RPC `my_coach_names` qui ne renvoie que id/name/pseudo/email.
--
--  2. USURPATION D'IDENTITÉ DE CLASSE. L'appartenance à une classe se juge sur
--     l'email/pseudo du PROFIL, colonne que l'utilisateur pouvait réécrire
--     librement : mettre l'email d'un camarade dans son profil suffisait à
--     entrer dans ses classes. → l'email est forcé à celui du compte auth ; un
--     pseudo ne peut ni contenir « @ » ni reprendre le pseudo d'un autre.
--
--  3. ESCALADE DE RÔLE. Tout utilisateur pouvait se passer `role = 'teacher'`
--     à tout moment. → le rôle n'est modifiable que dans l'heure qui suit la
--     création du compte (le parcours d'inscription et le retour OAuth Google
--     en ont besoin), figé ensuite.
--
--  4. RÉSULTATS FORGÉS. `results`/`practice` acceptaient un student_email /
--     student_pseudo arbitraire : un élève pouvait écrire des résultats AU NOM
--     d'un autre (pollution du suivi coach et du rapport parents). → identité
--     réécrite côté serveur depuis le profil à chaque insertion.
--
--  5. INJECTION DANS LE RÉPERTOIRE D'UN COACH. `modules_insert_owner` laissait
--     un élève insérer une ligne avec N'IMPORTE QUEL teacher_id → elle
--     apparaissait chez un coach qui ne le connaît pas. → une couche élève ne
--     peut viser qu'un coach dont il est réellement l'élève.
--
--  + `parent_report` ne compte plus que les résultats sur les modules du coach
--    qui a émis le lien (sinon un homonyme d'un autre club fuitait), et ne
--    rapproche plus par nom seul quand l'email est connu.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Profils : chacun le sien ; le nom du coach via RPC minimale ──────────
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create or replace function public.my_coach_names()
returns table (id uuid, name text, pseudo text, email text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.pseudo, p.email
  from public.profiles p
  where p.id in (
    select c.teacher_id from public.classes c
    where c.students ?| public.my_identifiers()
  );
$$;
revoke all on function public.my_coach_names() from public;
grant execute on function public.my_coach_names() to authenticated;

-- ── 2 + 3. Garde-fous d'écriture sur profiles ───────────────────────────────
create or replace function public.profiles_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  auth_email text;
begin
  -- Les écritures du serveur (service role, trigger d'inscription) passent.
  if auth.uid() is null then return new; end if;

  select u.email into auth_email from auth.users u where u.id = new.id;
  new.email := auth_email;                       -- jamais l'email d'un autre

  if new.pseudo is not null then
    new.pseudo := lower(btrim(new.pseudo));
    if new.pseudo = '' then new.pseudo := null;
    elsif position('@' in new.pseudo) > 0 then
      raise exception 'pseudo invalide : « @ » interdit';
    elsif exists (select 1 from public.profiles p
                  where p.id <> new.id
                    and (lower(p.pseudo) = new.pseudo or lower(p.email) = new.pseudo)) then
      raise exception 'pseudo déjà pris';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.role is distinct from old.role
     and old.created_at < now() - interval '1 hour' then
    raise exception 'le rôle ne peut plus être modifié';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- ── 4. results / practice : l'identité vient du profil, pas du client ───────
create or replace function public.stamp_student_identity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  p record;
begin
  if auth.uid() is null then return new; end if;
  select email, pseudo into p from public.profiles where id = auth.uid();
  new.student_id     := auth.uid();
  new.student_email  := p.email;
  new.student_pseudo := p.pseudo;
  return new;
end;
$$;

drop trigger if exists results_stamp on public.results;
create trigger results_stamp before insert on public.results
  for each row execute function public.stamp_student_identity();
drop trigger if exists practice_stamp on public.practice;
create trigger practice_stamp before insert on public.practice
  for each row execute function public.stamp_student_identity();

-- ── 5. modules : un élève ne cible que SES coachs ───────────────────────────
create or replace function public.my_coach_ids()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(distinct c.teacher_id), '{}')
  from public.classes c
  where c.students ?| public.my_identifiers();
$$;
grant execute on function public.my_coach_ids() to authenticated;

drop policy if exists "modules_insert_owner" on public.modules;
create policy "modules_insert_owner" on public.modules for insert to authenticated
  with check (
    (teacher_id = auth.uid())
    or (owner_student_id = auth.uid()
        and (teacher_id is null or teacher_id = any(public.my_coach_ids())))
  );

drop policy if exists "modules_update_owner" on public.modules;
create policy "modules_update_owner" on public.modules for update to authenticated
  using  (teacher_id = auth.uid() or owner_student_id = auth.uid())
  with check (
    (teacher_id = auth.uid())
    or (owner_student_id = auth.uid()
        and (teacher_id is null or teacher_id = any(public.my_coach_ids())))
  );

-- ── + parent_report : périmètre du coach émetteur ───────────────────────────
create or replace function public.parent_report(p_token text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with lk as (
    select p.id as coach_id, p.extra->'parentLinks'->p_token as info
    from profiles p
    where length(coalesce(p_token, '')) >= 16
      and p.extra->'parentLinks' ? p_token
    limit 1
  ),
  ident as (
    select coach_id,
           lower(coalesce(info->>'email',''))   as email,
           coalesce(info->>'name','')           as name,
           coalesce(info->>'display', info->>'name', '') as display
    from lk where info is not null
  ),
  res as (
    select r.ts, r.correct, r.drill_name
    from results r, ident i
    where r.drill_id in (select m.id::text from modules m where m.teacher_id = i.coach_id)
      and (
        (i.email <> '' and lower(coalesce(r.student_email,'')) = i.email)
        or (i.email = '' and i.name <> '' and coalesce(r.student_name,'') = i.name)
      )
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
revoke all on function public.parent_report(text) from public;
grant execute on function public.parent_report(text) to anon, authenticated;

notify pgrst, 'reload schema';
