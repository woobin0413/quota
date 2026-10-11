-- =====================================================
-- MIGRATION 011: Lock down anon / authenticated DB access
-- =====================================================
-- SECURITY — hard pre-production gate.
--
-- The app reaches PostgREST ONLY through the service_role key
-- (supabaseAdmin in lib/db/core.ts). But NEXT_PUBLIC_SUPABASE_ANON_KEY ships
-- to every browser, and 20260709000001_grants.sql granted SELECT on every
-- table to anon/authenticated. Combined with the permissive `USING (true)`
-- RLS policies, anyone holding the public anon key could read all customer
-- PII — users, contacts, quotes, and usage_sessions (per-user IP addresses) —
-- straight through PostgREST, bypassing the application entirely.
--
-- Authentication is Auth0, not Supabase Auth, so there is NO legitimate
-- anon/authenticated database access to preserve. Revoke all of it. The
-- service_role backend is unaffected (it keeps its own GRANT ALL).
-- =====================================================

-- 1. Stop future tables from auto-granting SELECT to these roles
--    (undo the ALTER DEFAULT PRIVILEGES from the grants migration).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT ON TABLES FROM anon, authenticated;

-- 2. Remove every existing object privilege on current tables/sequences.
--    (Functions are covered by the schema USAGE revoke below — without it
--    these roles cannot resolve any function in `public` anyway, and an
--    explicit FUNCTIONS revoke only warns on extension-owned routines.)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 3. Remove schema access entirely — without USAGE on `public`, PostgREST
--    cannot resolve any object in the schema for these roles, so the public
--    anon key can no longer read anything regardless of RLS policy state.
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
