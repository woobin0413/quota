-- Rollback 009
UPDATE users SET subscription_tier = 'enterprise' WHERE subscription_tier = 'ultimate';
ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_subscription_tier;
ALTER TABLE users ADD CONSTRAINT valid_subscription_tier
  CHECK (subscription_tier IN ('free', 'pro', 'enterprise'));
