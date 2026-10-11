-- 013_voice_captures.sql
-- Records every voice capture: the transcript (kept), the audio blob
-- (purged at 7 days), and which model produced the extraction.

CREATE TABLE IF NOT EXISTS voice_captures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Nullable: abandoned drafts are the common case, and deleting a quote must
  -- not erase the record of a call that cost money.
  quote_id        UUID REFERENCES quotes(id) ON DELETE SET NULL,
  transcript      TEXT NOT NULL,
  duration_sec    NUMERIC(6,2),
  -- Private blob URL (not publicly readable) for the audio recording; NULL
  -- once purged by the retention job or never populated for text-only capture.
  blob_url        TEXT,
  blob_expires_at TIMESTAMPTZ,
  model           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS voice_captures_user_created_idx
  ON voice_captures (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS voice_captures_expiry_idx
  ON voice_captures (blob_expires_at) WHERE blob_url IS NOT NULL;
