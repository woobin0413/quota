-- 010: production readiness — cancellation tracking, usage sessions, quotes index

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS usage_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip VARCHAR(45) NOT NULL,
  ua_hash VARCHAR(32) NOT NULL,
  day DATE NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count INT NOT NULL DEFAULT 1,
  UNIQUE (user_id, ip, ua_hash, day)
);

CREATE INDEX IF NOT EXISTS idx_usage_sessions_user_day ON usage_sessions(user_id, day);

CREATE INDEX IF NOT EXISTS idx_quotes_user_active ON quotes(user_id) WHERE deleted_at IS NULL;
