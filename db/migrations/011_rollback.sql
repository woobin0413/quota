-- =====================================================
-- ROLLBACK 011: restore anon / authenticated read access
-- =====================================================
-- Reverts 011_lockdown_anon_access.sql back to the pre-lockdown grant state
-- established by 20260709000001_grants.sql. Only restores read access —
-- matches exactly what was there before. Do NOT run in production; the
-- lockdown is intentional.
-- =====================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon, authenticated;
