# Tier Limits + Benefit Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter quotes per calendar month and gate paid benefits (email invoicing, logo on PDFs, no "Made with Quota" watermark) so Free no longer receives them.

**Architecture:** Extract the gating *decisions* into pure, unit-testable helpers (month boundary, PDF flags). Wire them into the quote-create limit, the subscription usage readout, the email route, and the PDF renderer. Thread the user's `subscription_tier` to the two PDF call sites. Clients stay unlimited.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, `@react-pdf/renderer`, Supabase (`supabaseAdmin`), Vitest (node-env), Playwright.

## Global Constraints

- Reset window is the **calendar month in UTC**: count quotes with `created_at >=` the first instant of the current UTC month.
- Quote ceilings unchanged: Free **3/mo**, Pro **15/mo**, Ultimate **unlimited** (`QUOTE_LIMIT`).
- **Email invoicing is Pro+**: `/api/send-quote` rejects `subscription_tier === "free"` with 403 `EMAIL_REQUIRES_PRO`.
- **Logo on PDF is Pro+**; **"Made with Quota" footer is Free-only** (`showBranding = tier === "free"`).
- Clients/contacts stay **unlimited** on all tiers — do not add a client limit.
- Unknown/missing tier is treated as `"free"` (safe default).
- Every route keeps its existing `getCurrentUser()` guard. TypeScript strict. NO Claude/AI attribution in commits. Run `npm run type-check` + `npm run lint` before a task is done.

## Interfaces defined here

- `Tier = "free" | "pro" | "ultimate"` from `@/lib/subscription`; `QUOTE_LIMIT`, `TIER_LABEL`.
- Existing `countUserQuotes(userId)` in `lib/db/users.ts` (lifetime; stays for any other caller).
- Existing `generateQuotePDF(quote, companyInfo, quoteNumber, quoteDate, validUntil?, scheduleLines?, paymentReceipt?)` in `lib/quote-pdf.ts`.
- Existing `QuotePDFDocument` props include `logoSrc?: Buffer | null`.

---

### Task 1: Calendar-month quote counter

**Files:**
- Create: `lib/billing/month.ts`
- Modify: `lib/db/users.ts` (add `countUserQuotesThisMonth`)
- Test: `lib/__tests__/month.test.ts`

**Interfaces:**
- Produces: `startOfMonthUTC(now: Date): Date` (first instant of `now`'s UTC month); `countUserQuotesThisMonth(userId: string): Promise<number>`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/month.test.ts
import { describe, it, expect } from "vitest";
import { startOfMonthUTC } from "@/lib/billing/month";

describe("startOfMonthUTC", () => {
  it("returns the first instant of the month in UTC", () => {
    const d = startOfMonthUTC(new Date("2026-08-20T18:37:31Z"));
    expect(d.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
  it("is idempotent on the first of the month", () => {
    const d = startOfMonthUTC(new Date("2026-08-01T00:00:00Z"));
    expect(d.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
  it("handles year boundary (January)", () => {
    const d = startOfMonthUTC(new Date("2026-01-05T12:00:00Z"));
    expect(d.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/month.test.ts`
Expected: FAIL — cannot resolve `@/lib/billing/month`.

- [ ] **Step 3: Implement the helper**

```ts
// lib/billing/month.ts
/**
 * First instant of the given date's calendar month, in UTC. Used to meter
 * quote usage per calendar month (everyone resets on the 1st).
 */
export function startOfMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/month.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the monthly counter**

In `lib/db/users.ts`, add this export (mirrors `countUserQuotes` but adds a `created_at` lower bound). Import the helper at the top: `import { startOfMonthUTC } from "@/lib/billing/month";`

```ts
/** Quotes the user created since the first of the current UTC month. */
export async function countUserQuotesThisMonth(userId: string): Promise<number> {
  const since = startOfMonthUTC(new Date()).toISOString();
  const { count, error } = await supabaseAdmin
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("created_at", since);

  if (error) throw error;
  return count ?? 0;
}
```

- [ ] **Step 6: Verify + commit**

Run: `npm run type-check && npx vitest run lib/__tests__/month.test.ts`
Expected: clean; 3 pass.

```bash
git add lib/billing/month.ts lib/db/users.ts lib/__tests__/month.test.ts
git commit -m "feat(billing): calendar-month quote counter"
```

---

### Task 2: Enforce the monthly limit + report monthly usage

**Files:**
- Modify: `app/api/quotes/route.ts` (POST — use monthly count + "this month" message)
- Modify: `app/api/subscription/route.ts` (GET — `quotesUsed` from monthly count)

**Interfaces:**
- Consumes: `countUserQuotesThisMonth` (Task 1); `QUOTE_LIMIT`, `TIER_LABEL`, `Tier`.

- [ ] **Step 1: Point quote-create enforcement at the monthly count**

In `app/api/quotes/route.ts`:
- Update the import from `@/lib/db/users` to also pull `countUserQuotesThisMonth` (keep other imports).
- In the POST limit block, replace `countUserQuotes` with `countUserQuotesThisMonth` and the message:

```ts
    // 3. Enforce the tier's monthly quote limit (quote count is the only limiter)
    const tier = user.subscription_tier as Tier;
    const limit = QUOTE_LIMIT[tier];
    if (Number.isFinite(limit)) {
      const used = await countUserQuotesThisMonth(user.id);
      if (used >= limit) {
        return NextResponse.json(
          {
            success: false,
            code: "QUOTE_LIMIT",
            tier,
            limit,
            message: `You've used all ${limit} quotes this month on your ${TIER_LABEL[tier]} plan.`,
          },
          { status: 403 }
        );
      }
    }
```

- [ ] **Step 2: Report monthly usage from the subscription route**

In `app/api/subscription/route.ts`:
- Change the import: `import { countUserQuotesThisMonth, updateSubscription } from "@/lib/db/users";` (replace `countUserQuotes`).
- Replace the usage line:

```ts
    const quotesUsed = await countUserQuotesThisMonth(user.id);
```
(`quotesRemaining` formula stays: `Number.isFinite(limit) ? Math.max(0, limit - quotesUsed) : null`.)

- [ ] **Step 3: Verify + commit**

Run: `npm run type-check`
Expected: clean.

```bash
git add app/api/quotes/route.ts app/api/subscription/route.ts
git commit -m "feat(billing): meter quotes per calendar month"
```

---

### Task 3: Gate email invoicing to Pro+

**Files:**
- Modify: `app/api/send-quote/route.ts` (403 for Free after auth)
- Test: `lib/__tests__/send-quote-gate.test.ts`

**Interfaces:**
- Produces: `/api/send-quote` returns 403 `{ success:false, code:"EMAIL_REQUIRES_PRO", ... }` when `subscription_tier === "free"`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/send-quote-gate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
// Stop the handler before it does real work: make body parsing throw after
// the tier gate would have run. We only assert the gate's behavior.
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));

import { POST as sendQuotePOST } from "@/app/api/send-quote/route";

function reqWith(body: unknown) {
  return new Request("http://localhost/api/send-quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/send-quote — email gate", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await sendQuotePOST(reqWith({}));
    expect(res.status).toBe(401);
  });

  it("403 EMAIL_REQUIRES_PRO for a free user", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: "free" });
    const res = await sendQuotePOST(reqWith({ quoteId: "q1", recipientName: "X", recipientEmail: "x@y.com" }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("EMAIL_REQUIRES_PRO");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/send-quote-gate.test.ts`
Expected: FAIL — the free case is not 403 yet (no gate).

- [ ] **Step 3: Add the gate**

In `app/api/send-quote/route.ts`, immediately AFTER the `userId = user.id;` line in the auth block, add:

```ts
    // Email invoicing is a Pro feature. Free users export/download instead.
    if ((user.subscription_tier ?? "free") === "free") {
      return NextResponse.json(
        {
          success: false,
          code: "EMAIL_REQUIRES_PRO",
          message: "Emailing invoices is a Pro feature. Upgrade to send, or download the PDF.",
        },
        { status: 403 }
      );
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/send-quote-gate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify + commit**

Run: `npm run type-check`

```bash
git add app/api/send-quote/route.ts lib/__tests__/send-quote-gate.test.ts
git commit -m "feat(billing): gate email invoicing to Pro+"
```

---

### Task 4: Gate logo + watermark on the PDF by tier

**Files:**
- Create: `lib/billing/pdf-flags.ts`
- Test: `lib/__tests__/pdf-flags.test.ts`
- Modify: `lib/quote-pdf.ts` (`generateQuotePDF` gains a `tier` arg)
- Modify: `components/quote/QuotePDFDocument.tsx` (`showBranding` prop)
- Modify: `lib/email-sender.ts` (`sendQuoteEmail` passes tier through)
- Modify: `app/api/send-quote/route.ts` (pass tier to `sendQuoteEmail`)
- Modify: `app/api/quotes/[id]/pdf/route.ts` (pass tier to `generateQuotePDF`)

**Interfaces:**
- Produces: `pdfFlagsForTier(tier: Tier): { showLogo: boolean; showBranding: boolean }` — `showLogo = tier !== "free"`, `showBranding = tier === "free"`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/pdf-flags.test.ts
import { describe, it, expect } from "vitest";
import { pdfFlagsForTier } from "@/lib/billing/pdf-flags";

describe("pdfFlagsForTier", () => {
  it("free: watermark on, logo off", () => {
    expect(pdfFlagsForTier("free")).toEqual({ showLogo: false, showBranding: true });
  });
  it("pro: logo on, no watermark", () => {
    expect(pdfFlagsForTier("pro")).toEqual({ showLogo: true, showBranding: false });
  });
  it("ultimate: logo on, no watermark", () => {
    expect(pdfFlagsForTier("ultimate")).toEqual({ showLogo: true, showBranding: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/pdf-flags.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the flags helper**

```ts
// lib/billing/pdf-flags.ts
import type { Tier } from "@/lib/subscription";

/** PDF appearance by tier: paid tiers get their logo and no watermark. */
export function pdfFlagsForTier(tier: Tier): { showLogo: boolean; showBranding: boolean } {
  return { showLogo: tier !== "free", showBranding: tier === "free" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/pdf-flags.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `showBranding` to the PDF document**

In `components/quote/QuotePDFDocument.tsx`:
- Add `showBranding?: boolean;` to `QuotePDFDocumentProps`.
- Destructure it in the component signature with a default: `showBranding = true,`.
- Wrap the brand footer line so it renders only when `showBranding`:

```tsx
          {showBranding && (
            <Text style={styles.footerBrand}>Made with Quota</Text>
          )}
```

- [ ] **Step 6: Thread `tier` through `generateQuotePDF`**

In `lib/quote-pdf.ts`:
- Import: `import { pdfFlagsForTier } from "@/lib/billing/pdf-flags";` and `import type { Tier } from "@/lib/subscription";`
- Add a final parameter to `generateQuotePDF`: `tier: Tier = "free"`.
- Replace the logo + element construction:

```ts
    const { showLogo, showBranding } = pdfFlagsForTier(tier);
    const logoSrc = showLogo && companyInfo.logoUrl
      ? await fetchLogoBuffer(companyInfo.logoUrl)
      : null;

    const pdfElement = QuotePDFDocument({
      quote,
      companyInfo,
      quoteNumber,
      quoteDate,
      validUntil,
      scheduleLines,
      paymentReceipt,
      logoSrc,
      showBranding,
    });
```

- [ ] **Step 7: Pass tier from the email sender**

In `lib/email-sender.ts`:
- Add a `tier: Tier` field to the `sendQuoteEmail` options type/signature (import `Tier` from `@/lib/subscription`). Place it alongside the other options; default it to `"free"` if the type allows optional, else make callers pass it.
- Forward it into the `generateQuotePDF(...)` call as the new last argument (`tier`).

In `app/api/send-quote/route.ts`:
- Where `sendQuoteEmail(...)` is invoked, pass `tier: user.subscription_tier as Tier` (import `Tier` from `@/lib/subscription`). Since the Free path already 403s (Task 3), this is always a paid tier here, but pass it explicitly.

- [ ] **Step 8: Pass tier from the PDF download route**

In `app/api/quotes/[id]/pdf/route.ts`:
- Import `Tier` from `@/lib/subscription`.
- At the `generateQuotePDF(...)` call, pass `(user.subscription_tier as Tier) ?? "free"` as the final `tier` argument.

- [ ] **Step 9: Verify + commit**

Run: `npm run type-check && npx vitest run lib/__tests__/pdf-flags.test.ts`
Expected: clean; 3 pass.

```bash
git add lib/billing/pdf-flags.ts lib/__tests__/pdf-flags.test.ts lib/quote-pdf.ts components/quote/QuotePDFDocument.tsx lib/email-sender.ts app/api/send-quote/route.ts "app/api/quotes/[id]/pdf/route.ts"
git commit -m "feat(billing): tier-gate logo (Pro+) and Made-with-Quota watermark (Free only) on PDFs"
```

---

### Task 5: Tier-aware Send button (Free → upgrade prompt + Download PDF)

**Files:**
- Modify: `components/quote/SendQuoteButton.tsx`

**Interfaces:**
- Consumes: `useSubscription()` (`sub.tier`); `UpgradeDialog` (`reason` prop routes Upgrade → `/billing`); the existing `/api/quotes/${quoteId}/pdf` download route.

- [ ] **Step 1: Read the current SendQuoteButton to learn its props/quote id source**

Run: `sed -n '1,60p' components/quote/SendQuoteButton.tsx`
(Confirm how it receives the quote id and how it currently triggers the send.)

- [ ] **Step 2: Make it tier-aware**

In `components/quote/SendQuoteButton.tsx`:
- Import `useSubscription` from `@/components/subscription/use-subscription`, `UpgradeDialog` from `@/components/subscription/UpgradeDialog`, and `useState`.
- Read `const { sub } = useSubscription();` and derive `const isFree = sub?.tier === "free";`.
- Add `const [upgradeOpen, setUpgradeOpen] = useState(false);`.
- When `isFree`, the primary Send control must NOT call the send flow. Instead its `onClick` calls `setUpgradeOpen(true)`. Keep the button labeled "Send" with `data-testid="send-quote-button"` (unchanged).
- Render, when `isFree`, an `UpgradeDialog`:

```tsx
      {isFree && (
        <UpgradeDialog
          open={upgradeOpen}
          onOpenChange={setUpgradeOpen}
          currentTier="free"
          reason="Email invoicing is a Pro feature. Upgrade to email, or download the PDF."
        />
      )}
```
- Add a Download PDF affordance for Free users next to Send — an anchor to the existing route (use the same quote id the component already has):

```tsx
      {isFree && (
        <a
          href={`/api/quotes/${quoteId}/pdf`}
          className="text-sm underline underline-offset-4 hover:text-accent"
          data-testid="download-pdf-link"
        >
          Download PDF
        </a>
      )}
```
- Paid tiers (`!isFree`) keep the current send behavior untouched.

- [ ] **Step 3: Verify + commit**

Run: `npm run type-check && npx next lint --file components/quote/SendQuoteButton.tsx`
Expected: clean (lint: no new warnings).

```bash
git add components/quote/SendQuoteButton.tsx
git commit -m "feat(billing): free-tier Send opens upgrade prompt + Download PDF"
```

---

### Task 6: Copy — "per month" + "this month"

**Files:**
- Modify: `lib/landing-copy.ts` (pricing bullets EN + ES)
- Modify: the quota badge/banner copy source (grep to locate)

**Interfaces:** none (copy only).

- [ ] **Step 1: Update pricing bullets (both locales)**

In `lib/landing-copy.ts`, change the Free and Pro quote bullets:
- EN: `"3 quotes"` → `"3 quotes / mo"`; `"15 quotes"` → `"15 quotes / mo"` (Ultimate stays `"Unlimited quotes"`).
- ES: `"3 presupuestos"` → `"3 presupuestos / mes"`; `"15 presupuestos"` → `"15 presupuestos / mes"` (Ultimate stays `"Presupuestos ilimitados"`).

- [ ] **Step 2: Update the quota badge/banner wording**

Run: `grep -rnE "quotes left|used all|quotes|No quotes" components/subscription/ | head`
For the strings that name the cap or remaining count on the dashboard badge and the New Quote banner, add "this month" so they read e.g. "used all 3 quotes this month" and "No quotes left this month". Change only the user-facing copy; do not touch testids or logic.

- [ ] **Step 3: Verify + commit**

Run: `npm run type-check && npx vitest run`
Expected: type-check clean; full suite green (copy change shouldn't break tests — if a test asserts old wording, update the assertion string to match).

```bash
git add lib/landing-copy.ts components/subscription/
git commit -m "copy(billing): quotes are per-month (\"/ mo\", \"this month\")"
```

---

### Task 7: e2e + full gate

**Files:**
- Modify: `e2e/tiers.spec.ts` (extend for the new gates)

**Interfaces:**
- Consumes: dev tier switch `PATCH /api/subscription { tier }` (`ALLOW_DEV_TIER_SWITCH`); testids `send-quote-button`, `upgrade-dialog`, `download-pdf-link`.

- [ ] **Step 1: Add free-send + PDF-download e2e**

Append to `e2e/tiers.spec.ts` (inside the `test.describe`) a test that, on the e2e user set to Free via the dev switch, opens an existing quote's page (or creates one within the monthly cap), asserts that clicking `send-quote-button` opens `upgrade-dialog` and that `download-pdf-link` is present, and asserts NO navigation to a sent state:

```ts
  test("free tier: Send opens upgrade prompt, offers Download PDF, does not email", async ({ page, request }) => {
    await request.patch("/api/subscription", { data: { tier: "free" } });
    // Open the most recent quote for the e2e user.
    await page.goto("/dashboard");
    await page.getByTestId("quote-row").first().click();
    await page.waitForURL(/\/quote\//);

    let emailed = false;
    await page.route("**/api/send-quote", (r) => { emailed = true; return r.abort(); });

    await page.getByTestId("send-quote-button").click();
    await expect(page.getByTestId("upgrade-dialog")).toBeVisible();
    await expect(page.getByTestId("download-pdf-link")).toBeVisible();
    expect(emailed).toBe(false);
  });
```

> Executor note: if `quote-row` isn't the dashboard row testid, grep `e2e/` for the existing quotes-list row testid and use that. If the e2e user has no quotes, create one first (the existing quote-flow helpers do this). Do not weaken the assertions.

- [ ] **Step 2: Confirm the existing over-cap test still holds**

The existing "free user at the cap is blocked" test now reflects the monthly count. If its assertion checks the 403 message text, update it to include "this month". Keep the block-at-save behavior assertion.

- [ ] **Step 3: Full gate** (stop any dev server first — config uses `reuseExistingServer:false`):

```bash
npx vitest run
npm run type-check
npm run lint
npx playwright test e2e/tiers.spec.ts e2e/quote-flow.spec.ts e2e/billing.spec.ts e2e/account-nav.spec.ts
```

Expected: all green (lint: only the 2 pre-existing warnings in `lib/email-sender.ts` + `lib/quote-calculations.ts` — note `email-sender.ts` is modified this plan; keep those warnings unchanged, don't introduce new ones).

- [ ] **Step 4: Commit**

```bash
git add e2e/tiers.spec.ts
git commit -m "test(e2e): free-tier send gate + monthly cap wording"
```

---

## Notes for the executor

- **Sole limiter is quote count.** Do not add any client/contact limit.
- **The Free email path is defended twice:** the server 403 (Task 3) and the UI upgrade prompt (Task 5). Both are required.
- **Tier default:** anywhere `subscription_tier` might be null, treat as `"free"`.
- The emailed PDF is always a paid tier (Free can't email), but pass `tier` explicitly through `sendQuoteEmail` so the renderer is correct if that ever changes.
