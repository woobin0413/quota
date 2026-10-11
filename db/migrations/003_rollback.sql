-- Rollback 003: restore quote lifecycle status
--
-- Restores the columns, enum, indexes, and the pre-003 versions of the
-- trigger functions. Historical status values are NOT recoverable; all
-- quotes come back as 'draft'.

BEGIN;

CREATE TYPE quote_status AS ENUM (
  'draft',
  'sent',
  'viewed',
  'accepted',
  'rejected',
  'expired'
);

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS status quote_status DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_user_status ON quotes(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_valid_until ON quotes(valid_until)
  WHERE status = 'sent' AND valid_until IS NOT NULL;

-- Pre-003 contact stats (accepted-based)
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
        AND status = 'accepted'
        AND deleted_at IS NULL
    ),
    total_revenue = (
      SELECT COALESCE(SUM(total), 0)
      FROM quotes
      WHERE contact_id = NEW.contact_id
        AND status = 'accepted'
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

-- Pre-003 activity logging (status-transition based)
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

    IF OLD.status != NEW.status THEN
      CASE NEW.status
        WHEN 'sent' THEN action_type := 'sent';
        WHEN 'viewed' THEN action_type := 'viewed';
        WHEN 'accepted' THEN action_type := 'accepted';
        WHEN 'rejected' THEN action_type := 'rejected';
        WHEN 'expired' THEN action_type := 'expired';
        ELSE action_type := 'updated';
      END CASE;
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

CREATE OR REPLACE FUNCTION check_quote_expiration()
RETURNS void AS $$
BEGIN
  UPDATE quotes
  SET status = 'expired'
  WHERE status = 'sent'
    AND valid_until < CURRENT_DATE
    AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
