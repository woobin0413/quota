-- 013_rollback.sql
DROP INDEX IF EXISTS voice_captures_expiry_idx;
DROP INDEX IF EXISTS voice_captures_user_created_idx;
DROP TABLE IF EXISTS voice_captures;
