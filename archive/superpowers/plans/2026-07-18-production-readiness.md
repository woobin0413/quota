# Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship everything deployable pre-infra: legal/about pages, billing-route rate limits, security headers, billing reconciliation cron, cancellation tracking, owner KPI dashboard with sharing signals, and the Stripe review follow-up batch.

**Architecture:** One migration (010) carries all schema changes (cancel columns, `usage_sessions`, quotes index). The webhook and a new reconciliation module both write billing state through `setTierFromBilling` (extended with an optional billing-state arg) — the sole-writer invariant holds. Legal pages are static public server components under `app/(legal)/`. `/admin` is a server component gated by `ADMIN_EMAILS` on top of session auth. Usage tracking hooks into `getCurrentUser()` fire-and-forget.

**Tech Stack:** Existing stack (Next.js 14, Supabase service-role, stripe v14, Vitest, Playwright). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-18-production-readiness-design.md`

## Global Constraints

- **Sole-writer invariant unchanged:** paid tiers are written only by `processStripeEvent` and `reconcileBilling` (both derive from live Stripe data via `setTierFromBilling`) plus the flag-guarded dev PATCH.
- Refund policy copy (exact): full refund if canceled **within 3 days of a charge (initial or renewal)**; after 3 days, no refund for that billing period; cancellation anytime, access continues to period end.
- Terms: governing law **New Jersey**; account-sharing clause (one account = one business/user; credential sharing grounds for termination).
- Contact email: `SUPPORT_EMAIL` constant in `lib/site.ts`, value `support@example.com` with a TODO comment — referenced everywhere, never hardcoded in pages.
- `/admin` returns **404** (`notFound()`) for non-admin sessions — never 403.
- `/api/cron/reconcile-billing`: 500 if `CRON_SECRET` unset, 401 on mismatch, session-free.
- Usage tracking must never block or fail a request (fire-and-forget, all errors swallowed + logged at debug/warn).
- Rate-limit 429 shape: `{ success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." }`.
- New public routes: exactly `/terms`, `/privacy`, `/refunds`, `/about`, `/api/cron` added to `PUBLIC_ROUTES`.
- All existing testids stable; new ones: `app-footer`, `legal-page`, `admin-page`, `sharing-signals`, `pending-cancellations`, `cancel-notice`.
- Commit messages: plain, no attribution trailers of any kind.
- Every task ends with `npm run type-check && npm run lint` clean and `npx vitest run` green.

## File Structure

- Create: `db/migrations/010_production_readiness.sql` + `010_rollback.sql` + supabase mirror `supabase/migrations/20260718000000_production_readiness.sql`
- Create: `lib/site.ts`, `lib/billing-reconcile.ts`, `lib/usage-tracking.ts`, `lib/db/admin-metrics.ts`
- Create: `app/(legal)/layout.tsx`, `app/(legal)/terms/page.tsx`, `app/(legal)/privacy/page.tsx`, `app/(legal)/refunds/page.tsx`, `app/(legal)/about/page.tsx`
- Create: `app/api/cron/reconcile-billing/route.ts`, `app/admin/page.tsx`, `components/layout/AppFooter.tsx`
- Create tests: `lib/__tests__/rate-limit.test.ts`, `lib/__tests__/billing-reconcile.test.ts`, `lib/__tests__/usage-tracking.test.ts`; extend `lib/__tests__/stripe.test.ts`, `lib/__tests__/stripe-webhook.test.ts`
- Create: `e2e/legal.spec.ts`
- Modify: `types/database.ts`, `lib/db/users.ts`, `lib/stripe-webhook.ts`, `app/api/webhooks/stripe/route.ts`, `app/api/billing/checkout/route.ts`, `app/api/billing/portal/route.ts`, `app/api/subscription/route.ts`, `components/subscription/use-subscription.ts`, `components/subscription/UpgradeDialog.tsx`, `components/settings/ProfileForm.tsx`, `lib/auth.ts`, `middleware.ts`, `next.config.js`, `components/landing/sections.tsx`, `app/dashboard/layout.tsx`, `app/new-quote/layout.tsx`, `app/quote/layout.tsx`, `CLAUDE.md`, `.env.example`

---

### Task 1: Migration 010 + types + repo helpers

**Files:**
- Create: `db/migrations/010_production_readiness.sql`, `db/migrations/010_rollback.sql`, `supabase/migrations/20260718000000_production_readiness.sql` (identical content to the forward migration)
- Modify: `types/database.ts` (User type), `lib/db/users.ts` (`setTierFromBilling` extension, `linkStripeCustomer` throws, new `getBillingRelevantUsers`)

**Interfaces:**
- Produces: `users.cancel_at_period_end` / `users.current_period_end` columns; `usage_sessions` table; `setTierFromBilling(userId, tier, status, billing?: { cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null })`; `getBillingRelevantUsers(): Promise<User[]>`; `linkStripeCustomer` now throws on DB error. Tasks 2, 4, 6, 7, 8 consume these.

- [ ] **Step 1: Write the migration**

`db/migrations/010_production_readiness.sql`:

```sql
-- 010: production readiness — cancellation tracking, usage sessions, quotes index

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS usage_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip VARCHAR(45) NOT NULL,
  ua_hash VARCHAR(32) NOT NULL,
  day DATE NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count INT NOT NULL DEFAULT 1,
  UNIQUE (user_id, ip, ua_hash, day)
);

CREATE INDEX IF NOT EXISTS idx_usage_sessions_user_day ON usage_sessions(user_id, day);

CREATE INDEX IF NOT EXISTS idx_quotes_user_active ON quotes(user_id) WHERE deleted_at IS NULL;
```

`db/migrations/010_rollback.sql`:

```sql
DROP INDEX IF EXISTS idx_quotes_user_active;
DROP INDEX IF EXISTS idx_usage_sessions_user_day;
DROP TABLE IF EXISTS usage_sessions;
ALTER TABLE users
  DROP COLUMN IF EXISTS current_period_end,
  DROP COLUMN IF EXISTS cancel_at_period_end;
```

Copy the forward migration verbatim to `supabase/migrations/20260718000000_production_readiness.sql`.

- [ ] **Step 2: Apply locally**

Run: `~/.local/share/supabase/supabase db reset` (Docker must be up; if it fails on connectivity, report BLOCKED).
Expected: reset succeeds, migration list includes `20260718000000`.

- [ ] **Step 3: Types**

In `types/database.ts`, add to the `User` interface (after `stripe_customer_id`):

```ts
  cancel_at_period_end: boolean;
  current_period_end: string | null;
```

- [ ] **Step 4: Repo helpers**

In `lib/db/users.ts`:

1. Replace `setTierFromBilling` with:

```ts
/**
 * Set tier + subscription status (and optional cancellation state) from
 * billing (Stripe webhook / reconciliation). The ONLY intended production
 * writers of paid tiers derive their data from live Stripe state.
 */
export async function setTierFromBilling(
  userId: string,
  tier: SubscriptionTier,
  status: string,
  billing?: { cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }
): Promise<void> {
  const update: Record<string, unknown> = {
    subscription_tier: tier,
    subscription_status: status,
  };
  if (billing) {
    update.cancel_at_period_end = billing.cancelAtPeriodEnd;
    update.current_period_end = billing.currentPeriodEnd;
  }

  const { error } = await supabaseAdmin
    .from("users")
    .update(update)
    .eq("id", userId);

  if (error) {
    throw error;
  }
}
```

2. Make `linkStripeCustomer` throw (spec follow-up 1):

```ts
export async function linkStripeCustomer(
  userId: string,
  stripeCustomerId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("users")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", userId);

  if (error) {
    throw error;
  }
}
```

3. Add after `getUserByStripeCustomerId`:

```ts
/**
 * Users relevant to billing reconciliation: anyone with a Stripe customer
 * or a non-free tier (covers drift in both directions).
 */
export async function getBillingRelevantUsers(): Promise<User[]> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .or("stripe_customer_id.not.is.null,subscription_tier.neq.free")
    .is("deleted_at", null);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => transformUser(row as UserRow));
}
```

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run && npm run type-check && npm run lint`
Expected: existing 34 pass (the webhook test mocks `setTierFromBilling`, so the added optional param is non-breaking), clean.

```bash
git add db/migrations/010_production_readiness.sql db/migrations/010_rollback.sql supabase/migrations/20260718000000_production_readiness.sql types/database.ts lib/db/users.ts
git commit -m "feat(db): cancellation tracking columns, usage_sessions table, quotes index"
```

---

### Task 2: Webhook persists cancellation state (+ tests)

**Files:**
- Modify: `lib/stripe-webhook.ts`, `lib/__tests__/stripe-webhook.test.ts`

**Interfaces:**
- Consumes: Task 1's `setTierFromBilling` 4-arg signature.
- Produces: every webhook write now carries `{ cancelAtPeriodEnd, currentPeriodEnd }`; `subscription.deleted` resets to `{ false, null }`.

- [ ] **Step 1: Extend the tests first**

In `lib/__tests__/stripe-webhook.test.ts`:

1. Extend `makeSubscription` to carry period fields:

```ts
function makeSubscription(priceId: string, status = "active") {
  return {
    id: "sub_1",
    customer: "cus_1",
    status,
    cancel_at_period_end: false,
    current_period_end: 1790000000, // epoch seconds
    metadata: { userId: "user-1" },
    items: { data: [{ price: { id: priceId } }] },
  };
}
```

2. Update the existing assertions — every `setTierFromBilling` expectation gains the billing arg. The four existing write assertions become:

```ts
// checkout.session.completed test:
expect(setTierFromBilling).toHaveBeenCalledWith("user-1", "pro", "active", {
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date(1790000000 * 1000).toISOString(),
});
// customer.subscription.updated test:
expect(setTierFromBilling).toHaveBeenCalledWith("user-1", "ultimate", "past_due", {
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date(1790000000 * 1000).toISOString(),
});
// cancel_at_period_end test (sub has cancel_at_period_end: true):
expect(setTierFromBilling).toHaveBeenCalledWith("user-1", "pro", "active", {
  cancelAtPeriodEnd: true,
  currentPeriodEnd: new Date(1790000000 * 1000).toISOString(),
});
// deleted test:
expect(setTierFromBilling).toHaveBeenCalledWith("user-1", "free", "canceled", {
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
});
```

(The fallback-lookup test's assertion gains the same non-cancel billing object with `"user-2"`.)

3. Add one new test:

```ts
it("subscription with null current_period_end stores null", async () => {
  const sub = { ...makeSubscription("price_pro_test"), current_period_end: null };
  const event = {
    type: "customer.subscription.updated",
    data: { object: sub },
  } as unknown as Stripe.Event;

  await processStripeEvent(event);

  expect(setTierFromBilling).toHaveBeenCalledWith("user-1", "pro", "active", {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
  });
});
```

- [ ] **Step 2: Run to verify the updated tests fail**

Run: `npx vitest run lib/__tests__/stripe-webhook.test.ts`
Expected: FAIL — writes called without the billing arg.

- [ ] **Step 3: Implement in `lib/stripe-webhook.ts`**

Add a helper and thread it through:

```ts
/** Cancellation-visibility fields from a subscription. */
function billingStateOf(sub: Stripe.Subscription) {
  return {
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    currentPeriodEnd: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };
}
```

- In `syncFromSubscription`: `await setTierFromBilling(userId, tier, sub.status, billingStateOf(sub));`
- In the `checkout.session.completed` case: `await setTierFromBilling(userId, tier, sub.status, billingStateOf(sub));`
- In the `customer.subscription.deleted` case: `await setTierFromBilling(userId, "free", "canceled", { cancelAtPeriodEnd: false, currentPeriodEnd: null });`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/stripe-webhook.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Gate + commit**

Run: `npx vitest run && npm run type-check && npm run lint`
Expected: all green.

```bash
git add lib/stripe-webhook.ts lib/__tests__/stripe-webhook.test.ts
git commit -m "feat(billing): webhook persists cancel_at_period_end and current_period_end"
```

---

### Task 3: Billing route hardening (follow-ups 2, 3, 6 + rate limits)

**Files:**
- Modify: `app/api/webhooks/stripe/route.ts`, `app/api/billing/checkout/route.ts`, `app/api/billing/portal/route.ts`
- Test: extend `lib/__tests__/stripe.test.ts`

**Interfaces:**
- Consumes: `checkRateLimit` from `@/lib/rate-limit` (existing), `getStripe`/`PRICE_BY_TIER` from Task 1 of the Stripe plan.
- Produces: webhook 500 `WEBHOOK_MISCONFIGURED` on missing STRIPE_SECRET_KEY; checkout 500 `BILLING_NOT_CONFIGURED` on empty price; both billing routes 429 `RATE_LIMITED` at 10/min per user.

- [ ] **Step 1: getStripe unit tests (write first)**

Append to `lib/__tests__/stripe.test.ts`:

```ts
describe("getStripe", () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.resetModules();
  });

  it("throws when STRIPE_SECRET_KEY is unset", async () => {
    vi.resetModules();
    delete process.env.STRIPE_SECRET_KEY;
    const { getStripe } = await import("@/lib/stripe");
    expect(() => getStripe()).toThrow("STRIPE_SECRET_KEY is not configured");
  });

  it("returns the same instance on repeat calls", async () => {
    vi.resetModules();
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const { getStripe } = await import("@/lib/stripe");
    expect(getStripe()).toBe(getStripe());
  });
});
```

Add `vi` to the vitest imports at the top of the file.

Run: `npx vitest run lib/__tests__/stripe.test.ts` — the two new tests must pass immediately (they test existing behavior; if either fails, the implementation is wrong — investigate, don't adjust the test).

- [ ] **Step 2: Webhook misconfig split**

In `app/api/webhooks/stripe/route.ts`, construct the client before signature verification so a missing secret key is a 500 config error, not a fake "Invalid signature" 400. After the `signature` null-check and before `request.text()`:

```ts
  let stripe;
  try {
    stripe = getStripe();
  } catch (error) {
    logger.error("Stripe webhook: STRIPE_SECRET_KEY not configured", {
      err: error,
      route: "POST /api/webhooks/stripe",
    });
    return NextResponse.json({ error: "Webhook misconfigured" }, { status: 500 });
  }
```

Then use `stripe.webhooks.constructEvent(...)` (replacing `getStripe().webhooks...`) inside the existing try/catch.

- [ ] **Step 3: Checkout price guard + rate limits**

In `app/api/billing/checkout/route.ts`, after the tier is parsed and before any Stripe call:

```ts
    const price = PRICE_BY_TIER()[tier];
    if (!price) {
      logger.error("Billing checkout: missing price id for tier", {
        tier,
        route: "POST /api/billing/checkout",
      });
      return NextResponse.json(
        { success: false, message: "Billing is not configured", code: "BILLING_NOT_CONFIGURED" },
        { status: 500 }
      );
    }
```

Use `price` in `line_items` instead of the inline lookup.

In BOTH `app/api/billing/checkout/route.ts` and `app/api/billing/portal/route.ts`, immediately after the auth check:

```ts
    const rate = checkRateLimit(`billing:${user.id}`, { maxRequests: 10 });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." },
        { status: 429 }
      );
    }
```

Import `checkRateLimit` from `@/lib/rate-limit` in both files. (Same `billing:` key namespace on purpose — checkout+portal share one budget.)

- [ ] **Step 4: Gate + commit**

Run: `npx vitest run && npm run type-check && npm run lint`
Expected: all green (36 tests now).

```bash
git add app/api/webhooks/stripe/route.ts app/api/billing/checkout/route.ts app/api/billing/portal/route.ts lib/__tests__/stripe.test.ts
git commit -m "fix(billing): distinct misconfig errors, price guard, billing rate limits"
```

---

### Task 4: Rate limiter unit tests

**Files:**
- Test: `lib/__tests__/rate-limit.test.ts` (new)

**Interfaces:**
- Consumes: existing `checkRateLimit` from `@/lib/rate-limit`.

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit then blocks", () => {
    const key = `t1:${Date.now()}:${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, { maxRequests: 3 }).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, { maxRequests: 3 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after the window elapses", () => {
    const key = `t2:${Date.now()}:${Math.random()}`;
    checkRateLimit(key, { maxRequests: 1, windowMs: 60_000 });
    expect(checkRateLimit(key, { maxRequests: 1, windowMs: 60_000 }).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit(key, { maxRequests: 1, windowMs: 60_000 }).allowed).toBe(true);
  });

  it("isolates keys", () => {
    const a = `t3a:${Math.random()}`;
    const b = `t3b:${Math.random()}`;
    checkRateLimit(a, { maxRequests: 1 });
    expect(checkRateLimit(a, { maxRequests: 1 }).allowed).toBe(false);
    expect(checkRateLimit(b, { maxRequests: 1 }).allowed).toBe(true);
  });

  it("reports remaining correctly", () => {
    const key = `t4:${Math.random()}`;
    expect(checkRateLimit(key, { maxRequests: 5 }).remaining).toBe(4);
    expect(checkRateLimit(key, { maxRequests: 5 }).remaining).toBe(3);
  });
});
```

Note: fake timers control `Date.now()` used by the limiter. Unique keys per test keep the module-level Map from cross-contaminating tests.

- [ ] **Step 2: Run**

Run: `npx vitest run lib/__tests__/rate-limit.test.ts`
Expected: PASS (4). These test existing behavior — if one fails, investigate the limiter, don't bend the test.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/rate-limit.test.ts
git commit -m "test: rate limiter window, boundary, key isolation"
```

---

### Task 5: Reconciliation module + cron route (+ tests)

**Files:**
- Create: `lib/billing-reconcile.ts`, `app/api/cron/reconcile-billing/route.ts`
- Test: `lib/__tests__/billing-reconcile.test.ts`
- Modify: `middleware.ts` (PUBLIC_ROUTES + `/api/cron`)

**Interfaces:**
- Consumes: `getBillingRelevantUsers`, `setTierFromBilling` (Task 1), `getStripe`, `tierByPriceId`.
- Produces: `reconcileBilling(): Promise<{ checked: number; drifted: { userId: string; from: string; to: string }[]; errors: number }>`; `POST /api/cron/reconcile-billing`.

- [ ] **Step 1: Tests first** — `lib/__tests__/billing-reconcile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const setTierFromBilling = vi.fn();
const getBillingRelevantUsers = vi.fn();
const subscriptionsList = vi.fn();

vi.mock("@/lib/db/users", () => ({
  setTierFromBilling: (...a: unknown[]) => setTierFromBilling(...a),
  getBillingRelevantUsers: (...a: unknown[]) => getBillingRelevantUsers(...a),
}));

vi.mock("@/lib/stripe", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stripe")>();
  return {
    ...mod,
    getStripe: () => ({
      subscriptions: { list: (...a: unknown[]) => subscriptionsList(...a) },
    }),
  };
});

import { reconcileBilling } from "@/lib/billing-reconcile";

function user(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    subscription_tier: "pro",
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    cancel_at_period_end: false,
    current_period_end: null,
    ...over,
  };
}

function sub(priceId: string, over: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: 1790000000,
    items: { data: [{ price: { id: priceId } }] },
    ...over,
  };
}

describe("reconcileBilling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_PRO = "price_pro_test";
    process.env.STRIPE_PRICE_ULTIMATE = "price_ult_test";
  });

  it("no drift → no write", async () => {
    getBillingRelevantUsers.mockResolvedValue([
      user({ current_period_end: new Date(1790000000 * 1000).toISOString() }),
    ]);
    subscriptionsList.mockResolvedValue({ data: [sub("price_pro_test")] });

    const report = await reconcileBilling();

    expect(setTierFromBilling).not.toHaveBeenCalled();
    expect(report.checked).toBe(1);
    expect(report.drifted).toEqual([]);
  });

  it("paid user with no subscription → free", async () => {
    getBillingRelevantUsers.mockResolvedValue([user()]);
    subscriptionsList.mockResolvedValue({ data: [] });

    const report = await reconcileBilling();

    expect(setTierFromBilling).toHaveBeenCalledWith("u1", "free", "canceled", {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    });
    expect(report.drifted).toEqual([{ userId: "u1", from: "pro", to: "free" }]);
  });

  it("free user with active subscription → paid", async () => {
    getBillingRelevantUsers.mockResolvedValue([
      user({ subscription_tier: "free", subscription_status: "canceled" }),
    ]);
    subscriptionsList.mockResolvedValue({ data: [sub("price_ult_test")] });

    await reconcileBilling();

    expect(setTierFromBilling).toHaveBeenCalledWith("u1", "ultimate", "active", {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(1790000000 * 1000).toISOString(),
    });
  });

  it("unknown price → skipped, counted as error, no write", async () => {
    getBillingRelevantUsers.mockResolvedValue([user()]);
    subscriptionsList.mockResolvedValue({ data: [sub("price_mystery")] });

    const report = await reconcileBilling();

    expect(setTierFromBilling).not.toHaveBeenCalled();
    expect(report.errors).toBe(1);
  });

  it("cancel-state drift alone triggers a sync write", async () => {
    getBillingRelevantUsers.mockResolvedValue([
      user({ current_period_end: new Date(1790000000 * 1000).toISOString() }),
    ]);
    subscriptionsList.mockResolvedValue({
      data: [sub("price_pro_test", { cancel_at_period_end: true })],
    });

    await reconcileBilling();

    expect(setTierFromBilling).toHaveBeenCalledWith("u1", "pro", "active", {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(1790000000 * 1000).toISOString(),
    });
  });

  it("user with paid tier but no stripe customer → free", async () => {
    getBillingRelevantUsers.mockResolvedValue([user({ stripe_customer_id: null })]);

    const report = await reconcileBilling();

    expect(subscriptionsList).not.toHaveBeenCalled();
    expect(setTierFromBilling).toHaveBeenCalledWith("u1", "free", "canceled", {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    });
    expect(report.drifted).toEqual([{ userId: "u1", from: "pro", to: "free" }]);
  });
});
```

Run: `npx vitest run lib/__tests__/billing-reconcile.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `lib/billing-reconcile.ts`**

```ts
/**
 * Billing reconciliation — daily backstop for missed webhook events.
 *
 * Compares each billing-relevant user's stored tier/status/cancel state
 * against their live Stripe subscriptions and corrects drift via
 * setTierFromBilling (the same Stripe-derived writer the webhook uses,
 * so the sole-writer invariant holds).
 */

import type Stripe from "stripe";
import { getStripe, tierByPriceId } from "@/lib/stripe";
import { getBillingRelevantUsers, setTierFromBilling } from "@/lib/db/users";
import { logger } from "@/lib/logger";
import type { SubscriptionTier } from "@/types/database";

export interface ReconcileReport {
  checked: number;
  drifted: { userId: string; from: string; to: string }[];
  errors: number;
}

const FREE_STATE = {
  tier: "free" as SubscriptionTier,
  status: "canceled",
  billing: { cancelAtPeriodEnd: false, currentPeriodEnd: null as string | null },
};

export async function reconcileBilling(): Promise<ReconcileReport> {
  const users = await getBillingRelevantUsers();
  const report: ReconcileReport = { checked: 0, drifted: [], errors: 0 };

  for (const user of users) {
    report.checked++;
    try {
      let expected = FREE_STATE;

      if (user.stripe_customer_id) {
        // Stripe list default excludes only ended subscriptions.
        const subs = await getStripe().subscriptions.list({
          customer: user.stripe_customer_id,
          limit: 10,
        });
        const active = subs.data[0] as Stripe.Subscription | undefined;
        if (active) {
          const priceId = active.items.data[0]?.price?.id ?? "";
          const tier = tierByPriceId(priceId);
          if (!tier) {
            logger.error("Reconcile: unknown price id", {
              userId: user.id,
              priceId,
              subId: active.id,
            });
            report.errors++;
            continue; // never write on unknown price
          }
          expected = {
            tier,
            status: active.status,
            billing: {
              cancelAtPeriodEnd: active.cancel_at_period_end === true,
              currentPeriodEnd: active.current_period_end
                ? new Date(active.current_period_end * 1000).toISOString()
                : null,
            },
          };
        }
      }

      const drifted =
        user.subscription_tier !== expected.tier ||
        user.subscription_status !== expected.status ||
        user.cancel_at_period_end !== expected.billing.cancelAtPeriodEnd ||
        (user.current_period_end ?? null) !== expected.billing.currentPeriodEnd;

      if (drifted) {
        await setTierFromBilling(user.id, expected.tier, expected.status, expected.billing);
        if (user.subscription_tier !== expected.tier) {
          report.drifted.push({
            userId: user.id,
            from: user.subscription_tier,
            to: expected.tier,
          });
        }
      }
    } catch (error) {
      logger.error("Reconcile: user failed", { err: error, userId: user.id });
      report.errors++;
    }
  }

  if (report.drifted.length > 0 || report.errors > 0) {
    logger.warn("Reconcile completed with drift/errors", { ...report });
  }
  return report;
}
```

Note: tier-unchanged cancel-state drift writes but doesn't append to `drifted` (that list tracks tier changes) — the test for cancel-state drift only asserts the write.

Run: `npx vitest run lib/__tests__/billing-reconcile.test.ts` → PASS (6).

- [ ] **Step 3: Cron route** — `app/api/cron/reconcile-billing/route.ts`:

```ts
/**
 * Billing Reconciliation Cron — POST /api/cron/reconcile-billing
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (no session).
 * Schedule daily once infra is chosen, e.g. Vercel cron:
 *   { "crons": [{ "path": "/api/cron/reconcile-billing", "schedule": "0 9 * * *" }] }
 * (Vercel sends GET with the CRON_SECRET env auto-injected as Bearer —
 * hence the GET handler delegating to POST below.)
 * Manual run:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/cron/reconcile-billing
 */

import { NextRequest, NextResponse } from "next/server";
import { reconcileBilling } from "@/lib/billing-reconcile";
import { logger } from "@/lib/logger";

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.error("Cron: CRON_SECRET not configured", {
      route: "/api/cron/reconcile-billing",
    });
    return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await reconcileBilling();
    return NextResponse.json({ success: true, ...report });
  } catch (error) {
    logger.error("Cron: reconcile failed", {
      err: error,
      route: "/api/cron/reconcile-billing",
    });
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
```

- [ ] **Step 4: Middleware** — in `middleware.ts` change:

```ts
const PUBLIC_ROUTES = ["/", "/og", "/api/webhooks", "/api/waitlist", "/api/cron"];
```

- [ ] **Step 5: Gate + commit**

Run: `npx vitest run && npm run type-check && npm run lint`
Expected: green (46 tests).

```bash
git add lib/billing-reconcile.ts app/api/cron/reconcile-billing/route.ts lib/__tests__/billing-reconcile.test.ts middleware.ts
git commit -m "feat(billing): daily reconciliation module + secret-guarded cron route"
```

---

### Task 6: Legal + About pages, site constant, footers, security headers

**Files:**
- Create: `lib/site.ts`, `app/(legal)/layout.tsx`, `app/(legal)/terms/page.tsx`, `app/(legal)/privacy/page.tsx`, `app/(legal)/refunds/page.tsx`, `app/(legal)/about/page.tsx`, `components/layout/AppFooter.tsx`
- Modify: `middleware.ts` (public routes), `components/landing/sections.tsx` (footer links), `app/dashboard/layout.tsx`, `app/new-quote/layout.tsx`, `app/quote/layout.tsx` (mount AppFooter), `next.config.js` (headers)

**Interfaces:**
- Produces: `SUPPORT_EMAIL` from `@/lib/site`; four public routes; `AppFooter` component. Task 9's e2e consumes the routes.

- [ ] **Step 1: `lib/site.ts`**

```ts
/** Site-wide constants. */

// TODO: replace when a domain is chosen
export const SUPPORT_EMAIL = "support@example.com";

export const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
  { href: "/about", label: "About" },
] as const;
```

- [ ] **Step 2: Legal layout** — `app/(legal)/layout.tsx`:

```tsx
import Link from "next/link";
import { FileText } from "lucide-react";
import { LEGAL_LINKS } from "@/lib/site";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2 font-display font-bold uppercase tracking-wide">
            <FileText className="h-5 w-5 text-accent" aria-hidden="true" />
            Quota
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-foreground">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="container mx-auto max-w-3xl px-4 py-12" data-testid="legal-page">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: The four pages**

Shared conventions: default-export server component, `export const metadata = { title: "… — Quota" }`, one `<h1 className="font-display text-3xl font-bold uppercase mb-2">`, `<p className="text-sm text-muted-foreground mb-8">Last updated: July 18, 2026</p>`, sections as `<h2 className="font-display text-xl font-bold uppercase mt-8 mb-3">` + `<p className="text-muted-foreground leading-relaxed">` paragraphs, contact section referencing `SUPPORT_EMAIL`.

`app/(legal)/terms/page.tsx` — h1 "Terms of Service". Sections (write full prose, 2-4 sentences each, plain informational English):
1. **The service** — Quota is a quoting and invoicing tool for contractors: work catalog, quotes, client emails, payment tracking.
2. **Accounts & plans** — Free (3 quotes), Pro $15/mo (15 quotes), Ultimate $29/mo (unlimited). Payments processed by Stripe; Quota never stores card details.
3. **One account, one business** — exact clause: "Your account is licensed to a single business and its owner. Sharing login credentials with anyone outside your business — on any plan, including Ultimate — is a violation of these terms and grounds for suspension or termination."
4. **Acceptable use** — lawful use only; no abuse of email sending; no attempts to circumvent plan limits.
5. **Your content** — quotes/clients/catalog remain yours; we store them to provide the service.
6. **Disclaimer** — service provided "as is", no warranty of uninterrupted operation; quotes/invoices are your business documents — verify amounts before sending.
7. **Limitation of liability** — liability capped at fees paid in the prior 3 months.
8. **Cancellation & refunds** — link to `/refunds`.
9. **Changes** — we may update these terms; continued use = acceptance.
10. **Governing law** — "These terms are governed by the laws of the State of New Jersey, USA."
11. **Contact** — `{SUPPORT_EMAIL}`.

`app/(legal)/privacy/page.tsx` — h1 "Privacy Policy". Sections:
1. **What we collect** — account info via Auth0 login (name, email); your business data (client contacts, work catalog, quotes, business logo); email delivery metadata via Resend.
2. **What we never collect** — card numbers (Stripe hosted checkout handles payment; we store only your subscription status).
3. **How we use it** — to run the service; usage records (IP address, browser type, dates) kept for security and abuse prevention.
4. **Sharing** — never sold; shared only with processors that run the service (Auth0, Stripe, Resend, database hosting).
5. **Retention & deletion** — data kept while your account is active; email `{SUPPORT_EMAIL}` to delete your account and data.
6. **Contact** — `{SUPPORT_EMAIL}`.

`app/(legal)/refunds/page.tsx` — h1 "Refund Policy". Sections:
1. **The 3-day rule** — exact: "If you cancel within 3 days of a charge — whether it's your first payment or a monthly renewal — we'll refund that charge in full. After 3 days, the charge for that billing period is non-refundable."
2. **How to cancel** — Settings → Manage billing (Stripe portal); cancellation stops future charges; access continues until the end of the paid period.
3. **How refunds arrive** — issued to the original payment method via Stripe, typically 5-10 business days.
4. **Contact** — `{SUPPORT_EMAIL}` for refund requests within the 3-day window.

`app/(legal)/about/page.tsx` — h1 "About Quota". 3 short paragraphs: built for contractors who quote in the field — price book in your pocket, quote in minutes, send as a PDF invoice, track who's paid; no accounting degree required; made by a small team that believes billing software should be simpler than the work it bills. Contact via `{SUPPORT_EMAIL}`.

- [ ] **Step 4: Middleware public routes**

```ts
const PUBLIC_ROUTES = [
  "/",
  "/og",
  "/terms",
  "/privacy",
  "/refunds",
  "/about",
  "/api/webhooks",
  "/api/waitlist",
  "/api/cron",
];
```

- [ ] **Step 5: `components/layout/AppFooter.tsx`**

```tsx
import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/site";

/** Muted legal-links footer for authenticated app pages. */
export function AppFooter() {
  return (
    <footer
      className="border-t py-4 text-center text-xs text-muted-foreground"
      data-testid="app-footer"
    >
      <nav className="flex justify-center gap-4">
        {LEGAL_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-foreground">
            {l.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
```

Export it from `components/layout/index.ts` if that barrel exists (check; otherwise import directly). Mount in `app/dashboard/layout.tsx`, `app/new-quote/layout.tsx`, `app/quote/layout.tsx` — after `<main>{children}</main>`:

```tsx
      <main>{children}</main>
      <AppFooter />
```

(Adapt to each layout's actual JSX; keep their existing structure.)

- [ ] **Step 6: Landing footer links**

In `components/landing/sections.tsx`, the footer's bottom row currently has brand / sign-in / copyright. Add a links row above it (inside the same `border-t` container, before the existing flex row):

```tsx
        <nav className="mb-4 flex items-center justify-center gap-4 pt-6 text-sm text-primary-foreground/70">
          {LEGAL_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-primary-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
```

Move the `border-t … pt-6` classes from the existing bottom row onto this nav's wrapper as needed so there's one divider (adjust minimally; visual: divider, then links row, then the existing brand/sign-in/copyright row). Import `LEGAL_LINKS` from `@/lib/site`. English labels on both locales (spec: legal pages are EN-only).

- [ ] **Step 7: Security headers** — `next.config.js`:

```js
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { /* …existing unchanged… */ },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
```

- [ ] **Step 8: Visual sanity + gate + commit**

Run: `npm run type-check && npm run lint && npx vitest run` → green.
Optionally `npm run dev` and curl `http://localhost:3000/terms` → 200 (kill the server after).

```bash
git add lib/site.ts app/\(legal\)/ components/layout/AppFooter.tsx middleware.ts components/landing/sections.tsx app/dashboard/layout.tsx app/new-quote/layout.tsx app/quote/layout.tsx next.config.js components/layout/index.ts
git commit -m "feat(legal): terms, privacy, refunds, about pages + footers + security headers"
```

---

### Task 7: Cancellation visibility in API + UI (follow-ups 4, 5)

**Files:**
- Modify: `app/api/subscription/route.ts`, `components/subscription/use-subscription.ts`, `components/subscription/UpgradeDialog.tsx`, `components/settings/ProfileForm.tsx`

**Interfaces:**
- Consumes: Task 1's User columns.
- Produces: `GET /api/subscription` adds `cancelAtPeriodEnd: boolean` + `currentPeriodEnd: string | null`; `Subscription` client type gains the same.

- [ ] **Step 1: API** — in the GET handler's response object add:

```ts
      cancelAtPeriodEnd: user.cancel_at_period_end,
      currentPeriodEnd: user.current_period_end,
```

- [ ] **Step 2: Hook** — `use-subscription.ts`: add to the `Subscription` interface:

```ts
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
```

and to the `setSub` mapping:

```ts
            cancelAtPeriodEnd: d.cancelAtPeriodEnd ?? false,
            currentPeriodEnd: d.currentPeriodEnd ?? null,
```

- [ ] **Step 3: PlanRow (ProfileForm.tsx)** — under the existing plan display line, when pending cancellation:

```tsx
      {sub.cancelAtPeriodEnd && sub.currentPeriodEnd && (
        <p className="text-xs text-destructive" data-testid="cancel-notice">
          Cancels {new Date(sub.currentPeriodEnd).toLocaleDateString()} — access until then
        </p>
      )}
```

Also follow-up 5 — portal failure shows inline error instead of silent reset. Give PlanRow local error state:

```tsx
const [portalError, setPortalError] = useState<string | null>(null);
```

In `openPortal`, on the fall-through/catch path: `setPortalError("Could not open billing portal — try again.")`; clear it (`setPortalError(null)`) at the start of each attempt. Render under the button:

```tsx
      {portalError && (
        <p className="text-xs text-destructive" role="alert">{portalError}</p>
      )}
```

- [ ] **Step 4: UpgradeDialog** — two changes:

1. Cancel notice on the current-plan card. The dialog receives `currentTier` but not cancellation state — add optional props `cancelAtPeriodEnd?: boolean; currentPeriodEnd?: string | null` to `UpgradeDialogProps`, and in the current-plan card (where "Current plan" renders), above that label:

```tsx
                    {isCurrent && cancelAtPeriodEnd && currentPeriodEnd && (
                      <p className="mb-1 text-center text-xs text-destructive" data-testid="cancel-notice">
                        Cancels {new Date(currentPeriodEnd).toLocaleDateString()}
                      </p>
                    )}
```

Callers that have a `sub` from `useSubscription` (PlanChip, QuotaBadge, NewQuoteForm, ProfileForm) pass the two new props where `sub` is in scope; callers without it omit them (optional props default undefined → nothing renders). Update each call site that has the data.

2. Follow-up 4 — cross-disable busy states:
- checkout buttons: `disabled={busy !== null || portalBusy}`
- manage-billing link: `disabled={portalBusy || busy !== null}`

- [ ] **Step 5: Gate + commit**

Run: `npx vitest run && npm run type-check && npm run lint` → green.

```bash
git add app/api/subscription/route.ts components/subscription/use-subscription.ts components/subscription/UpgradeDialog.tsx components/settings/ProfileForm.tsx components/subscription/PlanChip.tsx components/subscription/QuotaBadge.tsx components/quote/NewQuoteForm.tsx
git commit -m "feat(billing): cancellation visibility in subscription API and UI"
```

(Include only the call-site files actually touched.)

---

### Task 8: Usage tracking (+ tests)

**Files:**
- Create: `lib/usage-tracking.ts`
- Test: `lib/__tests__/usage-tracking.test.ts`
- Modify: `lib/auth.ts` (hook into `getCurrentUser`)

**Interfaces:**
- Consumes: `supabaseAdmin`, Task 1's `usage_sessions` table.
- Produces: `recordUsage(userId: string, ip: string, userAgent: string): void` (fire-and-forget). Task 9's admin panel reads the table.

- [ ] **Step 1: Tests first** — `lib/__tests__/usage-tracking.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const upsert = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/lib/db/core", () => ({
  supabaseAdmin: { from: () => ({ upsert: (...a: unknown[]) => upsert(...a) }) },
}));

import { recordUsage, __clearUsageCacheForTests } from "@/lib/usage-tracking";

describe("recordUsage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T10:00:00Z"));
    upsert.mockClear();
    __clearUsageCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes once per user/ip/ua/day", async () => {
    recordUsage("u1", "1.2.3.4", "Safari");
    recordUsage("u1", "1.2.3.4", "Safari");
    recordUsage("u1", "1.2.3.4", "Safari");
    await vi.runAllTimersAsync();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("distinct ip or ua writes separately", async () => {
    recordUsage("u1", "1.2.3.4", "Safari");
    recordUsage("u1", "5.6.7.8", "Safari");
    recordUsage("u1", "1.2.3.4", "Chrome");
    await vi.runAllTimersAsync();
    expect(upsert).toHaveBeenCalledTimes(3);
  });

  it("new day writes again", async () => {
    recordUsage("u1", "1.2.3.4", "Safari");
    await vi.runAllTimersAsync();
    vi.setSystemTime(new Date("2026-07-19T10:00:00Z"));
    recordUsage("u1", "1.2.3.4", "Safari");
    await vi.runAllTimersAsync();
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("swallows DB errors", async () => {
    upsert.mockRejectedValueOnce(new Error("boom"));
    expect(() => recordUsage("u1", "1.2.3.4", "Safari")).not.toThrow();
    await vi.runAllTimersAsync();
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement `lib/usage-tracking.ts`**

```ts
/**
 * Usage tracking for account-sharing signals. Fire-and-forget: records
 * one row per (user, ip, user-agent, day) in usage_sessions. An in-memory
 * dedupe cache keeps this to ~1 upsert per new combo per day per process.
 * Never blocks or fails a request.
 */

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db/core";
import { logger } from "@/lib/logger";

const seen = new Set<string>();
let seenDay = "";

/** Test hook — clears the dedupe cache. */
export function __clearUsageCacheForTests(): void {
  seen.clear();
  seenDay = "";
}

export function recordUsage(userId: string, ip: string, userAgent: string): void {
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== seenDay) {
      seen.clear();
      seenDay = day;
    }

    const uaHash = crypto.createHash("md5").update(userAgent).digest("hex");
    const key = `${userId}|${ip}|${uaHash}|${day}`;
    if (seen.has(key)) return;
    seen.add(key);

    const now = new Date().toISOString();
    void supabaseAdmin
      .from("usage_sessions")
      .upsert(
        { user_id: userId, ip, ua_hash: uaHash, day, first_seen: now, last_seen: now },
        { onConflict: "user_id,ip,ua_hash,day", ignoreDuplicates: false }
      )
      .then(({ error }) => {
        if (error) logger.warn("usage tracking write failed", { err: error.message });
      })
      .catch?.((err: unknown) => {
        logger.warn("usage tracking write failed", { err });
      });
  } catch (err) {
    logger.warn("usage tracking failed", { err });
  }
}
```

(If the supabase-js thenable lacks `.catch`, wrap in an async IIFE with try/catch instead — the invariant is: no thrown errors, no unhandled rejections. Adjust minimally to satisfy the tests.)

- [ ] **Step 3: Hook into `getCurrentUser`** — in `lib/auth.ts`:

```ts
import { headers } from "next/headers";
import { recordUsage } from "@/lib/usage-tracking";
```

In `getCurrentUser`, after resolving the user (before returning):

```ts
  const user = await getOrCreateUser({ /* …existing args unchanged… */ });

  try {
    const h = headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    recordUsage(user.id, ip, h.get("user-agent") ?? "unknown");
  } catch {
    // headers() unavailable in some contexts — tracking is best-effort
  }

  return user;
```

- [ ] **Step 4: Gate + commit**

Run: `npx vitest run && npm run type-check && npm run lint` → green (50 tests).

```bash
git add lib/usage-tracking.ts lib/__tests__/usage-tracking.test.ts lib/auth.ts
git commit -m "feat(admin): usage session tracking for sharing signals"
```

---

### Task 9: Admin dashboard + metrics repo

**Files:**
- Create: `lib/db/admin-metrics.ts`, `app/admin/page.tsx`

**Interfaces:**
- Consumes: `usage_sessions`, cancel columns, `requireUser`, `QUOTE_LIMIT`/`TIER_LABEL`.
- Produces: `/admin` (404 unless session email ∈ `ADMIN_EMAILS`).

- [ ] **Step 1: `lib/db/admin-metrics.ts`**

```ts
/**
 * Owner KPI queries (read-only, service-role). Small-scale by design —
 * aggregates in JS; revisit if user count makes this slow.
 */

import { supabaseAdmin } from "@/lib/db/core";

export interface SignupStats {
  total: number;
  last7: number;
  last30: number;
}

export async function getSignupStats(): Promise<SignupStats> {
  const since = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString();
  const base = () =>
    supabaseAdmin.from("users").select("id", { count: "exact", head: true }).is("deleted_at", null);

  const [{ count: total }, { count: last7 }, { count: last30 }] = await Promise.all([
    base(),
    base().gte("created_at", since(7)),
    base().gte("created_at", since(30)),
  ]);
  return { total: total ?? 0, last7: last7 ?? 0, last30: last30 ?? 0 };
}

export interface TierBreakdown {
  free: number;
  pro: number;
  ultimate: number;
  mrr: number;
}

export async function getTierBreakdown(): Promise<TierBreakdown> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("subscription_tier")
    .is("deleted_at", null);
  if (error) throw error;

  const counts = { free: 0, pro: 0, ultimate: 0 };
  for (const row of data ?? []) {
    const t = row.subscription_tier as keyof typeof counts;
    if (t in counts) counts[t]++;
  }
  return { ...counts, mrr: counts.pro * 15 + counts.ultimate * 29 };
}

export interface PendingCancellation {
  id: string;
  email: string;
  tier: string;
  currentPeriodEnd: string | null;
}

export async function getPendingCancellations(): Promise<PendingCancellation[]> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, email, subscription_tier, current_period_end")
    .eq("cancel_at_period_end", true)
    .is("deleted_at", null)
    .order("current_period_end", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    tier: r.subscription_tier,
    currentPeriodEnd: r.current_period_end,
  }));
}

export interface RecentSignup {
  id: string;
  email: string;
  tier: string;
  createdAt: string;
  quoteCount: number;
}

export async function getRecentSignups(limit = 20): Promise<RecentSignup[]> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, email, subscription_tier, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const users = data ?? [];
  const counts = await Promise.all(
    users.map(async (u) => {
      const { count } = await supabaseAdmin
        .from("quotes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", u.id)
        .is("deleted_at", null);
      return count ?? 0;
    })
  );
  return users.map((u, i) => ({
    id: u.id,
    email: u.email,
    tier: u.subscription_tier,
    createdAt: u.created_at,
    quoteCount: counts[i],
  }));
}

export interface SharingSignal {
  userId: string;
  email: string;
  tier: string;
  avgCombosPerActiveDay: number;
  concurrentIpDays: number;
}

/** Last-7-days sharing signals, strongest first. */
export async function getSharingSignals(): Promise<SharingSignal[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("usage_sessions")
    .select("user_id, ip, ua_hash, day")
    .gte("day", since);
  if (error) throw error;

  // Aggregate per user: combos per day, distinct IPs per day
  const byUserDay = new Map<string, Map<string, { combos: Set<string>; ips: Set<string> }>>();
  for (const row of data ?? []) {
    let days = byUserDay.get(row.user_id);
    if (!days) byUserDay.set(row.user_id, (days = new Map()));
    let d = days.get(row.day);
    if (!d) days.set(row.day, (d = { combos: new Set(), ips: new Set() }));
    d.combos.add(`${row.ip}|${row.ua_hash}`);
    d.ips.add(row.ip);
  }
  if (byUserDay.size === 0) return [];

  const userIds = [...byUserDay.keys()];
  const { data: users, error: uErr } = await supabaseAdmin
    .from("users")
    .select("id, email, subscription_tier")
    .in("id", userIds);
  if (uErr) throw uErr;
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  const signals: SharingSignal[] = [];
  for (const [userId, days] of byUserDay) {
    const u = userById.get(userId);
    if (!u) continue;
    let comboSum = 0;
    let concurrentIpDays = 0;
    for (const d of days.values()) {
      comboSum += d.combos.size;
      if (d.ips.size >= 2) concurrentIpDays++;
    }
    signals.push({
      userId,
      email: u.email,
      tier: u.subscription_tier,
      avgCombosPerActiveDay: Math.round((comboSum / days.size) * 10) / 10,
      concurrentIpDays,
    });
  }
  // Strongest signal first: concurrent-IP days, then combo average
  signals.sort(
    (a, b) =>
      b.concurrentIpDays - a.concurrentIpDays ||
      b.avgCombosPerActiveDay - a.avgCombosPerActiveDay
  );
  return signals;
}
```

- [ ] **Step 2: `app/admin/page.tsx`**

Server component; email gate first:

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  getSignupStats,
  getTierBreakdown,
  getPendingCancellations,
  getRecentSignups,
  getSharingSignals,
} from "@/lib/db/admin-metrics";
import { TIER_LABEL } from "@/lib/subscription";
import type { Tier } from "@/lib/subscription";

export const metadata = { title: "Admin — Quota" };
export const dynamic = "force-dynamic";

function isAdmin(email: string): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

export default async function AdminPage() {
  const user = await requireUser();
  if (!isAdmin(user.email)) notFound();

  const [signups, tiers, cancellations, recent, sharing] = await Promise.all([
    getSignupStats(),
    getTierBreakdown(),
    getPendingCancellations(),
    getRecentSignups(),
    getSharingSignals(),
  ]);

  return (
    <div className="container mx-auto px-4 py-8" data-testid="admin-page">
      {/* header + stat cards + tables — structure below */}
    </div>
  );
}
```

Render (plain Tailwind tables/cards matching the app's ledger look, `font-display` uppercase headings, `figure` class for numbers):
1. h1 "Admin" + eyebrow "The back office"; link-out button `https://dashboard.stripe.com` ("Revenue & fees → Stripe") with `target="_blank" rel="noopener noreferrer"`.
2. Stat cards grid: Total users, New (7d), New (30d), MRR `$${tiers.mrr}`, Free/Pro/Ultimate counts.
3. "Pending cancellations" table (`data-testid="pending-cancellations"`): email · tier label · ends date. Empty state: "None".
4. "Recent signups" table: email · tier · joined date · quotes count.
5. "Sharing signals" table (`data-testid="sharing-signals"`): email · tier · avg devices/day (`text-destructive` when ≥4) · concurrent-IP days (`text-destructive` when ≥2). Helper text under the heading: "Heuristics only — VPNs, mobile networks, and phone+laptop use cause false positives. Review before acting." Empty state: "No usage recorded yet."

Use `TIER_LABEL[row.tier as Tier] ?? row.tier` for tier display.

- [ ] **Step 3: Manual check + gate + commit**

`npm run dev`; visit `/admin` with your dev user — if your e2e/dev user's email isn't in `ADMIN_EMAILS` (unset locally so far), expect 404: correct. (Full visual pass happens post-merge once the controller sets `ADMIN_EMAILS` in `.env.local`.) Kill the server.

Run: `npx vitest run && npm run type-check && npm run lint` → green.

```bash
git add lib/db/admin-metrics.ts app/admin/page.tsx
git commit -m "feat(admin): owner KPI dashboard with sharing signals"
```

---

### Task 10: Env docs + e2e + full gate

**Files:**
- Create: `e2e/legal.spec.ts`
- Modify: `CLAUDE.md`, `.env.example`

- [ ] **Step 1: Env docs**

CLAUDE.md env block (after the Stripe section) and `.env.example` (both shipped blank):

```bash
# Ops
CRON_SECRET=     # guards /api/cron/* (openssl rand -hex 32)
ADMIN_EMAILS=    # comma-separated emails allowed into /admin
```

- [ ] **Step 2: `e2e/legal.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test.describe("legal pages (public)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [path, heading] of [
    ["/terms", "Terms of Service"],
    ["/privacy", "Privacy Policy"],
    ["/refunds", "Refund Policy"],
    ["/about", "About Quota"],
  ] as const) {
    test(`${path} renders without auth`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    });
  }
});

test.describe("admin gate", () => {
  test("non-admin user gets 404", async ({ page }) => {
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
  });
});
```

(The admin test runs with the default authenticated storage state; `ADMIN_EMAILS` is unset in the Playwright server env, so every user is non-admin — deterministic 404.)

- [ ] **Step 3: Full gate**

Stop any running dev server first (`reuseExistingServer: false` fails fast on a busy port 3000). Run in order:

```bash
npx vitest run
npm run type-check
npm run lint
npx playwright test e2e/legal.spec.ts
npx playwright test e2e/tiers.spec.ts
npx playwright test e2e/quote-flow.spec.ts
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .env.example e2e/legal.spec.ts
git commit -m "docs(env): cron + admin vars; e2e for legal pages and admin gate"
```

---

## Post-merge manual steps (controller + user)

1. Controller appends to `.env.local`: `CRON_SECRET=<openssl rand -hex 32>` and `ADMIN_EMAILS=${QUOTA_DMARC_REPORT_EMAIL}` (values visible to user).
2. Visual pass: `/terms` `/privacy` `/refunds` `/about` (logged out), dashboard footer links, `/admin` as the admin user (stat cards render), cancel notice (set `cancel_at_period_end` on the dev user or run a portal cancel in Stripe test mode).
3. Manual cron run: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reconcile-billing` → `{ success: true, checked: … }`.
