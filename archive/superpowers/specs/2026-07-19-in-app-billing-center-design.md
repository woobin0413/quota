# In-App Billing Center — Design

**Date:** 2026-07-19
**Status:** Approved (design)

## Goal

Replace Stripe's hosted pages (Customer Portal + Checkout redirects) with a
dedicated in-app **`/billing`** page. Customers see their plan, payment
method, and invoice history, change plans, update their card, and
cancel/reactivate — all inside Quota's UI, backed by server-side Stripe API
calls. Card entry uses Stripe Elements so no raw card data touches our
backend. Also fixes a cancel/reactivate UI bug.

## Decisions (locked)

- **Card capture:** in-app **Stripe Elements** (SetupIntent + client-side
  tokenization). No redirect to Stripe's portal. Keeps us in PCI SAQ-A.
- **Shell:** dedicated **`/billing`** page (not a popup). "Plan & billing"
  in the header links here. Profile Settings stays a dialog.
- **Plan changes:** **upgrade** = immediate, prorated; **downgrade** =
  scheduled to take effect at period end (customer keeps the higher tier
  until renewal, no refunds).
- **Sole-writer invariant preserved:** all new routes mutate Stripe only;
  `setTierFromBilling` (called from the Stripe webhook) remains the ONLY
  writer of `subscription_tier` / `cancel_at_period_end` /
  `current_period_end`.

## Background — current state

- `lib/stripe.ts`: `getStripe()`, `PRICE_BY_TIER()`, `tierByPriceId()`,
  `getActiveSubscription(customerId)`. API pinned `2023-10-16`.
- Webhook (`lib/stripe-webhook.ts`, `processStripeEvent`) handles
  `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`; `syncFromSubscription` maps the sub's
  price → tier via `tierByPriceId` and calls `setTierFromBilling`.
- Existing routes: `/api/billing/checkout` (hosted Checkout / Portal),
  `/api/billing/portal` (hosted Portal), `/api/billing/cancel`,
  `/api/billing/reactivate`. Cancel/reactivate already call Stripe only.
- `BillingPanel` renders inside a `BillingDialog`. Bug: `isCancelling`
  requires `currentPeriodEnd !== null`; when null it falls back and shows
  **Cancel** again with no **Reactivate**.
- Env has `STRIPE_SECRET_KEY` (sk_test), `STRIPE_PRICE_PRO/ULTIMATE`,
  and now `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test).

## Architecture

`/billing` is an authenticated page composed of three self-contained
sections, each backed by its own read route and mutations. Reads come from
Stripe live (source of truth for card + invoices); tier still comes from
our DB (written only by the webhook). Card entry is a Stripe Elements form
driven by a SetupIntent. Plan changes and cancellations mutate Stripe; the
webhook syncs our DB seconds later, and the UI optimistically reflects the
change (same pattern as today's cancel/reactivate).

## Backend routes

All: `getCurrentUser()` guard → `checkRateLimit(\`billing:${id}\`,
{maxRequests: 10})` → Stripe calls. No route writes tier/billing DB fields.

- **`GET /api/billing/summary`** → `{ tier, tierLabel, price, status,
  currentPeriodEnd, cancelAtPeriodEnd, pendingDowngradeTier|null,
  pendingChangeDate|null, paymentMethod: { brand, last4, expMonth, expYear
  } | null }`. Derived from the customer's subscription + default payment
  method + any subscription schedule (for a pending downgrade). No
  customer/sub → free-plan shape with nulls.
- **`GET /api/billing/invoices`** → `{ invoices: [{ id, number, created
  (ISO), amountPaid, currency, status, pdfUrl }] }` via
  `invoices.list({ customer, limit: 24 })`. Empty array when none.
- **`POST /api/billing/setup-intent`** → `{ clientSecret }`. Ensures a
  Stripe customer (find-or-create, reusing `linkStripeCustomer`), creates a
  SetupIntent for that customer, returns its `client_secret` for Elements.
- **`POST /api/billing/payment-method`** `{ setupIntentId }` → verifies the
  SetupIntent succeeded and belongs to this customer, then sets its
  `payment_method` as the customer's default
  (`invoice_settings.default_payment_method`) and, if a subscription
  exists, the subscription's `default_payment_method`. Returns the new
  card summary. **Never** accepts a raw PAN.
- **`POST /api/billing/change-plan`** `{ targetTier: "free"|"pro"|
  "ultimate" }`:
  - **Upgrade** (free→paid, pro→ultimate): if no card on file, respond
    `{ needsPaymentMethod: true }` so the UI collects a card first; else
    `subscriptions.update(sub, { items:[{ id, price }],
    proration_behavior: "create_prorations" })` (or create the subscription
    for a first-time paid). Immediate.
    If free→paid and no existing sub, create the subscription with the
    default payment method (requires a card, same `needsPaymentMethod`
    gate).
  - **Downgrade** (ultimate→pro): create/replace a **subscription
    schedule** so the current price runs until `current_period_end`, then
    switches to the target price. Tier stays the higher one until then.
  - **Downgrade to free** = cancel at period end (delegate to existing
    cancel behavior).
  - Returns the new summary shape (optimistic UI).
- **Retire from the UI:** `/api/billing/checkout` and `/api/billing/portal`
  are no longer called by the front end. Leave the route files in place
  (dead but harmless) OR delete — plan decides; no UI references remain.
- **`cancel` / `reactivate`:** unchanged.

## Webhook additions

`customer.subscription.updated` already re-syncs tier from the sub's active
price, so scheduled downgrades sync automatically when the schedule
releases. Add handling so a **subscription schedule** phase change is
covered (it surfaces as `customer.subscription.updated`; no new case needed
if we read the current price). No tier write happens outside the webhook.
(SetupIntent/payment-method changes do not affect tier, so no webhook
change is required for the card flow.)

## Frontend

- **`app/billing/page.tsx`** — authenticated page (app header/footer),
  renders the three sections. Fetches `/api/billing/summary` +
  `/api/billing/invoices` on mount.
- **`components/billing/PlanSection.tsx`** — tier, price, "Renews {date}" /
  "Cancels {date}" / "Ultimate until {date}, then Pro". Buttons: Change
  plan (opens `ChangePlanDialog`), Cancel / Reactivate. **Fixes the bug**:
  cancelling state keyed on `cancelAtPeriodEnd` alone → always shows
  Reactivate, hides Cancel.
- **`components/billing/ChangePlanDialog.tsx`** — the three tiers as cards
  with the current one marked; picking one calls `change-plan`. If
  `needsPaymentMethod`, routes the user through the card form first.
- **`components/billing/PaymentMethodSection.tsx`** — shows "Visa ••••
  4242, exp 08/27" or an empty state; Update opens the Elements form.
- **`components/billing/PaymentMethodForm.tsx`** — Stripe Elements
  (`@stripe/react-stripe-js`): loads publishable key, gets a client secret
  from `/api/billing/setup-intent`, `confirmSetup`, then posts
  `setupIntentId` to `/api/billing/payment-method`.
- **`components/billing/InvoiceTable.tsx`** — date, amount, status, PDF
  link; empty state when no invoices.
- **`lib/stripe-browser.ts`** — memoized `loadStripe(publishableKey)` client
  loader.
- **Header:** "Plan & billing" (desktop + mobile) → `Link` to `/billing`;
  remove `BillingDialog` mount + `billingOpen` state. `middleware.ts`:
  `/billing` is already covered by the auth gate (not public).

## Data flow

- **Card update:** UI → `POST setup-intent` → Elements `confirmSetup`
  (card tokenized in Stripe's iframe) → `POST payment-method
  {setupIntentId}` → default set → summary refresh.
- **Upgrade:** UI → `POST change-plan` → `subscriptions.update` immediate →
  webhook `subscription.updated` → `setTierFromBilling` → DB tier up (UI
  optimistic in the meantime).
- **Downgrade:** UI → `POST change-plan` → subscription schedule set → DB
  tier unchanged until period end → schedule releases → webhook → tier down.

## Error handling

- No customer/subscription on a mutation → 400 with a clear code, UI shows
  an inline message.
- `needsPaymentMethod` from change-plan → UI opens the card form, then
  retries the change.
- Elements `confirmSetup` error (declined/invalid) → inline error from
  Stripe's message; no backend call.
- SetupIntent not `succeeded` or customer mismatch on `payment-method` →
  400, no default change.
- Stripe/network failure → 500 + generic message; tier never changes
  outside the webhook.

## Testing

- **Unit** (`lib/__tests__/…`): `change-plan` tier routing (upgrade vs
  downgrade vs free), summary mapping (subscription + PM + schedule →
  response shape), invoice mapping. `buildAuthHandoffUrl`-style pure
  helpers where extracted.
- **e2e** (`e2e/billing.spec.ts`): `/billing` renders all three sections;
  cancel → shows "Cancels {date}" + Reactivate (bug regression);
  reactivate → back to Renews; invoice empty-state; Change plan opens the
  dialog. Plan changes exercised via the dev tier switch where a real
  Stripe round-trip isn't feasible.
- **Manual (test mode):** card update with `4242 4242 4242 4242`; upgrade
  charges prorated; downgrade schedules; signup account creation end-to-end
  (Auth0 now configured).

## Dependencies

- New packages: `@stripe/stripe-js`, `@stripe/react-stripe-js`.
- Env: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test — added).

## Out of scope

- No raw-card handling anywhere in our backend.
- No new DB columns (tier state already covered; pending-downgrade read
  live from the Stripe schedule).
- No dunning / failed-payment retry UI (Stripe emails handle it).
- No multi-currency or tax UI.
- Keeping/removing the now-unused `checkout`/`portal` route files is a
  plan-level cleanup decision, not a behavior change.
