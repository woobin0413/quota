-- 006: Split payments
--
-- Milestone schedule per quote + payments recorded against milestones.
-- quotes.is_paid becomes derived: amount_paid >= total. Trigger keeps the
-- cache in sync (same pattern as calculate_quote_totals).

BEGIN;

-- ---------------------------------------------------------------
-- payment_milestones
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  percentage DECIMAL(5,2) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_percentage CHECK (percentage > 0 AND percentage <= 100)
);

COMMENT ON TABLE payment_milestones IS
  'Planned payment split per quote; amounts derived from percentage of quote total at read time';

CREATE INDEX IF NOT EXISTS idx_payment_milestones_quote
  ON payment_milestones(quote_id, sort_order);

CREATE TRIGGER update_payment_milestones_updated_at
  BEFORE UPDATE ON payment_milestones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------
-- quote_payments
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS quote_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES payment_milestones(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  method VARCHAR(20),
  note TEXT,
  receipt_sent_at TIMESTAMPTZ,
  receipt_sent_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT positive_amount CHECK (amount > 0),
  CONSTRAINT valid_method CHECK (method IS NULL OR method IN ('cash','check','zelle','other'))
);

COMMENT ON TABLE quote_payments IS
  'Payments recorded against schedule milestones; payments happen outside the system';

CREATE INDEX IF NOT EXISTS idx_quote_payments_quote
  ON quote_payments(quote_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_payments_milestone
  ON quote_payments(milestone_id);

-- ---------------------------------------------------------------
-- quotes.amount_paid cache + derived paid state
-- ---------------------------------------------------------------

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN quotes.amount_paid IS
  'Cache of SUM(quote_payments.amount); maintained by trigger_recalc_payment_state';

CREATE OR REPLACE FUNCTION recalc_quote_payment_state()
RETURNS TRIGGER AS $$
DECLARE
  v_quote_id UUID;
  v_paid DECIMAL(10,2);
BEGIN
  v_quote_id := COALESCE(NEW.quote_id, OLD.quote_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM quote_payments WHERE quote_id = v_quote_id;

  UPDATE quotes SET
    amount_paid = v_paid,
    is_paid = (v_paid >= total AND total > 0),
    paid_at = CASE
      WHEN (v_paid >= total AND total > 0) THEN COALESCE(paid_at, NOW())
      ELSE NULL
    END
  WHERE id = v_quote_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_recalc_payment_state
  AFTER INSERT OR UPDATE OR DELETE ON quote_payments
  FOR EACH ROW EXECUTE FUNCTION recalc_quote_payment_state();

-- ---------------------------------------------------------------
-- Totals trigger also refreshes payment state: a tax/line-item change
-- moves total, which can flip is_paid in either direction
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION calculate_quote_totals()
RETURNS TRIGGER AS $$
DECLARE
  quote_subtotal DECIMAL(10, 2);
  quote_tax DECIMAL(10, 2);
  quote_total DECIMAL(10, 2);
  v_paid DECIMAL(10, 2);
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

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM quote_payments WHERE quote_id = NEW.quote_id;

  UPDATE quotes
  SET
    subtotal = quote_subtotal,
    tax_amount = quote_tax,
    total = quote_total,
    amount_paid = v_paid,
    is_paid = (v_paid >= quote_total AND quote_total > 0),
    paid_at = CASE
      WHEN (v_paid >= quote_total AND quote_total > 0) THEN COALESCE(paid_at, NOW())
      ELSE NULL
    END
  WHERE id = NEW.quote_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
