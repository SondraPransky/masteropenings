-- ════════════════════════════════════════════════════════════
--  Migration 003 — colonne `mastery` (jsonb) sur profiles
--  À exécuter dans Supabase → SQL Editor (additive, AUCUNE perte).
--  Stocke la progression SM-2 de l'élève (sync multi-appareils),
--  comme le champ users/{uid}.mastery de l'ancienne version Firebase.
-- ════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists mastery jsonb default '{}'::jsonb;

notify pgrst, 'reload schema';
