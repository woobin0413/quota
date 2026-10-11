-- 009: rename subscription tier 'enterprise' → 'ultimate'

UPDATE users SET subscription_tier = 'ultimate' WHERE subscription_tier = 'enterprise';

ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_subscription_tier;
ALTER TABLE users ADD CONSTRAINT valid_subscription_tier
  CHECK (subscription_tier IN ('free', 'pro', 'ultimate'));
