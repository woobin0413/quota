-- =====================================================
-- MIGRATION 002: Work Catalog & Invoicing Restructure
-- =====================================================
-- 1. Rename users.clerk_user_id -> auth0_user_id (Auth0 replaces Clerk)
-- 2. work_items: per-contractor configurable work catalog
-- 3. payment_status_changes: paid/unpaid toggle history with notes
-- 4. quotes: add is_paid/paid_at, drop audio columns
-- 5. quote_line_items: link to work_items
-- 6. Drop audio_recordings (voice/AI feature removed)
-- =====================================================

BEGIN;

-- =====================================================
-- 1. USERS: Clerk -> Auth0
-- =====================================================

ALTER TABLE users RENAME COLUMN clerk_user_id TO auth0_user_id;
ALTER INDEX IF EXISTS idx_users_clerk_id RENAME TO idx_users_auth0_id;

COMMENT ON COLUMN users.auth0_user_id IS 'Auth0 sub claim, e.g. auth0|abc123 or google-oauth2|...';

-- =====================================================
-- 2. TABLE: work_items
-- =====================================================

CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Item details
  name VARCHAR(255) NOT NULL,
  description TEXT,
  unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'each', -- each, hours, sqft, lf
  default_unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  category VARCHAR(100), -- trade: electrical, plumbing, carpentry...

  -- State
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_default_price CHECK (default_unit_price >= 0),
  CONSTRAINT unique_work_item_name_per_user UNIQUE (user_id, name)
);

COMMENT ON TABLE work_items IS 'Per-contractor catalog of work items with configurable pricing';

CREATE INDEX IF NOT EXISTS idx_work_items_user
  ON work_items(user_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_work_items_user_category
  ON work_items(user_id, category);

CREATE TRIGGER update_work_items_updated_at
  BEFORE UPDATE ON work_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 3. TABLE: payment_status_changes
-- =====================================================

CREATE TABLE IF NOT EXISTS payment_status_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_paid BOOLEAN NOT NULL,     -- the new state after the change
  note TEXT,                    -- optional, e.g. "paid by check #1042"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE payment_status_changes IS 'History of manual paid/unpaid toggles with optional notes; payments happen outside the system';

CREATE INDEX IF NOT EXISTS idx_payment_changes_quote
  ON payment_status_changes(quote_id, created_at DESC);

-- =====================================================
-- 4. QUOTES: paid tracking + drop audio columns
-- =====================================================

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE quotes
  DROP COLUMN IF EXISTS audio_recording_url,
  DROP COLUMN IF EXISTS audio_transcript;

COMMENT ON COLUMN quotes.is_paid IS 'Manually toggled by contractor; payment collected outside the system';

CREATE INDEX IF NOT EXISTS idx_quotes_user_paid
  ON quotes(user_id, is_paid) WHERE deleted_at IS NULL;

-- =====================================================
-- 5. QUOTE_LINE_ITEMS: catalog link
-- =====================================================

ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS work_item_id UUID REFERENCES work_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN quote_line_items.work_item_id IS 'Source catalog item; NULL for ad-hoc lines';

-- =====================================================
-- 6. DROP: audio_recordings
-- =====================================================

DROP TABLE IF EXISTS audio_recordings CASCADE;

-- =====================================================
-- 7. ROW LEVEL SECURITY (consistent with 001: permissive,
--    app uses service_role which bypasses RLS)
-- =====================================================

ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_status_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own work items" ON work_items
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own work items" ON work_items
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own work items" ON work_items
  FOR UPDATE USING (true);
CREATE POLICY "Users can delete own work items" ON work_items
  FOR DELETE USING (true);

CREATE POLICY "Users can view own payment changes" ON payment_status_changes
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own payment changes" ON payment_status_changes
  FOR INSERT WITH CHECK (true);

COMMIT;
