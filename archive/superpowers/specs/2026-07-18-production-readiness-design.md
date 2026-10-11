# Production Readiness (pre-infra) — Design

**Date:** 2026-07-18
**Status:** Approved
**Scope:** Everything deployable before an infra decision: legal/about pages,
rate limiting, security headers, billing reconciliation, cancellation
tracking, owner KPI dashboard with account-sharing signals, and the Stripe
review follow-up batch. Explicitly OUT: hosting/prod-DB provisioning, Sentry,
CSP (all infra-dependent).

## 1. Legal + About pages

Four public, static, English-only pages (legal pages in one language is
standard; the bilingual landing links to them as-is):

| Route | Content |
|---|---|
| `/terms` | Service description (quoting/invoicing SaaS), tiers + quote limits, payment via Stripe, acceptable use, **account-sharing clause: one account = one business/user; credential sharing is grounds for termination** (all tiers incl. Ultimate), disclaimer of warranties, limitation of liability, changes-to-terms, **governing law: New Jersey** |
| `/privacy` | What we store (account via Auth0, client contacts, quotes, send metadata), what we don't (no card data — Stripe hosted checkout), email via Resend, no selling of data, deletion on request |
| `/refunds` | **Full refund if you cancel within 3 days of a charge (initial or renewal); after 3 days, no refund for that billing period.** Cancellation anytime via Manage billing; access continues to period end |
| `/about` | Short Quota story: invoicing built for contractors — price book, quote, send, get paid |

- Files: `app/(legal)/terms/page.tsx`, `privacy/`, `refunds/`, `about/` +
  shared `app/(legal)/layout.tsx` (ledger-paper styling consistent with the
  landing; simple header with logo link home, footer).
- Contact email: single constant `SUPPORT_EMAIL = "support@example.com"
  /* TODO: replace when domain chosen */` in new `lib/site.ts`; every page
  reads it.
- Middleware: add `"/terms", "/privacy", "/refunds", "/about"` to
  `PUBLIC_ROUTES` (Stripe live-mode review requires these public).
- Links: (a) landing page footer gains Terms · Privacy · Refunds · About;
  (b) dashboard — small muted footer row with the same four links (user
  asked for dashboard visibility) added to the authenticated layout so it
  shows on all app pages, not just `/dashboard`.
- Content is plain informational text, not legal advice; user can have
  counsel review later. Metadata (title/description) per page.

## 2. Rate limiting (extend existing)

`lib/rate-limit.ts` already exists (in-memory fixed-window
`checkRateLimit(key, { windowMs, maxRequests })`) and already covers
`/api/waitlist` (5/min per IP), `/api/send-quote` and the receipt route
(10/min per user). Remaining work:

- Apply to the new billing routes: `POST /api/billing/checkout` and
  `POST /api/billing/portal` — `checkRateLimit(\`billing:${user.id}\`,
  { maxRequests: 10 })` (10/min per user), 429
  `{ success: false, code: "RATE_LIMITED", message: "Too many requests —
  try again soon." }`.
- Unit tests for the existing limiter (none today): window rollover, limit
  boundary, key isolation (vitest fake timers).
- Docblock note: per-process memory — swap to Upstash or similar
  after infra is chosen.

## 3. Security headers

`next.config.js` `headers()` for all routes: `Strict-Transport-Security`
(1y, includeSubDomains), `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`.
**CSP deferred** to post-infra (needs nonce wiring; report-only trial first).

## 4. Billing reconciliation (daily)

Corrects tier drift if webhook events are ever missed (endpoint down >72h →
Stripe stops retrying).

- New `lib/billing-reconcile.ts`: `reconcileBilling(): Promise<Report>`.
  Logic: fetch all users with `stripe_customer_id IS NOT NULL` OR
  `subscription_tier != 'free'` (new repo helper
  `getBillingRelevantUsers()` in `lib/db/users.ts`). For each:
  - List the customer's non-canceled Stripe subscriptions (none for users
    without a customer id).
  - Expected tier = `tierByPriceId` of the first non-canceled sub's price
    (or `free` if no sub / unknown price → log, skip write on unknown).
  - Mismatch with stored tier/status → `setTierFromBilling` (same
    Stripe-derived writer the webhook uses — the sole-writer invariant
    holds: reconciliation writes only what Stripe says).
  - Report `{ checked, drifted: [{userId, from, to}], errors }` — returned
    and logged via `logger.warn` when drift found.
- New route `POST /api/cron/reconcile-billing`: **not session-authed** —
  guarded by `Authorization: Bearer ${CRON_SECRET}` (new env var; 500 if
  unset, 401 on mismatch). Middleware `PUBLIC_ROUTES` += `"/api/cron"`.
- Scheduling is infra-dependent: document in the route docblock (Vercel
  cron JSON example, or `curl` in any scheduler). Manual run:
  `curl -X POST -H "Authorization: Bearer $CRON_SECRET" .../api/cron/reconcile-billing`.
- Monthly reconciliation = reading Stripe dashboard revenue reports; no code.
- Unit tests: drift both directions (paid user with no sub → free; free
  user with active sub → paid), no-drift no-write, unknown price skipped.

## 5. Cancellation tracking (period-end visibility)

Stripe already runs the clock (cancel → `subscription.updated` with
`cancel_at_period_end=true`, tier unchanged; period end →
`subscription.deleted` → tier `free`). This adds DB visibility:

- Migration `010`: `users.cancel_at_period_end BOOLEAN NOT NULL DEFAULT
  false`, `users.current_period_end TIMESTAMPTZ` (+ the quotes index from
  the follow-up batch, one migration).
- Webhook: `checkout.session.completed` + `subscription.updated` persist
  both fields from the subscription (`cancel_at_period_end`,
  `current_period_end` epoch → timestamp); `subscription.deleted` resets
  them (false/NULL). `setTierFromBilling` signature grows an optional
  billing-state arg (exact shape in the plan).
- Reconciliation syncs the same two fields.
- UI: `GET /api/subscription` returns `cancelAtPeriodEnd` +
  `currentPeriodEnd`; settings plan row and UpgradeDialog current-plan
  card show "Cancels {date} — access until then" when pending.
- Revocation itself stays webhook-driven (no app-side timer needed);
  the reconciliation cron is the missed-event backstop.

## 6. Owner KPI dashboard (`/admin`)

- Access: `ADMIN_EMAILS` env (comma-separated); non-matching sessions get
  `notFound()` (404, not 403 — don't reveal the route). Server component.
- New repo `lib/db/admin-metrics.ts` (service-role queries, read-only):
  - `getSignupStats()` — total users, new in last 7/30 days
  - `getTierBreakdown()` — count per tier + estimated MRR
    (`pro_count*15 + ultimate_count*29`)
  - `getPendingCancellations()` — users with `cancel_at_period_end=true`
    (email, tier, `current_period_end`)
  - `getRecentSignups(limit 20)` — email, tier, created_at, quote count
- Page `app/admin/page.tsx`: stat cards (users, new 7/30d, MRR, per-tier
  counts), pending-cancellations table, recent-signups table, link-out
  button to the Stripe dashboard for revenue/fees detail (Stripe already
  computes fees exactly — not rebuilt here).
- Middleware: `/admin` stays session-protected (default) — the email gate
  is on top.

### Account-sharing signals (usage tracking)

- Migration `010` adds table `usage_sessions`: `id`, `user_id` (FK),
  `ip VARCHAR(45)`, `ua_hash VARCHAR(32)` (md5 of user-agent), `day DATE`,
  `first_seen`, `last_seen`, `request_count INT DEFAULT 1`;
  `UNIQUE (user_id, ip, ua_hash, day)`; index on `(user_id, day)`.
- Recording: `lib/usage-tracking.ts` — `recordUsage(userId, ip, userAgent)`
  fire-and-forget (never blocks or fails the request), called from
  `getCurrentUser()` (the single auth chokepoint). In-memory dedupe cache
  (key `userId|ip|uaHash|day`, cleared daily) so the DB sees ~1 upsert per
  new device/IP/day, not per request. Upsert increments `request_count`,
  bumps `last_seen`.
- Admin panel "Sharing signals" (in `/admin`): users ranked by
  (a) avg distinct `(ip, ua_hash)` combos per active day over last 7 days
  (≥4 highlighted), (b) concurrent-use days — days where two different IPs
  both have activity (`request_count` from separate rows, same day) —
  strongest signal. Tier column shown; Ultimate sorted first.
- Policy: **flag-and-review only** — no automated enforcement. Owner acts
  under the ToS clause (email, terminate) or converts the account to a
  future Teams plan. Known false positives documented in the panel's
  helper text (VPNs, mobile IP rotation, phone+laptop concurrency).
- Session limits / forced re-login via Auth0 remain deferred escalation
  options; future "Teams" seats add-on is the strategic answer to
  sharing demand.

## 7. Stripe review follow-up batch

1. `linkStripeCustomer` throws on Supabase error (webhook then 500s →
   Stripe retries).
2. Webhook route: `getStripe()` misconfig (missing STRIPE_SECRET_KEY) no
   longer masquerades as "Invalid signature" — construct the client
   before the try/catch of `constructEvent`; missing key → 500 +
   `logger.error`.
3. Checkout route: empty `PRICE_BY_TIER()[tier]` → 500
   `{ code: "BILLING_NOT_CONFIGURED" }` + `logger.error` (instead of an
   opaque Stripe API error).
4. UpgradeDialog: checkout and portal buttons cross-disable
   (`disabled={busy !== null || portalBusy}` both ways).
5. PlanRow: portal failure shows an inline error line instead of silent
   reset.
6. `getStripe()` unit tests: throws without key; returns same instance
   twice (uses `vi.resetModules`).
7. Migration `010` (shared with §5's cancel columns, + rollback + supabase
   mirror): `CREATE INDEX idx_quotes_user_active ON quotes(user_id) WHERE
   deleted_at IS NULL;` (serves `countUserQuotes`).

## Env additions

```bash
CRON_SECRET=    # random string; guards /api/cron/* (openssl rand -hex 32)
ADMIN_EMAILS=   # comma-separated emails allowed into /admin
```

Documented in CLAUDE.md + `.env.example` (shipped blank).

## Testing

- Unit: rate limiter, reconciliation (incl. cancel-field sync), getStripe,
  webhook cancel-field persistence, usage-tracking dedupe (vitest).
- e2e additions (`e2e/legal.spec.ts`): the four pages return 200 + h1
  without auth; `/admin` 404s for the (non-admin) e2e user.
- Full gate: vitest, type-check, lint, tiers + quote-flow + legal e2e.

## Non-Goals

- Hosting/deploy, prod Supabase, Stripe live keys (infra undecided)
- Sentry / uptime monitoring (post-deploy)
- CSP (post-infra)
- Distributed rate limiting (post-infra)
- Spanish legal translations
- Tax collection (Stripe Tax — dashboard toggle later)
- Automated sharing enforcement (session/device limits, auto-suspend) —
  tracking + admin flagging only; enforcement is a human decision
- In-app Stripe fee/revenue reporting (Stripe dashboard link-out)
