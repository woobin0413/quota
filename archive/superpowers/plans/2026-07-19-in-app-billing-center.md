# In-App Billing Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Stripe's hosted Customer Portal + Checkout redirects with a dedicated in-app `/billing` page (plan, payment method via Stripe Elements, invoice history, plan changes, cancel/reactivate) backed by server-side Stripe API calls.

**Architecture:** A `/billing` page composed of three sections, each backed by billing API routes that call Stripe. Pure mapping/decision logic is extracted into `lib/billing/*` for unit testing. Card entry uses Stripe Elements (SetupIntent) so no raw card touches our backend. The Stripe webhook (`setTierFromBilling`) remains the ONLY writer of subscription tier; routes mutate Stripe and the webhook syncs the DB.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Tailwind + shadcn/ui, Stripe Node SDK (`2023-10-16`), `@stripe/stripe-js` + `@stripe/react-stripe-js`, Vitest (node-env), Playwright.

## Global Constraints

- **Sole-writer invariant:** no route may write `subscription_tier` / `cancel_at_period_end` / `current_period_end`. Only `setTierFromBilling` (from the webhook / reconcile) writes tier. Routes call Stripe; webhook syncs.
- **No raw card data in our backend** — card entry is Stripe Elements only (SetupIntent + client tokenization). Never accept a PAN.
- **Every billing route:** `getCurrentUser()` → 401 guard, then `checkRateLimit(\`billing:${user.id}\`, { maxRequests: 10 })` → 429, then Stripe.
- **Plan change:** upgrade = immediate + prorated; downgrade (ultimate→pro) = scheduled to period end; downgrade to free = cancel at period end.
- Zod-validate all route input. TypeScript strict. Stripe API version stays `2023-10-16` (set in `lib/stripe.ts`).
- No new DB columns. Pending-downgrade state is read live from the Stripe subscription schedule.
- NO Claude/AI attribution in any commit message.
- Run `npm run type-check` + `npm run lint` before a task is done.

## Interfaces defined here (used across tasks)

- `Tier = "free" | "pro" | "ultimate"` (from `@/lib/subscription`).
- `PaidTier = "pro" | "ultimate"` (from `@/lib/stripe`).
- `TIER_PRICE`, `TIER_LABEL`, `QUOTE_LIMIT`, `TIERS` from `@/lib/subscription`.
- `getStripe()`, `PRICE_BY_TIER()`, `tierByPriceId(priceId)`, `getActiveSubscription(customerId)` from `@/lib/stripe`.
- `linkStripeCustomer(userId, customerId)` from `@/lib/db/users`.

---

### Task 1: Plan-change decision logic (pure)

**Files:**
- Create: `lib/billing/plan-change.ts`
- Test: `lib/__tests__/plan-change.test.ts`

**Interfaces:**
- Produces: `planChange(current: Tier, target: Tier): PlanChange` where
  ```ts
  type PlanChange =
    | { kind: "noop" }
    | { kind: "upgrade"; target: PaidTier }
    | { kind: "downgrade"; target: PaidTier }
    | { kind: "cancel" };
  ```
  Ordering: free < pro < ultimate. Same tier → noop. Higher target → upgrade. Lower target that is still paid → downgrade. Target free → cancel.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/plan-change.test.ts
import { describe, it, expect } from "vitest";
import { planChange } from "@/lib/billing/plan-change";

describe("planChange", () => {
  it("same tier → noop", () => {
    expect(planChange("pro", "pro")).toEqual({ kind: "noop" });
  });
  it("free → pro is an upgrade", () => {
    expect(planChange("free", "pro")).toEqual({ kind: "upgrade", target: "pro" });
  });
  it("pro → ultimate is an upgrade", () => {
    expect(planChange("pro", "ultimate")).toEqual({ kind: "upgrade", target: "ultimate" });
  });
  it("ultimate → pro is a downgrade", () => {
    expect(planChange("ultimate", "pro")).toEqual({ kind: "downgrade", target: "pro" });
  });
  it("pro → free is a cancel", () => {
    expect(planChange("pro", "free")).toEqual({ kind: "cancel" });
  });
  it("free → free is noop", () => {
    expect(planChange("free", "free")).toEqual({ kind: "noop" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/plan-change.test.ts`
Expected: FAIL — cannot resolve `@/lib/billing/plan-change`.

- [ ] **Step 3: Implement**

```ts
// lib/billing/plan-change.ts
/**
 * Pure decision logic for a plan change. Maps (current, target) tiers to the
 * billing action to take. No Stripe calls here — the route acts on this.
 */
import type { Tier } from "@/lib/subscription";
import type { PaidTier } from "@/lib/stripe";

export type PlanChange =
  | { kind: "noop" }
  | { kind: "upgrade"; target: PaidTier }
  | { kind: "downgrade"; target: PaidTier }
  | { kind: "cancel" };

const RANK: Record<Tier, number> = { free: 0, pro: 1, ultimate: 2 };

export function planChange(current: Tier, target: Tier): PlanChange {
  if (current === target) return { kind: "noop" };
  if (target === "free") return { kind: "cancel" };
  // target is paid here
  if (RANK[target] > RANK[current]) return { kind: "upgrade", target };
  return { kind: "downgrade", target };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/plan-change.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/plan-change.ts lib/__tests__/plan-change.test.ts
git commit -m "feat(billing): pure plan-change decision logic"
```

---

### Task 2: Summary + invoice mappers (pure)

**Files:**
- Create: `lib/billing/summary.ts`
- Test: `lib/__tests__/billing-summary.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface CardSummary { brand: string; last4: string; expMonth: number; expYear: number; }
  interface BillingSummary {
    tier: Tier; tierLabel: string; price: string;
    status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
    pendingDowngradeTier: Tier | null; pendingChangeDate: string | null;
    paymentMethod: CardSummary | null;
  }
  interface InvoiceRow { id: string; number: string | null; created: string; amountPaid: number; currency: string; status: string; pdfUrl: string | null; }
  function toCardSummary(pm: Stripe.PaymentMethod | null): CardSummary | null
  function toInvoiceRows(invoices: Stripe.Invoice[]): InvoiceRow[]
  ```
  `toCardSummary` returns null when pm/pm.card missing. `toInvoiceRows` maps each invoice: created = ISO from epoch, amountPaid = `amount_paid` in major units (cents/100), pdfUrl = `invoice_pdf ?? null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/billing-summary.test.ts
import { describe, it, expect } from "vitest";
import { toCardSummary, toInvoiceRows } from "@/lib/billing/summary";

describe("toCardSummary", () => {
  it("maps a card payment method", () => {
    const pm = { card: { brand: "visa", last4: "4242", exp_month: 8, exp_year: 2027 } } as never;
    expect(toCardSummary(pm)).toEqual({ brand: "visa", last4: "4242", expMonth: 8, expYear: 2027 });
  });
  it("returns null when no card", () => {
    expect(toCardSummary(null)).toBeNull();
    expect(toCardSummary({ card: null } as never)).toBeNull();
  });
});

describe("toInvoiceRows", () => {
  it("maps invoices to rows with ISO date + major-unit amount", () => {
    const rows = toInvoiceRows([
      { id: "in_1", number: "A-1", created: 1_700_000_000, amount_paid: 1500, currency: "usd", status: "paid", invoice_pdf: "https://x/pdf" } as never,
    ]);
    expect(rows).toEqual([
      { id: "in_1", number: "A-1", created: new Date(1_700_000_000 * 1000).toISOString(), amountPaid: 15, currency: "usd", status: "paid", pdfUrl: "https://x/pdf" },
    ]);
  });
  it("tolerates missing number/pdf", () => {
    const [row] = toInvoiceRows([{ id: "in_2", number: null, created: 1, amount_paid: 0, currency: "usd", status: "open", invoice_pdf: null } as never]);
    expect(row.number).toBeNull();
    expect(row.pdfUrl).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/billing-summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/billing/summary.ts
/**
 * Pure mappers from Stripe objects to the billing UI's summary + invoice
 * shapes. No Stripe calls — the route fetches, these translate.
 */
import type Stripe from "stripe";
import type { Tier } from "@/lib/subscription";

export interface CardSummary { brand: string; last4: string; expMonth: number; expYear: number; }

export interface BillingSummary {
  tier: Tier;
  tierLabel: string;
  price: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingDowngradeTier: Tier | null;
  pendingChangeDate: string | null;
  paymentMethod: CardSummary | null;
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  created: string;
  amountPaid: number;
  currency: string;
  status: string;
  pdfUrl: string | null;
}

export function toCardSummary(pm: Stripe.PaymentMethod | null): CardSummary | null {
  const card = pm?.card;
  if (!card) return null;
  return { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year };
}

export function toInvoiceRows(invoices: Stripe.Invoice[]): InvoiceRow[] {
  return invoices.map((inv) => ({
    id: inv.id,
    number: inv.number ?? null,
    created: new Date(inv.created * 1000).toISOString(),
    amountPaid: (inv.amount_paid ?? 0) / 100,
    currency: inv.currency,
    status: inv.status ?? "unknown",
    pdfUrl: inv.invoice_pdf ?? null,
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/__tests__/billing-summary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/summary.ts lib/__tests__/billing-summary.test.ts
git commit -m "feat(billing): pure summary + invoice mappers"
```

---

### Task 3: Summary + invoices read routes

**Files:**
- Create: `app/api/billing/summary/route.ts`
- Create: `app/api/billing/invoices/route.ts`

**Interfaces:**
- Consumes: `toCardSummary`, `toInvoiceRows`, `BillingSummary`, `InvoiceRow` (Task 2); `getStripe`, `getActiveSubscription`, `tierByPriceId` (`@/lib/stripe`); `getCurrentUser`, `checkRateLimit`, `logger`; `TIER_LABEL`, `TIER_PRICE` (`@/lib/subscription`).
- Produces: `GET /api/billing/summary` → `{ success: true, summary: BillingSummary }`; `GET /api/billing/invoices` → `{ success: true, invoices: InvoiceRow[] }`.

- [ ] **Step 1: Implement the summary route**

```ts
// app/api/billing/summary/route.ts
/**
 * GET /api/billing/summary — the billing page's header data: plan, period,
 * cancellation/pending-downgrade state, and the default card. Reads Stripe
 * live; never writes tier. Free/no-customer users get a free-plan shape.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, getActiveSubscription, tierByPriceId } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { TIER_LABEL, TIER_PRICE, type Tier } from "@/lib/subscription";
import { toCardSummary, type BillingSummary } from "@/lib/billing/summary";

function freeSummary(): BillingSummary {
  return {
    tier: "free", tierLabel: TIER_LABEL.free, price: TIER_PRICE.free,
    status: "none", currentPeriodEnd: null, cancelAtPeriodEnd: false,
    pendingDowngradeTier: null, pendingChangeDate: null, paymentMethod: null,
  };
}

export async function GET() {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
    }
    userId = user.id;
    const rate = checkRateLimit(`billing:${user.id}`, { maxRequests: 10 });
    if (!rate.allowed) {
      return NextResponse.json({ success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." }, { status: 429 });
    }
    if (!user.stripe_customer_id) {
      return NextResponse.json({ success: true, summary: freeSummary() });
    }

    const stripe = getStripe();
    const sub = await getActiveSubscription(user.stripe_customer_id);
    const customer = (await stripe.customers.retrieve(user.stripe_customer_id, {
      expand: ["invoice_settings.default_payment_method"],
    })) as Stripe.Customer;
    const pm = (customer.invoice_settings?.default_payment_method as Stripe.PaymentMethod | null) ?? null;

    if (!sub) {
      return NextResponse.json({ success: true, summary: { ...freeSummary(), paymentMethod: toCardSummary(pm) } });
    }

    const currentPrice = sub.items.data[0]?.price?.id ?? "";
    const tier: Tier = tierByPriceId(currentPrice) ?? "free";

    // Pending downgrade: a subscription schedule whose next phase targets a
    // lower price. Read it live so the DB stays webhook-only.
    let pendingDowngradeTier: Tier | null = null;
    let pendingChangeDate: string | null = null;
    if (sub.schedule) {
      const scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      const nextPhase = schedule.phases.find((p) => (p.start_date ?? 0) > sub.current_period_end - 1);
      const nextPrice = nextPhase?.items?.[0]?.price;
      const nextPriceId = typeof nextPrice === "string" ? nextPrice : nextPrice?.id;
      const nextTier = nextPriceId ? tierByPriceId(nextPriceId) : null;
      if (nextTier && nextTier !== tier) {
        pendingDowngradeTier = nextTier;
        pendingChangeDate = new Date(sub.current_period_end * 1000).toISOString();
      }
    }

    const summary: BillingSummary = {
      tier,
      tierLabel: TIER_LABEL[tier],
      price: TIER_PRICE[tier],
      status: sub.status,
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      pendingDowngradeTier,
      pendingChangeDate,
      paymentMethod: toCardSummary(pm),
    };
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    logger.error("Billing summary error", { err: error, route: "GET /api/billing/summary", userId });
    return NextResponse.json({ success: false, code: "INTERNAL_ERROR", message: "Could not load billing" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implement the invoices route**

```ts
// app/api/billing/invoices/route.ts
/**
 * GET /api/billing/invoices — the customer's recent invoices, rendered in
 * our own UI (no hosted portal). Empty array when there is no customer.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { toInvoiceRows } from "@/lib/billing/summary";

export async function GET() {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
    }
    userId = user.id;
    const rate = checkRateLimit(`billing:${user.id}`, { maxRequests: 10 });
    if (!rate.allowed) {
      return NextResponse.json({ success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." }, { status: 429 });
    }
    if (!user.stripe_customer_id) {
      return NextResponse.json({ success: true, invoices: [] });
    }
    const list = await getStripe().invoices.list({ customer: user.stripe_customer_id, limit: 24 });
    return NextResponse.json({ success: true, invoices: toInvoiceRows(list.data) });
  } catch (error) {
    logger.error("Billing invoices error", { err: error, route: "GET /api/billing/invoices", userId });
    return NextResponse.json({ success: false, code: "INTERNAL_ERROR", message: "Could not load invoices" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/billing/summary/route.ts app/api/billing/invoices/route.ts
git commit -m "feat(billing): summary + invoices read routes (in-app, no portal)"
```

---

### Task 4: SetupIntent + payment-method routes

**Files:**
- Create: `app/api/billing/setup-intent/route.ts`
- Create: `app/api/billing/payment-method/route.ts`

**Interfaces:**
- Consumes: `getStripe` (`@/lib/stripe`), `linkStripeCustomer` (`@/lib/db/users`), `toCardSummary` (Task 2), auth + rate-limit + logger, `parseJsonBody` (`@/lib/api-validation`), `zod`.
- Produces: `POST /api/billing/setup-intent` → `{ success, clientSecret }`; `POST /api/billing/payment-method` `{ setupIntentId }` → `{ success, paymentMethod: CardSummary }`.

- [ ] **Step 1: Implement setup-intent**

```ts
// app/api/billing/setup-intent/route.ts
/**
 * POST /api/billing/setup-intent — mint a SetupIntent client secret so the
 * in-app Stripe Elements form can tokenize a card. Ensures a Stripe
 * customer exists first. No card data passes through here.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { linkStripeCustomer } from "@/lib/db/users";
import { logger } from "@/lib/logger";

export async function POST() {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
    }
    userId = user.id;
    const rate = checkRateLimit(`billing:${user.id}`, { maxRequests: 10 });
    if (!rate.allowed) {
      return NextResponse.json({ success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." }, { status: 429 });
    }

    const stripe = getStripe();
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
      customerId = customer.id;
      await linkStripeCustomer(user.id, customerId);
    }

    const intent = await stripe.setupIntents.create({ customer: customerId, payment_method_types: ["card"] });
    return NextResponse.json({ success: true, clientSecret: intent.client_secret });
  } catch (error) {
    logger.error("Billing setup-intent error", { err: error, route: "POST /api/billing/setup-intent", userId });
    return NextResponse.json({ success: false, code: "INTERNAL_ERROR", message: "Could not start card setup" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implement payment-method (set default)**

```ts
// app/api/billing/payment-method/route.ts
/**
 * POST /api/billing/payment-method { setupIntentId } — after Elements
 * confirms the SetupIntent, make that card the customer's default (and the
 * subscription's, if any). Verifies the intent succeeded and belongs to
 * this customer. Never accepts a raw card number.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, getActiveSubscription } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { toCardSummary } from "@/lib/billing/summary";

const bodySchema = z.object({ setupIntentId: z.string().min(1) });

export async function POST(request: NextRequest) {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
    }
    userId = user.id;
    const rate = checkRateLimit(`billing:${user.id}`, { maxRequests: 10 });
    if (!rate.allowed) {
      return NextResponse.json({ success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." }, { status: 429 });
    }
    if (!user.stripe_customer_id) {
      return NextResponse.json({ success: false, code: "NO_BILLING_ACCOUNT", message: "No billing account" }, { status: 400 });
    }
    const parsed = await parseJsonBody(request, bodySchema);
    if (parsed.response) return parsed.response;

    const stripe = getStripe();
    const intent = await stripe.setupIntents.retrieve(parsed.data.setupIntentId);
    const intentCustomer = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
    const pmId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
    if (intent.status !== "succeeded" || intentCustomer !== user.stripe_customer_id || !pmId) {
      return NextResponse.json({ success: false, code: "SETUP_NOT_COMPLETE", message: "Card setup did not complete" }, { status: 400 });
    }

    await stripe.customers.update(user.stripe_customer_id, {
      invoice_settings: { default_payment_method: pmId },
    });
    const sub = await getActiveSubscription(user.stripe_customer_id);
    if (sub) {
      await stripe.subscriptions.update(sub.id, { default_payment_method: pmId });
    }

    const pm = (await stripe.paymentMethods.retrieve(pmId)) as Stripe.PaymentMethod;
    return NextResponse.json({ success: true, paymentMethod: toCardSummary(pm) });
  } catch (error) {
    logger.error("Billing payment-method error", { err: error, route: "POST /api/billing/payment-method", userId });
    return NextResponse.json({ success: false, code: "INTERNAL_ERROR", message: "Could not save card" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/billing/setup-intent/route.ts app/api/billing/payment-method/route.ts
git commit -m "feat(billing): SetupIntent + set-default-card routes (Elements backend)"
```

---

### Task 5: change-plan route

**Files:**
- Create: `app/api/billing/change-plan/route.ts`

**Interfaces:**
- Consumes: `planChange` (Task 1), `getStripe`, `getActiveSubscription`, `PRICE_BY_TIER` (`@/lib/stripe`), auth + rate-limit + logger, `parseJsonBody`, `zod`.
- Produces: `POST /api/billing/change-plan { targetTier }` → one of: `{ success: true, applied: "upgrade"|"downgrade" }`, `{ success: true, needsPaymentMethod: true }` (free→paid with no card), `{ success: true, applied: "cancel" }`, or `{ success: false, ... }`. No tier DB write (webhook syncs).

- [ ] **Step 1: Implement**

```ts
// app/api/billing/change-plan/route.ts
/**
 * POST /api/billing/change-plan { targetTier } — move between plans:
 *  - upgrade: immediate + prorated (create subscription if first paid; a
 *    card is required → needsPaymentMethod when none on file)
 *  - downgrade (ultimate→pro): subscription schedule, switches at period end
 *  - downgrade to free: cancel at period end
 * Never writes tier — the webhook syncs our DB from the resulting Stripe state.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, getActiveSubscription, PRICE_BY_TIER } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { planChange } from "@/lib/billing/plan-change";
import type { Tier } from "@/lib/subscription";

const bodySchema = z.object({ targetTier: z.enum(["free", "pro", "ultimate"]) });

async function customerHasDefaultCard(stripe: Stripe, customerId: string): Promise<boolean> {
  const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
  return Boolean(customer.invoice_settings?.default_payment_method);
}

export async function POST(request: NextRequest) {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
    }
    userId = user.id;
    const rate = checkRateLimit(`billing:${user.id}`, { maxRequests: 10 });
    if (!rate.allowed) {
      return NextResponse.json({ success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." }, { status: 429 });
    }
    if (!user.stripe_customer_id) {
      return NextResponse.json({ success: false, code: "NO_BILLING_ACCOUNT", message: "No billing account" }, { status: 400 });
    }
    const parsed = await parseJsonBody(request, bodySchema);
    if (parsed.response) return parsed.response;

    const stripe = getStripe();
    const customerId = user.stripe_customer_id;
    const current = user.subscription_tier as Tier;
    const decision = planChange(current, parsed.data.targetTier);
    const prices = PRICE_BY_TIER();

    if (decision.kind === "noop") {
      return NextResponse.json({ success: true, applied: "noop" });
    }

    const sub = await getActiveSubscription(customerId);

    if (decision.kind === "cancel") {
      if (!sub) return NextResponse.json({ success: false, code: "NO_ACTIVE_SUBSCRIPTION", message: "No active subscription" }, { status: 400 });
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      return NextResponse.json({ success: true, applied: "cancel" });
    }

    if (decision.kind === "upgrade") {
      const newPrice = prices[decision.target];
      if (!newPrice) return NextResponse.json({ success: false, code: "BILLING_NOT_CONFIGURED", message: "Billing not configured" }, { status: 500 });

      if (!sub) {
        // First paid subscription — needs a card on file.
        if (!(await customerHasDefaultCard(stripe, customerId))) {
          return NextResponse.json({ success: true, needsPaymentMethod: true });
        }
        await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: newPrice }],
          payment_behavior: "error_if_incomplete",
        });
        return NextResponse.json({ success: true, applied: "upgrade" });
      }

      const itemId = sub.items.data[0]?.id;
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: itemId, price: newPrice }],
        proration_behavior: "create_prorations",
      });
      return NextResponse.json({ success: true, applied: "upgrade" });
    }

    // decision.kind === "downgrade": schedule the switch at period end.
    if (!sub) return NextResponse.json({ success: false, code: "NO_ACTIVE_SUBSCRIPTION", message: "No active subscription" }, { status: 400 });
    const newPrice = prices[decision.target];
    if (!newPrice) return NextResponse.json({ success: false, code: "BILLING_NOT_CONFIGURED", message: "Billing not configured" }, { status: 500 });
    const currentPrice = sub.items.data[0]?.price?.id;

    let scheduleId: string;
    if (sub.schedule) {
      scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
    } else {
      const created = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
      scheduleId = created.id;
    }
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
    const phase0 = schedule.phases[0];
    await stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      phases: [
        { items: [{ price: currentPrice, quantity: 1 }], start_date: phase0.start_date, end_date: phase0.end_date },
        { items: [{ price: newPrice, quantity: 1 }] },
      ],
    });
    return NextResponse.json({ success: true, applied: "downgrade" });
  } catch (error) {
    logger.error("Billing change-plan error", { err: error, route: "POST /api/billing/change-plan", userId });
    return NextResponse.json({ success: false, code: "INTERNAL_ERROR", message: "Could not change plan" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/billing/change-plan/route.ts
git commit -m "feat(billing): change-plan route (upgrade now, downgrade at period end)"
```

---

### Task 6: Stripe.js deps + browser loader

**Files:**
- Modify: `package.json` (add deps)
- Create: `lib/stripe-browser.ts`
- Modify: `CLAUDE.md` env section (document `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)

**Interfaces:**
- Produces: `getStripeBrowser(): Promise<Stripe | null>` (memoized `loadStripe`), from `@/lib/stripe-browser`.

- [ ] **Step 1: Install packages**

```bash
npm install @stripe/stripe-js@^4 @stripe/react-stripe-js@^2
```
Expected: both added to `package.json` dependencies.

- [ ] **Step 2: Create the loader**

```ts
// lib/stripe-browser.ts
"use client";

/**
 * Memoized browser-side Stripe.js loader for Elements. Returns null when the
 * publishable key is not configured (dev without billing env).
 */
import { loadStripe, type Stripe } from "@stripe/stripe-js";

let promise: Promise<Stripe | null> | null = null;

export function getStripeBrowser(): Promise<Stripe | null> {
  if (!promise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    promise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return promise;
}
```

- [ ] **Step 3: Document the env var**

In `CLAUDE.md`, under the Stripe env block, add the line:
```bash
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=   # pk_test_… (Elements card form; pk_live_… at launch)
```

- [ ] **Step 4: Verify**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/stripe-browser.ts CLAUDE.md
git commit -m "chore(billing): add Stripe.js + browser loader for Elements"
```

---

### Task 7: /billing page + PlanSection (cancel bug fix)

**Files:**
- Create: `app/billing/page.tsx`
- Create: `components/billing/BillingCenter.tsx`
- Create: `components/billing/PlanSection.tsx`
- Create: `components/billing/use-billing.ts`

**Interfaces:**
- Consumes: `BillingSummary`, `InvoiceRow`, `CardSummary` (Task 2); `TIER_PRICE` (`@/lib/subscription`); shadcn `Button`.
- Produces: `useBilling()` → `{ summary, invoices, loading, error, refresh, patchSummary }`; `BillingCenter` (client shell mounting the three sections); `PlanSection({ summary, onChanged })`.

- [ ] **Step 1: Billing data hook**

```ts
// components/billing/use-billing.ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { BillingSummary, InvoiceRow } from "@/lib/billing/summary";

export function useBilling() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, i] = await Promise.all([
        fetch("/api/billing/summary").then((r) => r.json()),
        fetch("/api/billing/invoices").then((r) => r.json()),
      ]);
      if (!s.success) throw new Error(s.message || "Could not load billing");
      setSummary(s.summary);
      setInvoices(i.success ? i.invoices : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load billing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Optimistic patch (webhook lag) — same pattern as cancel/reactivate today.
  const patchSummary = useCallback((over: Partial<BillingSummary>) => {
    setSummary((prev) => (prev ? { ...prev, ...over } : prev));
  }, []);

  return { summary, invoices, loading, error, refresh, patchSummary };
}
```

- [ ] **Step 2: PlanSection (with the cancel/reactivate fix)**

```tsx
// components/billing/PlanSection.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { TIER_PRICE } from "@/lib/subscription";
import type { BillingSummary } from "@/lib/billing/summary";

export function PlanSection({
  summary,
  onChangePlan,
  onChanged,
}: {
  summary: BillingSummary;
  onChangePlan: () => void;
  onChanged: (over: Partial<BillingSummary>) => void;
}) {
  const [busy, setBusy] = useState<"cancel" | "reactivate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPaid = summary.tier !== "free";
  // BUG FIX: key the cancelling state on cancelAtPeriodEnd alone. Previously
  // this also required currentPeriodEnd !== null, so a null period end fell
  // back to the paid branch and showed Cancel again with no Reactivate.
  const isCancelling = summary.cancelAtPeriodEnd;
  const periodEnd = summary.currentPeriodEnd
    ? new Date(summary.currentPeriodEnd).toLocaleDateString()
    : "";

  const post = async (path: string, over: Partial<BillingSummary>, kind: "cancel" | "reactivate") => {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Something went wrong");
      onChanged(over);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border-2 border-border bg-card p-4 sm:p-6" data-testid="plan-section">
      <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em]">Plan</h2>
      <div className="mt-1.5 h-0.5 w-10 bg-accent" aria-hidden="true" />

      <p className="mt-4 text-lg font-medium">
        {summary.tierLabel}
        <span className="text-muted-foreground"> · </span>
        <span className="figure">{TIER_PRICE[summary.tier]}</span>
        {isPaid && <span className="text-muted-foreground">/mo</span>}
      </p>

      {isCancelling ? (
        <p className="mt-1 text-sm font-medium text-destructive" data-testid="cancel-notice">
          Cancels {periodEnd} — access until then
        </p>
      ) : summary.pendingDowngradeTier ? (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="downgrade-notice">
          Changes to {summary.pendingDowngradeTier} on {summary.pendingChangeDate ? new Date(summary.pendingChangeDate).toLocaleDateString() : ""}
        </p>
      ) : isPaid && summary.currentPeriodEnd ? (
        <p className="mt-1 text-sm text-muted-foreground">Renews {periodEnd}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={onChangePlan} disabled={busy !== null} data-testid="change-plan">
          {isPaid ? "Change plan" : "Choose a plan"}
        </Button>
        {isCancelling ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => post("/api/billing/reactivate", { cancelAtPeriodEnd: false }, "reactivate")}
            disabled={busy !== null}
            data-testid="reactivate"
          >
            {busy === "reactivate" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Reactivate
          </Button>
        ) : isPaid ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => post("/api/billing/cancel", { cancelAtPeriodEnd: true }, "cancel")}
            disabled={busy !== null}
            data-testid="cancel-subscription"
          >
            Cancel subscription
          </Button>
        ) : null}
      </div>

      {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 3: BillingCenter shell**

```tsx
// components/billing/BillingCenter.tsx
"use client";

import { Loader2 } from "lucide-react";
import { useBilling } from "@/components/billing/use-billing";
import { PlanSection } from "@/components/billing/PlanSection";
import { useState } from "react";
import { ChangePlanDialog } from "@/components/billing/ChangePlanDialog";
import { PaymentMethodSection } from "@/components/billing/PaymentMethodSection";
import { InvoiceTable } from "@/components/billing/InvoiceTable";

export function BillingCenter() {
  const { summary, invoices, loading, error, refresh, patchSummary } = useBilling();
  const [planOpen, setPlanOpen] = useState(false);

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground" aria-live="polite">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Loading billing…
      </div>
    );
  }
  if (error && !summary) {
    return <p className="py-20 text-center text-sm text-destructive" role="alert">{error}</p>;
  }
  if (!summary) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="billing-center">
      <PlanSection summary={summary} onChangePlan={() => setPlanOpen(true)} onChanged={patchSummary} />
      <PaymentMethodSection summary={summary} onSaved={() => void refresh()} />
      <InvoiceTable invoices={invoices} />
      <ChangePlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        summary={summary}
        onDone={() => void refresh()}
      />
    </div>
  );
}
```

- [ ] **Step 4: The page**

```tsx
// app/billing/page.tsx
import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { AppFooter } from "@/components/layout/AppFooter";
import { BillingCenter } from "@/components/billing/BillingCenter";

export const metadata: Metadata = { title: "Plan & Billing — Quota" };

export default function BillingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="container mx-auto flex-1 px-4 py-8">
        <h1 className="mb-6 font-display text-2xl font-bold uppercase tracking-tight">Plan &amp; Billing</h1>
        <BillingCenter />
      </main>
      <AppFooter />
    </div>
  );
}
```

- [ ] **Step 5: Verify (depends on Tasks 8 + 9 components existing to type-check the imports)**

> Note for executor: `BillingCenter` imports `PaymentMethodSection`, `InvoiceTable` (Task 8) and `ChangePlanDialog` (Task 9). Implement Tasks 8 and 9 before running the full `type-check`. To keep this task self-contained, run type-check at the END of Task 9 as the joint gate. Commit this task's files now; the joint type-check gate is in Task 9 Step 4.

- [ ] **Step 6: Commit**

```bash
git add app/billing/page.tsx components/billing/BillingCenter.tsx components/billing/PlanSection.tsx components/billing/use-billing.ts
git commit -m "feat(billing): /billing page + PlanSection with cancel/reactivate fix"
```

---

### Task 8: PaymentMethodSection (Elements) + InvoiceTable

**Files:**
- Create: `components/billing/PaymentMethodSection.tsx`
- Create: `components/billing/PaymentMethodForm.tsx`
- Create: `components/billing/InvoiceTable.tsx`

**Interfaces:**
- Consumes: `getStripeBrowser` (Task 6); `@stripe/react-stripe-js` (`Elements`, `CardElement`, `useStripe`, `useElements`); `BillingSummary`, `InvoiceRow` (Task 2); shadcn `Button`, `Dialog`.
- Produces: `PaymentMethodSection({ summary, onSaved })`; `InvoiceTable({ invoices })`.

- [ ] **Step 1: PaymentMethodForm (Elements card entry)**

```tsx
// components/billing/PaymentMethodForm.tsx
"use client";

import { useState } from "react";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { getStripeBrowser } from "@/lib/stripe-browser";

function CardForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      const intentRes = await fetch("/api/billing/setup-intent", { method: "POST" }).then((r) => r.json());
      if (!intentRes.success || !intentRes.clientSecret) throw new Error(intentRes.message || "Could not start card setup");

      const { error: confirmError, setupIntent } = await stripe.confirmCardSetup(intentRes.clientSecret, {
        payment_method: { card },
      });
      if (confirmError) throw new Error(confirmError.message || "Card was declined");
      if (!setupIntent) throw new Error("Card setup did not complete");

      const saveRes = await fetch("/api/billing/payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupIntentId: setupIntent.id }),
      }).then((r) => r.json());
      if (!saveRes.success) throw new Error(saveRes.message || "Could not save card");

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="card-form">
      <div className="rounded-md border-2 border-border bg-background px-3 py-3">
        <CardElement options={{ hidePostalCode: false }} />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!stripe || busy} data-testid="card-save">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Save card
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function PaymentMethodForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  return (
    <Elements stripe={getStripeBrowser()}>
      <CardForm onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  );
}
```

- [ ] **Step 2: PaymentMethodSection**

```tsx
// components/billing/PaymentMethodSection.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PaymentMethodForm } from "@/components/billing/PaymentMethodForm";
import type { BillingSummary } from "@/lib/billing/summary";

export function PaymentMethodSection({
  summary,
  onSaved,
}: {
  summary: BillingSummary;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const pm = summary.paymentMethod;

  return (
    <section className="border-2 border-border bg-card p-4 sm:p-6" data-testid="payment-method-section">
      <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em]">Payment method</h2>
      <div className="mt-1.5 h-0.5 w-10 bg-accent" aria-hidden="true" />

      {editing ? (
        <div className="mt-4">
          <PaymentMethodForm
            onSaved={() => { setEditing(false); onSaved(); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm" data-testid="pm-display">
            {pm ? (
              <>
                <span className="uppercase">{pm.brand}</span> •••• {pm.last4}
                <span className="text-muted-foreground"> · exp {String(pm.expMonth).padStart(2, "0")}/{pm.expYear}</span>
              </>
            ) : (
              <span className="text-muted-foreground">No card on file</span>
            )}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="update-card">
            {pm ? "Update card" : "Add card"}
          </Button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: InvoiceTable**

```tsx
// components/billing/InvoiceTable.tsx
"use client";

import type { InvoiceRow } from "@/lib/billing/summary";

export function InvoiceTable({ invoices }: { invoices: InvoiceRow[] }) {
  return (
    <section className="border-2 border-border bg-card p-4 sm:p-6" data-testid="invoice-table">
      <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em]">Invoices</h2>
      <div className="mt-1.5 h-0.5 w-10 bg-accent" aria-hidden="true" />

      {invoices.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="invoice-empty">No invoices yet.</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2">Date</th><th className="py-2">Amount</th><th className="py-2">Status</th><th className="py-2 text-right">PDF</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b last:border-0">
                <td className="py-2">{new Date(inv.created).toLocaleDateString()}</td>
                <td className="py-2 figure">{inv.currency.toUpperCase()} {inv.amountPaid.toFixed(2)}</td>
                <td className="py-2 capitalize">{inv.status}</td>
                <td className="py-2 text-right">
                  {inv.pdfUrl ? (
                    <a href={inv.pdfUrl} className="text-accent underline-offset-4 hover:underline" target="_blank" rel="noopener noreferrer">PDF</a>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/billing/PaymentMethodSection.tsx components/billing/PaymentMethodForm.tsx components/billing/InvoiceTable.tsx
git commit -m "feat(billing): in-app card form (Elements) + invoice table"
```

---

### Task 9: ChangePlanDialog + Header rewire

**Files:**
- Create: `components/billing/ChangePlanDialog.tsx`
- Modify: `components/layout/Header.tsx` (Plan & billing → link to `/billing`; remove `BillingDialog`)
- Delete: `components/settings/BillingDialog.tsx`

**Interfaces:**
- Consumes: `planChange` is server-side; the dialog just POSTs `targetTier`. `TIERS`, `TIER_LABEL`, `TIER_PRICE` (`@/lib/subscription`); `BillingSummary` (Task 2); shadcn `Dialog`, `Button`; `PaymentMethodForm` (Task 8).
- Produces: `ChangePlanDialog({ open, onOpenChange, summary, onDone })`.

- [ ] **Step 1: ChangePlanDialog**

```tsx
// components/billing/ChangePlanDialog.tsx
"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { TIERS, TIER_LABEL, TIER_PRICE, type Tier } from "@/lib/subscription";
import { PaymentMethodForm } from "@/components/billing/PaymentMethodForm";
import type { BillingSummary } from "@/lib/billing/summary";

export function ChangePlanDialog({
  open,
  onOpenChange,
  summary,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  summary: BillingSummary;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsCard, setNeedsCard] = useState<Tier | null>(null);

  const choose = async (target: Tier) => {
    setBusy(target);
    setError(null);
    try {
      const res = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTier: target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not change plan");
      if (data.needsPaymentMethod) {
        setNeedsCard(target); // collect a card, then retry
        return;
      }
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change plan");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="change-plan-dialog">
        <DialogHeader>
          <DialogTitle>Change plan</DialogTitle>
          <DialogDescription>
            Upgrades apply now (prorated). Downgrades take effect at your next renewal.
          </DialogDescription>
        </DialogHeader>

        {needsCard ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Add a card to start your {TIER_LABEL[needsCard]} plan.</p>
            <PaymentMethodForm
              onSaved={() => { const t = needsCard; setNeedsCard(null); void choose(t); }}
              onCancel={() => setNeedsCard(null)}
            />
          </div>
        ) : (
          <div className="grid gap-3">
            {TIERS.map((t) => {
              const isCurrent = t === summary.tier;
              return (
                <div key={t} className="flex items-center justify-between border-2 border-border p-3" data-testid={`plan-option-${t}`}>
                  <div>
                    <p className="font-medium">{TIER_LABEL[t]}</p>
                    <p className="text-sm text-muted-foreground figure">{TIER_PRICE[t]}{t !== "free" && "/mo"}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent || busy !== null}
                    onClick={() => void choose(t)}
                    data-testid={`choose-${t}`}
                  >
                    {busy === t && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    {isCurrent ? "Current" : "Select"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Rewire the Header**

In `components/layout/Header.tsx`:
- Remove `import { BillingDialog } from "@/components/settings/BillingDialog";`
- Remove `const [billingOpen, setBillingOpen] = useState(false);`
- Remove the `<BillingDialog open={billingOpen} onOpenChange={setBillingOpen} />` mount.
- Desktop `menu-billing` item: convert from a button `onClick` to an `asChild` Link, matching the catalog item's pattern:

```tsx
                  <DropdownMenuItem asChild className="cursor-pointer" data-testid="menu-billing">
                    <Link href="/billing">
                      <CreditCard className="h-4 w-4" aria-hidden="true" />
                      Plan &amp; billing
                    </Link>
                  </DropdownMenuItem>
```
- Mobile "Plan & billing" button: convert to a Link to `/billing` that closes the menu, matching the mobile catalog link:

```tsx
              <Link
                href="/billing"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileMenuOpen(false)}
              >
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                Plan &amp; billing
              </Link>
```

- [ ] **Step 3: Delete the old dialog**

```bash
git rm components/settings/BillingDialog.tsx
```

- [ ] **Step 4: Joint gate (Tasks 7–9)**

Run: `npm run type-check && npm run lint`
Expected: type-check clean; lint clean except the 2 pre-existing warnings in `lib/email-sender.ts` + `lib/quote-calculations.ts`.

- [ ] **Step 5: Commit**

```bash
git add components/billing/ChangePlanDialog.tsx components/layout/Header.tsx
git commit -m "feat(billing): change-plan dialog; header links to /billing; drop BillingDialog"
```

---

### Task 10: e2e + full gate

**Files:**
- Create: `e2e/billing.spec.ts`
- Modify: `e2e/account-nav.spec.ts` (the old `menu-billing` opens `billing-dialog` test no longer applies — it now navigates to `/billing`)

**Interfaces:**
- Consumes: testids `billing-center`, `plan-section`, `payment-method-section`, `invoice-table`, `change-plan`, `change-plan-dialog`, `menu-billing`, `nav`/`user-menu-trigger`.

- [ ] **Step 1: Update the account-nav billing test**

In `e2e/account-nav.spec.ts`, replace the "Plan & Billing opens its own titled dialog" test with navigation:

```ts
  test("Plan & Billing navigates to the /billing page", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("menu-billing").click();
    await page.waitForURL(/\/billing$/);
    await expect(page.getByTestId("billing-center")).toBeVisible();
    await expect(page.getByTestId("plan-section")).toBeVisible();
  });
```
Leave the "Profile Settings has no billing panel" and "Help/About dashboard link" tests unchanged (Profile Settings still must not contain billing; `billing-panel` testid is gone entirely now, so that assertion — `toHaveCount(0)` — still holds).

- [ ] **Step 2: Billing page spec**

```ts
// e2e/billing.spec.ts
import { test, expect } from "@playwright/test";

test.describe("billing center (authenticated)", () => {
  test("renders plan, payment method, and invoices sections", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByTestId("billing-center")).toBeVisible();
    await expect(page.getByTestId("plan-section")).toBeVisible();
    await expect(page.getByTestId("payment-method-section")).toBeVisible();
    await expect(page.getByTestId("invoice-table")).toBeVisible();
  });

  test("Change plan opens the plan dialog", async ({ page }) => {
    await page.goto("/billing");
    await page.getByTestId("change-plan").click();
    await expect(page.getByTestId("change-plan-dialog")).toBeVisible();
    await expect(page.getByTestId("change-plan-dialog")).toContainText("Change plan");
  });
});
```

> Note for executor: the e2e user's tier depends on prior runs. These two tests assert only structure (sections + dialog), which hold for any tier. Do not assert a specific tier/price. Card entry (Stripe iframe) is verified manually in test mode, not here.

- [ ] **Step 3: Full gate** (stop any dev server first — `reuseExistingServer:false`):

```bash
npx vitest run
npm run type-check
npm run lint
npx playwright test e2e/billing.spec.ts e2e/account-nav.spec.ts e2e/nav-footer.spec.ts e2e/auth-pages.spec.ts e2e/quote-flow.spec.ts
```
Expected: all green (lint: only the 2 pre-existing warnings).

- [ ] **Step 4: Commit**

```bash
git add e2e/billing.spec.ts e2e/account-nav.spec.ts
git commit -m "test(e2e): billing center sections + change-plan dialog; nav goes to /billing"
```

---

## Notes for the executor

- **Sole-writer:** never call `setTierFromBilling` or write tier fields from any billing route. Routes mutate Stripe; the webhook (already handling `subscription.updated/deleted`) syncs the DB. Scheduled downgrades sync when the schedule releases.
- **Stripe API version** stays `2023-10-16` (in `lib/stripe.ts`). Subscription schedules + SetupIntents are available on it.
- **Manual test-mode checks** (not e2e): card `4242 4242 4242 4242` for the Elements form; verify upgrade prorates immediately and downgrade shows the pending notice.
- **Retired routes:** `/api/billing/checkout` and `/api/billing/portal` are no longer referenced by the UI after Task 9. Leaving the files is fine; a follow-up may delete them.
