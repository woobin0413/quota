BEGIN;
CREATE TABLE public.request_rate_limits (
  key_hash text PRIMARY KEY CHECK (length(key_hash) = 64),
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX request_rate_limits_expiry ON public.request_rate_limits(expires_at);
ALTER TABLE public.request_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.request_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.request_rate_limits TO service_role;

CREATE FUNCTION public.consume_request_budget(p_key text, p_max integer, p_window_ms integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_now timestamptz := clock_timestamp(); v_row request_rate_limits;
BEGIN
  IF length(p_key) != 64 OR p_max < 1 OR p_window_ms < 1 OR p_window_ms > 86400000 THEN
    RAISE EXCEPTION 'INVALID_BUDGET';
  END IF;
  DELETE FROM request_rate_limits WHERE expires_at <= v_now;
  INSERT INTO request_rate_limits VALUES (p_key, 1, v_now + p_window_ms * interval '1 millisecond')
  ON CONFLICT (key_hash) DO UPDATE SET
    hits = CASE WHEN request_rate_limits.expires_at <= v_now THEN 1 ELSE LEAST(request_rate_limits.hits + 1, p_max + 1) END,
    expires_at = CASE WHEN request_rate_limits.expires_at <= v_now THEN EXCLUDED.expires_at ELSE request_rate_limits.expires_at END
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('allowed', v_row.hits <= p_max, 'remaining', GREATEST(0, p_max - v_row.hits), 'resetTime', floor(extract(epoch FROM v_row.expires_at) * 1000));
END;
$$;
REVOKE ALL ON FUNCTION public.consume_request_budget(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_request_budget(text, integer, integer) TO service_role;

ALTER TABLE public.users ADD COLUMN billing_revision bigint NOT NULL DEFAULT 0;
CREATE FUNCTION public.read_billing_revision(p_user_id uuid, p_customer_id text) RETURNS bigint LANGUAGE sql SET search_path = public AS $$
SELECT billing_revision FROM users WHERE id = p_user_id AND stripe_customer_id IS NOT DISTINCT FROM p_customer_id AND deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.read_billing_revision(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_billing_revision(uuid, text) TO service_role;
CREATE TABLE public.processed_billing_events (event_id text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.processed_billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.processed_billing_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.processed_billing_events TO service_role;
CREATE FUNCTION public.apply_billing_state(p_user_id uuid, p_customer_id text, p_revision bigint, p_tier text, p_status text, p_cancel boolean, p_period_end timestamptz, p_event_id text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_previous bigint;
BEGIN
  IF p_tier IS NULL OR p_tier NOT IN ('free', 'pro', 'ultimate') OR p_revision IS NULL OR p_revision < 0 THEN RAISE EXCEPTION 'INVALID_BILLING_STATE'; END IF;
  SELECT billing_revision INTO v_previous FROM users WHERE id = p_user_id AND stripe_customer_id IS NOT DISTINCT FROM p_customer_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_USER_NOT_FOUND'; END IF;
  IF p_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM processed_billing_events WHERE event_id = p_event_id) THEN RETURN 'duplicate'; END IF;
  IF p_revision != v_previous THEN RETURN 'conflict'; END IF;
  IF p_event_id IS NOT NULL THEN
    INSERT INTO processed_billing_events(event_id) VALUES (p_event_id) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RETURN 'duplicate'; END IF;
  END IF;
  UPDATE users SET subscription_tier = p_tier, subscription_status = p_status,
    cancel_at_period_end = p_cancel, current_period_end = p_period_end, billing_revision = v_previous + 1
    WHERE id = p_user_id;
  RETURN 'applied';
END;
$$;
REVOKE ALL ON FUNCTION public.apply_billing_state(uuid, text, bigint, text, text, boolean, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_billing_state(uuid, text, bigint, text, text, boolean, timestamptz, text) TO service_role;
COMMIT;
