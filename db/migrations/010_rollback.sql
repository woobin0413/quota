DROP INDEX IF EXISTS idx_quotes_user_active;
DROP INDEX IF EXISTS idx_usage_sessions_user_day;
DROP TABLE IF EXISTS usage_sessions;
ALTER TABLE users
  DROP COLUMN IF EXISTS current_period_end,
  DROP COLUMN IF EXISTS cancel_at_period_end;
