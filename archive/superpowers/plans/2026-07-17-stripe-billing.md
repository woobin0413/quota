# Stripe Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paid Stripe subscriptions for Pro ($15/mo) and Ultimate ($29/mo) via hosted Checkout + Customer Portal, with a signature-verified webhook as the only writer of paid tiers.

**Architecture:** A lazy Stripe client singleton (`lib/stripe.ts`) + a pure event-processing module (`lib/stripe-webhook.ts`) keep route handlers thin and unit-testable. Three new routes: `POST /api/billing/checkout`, `POST /api/billing/portal`, `POST /api/webhooks/stripe`. The existing self-serve `PATCH /api/subscription` gets locked behind `ALLOW_DEV_TIER_SWITCH=1`. UI: UpgradeDialog redirects to Checkout, paid users get "Manage billing" (Portal), dashboard shows a one-time banner on `?upgraded=1`.

**Tech Stack:** Next.js 14 App Router, `stripe` npm v14 (already installed at `^14.17.0`), Vitest, existing Supabase repos.

**Spec:** `docs/superpowers/specs/2026-07-16-stripe-billing-design.md`

## Global Constraints

- **The webhook is the ONLY writer of paid tiers.** No other code path may set `pro`/`ultimate` except the dev-flagged PATCH.
- `PATCH /api/subscription` first line: `if (process.env.ALLOW_DEV_TIER_SWITCH !== "1")` → 403 `{ code: "BILLING_REQUIRED", message: "Plan changes go through billing." }`.
- Checkout success URL: `${APP}/dashboard?upgraded=1`; cancel URL: `${APP}/dashboard`. APP = `process.env.APP_BASE_URL`.
- One subscription per customer: if any non-canceled subscription exists (active, past_due, trialing, unpaid — Stripe list default), checkout route sends the user to the Customer Portal instead of creating a second subscription.
- `cancel_at_period_end=true` does NOT change tier (period-end rule).
- Unknown webhook events → 200 (ack, ignore). Signature failure → 400. Handler errors → 500 (Stripe retries).
- Webhook signature verified against the RAW body (`await request.text()` before `constructEvent`).
- No client-supplied customer/price IDs — client sends tier enum only.
- Stripe env keys are read lazily (at call time, not import time) so builds/tests without keys don't crash.
- e2e stays Stripe-free: `tiers.spec.ts` keeps using the dev PATCH; the flag must be set in the Playwright-launched server env.
- No card data or custom payment UI — hosted Checkout/Portal only.
- Pinned Stripe API version: `"2023-10-16"` (matches stripe v14).
- Existing testids stay stable (`upgrade-to-pro`, `upgrade-to-ultimate`, `plan-row`, `upgrade-dialog`, etc.).
- Run `npm run type-check` and `npm run lint` before any task is considered done.

## File Structure

- Create: `lib/stripe.ts` — lazy client singleton, `PRICE_BY_TIER`, `tierByPriceId`
- Create: `lib/stripe-webhook.ts` — `processStripeEvent(event)` (pure event→repo-write logic)
- Create: `app/api/billing/checkout/route.ts`, `app/api/billing/portal/route.ts`, `app/api/webhooks/stripe/route.ts`
- Create: `components/subscription/UpgradedBanner.tsx` — one-time `?upgraded=1` dashboard banner
- Create: `lib/__tests__/stripe.test.ts`, `lib/__tests__/stripe-webhook.test.ts`
- Modify: `lib/db/users.ts` (add `setTierFromBilling`), `app/api/subscription/route.ts` (dev guard), `components/subscription/UpgradeDialog.tsx` (checkout redirect + portal link), `components/settings/ProfileForm.tsx` (Manage billing), `app/dashboard/page.tsx` (banner mount), `playwright.config.ts` (env flag), `CLAUDE.md` + `.env.example` (env docs)
- **No migration** — `users.stripe_customer_id` and `subscription_status` already exist (001), tier CHECK already `free|pro|ultimate` (009). `linkStripeCustomer` and `getUserByStripeCustomerId` already exist in `lib/db/users.ts`.
- **No middleware change** — `PUBLIC_ROUTES` already contains `/api/webhooks` with slash-boundary matching, which covers `/api/webhooks/stripe`. Verify only.

---

### Task 1: Stripe client module (`lib/stripe.ts`) + unit tests

**Files:**
- Create: `lib/stripe.ts`
- Test: `lib/__tests__/stripe.test.ts`

**Interfaces:**
- Produces: `getStripe(): Stripe` (lazy singleton, throws if `STRIPE_SECRET_KEY` unset), `PRICE_BY_TIER(): Record<"pro" | "ultimate", string>`, `tierByPriceId(priceId: string): "pro" | "ultimate" | null`. Later tasks import all three.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/stripe.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tierByPriceId, PRICE_BY_TIER } from "@/lib/stripe";

describe("tierByPriceId", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env.STRIPE_PRICE_PRO = "price_pro_test";
    process.env.STRIPE_PRICE_ULTIMATE = "price_ult_test";
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("maps the pro price id to pro", () => {
    expect(tierByPriceId("price_pro_test")).toBe("pro");
  });

  it("maps the ultimate price id to ultimate", () => {
    expect(tierByPriceId("price_ult_test")).toBe("ultimate");
  });

  it("returns null for an unknown price id", () => {
    expect(tierByPriceId("price_nope")).toBeNull();
  });

  it("PRICE_BY_TIER reads current env", () => {
    expect(PRICE_BY_TIER()).toEqual({
      pro: "price_pro_test",
      ultimate: "price_ult_test",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/stripe.test.ts`
Expected: FAIL — `Cannot find module '@/lib/stripe'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `lib/stripe.ts`:

```ts
/**
 * Stripe client + price↔tier mapping.
 *
 * All env reads are lazy (call time, not import time) so builds and unit
 * tests without Stripe keys never crash. The client is a per-process
 * singleton pinned to one API version.
 */

import Stripe from "stripe";

export type PaidTier = "pro" | "ultimate";

let stripeSingleton: Stripe | null = null;

/** Lazy Stripe client. Throws if STRIPE_SECRET_KEY is not configured. */
export function getStripe(): Stripe {
  if (!stripeSingleton) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeSingleton = new Stripe(key, { apiVersion: "2023-10-16" });
  }
  return stripeSingleton;
}

/** Price IDs per paid tier, read from env at call time. */
export function PRICE_BY_TIER(): Record<PaidTier, string> {
  return {
    pro: process.env.STRIPE_PRICE_PRO ?? "",
    ultimate: process.env.STRIPE_PRICE_ULTIMATE ?? "",
  };
}

/** Reverse lookup: Stripe price id → paid tier (null if unknown). */
export function tierByPriceId(priceId: string): PaidTier | null {
  const prices = PRICE_BY_TIER();
  if (priceId && priceId === prices.pro) return "pro";
  if (priceId && priceId === prices.ultimate) return "ultimate";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/stripe.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check, lint, commit**

Run: `npm run type-check && npm run lint`
Expected: clean.

```bash
git add lib/stripe.ts lib/__tests__/stripe.test.ts
git commit -m "feat(billing): stripe client singleton + price/tier mapping"
```

---

### Task 2: `setTierFromBilling` repo helper + lock the dev PATCH

**Files:**
- Modify: `lib/db/users.ts` (add one function after `updateSubscription`, ~line 397)
- Modify: `app/api/subscription/route.ts` (PATCH guard)
- Modify: `playwright.config.ts` (env flag for the dev-server the tests launch)

**Interfaces:**
- Consumes: existing `updateSubscription`, `NotFoundError`, `supabaseAdmin`, `transformUser` patterns in `lib/db/users.ts`.
- Produces: `setTierFromBilling(userId: string, tier: SubscriptionTier, status: string): Promise<void>` — Task 4's webhook processor calls this. PATCH `/api/subscription` now returns 403 `{ code: "BILLING_REQUIRED" }` unless `ALLOW_DEV_TIER_SWITCH === "1"`.

- [ ] **Step 1: Add `setTierFromBilling` to `lib/db/users.ts`**

Insert after the `updateSubscription` function:

```ts
/**
 * Set tier + subscription status from billing (Stripe webhook).
 * This is the ONLY intended production writer of paid tiers.
 */
export async function setTierFromBilling(
  userId: string,
  tier: SubscriptionTier,
  status: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("users")
    .update({ subscription_tier: tier, subscription_status: status })
    .eq("id", userId);

  if (error) {
    throw error;
  }
}
```

- [ ] **Step 2: Guard the PATCH**

In `app/api/subscription/route.ts`, inside `PATCH`, immediately after the auth check (`if (!user) return unauthorized();` / `userId = user.id;`), add:

```ts
    // Billing gate: outside dev/e2e, plan changes go through Stripe only.
    if (process.env.ALLOW_DEV_TIER_SWITCH !== "1") {
      return NextResponse.json(
        {
          success: false,
          code: "BILLING_REQUIRED",
          message: "Plan changes go through billing.",
        },
        { status: 403 }
      );
    }
```

Also update the route's header comment: PATCH is now dev/e2e-only (`ALLOW_DEV_TIER_SWITCH=1`); production plan changes come from the Stripe webhook.

- [ ] **Step 3: Set the flag for Playwright's dev server**

In `playwright.config.ts`, find the `webServer` block. If it has an `env` object, add `ALLOW_DEV_TIER_SWITCH: "1"`; if not, add one that spreads the parent env:

```ts
  webServer: {
    // ...existing fields unchanged...
    env: {
      ...process.env,
      ALLOW_DEV_TIER_SWITCH: "1",
    },
  },
```

(`.env.local` already carries `ALLOW_DEV_TIER_SWITCH=1` for manual dev; this makes the e2e-launched server independent of that file.)

- [ ] **Step 4: Verify existing suites still pass**

Run: `npx vitest run`
Expected: all existing unit tests pass (no new unit tests in this task; the guard is exercised by e2e in Task 6).

Run: `npm run type-check && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/users.ts app/api/subscription/route.ts playwright.config.ts
git commit -m "feat(billing): setTierFromBilling helper; lock dev tier switch behind ALLOW_DEV_TIER_SWITCH"
```

---

### Task 3: Checkout + Portal routes

**Files:**
- Create: `app/api/billing/checkout/route.ts`
- Create: `app/api/billing/portal/route.ts`

**Interfaces:**
- Consumes: `getStripe`, `PRICE_BY_TIER` from Task 1; `getCurrentUser` from `@/lib/auth`; `linkStripeCustomer` from `@/lib/db/users`; `parseJsonBody` from `@/lib/api-validation`; `logger` from `@/lib/logger`.
- Produces: `POST /api/billing/checkout` body `{ tier: "pro" | "ultimate" }` → `{ success: true, url }` (Checkout URL, or Portal URL when an active subscription already exists). `POST /api/billing/portal` (no body) → `{ success: true, url }`. Task 5's UI calls both.

- [ ] **Step 1: Create `app/api/billing/checkout/route.ts`**

```ts
/**
 * Billing Checkout Route
 *
 * POST /api/billing/checkout { tier: "pro" | "ultimate" }
 * → { success, url } — Stripe-hosted Checkout for a new subscription.
 *
 * One subscription per customer: if the user already has an active
 * subscription (e.g. pro → ultimate change), we return a Customer Portal
 * URL instead of creating a second subscription.
 *
 * @module api/billing/checkout
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { getStripe, PRICE_BY_TIER } from "@/lib/stripe";
import { linkStripeCustomer } from "@/lib/db/users";
import { logger } from "@/lib/logger";

const bodySchema = z.object({ tier: z.enum(["pro", "ultimate"]) });

export async function POST(request: NextRequest) {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    userId = user.id;

    const parsed = await parseJsonBody(request, bodySchema);
    if (parsed.response) return parsed.response;
    const { tier } = parsed.data;

    const stripe = getStripe();
    const appUrl = process.env.APP_BASE_URL || "http://localhost:3000";

    // Find-or-create the Stripe customer for this user.
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await linkStripeCustomer(user.id, customerId);
    }

    // One subscription per customer: active sub → Portal, not a second Checkout.
    const existing = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    if (existing.data.length > 0) {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${appUrl}/dashboard`,
      });
      return NextResponse.json({ success: true, url: portal.url });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: PRICE_BY_TIER()[tier], quantity: 1 }],
      success_url: `${appUrl}/dashboard?upgraded=1`,
      cancel_url: `${appUrl}/dashboard`,
      metadata: { userId: user.id },
      subscription_data: { metadata: { userId: user.id } },
    });

    return NextResponse.json({ success: true, url: session.url });
  } catch (error) {
    logger.error("Billing checkout error", {
      err: error,
      route: "POST /api/billing/checkout",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Could not start checkout", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Create `app/api/billing/portal/route.ts`**

```ts
/**
 * Billing Portal Route
 *
 * POST /api/billing/portal → { success, url } — Stripe Customer Portal
 * (manage plan, payment method, cancel). Requires an existing Stripe
 * customer; free users who never checked out get a 400.
 *
 * @module api/billing/portal
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { logger } from "@/lib/logger";

export async function POST() {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    userId = user.id;

    if (!user.stripe_customer_id) {
      return NextResponse.json(
        { success: false, message: "No billing account yet", code: "NO_BILLING_ACCOUNT" },
        { status: 400 }
      );
    }

    const appUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    const portal = await getStripe().billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${appUrl}/dashboard`,
    });

    return NextResponse.json({ success: true, url: portal.url });
  } catch (error) {
    logger.error("Billing portal error", {
      err: error,
      route: "POST /api/billing/portal",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Could not open billing portal", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: clean. (These routes are exercised manually in test mode — Task 6 — and their UI callers land in Task 5. No unit tests: they are thin Stripe-API pass-throughs; mocking the whole Stripe client here buys nothing.)

- [ ] **Step 4: Commit**

```bash
git add app/api/billing/checkout/route.ts app/api/billing/portal/route.ts
git commit -m "feat(billing): checkout + customer portal routes"
```

---

### Task 4: Webhook — `lib/stripe-webhook.ts` + route + unit tests

**Files:**
- Create: `lib/stripe-webhook.ts`
- Create: `app/api/webhooks/stripe/route.ts`
- Test: `lib/__tests__/stripe-webhook.test.ts`

**Interfaces:**
- Consumes: `getStripe`, `tierByPriceId` from Task 1; `setTierFromBilling` (Task 2), `getUserByStripeCustomerId`, `linkStripeCustomer` from `@/lib/db/users`; `logger`.
- Produces: `processStripeEvent(event: Stripe.Event): Promise<void>` — the route verifies the signature and delegates here. Middleware already exposes `/api/webhooks/stripe` publicly (verify, don't change).

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/stripe-webhook.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const setTierFromBilling = vi.fn();
const getUserByStripeCustomerId = vi.fn();
const linkStripeCustomer = vi.fn();
const subscriptionsRetrieve = vi.fn();

vi.mock("@/lib/db/users", () => ({
  setTierFromBilling: (...a: unknown[]) => setTierFromBilling(...a),
  getUserByStripeCustomerId: (...a: unknown[]) => getUserByStripeCustomerId(...a),
  linkStripeCustomer: (...a: unknown[]) => linkStripeCustomer(...a),
}));

vi.mock("@/lib/stripe", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stripe")>();
  return {
    ...mod,
    getStripe: () => ({
      subscriptions: { retrieve: (...a: unknown[]) => subscriptionsRetrieve(...a) },
    }),
  };
});

import { processStripeEvent } from "@/lib/stripe-webhook";
import type Stripe from "stripe";

function makeSubscription(priceId: string, status = "active") {
  return {
    id: "sub_1",
    customer: "cus_1",
    status,
    metadata: { userId: "user-1" },
    items: { data: [{ price: { id: priceId } }] },
  };
}

describe("processStripeEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_PRO = "price_pro_test";
    process.env.STRIPE_PRICE_ULTIMATE = "price_ult_test";
  });

  it("checkout.session.completed sets tier from the subscription price", async () => {
    subscriptionsRetrieve.mockResolvedValue(makeSubscription("price_pro_test"));
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata: { userId: "user-1" },
        },
      },
    } as unknown as Stripe.Event;

    await processStripeEvent(event);

    expect(setTierFromBilling).toHaveBeenCalledWith("user-1", "pro", "active");
    expect(linkStripeCustomer).toHaveBeenCalledWith("user-1", "cus_1");
  });

  it("customer.subscription.updated re-derives tier and maps status", async () => {
    const event = {
      type: "customer.subscription.updated",
      data: { object: makeSubscription("price_ult_test", "past_due") },
    } as unknown as Stripe.Event;

    await processStripeEvent(event);

    expect(setTierFromBilling).toHaveBeenCalledWith("user-1", "ultimate", "past_due");
  });

  it("cancel_at_period_end does not drop the tier", async () => {
    const sub = { ...makeSubscription("price_pro_test"), cancel_at_period_end: true };
    const event = {
      type: "customer.subscription.updated",
      data: { object: sub },
    } as unknown as Stripe.Event;

    await processStripeEvent(event);

    // Still active on pro — tier unchanged until deletion.
    expect(setTierFromBilling).toHaveBeenCalledWith("user-1", "pro", "active");
  });

  it("customer.subscription.deleted downgrades to free/canceled", async () => {
    const event = {
      type: "customer.subscription.deleted",
      data: { object: makeSubscription("price_pro_test", "canceled") },
    } as unknown as Stripe.Event;

    await processStripeEvent(event);

    expect(setTierFromBilling).toHaveBeenCalledWith("user-1", "free", "canceled");
  });

  it("falls back to customer lookup when metadata has no userId", async () => {
    getUserByStripeCustomerId.mockResolvedValue({ id: "user-2" });
    const sub = makeSubscription("price_pro_test");
    sub.metadata = {} as never;
    const event = {
      type: "customer.subscription.updated",
      data: { object: sub },
    } as unknown as Stripe.Event;

    await processStripeEvent(event);

    expect(getUserByStripeCustomerId).toHaveBeenCalledWith("cus_1");
    expect(setTierFromBilling).toHaveBeenCalledWith("user-2", "pro", "active");
  });

  it("unknown price id on update writes nothing", async () => {
    const event = {
      type: "customer.subscription.updated",
      data: { object: makeSubscription("price_mystery") },
    } as unknown as Stripe.Event;

    await processStripeEvent(event);

    expect(setTierFromBilling).not.toHaveBeenCalled();
  });

  it("unknown event types are ignored", async () => {
    const event = {
      type: "invoice.finalized",
      data: { object: {} },
    } as unknown as Stripe.Event;

    await processStripeEvent(event);

    expect(setTierFromBilling).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/stripe-webhook.test.ts`
Expected: FAIL — `Cannot find module '@/lib/stripe-webhook'`.

- [ ] **Step 3: Create `lib/stripe-webhook.ts`**

```ts
/**
 * Stripe webhook event processing — the ONLY production writer of paid
 * tiers. Kept route-free so the event→action mapping is unit-testable.
 *
 * Rules (spec: 2026-07-16-stripe-billing-design.md):
 * - Tier always derives from the subscription's current price.
 * - cancel_at_period_end does NOT change tier (period-end rule).
 * - subscription.deleted → free/canceled.
 * - Unknown events and unknown prices are ignored (logged).
 * - Writes are absolute sets → idempotent under Stripe retries.
 */

import type Stripe from "stripe";
import { getStripe, tierByPriceId } from "@/lib/stripe";
import {
  setTierFromBilling,
  getUserByStripeCustomerId,
  linkStripeCustomer,
} from "@/lib/db/users";
import { logger } from "@/lib/logger";

/** Resolve our user id from subscription metadata or the Stripe customer. */
async function resolveUserId(
  metadataUserId: string | undefined,
  customerId: string
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  const user = await getUserByStripeCustomerId(customerId);
  return user?.id ?? null;
}

function customerIdOf(sub: Stripe.Subscription): string {
  return typeof sub.customer === "string" ? sub.customer : sub.customer.id;
}

/** Apply a subscription's current price + status to our user row. */
async function syncFromSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(sub);
  const userId = await resolveUserId(sub.metadata?.userId, customerId);
  if (!userId) {
    logger.error("Stripe webhook: no user for customer", { customerId, subId: sub.id });
    return;
  }

  const priceId = sub.items.data[0]?.price?.id ?? "";
  const tier = tierByPriceId(priceId);
  if (!tier) {
    logger.error("Stripe webhook: unknown price id", { priceId, subId: sub.id });
    return;
  }

  await setTierFromBilling(userId, tier, sub.status);
}

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!customerId || !subscriptionId) {
        logger.error("Stripe webhook: checkout session missing refs", {
          sessionId: session.id,
        });
        return;
      }

      const userId = await resolveUserId(session.metadata?.userId, customerId);
      if (!userId) {
        logger.error("Stripe webhook: no user for checkout session", {
          sessionId: session.id,
          customerId,
        });
        return;
      }

      await linkStripeCustomer(userId, customerId);

      const sub = (await getStripe().subscriptions.retrieve(
        subscriptionId
      )) as Stripe.Subscription;
      const priceId = sub.items.data[0]?.price?.id ?? "";
      const tier = tierByPriceId(priceId);
      if (!tier) {
        logger.error("Stripe webhook: unknown price id", { priceId, subId: sub.id });
        return;
      }
      await setTierFromBilling(userId, tier, sub.status);
      return;
    }

    case "customer.subscription.updated": {
      await syncFromSubscription(event.data.object as Stripe.Subscription);
      return;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(sub.metadata?.userId, customerIdOf(sub));
      if (!userId) {
        logger.error("Stripe webhook: no user for deleted subscription", {
          subId: sub.id,
        });
        return;
      }
      await setTierFromBilling(userId, "free", "canceled");
      return;
    }

    default:
      // Unknown events are acked and ignored.
      return;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/stripe-webhook.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Create `app/api/webhooks/stripe/route.ts`**

```ts
/**
 * Stripe Webhook Handler — POST /api/webhooks/stripe
 *
 * Signature-verified against the RAW request body. This route (via
 * processStripeEvent) is the only production writer of paid tiers.
 *
 * Setup:
 * - Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
 *   → copy the printed whsec_… into STRIPE_WEBHOOK_SECRET.
 * - Prod: Dashboard → Developers → Webhooks → add endpoint for
 *   checkout.session.completed, customer.subscription.updated,
 *   customer.subscription.deleted.
 *
 * Responses: 400 bad signature/config · 200 processed or ignored ·
 * 500 handler error (Stripe retries).
 */

import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { processStripeEvent } from "@/lib/stripe-webhook";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("Stripe webhook: STRIPE_WEBHOOK_SECRET not configured", {
      route: "POST /api/webhooks/stripe",
    });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Raw body BEFORE any JSON parsing — required for signature verification.
  const rawBody = await request.text();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    logger.warn("Stripe webhook: signature verification failed", {
      err: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    await processStripeEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error("Stripe webhook: handler error", {
      err: error,
      eventType: event.type,
      eventId: event.id,
    });
    // 500 → Stripe retries; their retry schedule is the recovery mechanism.
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Verify middleware exposure (no change expected)**

Run: `grep -n "api/webhooks" middleware.ts`
Expected: `PUBLIC_ROUTES` contains `"/api/webhooks"` — slash-boundary matching already covers `/api/webhooks/stripe`. Do NOT edit middleware. If (unexpectedly) absent, stop and report BLOCKED.

- [ ] **Step 7: Full unit suite + type-check + lint**

Run: `npx vitest run && npm run type-check && npm run lint`
Expected: all pass, clean.

- [ ] **Step 8: Commit**

```bash
git add lib/stripe-webhook.ts app/api/webhooks/stripe/route.ts lib/__tests__/stripe-webhook.test.ts
git commit -m "feat(billing): stripe webhook — signature-verified sole writer of paid tiers"
```

---

### Task 5: UI — Checkout redirect, Manage billing, upgraded banner

**Files:**
- Modify: `components/subscription/UpgradeDialog.tsx`
- Modify: `components/settings/ProfileForm.tsx` (PlanRow button, ~line 265-285)
- Create: `components/subscription/UpgradedBanner.tsx`
- Modify: `app/dashboard/page.tsx` (mount banner)

**Interfaces:**
- Consumes: `POST /api/billing/checkout { tier }` → `{ success, url }`; `POST /api/billing/portal` → `{ success, url }` (Task 3); `useSubscription()` hook from `components/subscription/use-subscription.ts` (existing).
- Produces: UpgradeDialog paid buttons redirect to Stripe (`window.location.href = url`); paid-tier users see "Manage billing" (dialog footer + settings PlanRow); dashboard shows a one-time banner on `?upgraded=1` reading live tier from the API. Existing testids unchanged; new testids `manage-billing-link`, `manage-billing-button`, `upgraded-banner`.

- [ ] **Step 1: Repoint UpgradeDialog to Checkout**

In `components/subscription/UpgradeDialog.tsx`:

1. Replace the `choose` function body — PATCH → checkout redirect (`useRouter` import and `router` become unused; remove them):

```ts
  const choose = async (tier: Tier) => {
    if (tier === "free") return; // downgrades go through the portal
    setBusy(tier);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.url) {
        throw new Error(data.message || "Could not start checkout");
      }
      // Hard redirect to Stripe-hosted Checkout (or Portal for plan changes).
      window.location.href = data.url;
      // Keep the spinner during navigation — no setBusy(null) on success.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setBusy(null);
    }
  };
```

Note: delete the existing `finally { setBusy(null); }` — on success the page navigates away and the spinner should persist; on error the catch resets it.

2. Add a `manageBilling` handler and a footer link for paid users. Add state `const [portalBusy, setPortalBusy] = useState(false);` and:

```ts
  const manageBilling = async () => {
    setPortalBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.url) {
        throw new Error(data.message || "Could not open billing portal");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal");
      setPortalBusy(false);
    }
  };
```

3. After the plan-cards grid (before the error `<p>`), render for paid current tiers only:

```tsx
        {currentTier !== "free" && (
          <button
            type="button"
            onClick={manageBilling}
            disabled={portalBusy}
            className="text-left text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
            data-testid="manage-billing-link"
          >
            {portalBusy ? "Opening billing portal…" : "Manage billing"}
          </button>
        )}
```

4. Update the file's header comment: buttons now start Stripe Checkout; the webhook flips the tier after payment.

- [ ] **Step 2: PlanRow "Manage billing" for paid tiers**

In `components/settings/ProfileForm.tsx`, PlanRow currently renders one `Upgrade` button (~line 283). Make it tier-aware — paid tiers open the portal, free keeps the upgrade dialog:

```tsx
function PlanRow({ sub, onUpgrade }: { sub: Subscription; onUpgrade: () => void }) {
  // ...existing display line unchanged...
  const isPaid = sub.tier !== "free";
  const [portalBusy, setPortalBusy] = useState(false);

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.url) {
        window.location.href = data.url;
        return;
      }
    } catch {
      // fall through to reset
    }
    setPortalBusy(false);
  };

  // button:
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={isPaid ? openPortal : onUpgrade}
    disabled={portalBusy}
    data-testid={isPaid ? "manage-billing-button" : undefined}
  >
    {isPaid ? (portalBusy ? "Opening…" : "Manage billing") : "Upgrade"}
  </Button>
}
```

Integrate with the actual existing JSX (keep `data-testid="plan-row"` and the display copy untouched; only the button changes).

- [ ] **Step 3: Create `components/subscription/UpgradedBanner.tsx`**

```tsx
"use client";

/**
 * One-time success banner after Stripe Checkout returns to
 * /dashboard?upgraded=1. Copy reads the LIVE tier from the API (the
 * webhook may lag the redirect by seconds), then strips the param.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { useSubscription } from "./use-subscription";

export function UpgradedBanner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const upgraded = searchParams.get("upgraded") === "1";
  const [show, setShow] = useState(false);
  const { sub } = useSubscription();

  useEffect(() => {
    if (upgraded) {
      setShow(true);
      // Strip the param so refresh/back doesn't re-trigger the banner.
      router.replace("/dashboard", { scroll: false });
    }
  }, [upgraded, router]);

  if (!show || !sub) return null;

  const line =
    sub.quoteLimit === null
      ? `You're on ${sub.tierLabel} — unlimited quotes.`
      : `You're on ${sub.tierLabel} — ${sub.quoteLimit} quotes.`;

  return (
    <div
      role="status"
      data-testid="upgraded-banner"
      className="mb-6 flex items-center gap-2 border border-accent bg-accent/10 px-4 py-3 text-sm"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span>{line}</span>
    </div>
  );
}
```

If `useSubscription` still reports the old (free) tier because the webhook hasn't landed, the banner shows the API truth — acceptable seconds-level lag per spec. Note: `sub.tier`/`sub.tierLabel`/`sub.quoteLimit` come from the existing `Subscription` type in `use-subscription.ts` — check exact field names before wiring.

- [ ] **Step 4: Mount the banner on the dashboard**

In `app/dashboard/page.tsx`, inside the returned container above the header block (`useSearchParams` requires a Suspense boundary in a server page):

```tsx
import { UpgradedBanner } from "@/components/subscription/UpgradedBanner";

// inside the top-level <div className="container ...">, first child:
<Suspense fallback={null}>
  <UpgradedBanner />
</Suspense>
```

(`Suspense` is already imported in this file.)

- [ ] **Step 5: Verify + commit**

Run: `npm run type-check && npm run lint && npx vitest run`
Expected: clean, all unit tests pass.

```bash
git add components/subscription/UpgradeDialog.tsx components/subscription/UpgradedBanner.tsx components/settings/ProfileForm.tsx app/dashboard/page.tsx
git commit -m "feat(billing): checkout redirect, manage-billing portal links, upgraded banner"
```

---

### Task 6: Env docs + e2e repair + full gate

**Files:**
- Modify: `CLAUDE.md` (env section), `.env.example` (if the file exists; create only the Stripe block addition, do not invent unrelated keys)
- Modify: `e2e/tiers.spec.ts` (~line 51) — the in-dialog upgrade test
- Verify: whole suite

**e2e repair (required — Task 5 broke this test by design):** the test that clicks `upgrade-to-ultimate` and expects an in-app tier flip now gets a Stripe Checkout redirect instead. Rewrite that test to: (1) still open the UpgradeDialog and assert the plan cards + `upgrade-to-ultimate` button render (UI smoke), then close the dialog; (2) flip the tier via the API instead — `await request.patch("/api/subscription", { data: { tier: "ultimate" } })` (the dev PATCH works because Playwright's server has `ALLOW_DEV_TIER_SWITCH=1`); (3) keep the original post-upgrade assertions (save succeeds etc.) unchanged. Do NOT stub or mock `/api/billing/checkout`. The other tests in the spec are already API-driven — leave them alone.

**Interfaces:**
- Consumes: everything above.
- Produces: documented env vars; green gate.

- [ ] **Step 1: Document env vars**

In `CLAUDE.md`'s Environment Variables block, after the Email section, add:

```bash
# Stripe (test mode; swap to live at launch)
STRIPE_SECRET_KEY=       # sk_test_… (Dashboard → Developers → API keys)
STRIPE_PRICE_PRO=        # price_… for Quota Pro $15/mo
STRIPE_PRICE_ULTIMATE=   # price_… for Quota Ultimate $29/mo
STRIPE_WEBHOOK_SECRET=   # whsec_… from `stripe listen` (dev) or dashboard endpoint (prod)
ALLOW_DEV_TIER_SWITCH=1  # dev/e2e only — enables PATCH /api/subscription; NEVER set in prod
```

Mirror the same block into `.env.example` if that file exists (check with `ls .env.example`; skip silently if absent).

- [ ] **Step 2: Full gate**

Run, in order:

```bash
npx vitest run
npm run type-check
npm run lint
npx playwright test e2e/tiers.spec.ts
npx playwright test e2e/quote-flow.spec.ts
```

Expected: all green. `tiers.spec.ts` exercises the dev PATCH — it must still pass because `playwright.config.ts` now injects `ALLOW_DEV_TIER_SWITCH=1` (Task 2). If it fails with 403 `BILLING_REQUIRED`, the env injection didn't reach the dev server — fix the `webServer.env` block, don't weaken the guard.

Note: Playwright kills anything on port 3000 when it starts its dev server (known `npm run dev` script behavior).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "docs(billing): stripe env vars"
```

---

## Manual verification (controller, after all tasks — NOT a subagent step)

Requires the user's Stripe test keys (already in `.env.local`) and two terminals:

1. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` → copy `whsec_…` into `STRIPE_WEBHOOK_SECRET` in `.env.local` (user does this; Stripe CLI may need `brew install stripe/stripe-cli/stripe` + `stripe login`).
2. `npm run dev`, set the e2e user to `free` (or use the dev PATCH), open UpgradeDialog → Upgrade to Pro → Stripe Checkout appears → pay with `4242 4242 4242 4242`, any future expiry, any CVC.
3. Redirect lands on `/dashboard?upgraded=1` → banner "You're on Pro — 15 quotes."; badge/chip show Pro after the webhook lands (seconds).
4. Settings → plan row shows "Manage billing" → opens Stripe Customer Portal; cancel there → `customer.subscription.deleted` (immediate-cancel in test dashboard) → tier back to free.
5. With `ALLOW_DEV_TIER_SWITCH` removed from env, `curl -X PATCH /api/subscription` → 403 `BILLING_REQUIRED` (restore the flag after).
