-- Migration 005: Atomic send-tracking functions
--
-- Replaces read-modify-write counter updates in the API routes with
-- DB-side increments so concurrent sends can't lose an update.

CREATE OR REPLACE FUNCTION record_quote_send(
  p_quote_id UUID,
  p_user_id UUID,
  p_recipient_email TEXT
) RETURNS VOID AS $$
  UPDATE quotes
  SET recipient_email = p_recipient_email,
      email_sent_count = COALESCE(email_sent_count, 0) + 1,
      sent_at = NOW(),
      last_email_sent_at = NOW()
  WHERE id = p_quote_id AND user_id = p_user_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION record_receipt_send(
  p_quote_id UUID,
  p_user_id UUID
) RETURNS VOID AS $$
  UPDATE quotes
  SET receipt_sent_at = NOW(),
      receipt_sent_count = COALESCE(receipt_sent_count, 0) + 1
  WHERE id = p_quote_id AND user_id = p_user_id;
$$ LANGUAGE sql;
