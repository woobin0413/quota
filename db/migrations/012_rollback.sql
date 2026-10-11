-- Rollback 012
--
-- The NULL backfill is deliberately not reversed: those rows were unmetered by
-- accident, 'free' is the correct value for them, and the original NULLs are
-- not recoverable anyway. Only the constraint is lifted.

ALTER TABLE users ALTER COLUMN subscription_tier DROP NOT NULL;
