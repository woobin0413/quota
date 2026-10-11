# Stripe Billing — Design

**Date:** 2026-07-16
**Status:** Approved (design)
**Depends on:** quote-tier-limits (merged) + plan-visibility (ships first).
Replaces the free self-serve tier switch with paid Stripe subscriptions.

## Problem

Upgrades are currently free: `PATCH /api/subscription` sets any tier for
any signed-in user (an explicit placeholder). To charge for Pro ($15/mo)
and Ultimate ($29/mo), integrate Stripe so money moves before tiers do —
and lock the placeholder.

## Decisions (locked)

- **Stripe**, hosted surfaces only: **Checkout** (subscribe/upgrade) +
  **Customer Portal** (manage/cancel/payment method). No custom card UI.
- Monthly prices only: Pro $15/mo, Ultimate $29/mo. Products/prices created
  manually in the Stripe dashboard (test mode first); IDs via env.
- Cancel/downgrade takes effect **at period end** (Stripe default).
- **The webhook is the only writer of paid tiers.** The self-serve PATCH
  becomes dev/e2e-only behind `ALLOW_DEV_TIER_SWITCH=1`.
- User already has a Stripe account; build against test keys.

## Non-Goals

- Annual plans, coupons, trials, proration UI
- Invoices/receipts for the subscription itself (Stripe emails those)
- Seat/usage-based billing
- In-app payment-method entry (Portal handles it)

## Environment

```bash
STRIPE_SECRET_KEY=            # sk_test_… then sk_live_…
STRIPE_WEBHOOK_SECRET=        # whsec_… (from `stripe listen` locally; dashboard endpoint in prod)
STRIPE_PRICE_PRO=             # price_… for Pro $15/mo
STRIPE_PRICE_ULTIMATE=        # price_… for Ultimate $29/mo
ALLOW_DEV_TIER_SWITCH=1       # dev/e2e only — NEVER set in prod
```

`lib/stripe.ts` — singleton Stripe client (official `stripe` npm package,
pinned API version) + `PRICE_BY_TIER: { pro, ultimate }` from env +
`tierByPriceId(priceId)` reverse lookup.

## Flows

### Upgrade (Checkout)

1. UpgradeDialog buttons change: instead of PATCH, call
   `POST /api/billing/checkout { tier: "pro" | "ultimate" }`.
2. Route (auth required): find-or-create the Stripe customer
   (`users.stripe_customer_id`; create with email + `metadata.userId`,
   persist id), then create a **subscription-mode Checkout Session**:
   - `customer`, `line_items: [{ price: PRICE_BY_TIER[tier], quantity: 1 }]`
   - `success_url: {APP}/dashboard?upgraded=1`, `cancel_url: {APP}/dashboard`
   - `metadata.userId`, `subscription_data.metadata.userId`
   - If the user already has an active subscription (tier pro→ultimate
     change): do NOT create a second subscription — send them to the
     **Customer Portal** instead (`flow_data` update-plan deep link if
     available; plain portal otherwise). v1 rule: one subscription per
     customer.
3. Respond `{ url }`; client `window.location.href = url`.

### Tier sync (Webhook — source of truth)

`POST /api/webhooks/stripe` (public route; raw-body signature verification
with `STRIPE_WEBHOOK_SECRET` — Next.js route handlers must read
`await request.text()` before `stripe.webhooks.constructEvent`).

| Event | Action |
|---|---|
| `checkout.session.completed` | resolve userId (session.metadata / customer), fetch the subscription, set tier from its price via `tierByPriceId`, `subscription_status='active'`, persist `stripe_customer_id` |
| `customer.subscription.updated` | re-derive tier from the current price; map Stripe status → `subscription_status` (`active`,`past_due`,`canceled`…). `cancel_at_period_end=true` does NOT change tier (period-end rule) |
| `customer.subscription.deleted` | tier → `free`, `subscription_status='canceled'` |

- Unknown events → 200 (ack, ignore). Signature failure → 400.
- Idempotent by construction (writes are absolute sets, not increments).
- Repo helper `lib/db/users.ts`: `setTierFromBilling(userId, tier, status)`
  and `getUserByStripeCustomerId(customerId)`.

### Manage / cancel (Portal)

- `POST /api/billing/portal` (auth) → `stripe.billingPortal.sessions.create`
  → `{ url }`. Entry points: profile-settings plan row (`Manage billing`
  when tier ≠ free) and UpgradeDialog footer link for paid users.
- Cancel in Portal → period end → `customer.subscription.deleted` webhook
  → tier `free`.

### Locking the placeholder

`PATCH /api/subscription`: first line —

```ts
if (process.env.ALLOW_DEV_TIER_SWITCH !== "1") {
  return 403 { code: "BILLING_REQUIRED", message: "Plan changes go through billing." }
}
```

`.env.local` and the Playwright env set the flag; production never does.
e2e continues to use PATCH for baseline/tier flips (unchanged).

## UI deltas

- **UpgradeDialog**: paid-tier buttons → checkout redirect (spinner during
  session create); current-plan marker unchanged; for paid current tier,
  footer link `Manage billing` → portal. Free never shows portal.
- **Plan row (settings)**: `Upgrade` → `Manage billing` when tier ≠ free.
- **Dashboard**: on `?upgraded=1`, show a one-time success toast/banner
  ("You're on Pro — 15 quotes.") and strip the param. Tier may lag the
  webhook by seconds; banner copy reads from the API, not the param.

## Security

- Webhook signature verified against raw body; secret from env; public
  route added to middleware `PUBLIC_ROUTES` (boundary-matched).
- Tier changes only via verified webhook (or the dev flag).
- Checkout/Portal sessions created server-side for the session user's own
  customer id — no client-supplied customer/price ids (tier enum only).
- No card data touches the app (hosted surfaces).

## Failure handling

- Checkout-session create fails → 500; dialog shows retry error.
- Webhook handler errors → 500 so Stripe retries (their retry schedule is
  the recovery mechanism). Logged via `logger.error`.
- User pays but webhook delayed → dashboard banner reads live API; badge
  updates when the webhook lands. Acceptable seconds-level lag.

## Local dev & testing

- `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (Stripe
  CLI) supplies `STRIPE_WEBHOOK_SECRET` for dev.
- Manual test-mode pass: upgrade → Checkout with test card `4242…` →
  webhook flips tier → badge shows Pro; Portal cancel → period end
  simulated via Stripe test clock or immediate-cancel in dashboard.
- **e2e stays Stripe-free**: existing tiers.spec uses the dev PATCH (flag
  set in test env). New unit tests: `tierByPriceId`, webhook event→action
  mapping with mocked Stripe event payloads (no network).
- Controller manual verification in test mode replaces e2e for the hosted
  redirect flows.

## Surface

`lib/stripe.ts` (new) · `app/api/billing/checkout/route.ts` +
`app/api/billing/portal/route.ts` (new) · `app/api/webhooks/stripe/route.ts`
(new) + middleware public route · `PATCH /api/subscription` guard ·
`lib/db/users.ts` billing helpers · UpgradeDialog + plan row + dashboard
banner deltas · unit tests · env docs (CLAUDE.md env section + .env.example).
