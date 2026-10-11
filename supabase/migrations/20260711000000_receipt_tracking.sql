-- 004: Receipt send tracking
--
-- Quote sends and receipt sends are tracked separately: sent_at /
-- email_sent_count cover the quotation email, receipt_sent_at /
-- receipt_sent_count cover the payment receipt email.

BEGIN;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS receipt_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receipt_sent_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN quotes.receipt_sent_at IS 'Last payment-receipt email send; quote sends tracked by sent_at';

COMMIT;
