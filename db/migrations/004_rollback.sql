-- Rollback 004: remove receipt send tracking

BEGIN;

ALTER TABLE quotes
  DROP COLUMN IF EXISTS receipt_sent_at,
  DROP COLUMN IF EXISTS receipt_sent_count;

COMMIT;
