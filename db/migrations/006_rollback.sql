-- Rollback 006: drop split-payment tables and derived cache.
-- WARNING: recorded payments and schedules are NOT recoverable.

BEGIN;

DROP TRIGGER IF EXISTS trigger_recalc_payment_state ON quote_payments;
DROP FUNCTION IF EXISTS recalc_quote_payment_state();

DROP TABLE IF EXISTS quote_payments;
DROP TABLE IF EXISTS payment_milestones;

ALTER TABLE quotes DROP COLUMN IF EXISTS amount_paid;

-- Restore the pre-006 totals trigger body (from 001, GREATEST clamp kept)
CREATE OR REPLACE FUNCTION calculate_quote_totals()
RETURNS TRIGGER AS $$
DECLARE
  quote_subtotal DECIMAL(10, 2);
  quote_tax DECIMAL(10, 2);
  quote_total DECIMAL(10, 2);
BEGIN
  SELECT COALESCE(SUM(total), 0)
  INTO quote_subtotal
  FROM quote_line_items
  WHERE quote_id = NEW.quote_id;

  SELECT tax_rate, discount_amount
  INTO quote_tax, quote_total
  FROM quotes
  WHERE id = NEW.quote_id;

  quote_tax := (quote_subtotal * quote_tax / 100);
  quote_total := GREATEST(quote_subtotal + quote_tax - COALESCE(quote_total, 0), 0);

  UPDATE quotes
  SET subtotal = quote_subtotal, tax_amount = quote_tax, total = quote_total
  WHERE id = NEW.quote_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
