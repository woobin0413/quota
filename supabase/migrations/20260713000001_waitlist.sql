-- 008: Voice-to-invoice waitlist signups (public landing page capture)

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  locale VARCHAR(5) NOT NULL DEFAULT 'en',
  source VARCHAR(50) NOT NULL DEFAULT 'voice-teaser',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent duplicate handling keys on lowercased email
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email_lower
  ON waitlist_signups (LOWER(email));

COMMENT ON TABLE waitlist_signups IS 'Landing-page waitlist (voice-to-invoice teaser); public POST /api/waitlist';
