-- 012: subscription_tier must always hold a known tier
--
-- The CHECK constraint from 009 keeps non-null values within
-- (free|pro|ultimate), but a CHECK accepts NULL — `NULL IN (...)` evaluates to
-- NULL, not false — and the column was never NOT NULL. A NULL tier reaching
-- the app indexes QUOTE_LIMIT to `undefined`, which Number.isFinite reads as
-- "no cap", so the monthly quote meter is skipped entirely.
--
-- resolveTier() guards this in application code; this closes it at the source.
-- Free is the correct backfill: an unmetered row was never a paying customer.

UPDATE users SET subscription_tier = 'free' WHERE subscription_tier IS NULL;

ALTER TABLE users ALTER COLUMN subscription_tier SET DEFAULT 'free';
ALTER TABLE users ALTER COLUMN subscription_tier SET NOT NULL;
