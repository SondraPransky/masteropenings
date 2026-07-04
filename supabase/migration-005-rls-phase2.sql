-- ════════════════════════════════════════════════════════════
--  Migration 005 — Durcissement RLS · PHASE 2 (lecture modules / classes / profiles)
--  À EXÉCUTER dans : Supabase → SQL Editor → coller → Run. Idempotent.
--
--  Avant : modules/classes/profiles en `select using (true)` → tout utilisateur
--          connecté lisait TOUS les modules, TOUTES les classes (donc les
--          pseudos/emails des élèves) et TOUS les profils (emails).
--  Après : - prof   : ses modules / ses classes / son profil
--          - élève  : les modules qui lui sont ASSIGNÉS (via ses classes) + ses
--                     modules perso ; les classes dont il est membre ; son profil
--                     + celui de ses profs (pour afficher leur nom)
--
--  Écritures (déjà par propriétaire) et results/practice/games (phase 1) : inchangés.
-- ════════════════════════════════════════════════════════════

-- Helper : identifiants (pseudo + email, minuscules) de l'utilisateur connecté.
-- SECURITY DEFINER → lit profiles SANS déclencher la RLS (évite toute récursion
-- quand les policies ci-dessous s'en servent).
create or replace function public.my_identifiers()
returns text[]
language sql stable security definer set search_path = public
as $$
  select array_remove(array[lower(pseudo), lower(email)], null)
  from public.profiles where id = auth.uid();
$$;
grant execute on function public.my_identifiers() to authenticated;

-- ── profiles : soi-même + ses profs ───────────────────────
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or id in (select teacher_id from public.classes where students ?| public.my_identifiers())
  );

-- ── modules : les siens (prof), ses perso, ou ceux assignés (élève) ──
drop policy if exists "modules_read" on public.modules;
create policy "modules_read" on public.modules
  for select to authenticated
  using (
    teacher_id = auth.uid()
    or owner_student_id = auth.uid()
    or id in (
      select (jsonb_array_elements_text(coalesce(module_ids, '[]'::jsonb)))::bigint
      from public.classes
      where students ?| public.my_identifiers()
    )
  );

-- ── classes : les siennes (prof) ou celles dont on est membre (élève) ──
drop policy if exists "classes_read" on public.classes;
create policy "classes_read" on public.classes
  for select to authenticated
  using (
    teacher_id = auth.uid()
    or students ?| public.my_identifiers()
  );

-- ── Recharger le cache de schéma de PostgREST ─────────────
notify pgrst, 'reload schema';
