-- ════════════════════════════════════════════════════════════
--  EECoach — Schéma Supabase (Postgres + RLS)
--
--  À EXÉCUTER UNE FOIS dans : Supabase → SQL Editor → New query → Run.
--  Traduit firestore.rules. Modèle MVP : tout utilisateur CONNECTÉ peut
--  LIRE modules/classes/résultats ; seul le propriétaire écrit ses données.
--  (On pourra durcir la lecture plus tard.)
-- ════════════════════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────────────────

-- profiles : 1 ligne par compte (lié à auth.users de Supabase Auth)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  pseudo     text,
  role       text check (role in ('teacher','student')) default 'student',
  created_at timestamptz default now()
);

-- modules : modules d'ouvertures (id = Date.now() de l'app)
create table if not exists public.modules (
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
  created_at       timestamptz default now()
);

-- classes : assignation (module_ids[] + students[] en JSON, comme l'app)
create table if not exists public.classes (
  id          bigint primary key,
  teacher_id  uuid references auth.users(id) on delete cascade,
  name        text,
  module_ids  jsonb default '[]'::jsonb,
  students    jsonb default '[]'::jsonb,
  individual  boolean default false,
  created_at  timestamptz default now()
);

-- results : une ligne par tentative de position (analyse d'erreurs)
create table if not exists public.results (
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
  created_at     timestamptz default now()
);

-- practice : sessions de pratique (% de réussite par session)
create table if not exists public.practice (
  id             bigint generated always as identity primary key,
  drill_id       text,
  drill_name     text,
  student_id     uuid references auth.users(id) on delete set null,
  student_email  text,
  student_pseudo text,
  pct            numeric,
  session_idx    int,
  ts             bigint,
  created_at     timestamptz default now()
);

-- games : parties jouées contre Maia
create table if not exists public.games (
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
  created_at    timestamptz default now()
);

-- ── Activation RLS ──────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.modules  enable row level security;
alter table public.classes  enable row level security;
alter table public.results  enable row level security;
alter table public.practice enable row level security;
alter table public.games    enable row level security;

-- ── Politiques (traduisent firestore.rules) ─────────────────

-- profiles : lecture aux connectés (le prof voit le nom de ses élèves) ; écriture sur son propre profil
create policy "profiles_read"      on public.profiles for select to authenticated using (true);
create policy "profiles_write_own" on public.profiles for all    to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- modules : lecture aux connectés ; écriture par le prof OU l'élève propriétaire
create policy "modules_read"          on public.modules for select to authenticated using (true);
create policy "modules_insert_owner"  on public.modules for insert to authenticated with check (teacher_id = auth.uid() or owner_student_id = auth.uid());
create policy "modules_update_owner"  on public.modules for update to authenticated using  (teacher_id = auth.uid() or owner_student_id = auth.uid()) with check (teacher_id = auth.uid() or owner_student_id = auth.uid());
create policy "modules_delete_owner"  on public.modules for delete to authenticated using  (teacher_id = auth.uid() or owner_student_id = auth.uid());

-- classes : lecture aux connectés ; écriture par le prof propriétaire
create policy "classes_read"          on public.classes for select to authenticated using (true);
create policy "classes_insert_teacher" on public.classes for insert to authenticated with check (teacher_id = auth.uid());
create policy "classes_update_teacher" on public.classes for update to authenticated using  (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy "classes_delete_teacher" on public.classes for delete to authenticated using  (teacher_id = auth.uid());

-- results / practice / games : l'élève crée, tout le monde (connecté) lit, pas de modif/suppr
create policy "results_read"   on public.results  for select to authenticated using (true);
create policy "results_insert" on public.results  for insert to authenticated with check (true);
create policy "practice_read"   on public.practice for select to authenticated using (true);
create policy "practice_insert" on public.practice for insert to authenticated with check (true);
create policy "games_read"   on public.games for select to authenticated using (true);
create policy "games_insert" on public.games for insert to authenticated with check (true);

-- ── Création auto du profil à l'inscription (pattern Supabase) ──
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
