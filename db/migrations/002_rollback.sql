-- =====================================================
-- ROLLBACK 002: Work Catalog & Invoicing Restructure
-- =====================================================
-- Reverses 002_work_catalog.sql in dependency order.
-- =====================================================

BEGIN;

-- 7/3/2. Drop new tables (policies drop with them)
DROP TABLE IF EXISTS payment_status_changes CASCADE;

-- 5. Remove catalog link before dropping work_items
ALTER TABLE quote_line_items
  DROP COLUMN IF EXISTS work_item_id;

DROP TABLE IF EXISTS work_items CASCADE;

-- 4. Quotes: remove paid tracking, restore audio columns
DROP INDEX IF EXISTS idx_quotes_user_paid;

ALTER TABLE quotes
  DROP COLUMN IF EXISTS is_paid,
  DROP COLUMN IF EXISTS paid_at;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS audio_recording_url TEXT,
  ADD COLUMN IF NOT EXISTS audio_transcript TEXT;

-- 6. Recreate audio_recordings (definition from 001_supabase_schema.sql)
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

CREATE INDEX IF NOT EXISTS idx_audio_user_id ON audio_recordings(user_id);
CREATE INDEX IF NOT EXISTS idx_audio_quote_id ON audio_recordings(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audio_status ON audio_recordings(transcription_status);

CREATE TRIGGER update_audio_updated_at
  BEFORE UPDATE ON audio_recordings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE audio_recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recordings" ON audio_recordings
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own recordings" ON audio_recordings
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own recordings" ON audio_recordings
  FOR UPDATE USING (true);
CREATE POLICY "Users can delete own recordings" ON audio_recordings
  FOR DELETE USING (true);

-- 1. Users: Auth0 -> Clerk
ALTER TABLE users RENAME COLUMN auth0_user_id TO clerk_user_id;
ALTER INDEX IF EXISTS idx_users_auth0_id RENAME TO idx_users_clerk_id;

COMMIT;
