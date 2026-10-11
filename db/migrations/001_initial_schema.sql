-- =====================================================
-- Quota Database Schema - Initial Migration
-- =====================================================
-- Description: Complete database schema for contractor quote management
-- Version: 1.0.0
-- Author: Claude Code
-- Date: 2026-01-18
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pg_trgm for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================
-- CUSTOM TYPES & ENUMS
-- =====================================================

-- Quote status enum
CREATE TYPE quote_status AS ENUM (
  'draft',
  'sent',
  'viewed',
  'accepted',
  'rejected',
  'expired'
);

-- Payment status enum
CREATE TYPE payment_status AS ENUM (
  'pending',
  'processing',
  'succeeded',
  'failed',
  'refunded',
  'canceled'
);

-- Quote activity action enum
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

-- =====================================================
-- TABLE: users
-- =====================================================
-- Synced with Clerk authentication
-- Stores user profile and subscription information
-- =====================================================

CREATE TABLE users (
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,

  -- Constraints
  CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT valid_subscription_tier CHECK (subscription_tier IN ('free', 'pro', 'enterprise'))
);

COMMENT ON TABLE users IS 'User accounts synced with Clerk authentication';
COMMENT ON COLUMN users.clerk_user_id IS 'Unique identifier from Clerk';
COMMENT ON COLUMN users.quotes_this_month IS 'Counter for monthly quota tracking';
COMMENT ON COLUMN users.settings IS 'User preferences (theme, notifications, etc.)';

-- =====================================================
-- TABLE: contacts
-- =====================================================
-- Client contact information
-- Supports deduplication and full-text search
-- =====================================================

CREATE TABLE contacts (
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
  tags VARCHAR(50)[],

  -- Statistics (auto-updated via triggers)
  total_quotes INTEGER DEFAULT 0,
  accepted_quotes INTEGER DEFAULT 0,
  total_revenue DECIMAL(10, 2) DEFAULT 0.00,
  last_quote_date TIMESTAMP WITH TIME ZONE,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,

  -- Constraints
  CONSTRAINT email_format_check CHECK (
    email IS NULL OR
    email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  ),
  CONSTRAINT contact_unique_email_per_user UNIQUE (user_id, email)
);

COMMENT ON TABLE contacts IS 'Client contact information with deduplication';
COMMENT ON COLUMN contacts.tags IS 'Array of tags for categorization';
COMMENT ON COLUMN contacts.total_quotes IS 'Auto-updated count of all quotes';
COMMENT ON COLUMN contacts.accepted_quotes IS 'Auto-updated count of accepted quotes';
COMMENT ON CONSTRAINT contact_unique_email_per_user ON contacts IS 'Prevents duplicate emails per user';

-- =====================================================
-- TABLE: quotes
-- =====================================================
-- Main quotes table with versioning support
-- =====================================================

CREATE TABLE quotes (
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
  sent_at TIMESTAMP WITH TIME ZONE,
  viewed_at TIMESTAMP WITH TIME ZONE,
  accepted_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,

  -- Additional details
  terms_and_conditions TEXT,
  notes TEXT,
  internal_notes TEXT, -- Not visible to client

  -- Audio processing
  audio_recording_url TEXT,
  audio_transcript TEXT,

  -- Email tracking
  recipient_email VARCHAR(255),
  email_sent_count INTEGER DEFAULT 0,
  last_email_sent_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,

  -- Constraints
  CONSTRAINT valid_financial_amounts CHECK (
    subtotal >= 0 AND
    tax_amount >= 0 AND
    discount_amount >= 0 AND
    total >= 0
  ),
  CONSTRAINT valid_tax_rate CHECK (tax_rate >= 0 AND tax_rate <= 100),
  CONSTRAINT valid_until_future CHECK (
    valid_until IS NULL OR valid_until >= CURRENT_DATE
  )
);

COMMENT ON TABLE quotes IS 'Main quotes table with versioning support';
COMMENT ON COLUMN quotes.quote_number IS 'Unique identifier visible to clients (e.g., Q-2024-001)';
COMMENT ON COLUMN quotes.version IS 'Version number for tracking edits after sending';
COMMENT ON COLUMN quotes.parent_quote_id IS 'References original quote if this is a revision';
COMMENT ON COLUMN quotes.internal_notes IS 'Private notes not visible to clients';

-- =====================================================
-- TABLE: quote_line_items
-- =====================================================
-- Individual line items within quotes
-- =====================================================

CREATE TABLE quote_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

  -- Item details
  description TEXT NOT NULL,
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
  unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,

  -- Optional fields
  unit_of_measure VARCHAR(50), -- e.g., 'hours', 'sqft', 'each'
  category VARCHAR(100), -- e.g., 'labor', 'materials', 'equipment'
  sku VARCHAR(100),

  -- Display order
  sort_order INTEGER DEFAULT 0,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_quantity CHECK (quantity > 0),
  CONSTRAINT valid_unit_price CHECK (unit_price >= 0),
  CONSTRAINT valid_total CHECK (total >= 0)
);

COMMENT ON TABLE quote_line_items IS 'Individual line items within quotes';
COMMENT ON COLUMN quote_line_items.sort_order IS 'Display order within quote';
COMMENT ON COLUMN quote_line_items.unit_of_measure IS 'Unit type (hours, sqft, etc.)';

-- =====================================================
-- TABLE: payments
-- =====================================================
-- Payment transactions linked to Stripe
-- =====================================================

CREATE TABLE payments (
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
  payment_method_type VARCHAR(50), -- 'card', 'bank_transfer', etc.
  last_four VARCHAR(4),

  -- Processing details
  processed_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  refunded_at TIMESTAMP WITH TIME ZONE,
  failure_reason TEXT,

  -- Metadata from Stripe
  stripe_metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_amount CHECK (amount > 0),
  CONSTRAINT valid_currency CHECK (currency = UPPER(currency))
);

COMMENT ON TABLE payments IS 'Payment transactions linked to Stripe';
COMMENT ON COLUMN payments.stripe_payment_intent_id IS 'Stripe PaymentIntent ID';
COMMENT ON COLUMN payments.last_four IS 'Last 4 digits of payment method';

-- =====================================================
-- TABLE: quote_activity
-- =====================================================
-- Audit log for all quote actions
-- =====================================================

CREATE TABLE quote_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Activity details
  action activity_action NOT NULL,
  description TEXT,

  -- Change tracking
  changes JSONB, -- Stores before/after values

  -- IP and user agent for security
  ip_address INET,
  user_agent TEXT,

  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE quote_activity IS 'Audit log for all quote actions';
COMMENT ON COLUMN quote_activity.changes IS 'JSON object with before/after values for updates';
COMMENT ON COLUMN quote_activity.ip_address IS 'IP address of the action performer';

-- =====================================================
-- TABLE: audio_recordings
-- =====================================================
-- Voice recordings for quote generation
-- =====================================================

CREATE TABLE audio_recordings (
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
  processed_data JSONB, -- Extracted structured data

  -- Processing metadata
  processing_started_at TIMESTAMP WITH TIME ZONE,
  processing_completed_at TIMESTAMP WITH TIME ZONE,
  processing_error TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,

  -- Constraints
  CONSTRAINT valid_duration CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  CONSTRAINT valid_file_size CHECK (file_size_bytes IS NULL OR file_size_bytes > 0)
);

COMMENT ON TABLE audio_recordings IS 'Voice recordings for quote generation';
COMMENT ON COLUMN audio_recordings.processed_data IS 'Structured data extracted from audio';
COMMENT ON COLUMN audio_recordings.transcription_status IS 'Status: pending, processing, completed, failed';

-- =====================================================
-- INDEXES
-- =====================================================
-- Performance optimization for common queries
-- =====================================================

-- Users indexes
CREATE INDEX idx_users_clerk_id ON users(clerk_user_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_users_created_at ON users(created_at DESC);
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- Contacts indexes
CREATE INDEX idx_contacts_user_id ON contacts(user_id);
CREATE INDEX idx_contacts_email ON contacts(email) WHERE email IS NOT NULL;
CREATE INDEX idx_contacts_created_at ON contacts(created_at DESC);
CREATE INDEX idx_contacts_deleted_at ON contacts(deleted_at) WHERE deleted_at IS NOT NULL;

-- Full-text search on contacts (name and company)
CREATE INDEX idx_contacts_name_trgm ON contacts USING gin (name gin_trgm_ops);
CREATE INDEX idx_contacts_company_trgm ON contacts USING gin (company gin_trgm_ops);

-- Composite index for active contacts by user
CREATE INDEX idx_contacts_user_active ON contacts(user_id, deleted_at)
  WHERE deleted_at IS NULL;

-- Quotes indexes
CREATE INDEX idx_quotes_user_id ON quotes(user_id);
CREATE INDEX idx_quotes_contact_id ON quotes(contact_id);
CREATE INDEX idx_quotes_quote_number ON quotes(quote_number);
CREATE INDEX idx_quotes_status ON quotes(status);
CREATE INDEX idx_quotes_created_at ON quotes(created_at DESC);
CREATE INDEX idx_quotes_deleted_at ON quotes(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_quotes_parent_quote ON quotes(parent_quote_id) WHERE parent_quote_id IS NOT NULL;

-- Composite indexes for common quote queries
CREATE INDEX idx_quotes_user_status ON quotes(user_id, status, created_at DESC);
CREATE INDEX idx_quotes_user_date_range ON quotes(user_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_quotes_valid_until ON quotes(valid_until)
  WHERE status = 'sent' AND valid_until IS NOT NULL;

-- Full-text search on quotes
CREATE INDEX idx_quotes_project_name_trgm ON quotes USING gin (project_name gin_trgm_ops);

-- Quote line items indexes
CREATE INDEX idx_line_items_quote_id ON quote_line_items(quote_id);
CREATE INDEX idx_line_items_category ON quote_line_items(category) WHERE category IS NOT NULL;
CREATE INDEX idx_line_items_sort_order ON quote_line_items(quote_id, sort_order);

-- Payments indexes
CREATE INDEX idx_payments_quote_id ON payments(quote_id);
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_stripe_intent ON payments(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_created_at ON payments(created_at DESC);

-- Composite index for payment lookups
CREATE INDEX idx_payments_user_status ON payments(user_id, status, created_at DESC);

-- Quote activity indexes
CREATE INDEX idx_activity_quote_id ON quote_activity(quote_id, created_at DESC);
CREATE INDEX idx_activity_user_id ON quote_activity(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX idx_activity_action ON quote_activity(action);
CREATE INDEX idx_activity_created_at ON quote_activity(created_at DESC);

-- Audio recordings indexes
CREATE INDEX idx_audio_user_id ON audio_recordings(user_id);
CREATE INDEX idx_audio_quote_id ON audio_recordings(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX idx_audio_status ON audio_recordings(transcription_status);
CREATE INDEX idx_audio_created_at ON audio_recordings(created_at DESC);

-- =====================================================
-- FUNCTIONS & TRIGGERS
-- =====================================================
-- Automated updates and business logic
-- =====================================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function: Update contact statistics
CREATE OR REPLACE FUNCTION update_contact_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update total_quotes count
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

-- Function: Log quote activity
CREATE OR REPLACE FUNCTION log_quote_activity()
RETURNS TRIGGER AS $$
DECLARE
  action_type activity_action;
  change_data JSONB;
BEGIN
  -- Determine action type
  IF TG_OP = 'INSERT' THEN
    action_type := 'created';
    change_data := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    action_type := 'updated';
    change_data := jsonb_build_object(
      'before', to_jsonb(OLD),
      'after', to_jsonb(NEW)
    );

    -- Check for specific status changes
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

    -- Check for soft delete
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      action_type := 'deleted';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      action_type := 'restored';
    END IF;
  END IF;

  -- Insert activity log
  INSERT INTO quote_activity (quote_id, user_id, action, changes)
  VALUES (NEW.id, NEW.user_id, action_type, change_data);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate quote totals
CREATE OR REPLACE FUNCTION calculate_quote_totals()
RETURNS TRIGGER AS $$
DECLARE
  quote_subtotal DECIMAL(10, 2);
  quote_tax DECIMAL(10, 2);
  quote_total DECIMAL(10, 2);
BEGIN
  -- Calculate subtotal from line items
  SELECT COALESCE(SUM(total), 0)
  INTO quote_subtotal
  FROM quote_line_items
  WHERE quote_id = NEW.quote_id;

  -- Get quote details for tax calculation
  SELECT tax_rate, discount_amount
  INTO quote_tax, quote_total
  FROM quotes
  WHERE id = NEW.quote_id;

  -- Calculate tax and total
  quote_tax := (quote_subtotal * quote_tax / 100);
  quote_total := quote_subtotal + quote_tax - COALESCE(quote_total, 0);

  -- Update quote with calculated values
  UPDATE quotes
  SET
    subtotal = quote_subtotal,
    tax_amount = quote_tax,
    total = quote_total
  WHERE id = NEW.quote_id;

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
  IF NEW.quote_number IS NULL THEN
    year_prefix := TO_CHAR(NOW(), 'YYYY');

    -- Get next sequential number for this year
    SELECT COALESCE(MAX(
      CAST(
        SUBSTRING(quote_number FROM '\d+$') AS INTEGER
      )
    ), 0) + 1
    INTO next_number
    FROM quotes
    WHERE quote_number LIKE 'Q-' || year_prefix || '-%';

    -- Generate quote number: Q-2024-001
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

-- Function: Check quote validity and auto-expire
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
-- TRIGGER ASSIGNMENTS
-- =====================================================

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

-- Contact statistics triggers
CREATE TRIGGER trigger_update_contact_stats_on_quote
  AFTER INSERT OR UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_stats();

-- Quote activity logging
CREATE TRIGGER trigger_log_quote_activity
  AFTER INSERT OR UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION log_quote_activity();

-- Quote totals calculation
CREATE TRIGGER trigger_calculate_totals_on_line_item
  AFTER INSERT OR UPDATE OR DELETE ON quote_line_items
  FOR EACH ROW
  EXECUTE FUNCTION calculate_quote_totals();

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

-- =====================================================
-- INITIAL DATA & SETUP
-- =====================================================

-- Create a function to reset monthly quote counts (run via cron)
CREATE OR REPLACE FUNCTION reset_monthly_quote_counts()
RETURNS void AS $$
BEGIN
  UPDATE users
  SET quotes_this_month = 0
  WHERE DATE_TRUNC('month', updated_at) < DATE_TRUNC('month', NOW());
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================
-- Grant appropriate permissions (adjust based on your user setup)

-- Note: Uncomment and modify these based on your database user
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO your_app_user;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Version: 1.0.0
-- Tables created: 7
-- Indexes created: 40+
-- Functions created: 8
-- Triggers created: 11
-- =====================================================
