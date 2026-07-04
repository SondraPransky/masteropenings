-- ════════════════════════════════════════════════════════════
--  EECoach — Schéma Supabase COMPLET (tables + RLS + trigger)
--  À EXÉCUTER dans : Supabase → SQL Editor → coller → Run.
--  Idempotent : peut être relancé sans risque (drop + recreate).
--  Modèle MVP : tout utilisateur CONNECTÉ lit modules/classes/résultats ;
--  seul le propriétaire écrit ses données.
-- ════════════════════════════════════════════════════════════

-- ── Remise à zéro propre (aucune donnée en prod pour l'instant) ──
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists public.games    cascade;
drop table if exists public.practice cascade;
drop table if exists public.results  cascade;
drop table if exists public.classes  cascade;
drop table if exists public.modules  cascade;
drop table if exists public.profiles cascade;

-- ── Tables ──────────────────────────────────────────────────
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  pseudo     text,
  role       text check (role in ('teacher','student')) default 'student',
  mastery    jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table public.modules (
  id               bigint primary key,
  teacher_id       uuid references auth.users(id) on delete cascade,
  owner_student_id uuid references auth.users(id) on delete cascade,
  name             text not null,
  level            text,
  side             text,
  pgn              text,
  mode             text,
  varmode          text,
  tree             jsonb,
  sessions         jsonb,
  hide_comments    boolean default false,
  personal         boolean default false,
  deadline         date,
  updated_at       bigint,
  extra            jsonb default '{}'::jsonb,
  created_at       timestamptz default now()
);

create table public.classes (
  id          bigint primary key,
  teacher_id  uuid references auth.users(id) on delete cascade,
  name        text,
  module_ids  jsonb default '[]'::jsonb,
  students    jsonb default '[]'::jsonb,
  individual  boolean default false,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

create table public.results (
  id             bigint generated always as identity primary key,
  drill_id       text,
  drill_name     text,
  student_id     uuid references auth.users(id) on delete set null,
  student_email  text,
  student_pseudo text,
  student_name   text,
  san            text,
  comment        text,
  correct        boolean,
  pos_idx        int,
  ts             bigint,
  extra          jsonb default '{}'::jsonb,
  created_at     timestamptz default now()
);

create table public.practice (
  id             bigint generated always as identity primary key,
  drill_id       text,
  drill_name     text,
  student_id     uuid references auth.users(id) on delete set null,
  student_email  text,
  student_pseudo text,
  pct            numeric,
  session_idx    int,
  ts             bigint,
  extra          jsonb default '{}'::jsonb,
  created_at     timestamptz default now()
);

create table public.games (
  id            bigint primary key,
  drill_id      text,
  drill_name    text,
  student_id    uuid references auth.users(id) on delete set null,
  student_email text,
  side          text,
  level         text,
  pgn           text,
  result        text,
  ts            bigint,
  extra         jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);

-- ── RLS ─────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.modules  enable row level security;
alter table public.classes  enable row level security;
alter table public.results  enable row level security;
alter table public.practice enable row level security;
alter table public.games    enable row level security;

-- Helper : identifiants (pseudo + email minuscules) de l'utilisateur connecté.
-- SECURITY DEFINER → lit profiles sans RLS (évite toute récursion dans les policies).
create or replace function public.my_identifiers()
returns text[] language sql stable security definer set search_path = public as $$
  select array_remove(array[lower(pseudo), lower(email)], null) from public.profiles where id = auth.uid();
$$;
grant execute on function public.my_identifiers() to authenticated;

-- profiles : soi-même + ses profs (nom affiché à l'élève)
create policy "profiles_read"      on public.profiles for select to authenticated
  using (id = auth.uid() or id in (select teacher_id from public.classes where students ?| public.my_identifiers()));
create policy "profiles_write_own" on public.profiles for all    to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- modules : les siens (prof), ses perso, ou ceux assignés via ses classes (élève)
create policy "modules_read"         on public.modules for select to authenticated
  using (teacher_id = auth.uid() or owner_student_id = auth.uid()
    or id in (select (jsonb_array_elements_text(coalesce(module_ids,'[]'::jsonb)))::bigint from public.classes where students ?| public.my_identifiers()));
create policy "modules_insert_owner" on public.modules for insert to authenticated with check (teacher_id = auth.uid() or owner_student_id = auth.uid());
create policy "modules_update_owner" on public.modules for update to authenticated using  (teacher_id = auth.uid() or owner_student_id = auth.uid()) with check (teacher_id = auth.uid() or owner_student_id = auth.uid());
create policy "modules_delete_owner" on public.modules for delete to authenticated using  (teacher_id = auth.uid() or owner_student_id = auth.uid());

-- classes : les siennes (prof) ou celles dont on est membre (élève)
create policy "classes_read"           on public.classes for select to authenticated
  using (teacher_id = auth.uid() or students ?| public.my_identifiers());
create policy "classes_insert_teacher" on public.classes for insert to authenticated with check (teacher_id = auth.uid());
create policy "classes_update_teacher" on public.classes for update to authenticated using  (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy "classes_delete_teacher" on public.classes for delete to authenticated using  (teacher_id = auth.uid());

-- results / practice / games : l'élève n'écrit/ne lit QUE ses lignes ;
-- le prof lit/supprime celles liées à SES modules (drill_id texte = modules.id::text).
create policy "results_insert" on public.results for insert to authenticated with check (student_id = auth.uid());
create policy "results_read"   on public.results for select to authenticated using (student_id = auth.uid() or drill_id in (select id::text from public.modules where teacher_id = auth.uid()));
create policy "results_delete" on public.results for delete to authenticated using (student_id = auth.uid() or drill_id in (select id::text from public.modules where teacher_id = auth.uid()));

create policy "practice_insert" on public.practice for insert to authenticated with check (student_id = auth.uid());
create policy "practice_read"   on public.practice for select to authenticated using (student_id = auth.uid() or drill_id in (select id::text from public.modules where teacher_id = auth.uid()));
create policy "practice_delete" on public.practice for delete to authenticated using (student_id = auth.uid() or drill_id in (select id::text from public.modules where teacher_id = auth.uid()));

create policy "games_insert" on public.games for insert to authenticated with check (student_id = auth.uid());
create policy "games_read"   on public.games for select to authenticated using (student_id = auth.uid() or drill_id in (select id::text from public.modules where teacher_id = auth.uid()));
create policy "games_delete" on public.games for delete to authenticated using (student_id = auth.uid() or drill_id in (select id::text from public.modules where teacher_id = auth.uid()));

-- ── Création auto du profil à l'inscription ─────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Le rôle/nom/pseudo voulus arrivent dans raw_user_meta_data (options.data du signUp).
  insert into public.profiles (id, email, name, role, pseudo)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'name',
    coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'student'),
    new.raw_user_meta_data->>'pseudo'
  )
  on conflict (id) do update set
    name   = coalesce(excluded.name,   public.profiles.name),
    role   = coalesce(excluded.role,   public.profiles.role),
    pseudo = coalesce(excluded.pseudo, public.profiles.pseudo);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Recharger le cache de schéma de PostgREST ───────────────
notify pgrst, 'reload schema';
