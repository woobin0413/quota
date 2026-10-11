#!/usr/bin/env bash
# =====================================================
# Verify the anon-lockdown (migration 011) on a deployed Supabase.
#
# Simulates the real attacker path: hit PostgREST with the PUBLIC anon key
# and confirm every sensitive table is UNREADABLE. A pass means migration 011
# is applied; a fail means customer PII is still exposed — do not launch.
#
# Usage:
#   SUPABASE_URL=https://xxxx.supabase.co \
#   SUPABASE_ANON_KEY=eyJ... \
#   ./scripts/verify-anon-lockdown.sh
#
# Or pass as args:
#   ./scripts/verify-anon-lockdown.sh https://xxxx.supabase.co eyJ...
# =====================================================
set -uo pipefail

URL="${1:-${SUPABASE_URL:-}}"
KEY="${2:-${SUPABASE_ANON_KEY:-}}"

if [[ -z "$URL" || -z "$KEY" ]]; then
  echo "ERROR: need SUPABASE_URL and SUPABASE_ANON_KEY (env or args)." >&2
  exit 2
fi
URL="${URL%/}" # strip trailing slash

# Tables that hold customer PII / sensitive data. Anon must NOT read any.
TABLES=(users contacts quotes quote_line_items payments quote_payments \
        payment_milestones payment_status_changes usage_sessions \
        waitlist_signups work_items quote_activity)

echo "Target: $URL"
echo "Probing ${#TABLES[@]} tables with the public anon key…"
echo

fail=0
for t in "${TABLES[@]}"; do
  # Ask for a single row. If lockdown works PostgREST returns 401/permission
  # denied; if broken it returns 200 with a JSON array.
  resp="$(curl -s -w $'\n%{http_code}' \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" \
    "$URL/rest/v1/$t?select=*&limit=1")"
  code="$(tail -n1 <<<"$resp")"
  body="$(sed '$d' <<<"$resp")"

  if [[ "$code" == "200" && "$body" == "["* ]]; then
    echo "  ❌ EXPOSED  $t  (HTTP 200, returned rows)"
    fail=1
  elif [[ "$code" == "401" || "$code" == "403" ]] || grep -qi "permission denied" <<<"$body"; then
    echo "  ✅ locked   $t  (HTTP $code)"
  else
    # Unexpected — treat as suspicious, surface for a human.
    echo "  ⚠️  check   $t  (HTTP $code): $(head -c 120 <<<"$body")"
    fail=1
  fi
done

echo
if [[ "$fail" -eq 0 ]]; then
  echo "PASS — anon key cannot read any sensitive table. Migration 011 is live."
  exit 0
else
  echo "FAIL — at least one table is readable or unverified. DO NOT LAUNCH."
  echo "Fix: run db/migrations/011_lockdown_anon_access.sql against this project."
  exit 1
fi
