-- =====================================================
-- Reset billing state before the Stripe TEST → LIVE cutover.
--
-- Every user created during test-mode holds a TEST stripe_customer_id +
-- test subscription. Those don't exist in Stripe LIVE mode, so any billing
-- op (change-plan, cancel, summary) for them would fail against the live API.
--
-- This nulls the Stripe link and drops everyone back to the free tier, so
-- their next action creates a fresh LIVE customer. The Stripe webhook (sole
-- tier-writer) re-syncs tiers once they subscribe live.
--
-- Run against the PROD project:
--   supabase db query --linked --file scripts/reset-billing-for-live-cutover.sql
-- (or psql "<prod-connection-string>" -f scripts/reset-billing-for-live-cutover.sql)
--
-- Safe to run more than once. Review the SELECT first if you want to see who
-- is affected before committing.
-- =====================================================

-- Preview who will be reset (rows with any Stripe/billing state):
--   SELECT email, subscription_tier, subscription_status, stripe_customer_id
--   FROM users
--   WHERE stripe_customer_id IS NOT NULL OR subscription_tier <> 'free';

UPDATE users
SET
  stripe_customer_id   = NULL,
  subscription_tier    = 'free',
  subscription_status  = NULL,
  cancel_at_period_end = false,
  current_period_end   = NULL
WHERE stripe_customer_id IS NOT NULL
   OR subscription_tier <> 'free'
   OR subscription_status IS NOT NULL;
