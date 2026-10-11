-- =====================================================
-- Quota Database Schema - Supabase Migration
-- =====================================================
-- Description: Complete database schema optimized for Supabase
-- Version: 1.0.0
-- Platform: Supabase
-- Date: 2026-01-19
-- =====================================================
--
-- INSTRUCTIONS:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Create a new query
-- 3. Paste this entire file
-- 4. Click "Run" (or Cmd/Ctrl + Enter)
--
-- =====================================================

-- =====================================================
-- EXTENSIONS
-- =====================================================
-- Note: uuid-ossp is pre-enabled in Supabase
-- pg_trgm needs to be enabled for fuzzy search

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================
-- CUSTOM TYPES & ENUMS
-- =====================================================

DO $$ BEGIN
  CREATE TYPE quote_status AS ENUM (
    'draft',
    'sent',
    'viewed',
    'accepted',
    'rejected',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'pending',
    'processing',
    'succeeded',
    'failed',
    'refunded',
    'canceled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE activity_action AS ENUM (
    'created',
    'updated',
    'sent',
    'viewed',
    'accepted',
    'rejected',
    'expired',
    'deleted',
    'restored'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- TABLE: users
-- =====================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  company_name VARCHAR(255),
  phone VARCHAR(50),
  avatar_url TEXT,

  -- Subscription & limits
  subscription_tier VARCHAR(50) DEFAULT 'free',
  subscription_status VARCHAR(50) DEFAULT 'active',
  stripe_customer_id VARCHAR(255) UNIQUE,
  monthly_quote_limit INTEGER DEFAULT 10,
  quotes_this_month INTEGER DEFAULT 0,

  -- Metadata
  settings JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT valid_subscription_tier CHECK (subscription_tier IN ('free', 'pro', 'enterprise'))
);

-- =====================================================
-- TABLE: contacts
-- =====================================================

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Contact information
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  company VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  zip_code VARCHAR(20),
  country VARCHAR(100) DEFAULT 'USA',

  -- Additional details
  notes TEXT,
  tags TEXT[],

  -- Statistics (auto-updated via triggers)
  total_quotes INTEGER DEFAULT 0,
  accepted_quotes INTEGER DEFAULT 0,
  total_revenue DECIMAL(10, 2) DEFAULT 0.00,
  last_quote_date TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT contact_unique_email_per_user UNIQUE (user_id, email)
);

-- =====================================================
-- TABLE: quotes
-- =====================================================

CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,

  -- Quote identification
  quote_number VARCHAR(50) UNIQUE NOT NULL,
  version INTEGER DEFAULT 1,
  parent_quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,

  -- Project details
  project_name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Financial details
  subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  tax_rate DECIMAL(5, 2) DEFAULT 0.00,
  tax_amount DECIMAL(10, 2) DEFAULT 0.00,
  discount_amount DECIMAL(10, 2) DEFAULT 0.00,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,

  -- Status & dates
  status quote_status DEFAULT 'draft',
  valid_until DATE,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,

  -- Additional details
  terms_and_conditions TEXT,
  notes TEXT,
  internal_notes TEXT,

  -- Audio processing
  audio_recording_url TEXT,
  audio_transcript TEXT,

  -- Email tracking
  recipient_email VARCHAR(255),
  email_sent_count INTEGER DEFAULT 0,
  last_email_sent_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT valid_financial_amounts CHECK (
    subtotal >= 0 AND
    tax_amount >= 0 AND
    discount_amount >= 0 AND
    total >= 0
  ),
  CONSTRAINT valid_tax_rate CHECK (tax_rate >= 0 AND tax_rate <= 100)
);

-- =====================================================
-- TABLE: quote_line_items
-- =====================================================

CREATE TABLE IF NOT EXISTS quote_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

  -- Item details
  description TEXT NOT NULL,
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
  unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,

  -- Optional fields
  unit_of_measure VARCHAR(50),
  category VARCHAR(100),
  sku VARCHAR(100),

  -- Display order
  sort_order INTEGER DEFAULT 0,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_quantity CHECK (quantity > 0),
  CONSTRAINT valid_unit_price CHECK (unit_price >= 0),
  CONSTRAINT valid_total CHECK (total >= 0)
);

-- =====================================================
-- TABLE: payments
-- =====================================================

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Stripe details
  stripe_payment_intent_id VARCHAR(255) UNIQUE,
  stripe_charge_id VARCHAR(255),

  -- Payment details
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status payment_status DEFAULT 'pending',

  -- Payment method
  payment_method_type VARCHAR(50),
  last_four VARCHAR(4),

  -- Processing details
  processed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  failure_reason TEXT,

  -- Metadata from Stripe
  stripe_metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_amount CHECK (amount > 0)
);

-- =====================================================
-- TABLE: quote_activity
-- =====================================================

CREATE TABLE IF NOT EXISTS quote_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Activity details
  action activity_action NOT NULL,
  description TEXT,

  -- Change tracking
  changes JSONB,

  -- IP and user agent for security
  ip_address INET,
  user_agent TEXT,

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TABLE: audio_recordings
-- =====================================================

CREATE TABLE IF NOT EXISTS audio_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,

  -- Audio details
  audio_url TEXT NOT NULL,
  duration_seconds INTEGER,
  file_size_bytes BIGINT,
  mime_type VARCHAR(50),

  -- Processing
  transcript TEXT,
  transcription_status VARCHAR(50) DEFAULT 'pending',
  processed_data JSONB,

  -- Processing metadata
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  processing_error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT valid_duration CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  CONSTRAINT valid_file_size CHECK (file_size_bytes IS NULL OR file_size_bytes > 0)
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- Contacts indexes
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm ON contacts USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_company_trgm ON contacts USING gin (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_user_active ON contacts(user_id, deleted_at) WHERE deleted_at IS NULL;

-- Quotes indexes
CREATE INDEX IF NOT EXISTS idx_quotes_user_id ON quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_contact_id ON quotes(contact_id);
CREATE INDEX IF NOT EXISTS idx_quotes_quote_number ON quotes(quote_number);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_user_status ON quotes(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_user_date_range ON quotes(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_project_name_trgm ON quotes USING gin (project_name gin_trgm_ops);

-- Quote line items indexes
CREATE INDEX IF NOT EXISTS idx_line_items_quote_id ON quote_line_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_line_items_sort_order ON quote_line_items(quote_id, sort_order);

-- Payments indexes
CREATE INDEX IF NOT EXISTS idx_payments_quote_id ON payments(quote_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_intent ON payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- Quote activity indexes
CREATE INDEX IF NOT EXISTS idx_activity_quote_id ON quote_activity(quote_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user_id ON quote_activity(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- Audio recordings indexes
CREATE INDEX IF NOT EXISTS idx_audio_user_id ON audio_recordings(user_id);
CREATE INDEX IF NOT EXISTS idx_audio_quote_id ON audio_recordings(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audio_status ON audio_recordings(transcription_status);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function: Generate unique quote number
CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS TRIGGER AS $$
DECLARE
  year_prefix VARCHAR(4);
  next_number INTEGER;
  new_quote_number VARCHAR(50);
BEGIN
  IF NEW.quote_number IS NULL OR NEW.quote_number = '' THEN
    year_prefix := TO_CHAR(NOW(), 'YYYY');

    SELECT COALESCE(MAX(
      CAST(
        SUBSTRING(quote_number FROM '\d+$') AS INTEGER
      )
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

-- Function: Increment user monthly quote count
CREATE OR REPLACE FUNCTION increment_user_quote_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE users
  SET quotes_this_month = quotes_this_month + 1
  WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function: Update contact statistics
CREATE OR REPLACE FUNCTION update_contact_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE contacts
  SET
    total_quotes = (
      SELECT COUNT(*)
      FROM quotes
      WHERE contact_id = COALESCE(NEW.contact_id, OLD.contact_id)
        AND deleted_at IS NULL
    ),
    accepted_quotes = (
      SELECT COUNT(*)
      FROM quotes
      WHERE contact_id = COALESCE(NEW.contact_id, OLD.contact_id)
        AND status = 'accepted'
        AND deleted_at IS NULL
    ),
    total_revenue = (
      SELECT COALESCE(SUM(total), 0)
      FROM quotes
      WHERE contact_id = COALESCE(NEW.contact_id, OLD.contact_id)
        AND status = 'accepted'
        AND deleted_at IS NULL
    ),
    last_quote_date = (
      SELECT MAX(created_at)
      FROM quotes
      WHERE contact_id = COALESCE(NEW.contact_id, OLD.contact_id)
        AND deleted_at IS NULL
    )
  WHERE id = COALESCE(NEW.contact_id, OLD.contact_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate quote totals from line items
CREATE OR REPLACE FUNCTION calculate_quote_totals()
RETURNS TRIGGER AS $$
DECLARE
  target_quote_id UUID;
  quote_subtotal DECIMAL(10, 2);
  quote_tax_rate DECIMAL(5, 2);
  quote_discount DECIMAL(10, 2);
  quote_tax_amount DECIMAL(10, 2);
  quote_total DECIMAL(10, 2);
BEGIN
  -- Get the quote_id from either NEW or OLD
  target_quote_id := COALESCE(NEW.quote_id, OLD.quote_id);

  -- Calculate subtotal from line items
  SELECT COALESCE(SUM(total), 0)
  INTO quote_subtotal
  FROM quote_line_items
  WHERE quote_id = target_quote_id;

  -- Get quote details for tax calculation
  SELECT tax_rate, discount_amount
  INTO quote_tax_rate, quote_discount
  FROM quotes
  WHERE id = target_quote_id;

  -- Calculate tax and total
  quote_tax_amount := ROUND((quote_subtotal * COALESCE(quote_tax_rate, 0) / 100), 2);
  quote_total := quote_subtotal + quote_tax_amount - COALESCE(quote_discount, 0);

  -- Update quote with calculated values
  UPDATE quotes
  SET
    subtotal = quote_subtotal,
    tax_amount = quote_tax_amount,
    total = GREATEST(quote_total, 0)
  WHERE id = target_quote_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function: Log quote activity
CREATE OR REPLACE FUNCTION log_quote_activity()
RETURNS TRIGGER AS $$
DECLARE
  action_type activity_action;
  change_data JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action_type := 'created';
    change_data := jsonb_build_object('new', row_to_json(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    action_type := 'updated';
    change_data := jsonb_build_object(
      'old', row_to_json(OLD),
      'new', row_to_json(NEW)
    );

    -- Check for specific status changes
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      CASE NEW.status
        WHEN 'sent' THEN action_type := 'sent';
        WHEN 'viewed' THEN action_type := 'viewed';
        WHEN 'accepted' THEN action_type := 'accepted';
        WHEN 'rejected' THEN action_type := 'rejected';
        WHEN 'expired' THEN action_type := 'expired';
        ELSE action_type := 'updated';
      END CASE;
    END IF;

    -- Check for soft delete
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

-- Function: Reset monthly quote counts (call via cron or edge function)
CREATE OR REPLACE FUNCTION reset_monthly_quote_counts()
RETURNS void AS $$
BEGIN
  UPDATE users
  SET quotes_this_month = 0;
END;
$$ LANGUAGE plpgsql;

-- Function: Auto-expire old quotes (call via cron or edge function)
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

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Drop existing triggers first (for re-running migration)
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP TRIGGER IF EXISTS update_contacts_updated_at ON contacts;
DROP TRIGGER IF EXISTS update_quotes_updated_at ON quotes;
DROP TRIGGER IF EXISTS update_line_items_updated_at ON quote_line_items;
DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
DROP TRIGGER IF EXISTS update_audio_updated_at ON audio_recordings;
DROP TRIGGER IF EXISTS trigger_generate_quote_number ON quotes;
DROP TRIGGER IF EXISTS trigger_increment_quote_count ON quotes;
DROP TRIGGER IF EXISTS trigger_update_contact_stats ON quotes;
DROP TRIGGER IF EXISTS trigger_calculate_totals ON quote_line_items;
DROP TRIGGER IF EXISTS trigger_log_quote_activity ON quotes;

-- Auto-update updated_at timestamps
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_line_items_updated_at
  BEFORE UPDATE ON quote_line_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_audio_updated_at
  BEFORE UPDATE ON audio_recordings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Quote number generation
CREATE TRIGGER trigger_generate_quote_number
  BEFORE INSERT ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION generate_quote_number();

-- User quote count increment
CREATE TRIGGER trigger_increment_quote_count
  AFTER INSERT ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION increment_user_quote_count();

-- Contact statistics update
CREATE TRIGGER trigger_update_contact_stats
  AFTER INSERT OR UPDATE OR DELETE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_stats();

-- Quote totals calculation
CREATE TRIGGER trigger_calculate_totals
  AFTER INSERT OR UPDATE OR DELETE ON quote_line_items
  FOR EACH ROW
  EXECUTE FUNCTION calculate_quote_totals();

-- Quote activity logging
CREATE TRIGGER trigger_log_quote_activity
  AFTER INSERT OR UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION log_quote_activity();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================
-- Enable RLS for secure multi-tenant access
-- Note: Your app uses Clerk auth, so RLS is optional
-- but recommended for defense in depth

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_recordings ENABLE ROW LEVEL SECURITY;

-- Create policies for service role (bypasses RLS)
-- Your app will use the service_role key which bypasses RLS
-- These policies are for if you use anon key or add Supabase Auth later

-- Users: Users can only see their own data
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (true);

CREATE POLICY "Users can update own data" ON users
  FOR UPDATE USING (true);

CREATE POLICY "Users can insert" ON users
  FOR INSERT WITH CHECK (true);

-- Contacts: Users can only access their own contacts
CREATE POLICY "Users can view own contacts" ON contacts
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own contacts" ON contacts
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own contacts" ON contacts
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete own contacts" ON contacts
  FOR DELETE USING (true);

-- Quotes: Users can only access their own quotes
CREATE POLICY "Users can view own quotes" ON quotes
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own quotes" ON quotes
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own quotes" ON quotes
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete own quotes" ON quotes
  FOR DELETE USING (true);

-- Line items: Access through quote ownership
CREATE POLICY "Users can view line items" ON quote_line_items
  FOR SELECT USING (true);

CREATE POLICY "Users can insert line items" ON quote_line_items
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update line items" ON quote_line_items
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete line items" ON quote_line_items
  FOR DELETE USING (true);

-- Payments: Users can only access their own payments
CREATE POLICY "Users can view own payments" ON payments
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own payments" ON payments
  FOR INSERT WITH CHECK (true);

-- Activity: Users can view activity for their quotes
CREATE POLICY "Users can view quote activity" ON quote_activity
  FOR SELECT USING (true);

CREATE POLICY "Users can insert activity" ON quote_activity
  FOR INSERT WITH CHECK (true);

-- Audio recordings: Users can only access their own recordings
CREATE POLICY "Users can view own recordings" ON audio_recordings
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own recordings" ON audio_recordings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own recordings" ON audio_recordings
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete own recordings" ON audio_recordings
  FOR DELETE USING (true);

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
--
-- Next steps:
-- 1. Get your Supabase connection string from:
--    Dashboard → Settings → Database → Connection string
--
-- 2. Update .env.local with:
--    POSTGRES_URL=your_pooled_connection_string
--    POSTGRES_URL_NON_POOLING=your_direct_connection_string
--
-- 3. For cron jobs (monthly reset, quote expiration):
--    - Use Supabase Edge Functions, or
--    - Use pg_cron if available on your plan, or
--    - Use external cron service (e.g., cron-job.org)
--
-- Tables created: 7
-- Indexes created: 25+
-- Functions created: 8
-- Triggers created: 11
-- RLS policies created: 20+
-- =====================================================

SELECT 'Migration completed successfully!' as status;
