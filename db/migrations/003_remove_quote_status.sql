-- 003: Remove quote lifecycle status
--
-- Payment state (is_paid) is the only quote status. Sending an invoice
-- is a status-free action tracked by sent_at / email_sent_count.
-- contacts.accepted_quotes is repurposed as the paid-quote count and
-- contacts.total_revenue now sums paid quotes.

BEGIN;

-- ---------------------------------------------------------------
-- Functions that referenced quotes.status
-- ---------------------------------------------------------------

-- Contact stats: revenue and counts now derive from is_paid
CREATE OR REPLACE FUNCTION update_contact_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE contacts
  SET
    total_quotes = (
      SELECT COUNT(*)
      FROM quotes
      WHERE contact_id = NEW.contact_id
        AND deleted_at IS NULL
    ),
    accepted_quotes = (
      SELECT COUNT(*)
      FROM quotes
      WHERE contact_id = NEW.contact_id
        AND is_paid = TRUE
        AND deleted_at IS NULL
    ),
    total_revenue = (
      SELECT COALESCE(SUM(total), 0)
      FROM quotes
      WHERE contact_id = NEW.contact_id
        AND is_paid = TRUE
        AND deleted_at IS NULL
    ),
    last_quote_date = (
      SELECT MAX(created_at)
      FROM quotes
      WHERE contact_id = NEW.contact_id
        AND deleted_at IS NULL
    )
  WHERE id = NEW.contact_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Activity log: 'sent' derives from sent_at changing; other lifecycle
-- actions no longer occur (paid toggles are tracked in
-- payment_status_changes)
CREATE OR REPLACE FUNCTION log_quote_activity()
RETURNS TRIGGER AS $$
DECLARE
  action_type activity_action;
  change_data JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action_type := 'created';
    change_data := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    action_type := 'updated';
    change_data := jsonb_build_object(
      'before', to_jsonb(OLD),
      'after', to_jsonb(NEW)
    );

    IF OLD.sent_at IS DISTINCT FROM NEW.sent_at AND NEW.sent_at IS NOT NULL THEN
      action_type := 'sent';
    END IF;

    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      action_type := 'deleted';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      action_type := 'restored';
    END IF;
  END IF;

  INSERT INTO quote_activity (quote_id, user_id, action, changes)
  VALUES (NEW.id, NEW.user_id, action_type, change_data);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Expiration was a pure lifecycle-status feature
DROP FUNCTION IF EXISTS check_quote_expiration();

-- ---------------------------------------------------------------
-- Indexes and columns
-- ---------------------------------------------------------------

DROP INDEX IF EXISTS idx_quotes_status;
DROP INDEX IF EXISTS idx_quotes_user_status;
DROP INDEX IF EXISTS idx_quotes_valid_until;

ALTER TABLE quotes
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS viewed_at,
  DROP COLUMN IF EXISTS accepted_at,
  DROP COLUMN IF EXISTS rejected_at;

DROP TYPE IF EXISTS quote_status;

COMMIT;
