BEGIN;

DROP FUNCTION IF EXISTS replace_payment_schedule_atomic(UUID, UUID, JSONB);
DROP FUNCTION IF EXISTS ensure_default_payment_schedule(UUID, UUID);
DROP FUNCTION IF EXISTS create_quote_atomic(UUID, UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS TRIGGER AS $$
DECLARE
  year_prefix VARCHAR(4);
  next_number INTEGER;
  new_quote_number VARCHAR(50);
BEGIN
  IF NEW.quote_number IS NULL THEN
    year_prefix := TO_CHAR(NOW(), 'YYYY');

    SELECT COALESCE(MAX(
      CAST(SUBSTRING(quote_number FROM '\d+$') AS INTEGER)
    ), 0) + 1
    INTO next_number
    FROM quotes
    WHERE quote_number LIKE 'Q-' || year_prefix || '-%';

    new_quote_number := 'Q-' || year_prefix || '-' || LPAD(next_number::TEXT, 3, '0');
    NEW.quote_number := new_quote_number;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
