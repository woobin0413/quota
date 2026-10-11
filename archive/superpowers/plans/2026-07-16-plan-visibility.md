# Plan Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every user their tier name and quotes remaining — dashboard badge (re-worded), header plan chip, profile-settings plan row, and a low-quota banner on New Quote.

**Architecture:** `GET /api/subscription` gains server-computed `tierLabel` + `quotesRemaining`; a shared client hook `useSubscription()` fetches it; four small surfaces render it. Upgrade affordances open the existing UpgradeDialog (Stripe re-points them later).

**Tech Stack:** Next.js 14 App Router, existing `lib/subscription.ts` policy module, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-16-plan-visibility-design.md`

## Global Constraints

- Remaining-centric copy, exact strings from the spec's Copy table (e.g. badge `{TierLabel} · {n} quote{s} left`, zero `{TierLabel} · No quotes left`, unlimited `Ultimate · Unlimited quotes`).
- Server computes remaining: `quotesRemaining = max(0, limit - used)`, `null` = unlimited. UI never derives eligibility.
- All surfaces fail silent (render nothing / keep existing layout) when the fetch fails.
- testids: `quota-remaining`, `plan-chip`, `plan-row`, `quota-banner`. Existing testids unchanged.
- Zero-left count styled `text-destructive`.
- Gates per task: `npm run type-check && npm run lint` clean (2 pre-existing warnings in `lib/email-sender.ts` + `lib/quote-calculations.ts` OK).
- Branch: `feat/plan-visibility` (exists; specs committed).

## File Structure

| File | Responsibility |
|---|---|
| `app/api/subscription/route.ts` (modify GET) | +`tierLabel`, +`quotesRemaining` |
| `components/subscription/use-subscription.ts` (create) | `useSubscription()` client hook (fetch once per mount, null on fail) |
| `components/subscription/QuotaBadge.tsx` (modify) | Remaining-centric wording via the hook |
| `components/subscription/PlanChip.tsx` (create) + `components/layout/Header.tsx` (modify) | Header chip → UpgradeDialog |
| `components/settings/ProfileForm.tsx` (modify) | Plan row section |
| `components/quote/NewQuoteForm.tsx` (modify) | ≤1-remaining banner |
| `e2e/tiers.spec.ts` (modify) | Visibility assertions |

**Parallel groups:** Task 1 (API+hook+badge) must land first. Tasks 2 (chip+header), 3 (plan row), 4 (banner) are file-disjoint after Task 1 → MAY run as parallel subagents. Task 5 (e2e+gate) last.

---

### Task 1: API fields + useSubscription hook + badge rewording

**Files:**
- Modify: `app/api/subscription/route.ts` (GET response, ~line 35)
- Create: `components/subscription/use-subscription.ts`
- Modify: `components/subscription/QuotaBadge.tsx`

**Interfaces:**
- Produces for Tasks 2-4:
  - GET response adds `tierLabel: string`, `quotesRemaining: number | null`.
  - `useSubscription(): { sub: Subscription | null }` where `Subscription = { tier: Tier; tierLabel: string; quotesUsed: number; quoteLimit: number | null; quotesRemaining: number | null }` — `sub` is `null` while loading or on failure.

- [ ] **Step 1: Extend the GET response**

In `app/api/subscription/route.ts`, the GET currently returns `{ success, tier, quotesUsed, quoteLimit }`. Add the import `TIER_LABEL` from `@/lib/subscription` (already imports `QUOTE_LIMIT`, `type Tier`) and change the return to:

```ts
    return NextResponse.json({
      success: true,
      tier,
      tierLabel: TIER_LABEL[tier],
      quotesUsed,
      quoteLimit: Number.isFinite(limit) ? limit : null,
      quotesRemaining: Number.isFinite(limit) ? Math.max(0, limit - quotesUsed) : null,
    });
```

- [ ] **Step 2: Create the hook**

`components/subscription/use-subscription.ts`:

```ts
"use client";

/**
 * Client hook for the current user's plan + quote usage.
 * Each surface fetches independently (route is cheap; avoids client
 * cache invalidation). `sub` is null while loading or on any failure —
 * consumers render nothing in that case.
 */

import { useEffect, useState } from "react";
import type { Tier } from "@/lib/subscription";

export interface Subscription {
  tier: Tier;
  tierLabel: string;
  quotesUsed: number;
  quoteLimit: number | null;
  quotesRemaining: number | null;
}

export function useSubscription(): { sub: Subscription | null } {
  const [sub, setSub] = useState<Subscription | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.success) {
          setSub({
            tier: d.tier,
            tierLabel: d.tierLabel,
            quotesUsed: d.quotesUsed,
            quoteLimit: d.quoteLimit,
            quotesRemaining: d.quotesRemaining,
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return { sub };
}
```

- [ ] **Step 3: Reword QuotaBadge using the hook**

Rewrite `components/subscription/QuotaBadge.tsx` (replacing its inline fetch/state with the hook; keep testids `quota-badge`, `quota-upgrade`; keep the UpgradeDialog wiring):

```tsx
"use client";

/**
 * Dashboard quota badge: "{Tier} · N quotes left" (or "Unlimited quotes")
 * plus an upgrade entry point. Renders nothing until loaded / on failure.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UpgradeDialog } from "@/components/subscription/UpgradeDialog";
import { useSubscription } from "@/components/subscription/use-subscription";
import { nextTier } from "@/lib/subscription";

export function QuotaBadge() {
  const { sub } = useSubscription();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!sub) return null;

  const zero = sub.quotesRemaining === 0;
  const remainingLabel =
    sub.quotesRemaining === null
      ? "Unlimited quotes"
      : zero
        ? "No quotes left"
        : `${sub.quotesRemaining} quote${sub.quotesRemaining === 1 ? "" : "s"} left`;
  const canUpgrade = nextTier(sub.tier) !== null;

  return (
    <div className="flex items-center gap-3" data-testid="quota-badge">
      <span className="eyebrow">
        {sub.tierLabel} ·{" "}
        <span
          className={zero ? "text-destructive" : undefined}
          data-testid="quota-remaining"
        >
          {remainingLabel}
        </span>
      </span>
      {canUpgrade && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
          data-testid="quota-upgrade"
        >
          Upgrade
        </Button>
      )}
      <UpgradeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentTier={sub.tier}
      />
    </div>
  );
}
```

- [ ] **Step 4: Manual check**

Dev server on :3000 (authenticated browser session): dashboard badge reads `Ultimate · Unlimited quotes` for the e2e user. (Full state matrix verified in Task 5.)

- [ ] **Step 5: Gate + commit**

```bash
npm run type-check && npm run lint
git add app/api/subscription/route.ts components/subscription/use-subscription.ts components/subscription/QuotaBadge.tsx
git commit -m "feat(plan): remaining-centric subscription API + badge; useSubscription hook"
```

---

### Task 2: Header plan chip  [parallel after Task 1]

**Files:**
- Create: `components/subscription/PlanChip.tsx`
- Modify: `components/layout/Header.tsx` (mount next to the user menu)

**Interfaces:**
- Consumes: `useSubscription()` (Task 1), `UpgradeDialog` (existing).
- Produces: `<PlanChip />` — self-contained.

- [ ] **Step 1: PlanChip**

`components/subscription/PlanChip.tsx`:

```tsx
"use client";

/**
 * Header plan chip: always-visible tier label; click opens the
 * UpgradeDialog. Renders nothing until the subscription loads.
 */

import { useState } from "react";
import { UpgradeDialog } from "@/components/subscription/UpgradeDialog";
import { useSubscription } from "@/components/subscription/use-subscription";

export function PlanChip() {
  const { sub } = useSubscription();
  const [open, setOpen] = useState(false);

  if (!sub) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="stamp border-primary-foreground/40 text-primary-foreground/80 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        data-testid="plan-chip"
        aria-label={`Current plan: ${sub.tierLabel}. Open upgrade options.`}
      >
        {sub.tierLabel}
      </button>
      <UpgradeDialog open={open} onOpenChange={setOpen} currentTier={sub.tier} />
    </>
  );
}
```

- [ ] **Step 2: Mount in the header**

Read `components/layout/Header.tsx`. The header is a client component with a navy band; the user menu trigger (`data-testid="user-menu-trigger"`) sits on the right. Import `PlanChip` and render it immediately BEFORE the user-menu dropdown in the right-side flex group:

```tsx
import { PlanChip } from "@/components/subscription/PlanChip";
```
```tsx
          <PlanChip />
```

(Place inside the existing right-side container so spacing matches; if the container lacks a gap, wrap with the header's existing spacing conventions. Only render for authenticated users — the header already gates its user area on `useUser()`; put PlanChip inside that authenticated branch.)

- [ ] **Step 3: Gate + commit**

```bash
npm run type-check && npm run lint
git add components/subscription/PlanChip.tsx components/layout/Header.tsx
git commit -m "feat(plan): header plan chip"
```

---

### Task 3: Profile-settings plan row  [parallel after Task 1]

**Files:**
- Modify: `components/settings/ProfileForm.tsx`

**Interfaces:**
- Consumes: `useSubscription()` (Task 1), `UpgradeDialog`, `TIER_PRICE` from `@/lib/subscription`.

- [ ] **Step 1: Add the plan row**

In `components/settings/ProfileForm.tsx`, add imports:

```tsx
import { UpgradeDialog } from "@/components/subscription/UpgradeDialog";
import { useSubscription } from "@/components/subscription/use-subscription";
import { TIER_PRICE } from "@/lib/subscription";
```

Add state next to the existing useStates:

```tsx
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
```

Insert a Plan section between `<LogoUploader …/>` and the Company Name field (inside the form, but the row is display-only — no form fields):

```tsx
      <PlanRow onUpgrade={() => setPlanDialogOpen(true)} />
```

And at the bottom of the component file, add the row component (kept in the same file — it's settings-dialog-specific):

```tsx
function PlanRow({ onUpgrade }: { onUpgrade: () => void }) {
  const { sub } = useSubscription();
  if (!sub) return null;

  const usage =
    sub.quoteLimit === null
      ? "Unlimited quotes"
      : `${sub.quotesUsed} of ${sub.quoteLimit} used (${sub.quotesRemaining} left)`;
  const price = sub.tier === "free" ? "Free plan" : `${TIER_PRICE[sub.tier]}/mo`;

  return (
    <div
      className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2"
      data-testid="plan-row"
    >
      <div>
        <p className="eyebrow">Plan</p>
        <p className="text-sm font-medium">
          {sub.tierLabel} · {price} · {usage}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onUpgrade}>
        Upgrade
      </Button>
    </div>
  );
}
```

Render the dialog once near the end of the main component's JSX (inside the returned fragment/form container, matching how the file structures trailing elements):

```tsx
      {planDialogOpen && sub is not needed here — the dialog needs currentTier:
```

Correction — the dialog needs `currentTier`. Lift the hook into `ProfileForm` itself instead of inside `PlanRow`:

```tsx
  const { sub } = useSubscription();
```

`PlanRow` becomes a pure display of `sub` passed as a prop:

```tsx
      {sub && <PlanRow sub={sub} onUpgrade={() => setPlanDialogOpen(true)} />}
      …
      {sub && (
        <UpgradeDialog
          open={planDialogOpen}
          onOpenChange={setPlanDialogOpen}
          currentTier={sub.tier}
        />
      )}
```

```tsx
function PlanRow({ sub, onUpgrade }: { sub: Subscription; onUpgrade: () => void }) {
  const usage =
    sub.quoteLimit === null
      ? "Unlimited quotes"
      : `${sub.quotesUsed} of ${sub.quoteLimit} used (${sub.quotesRemaining} left)`;
  const price = sub.tier === "free" ? "Free plan" : `${TIER_PRICE[sub.tier]}/mo`;

  return (
    <div
      className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2"
      data-testid="plan-row"
    >
      <div>
        <p className="eyebrow">Plan</p>
        <p className="text-sm font-medium">
          {sub.tierLabel} · {price} · {usage}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onUpgrade}>
        Upgrade
      </Button>
    </div>
  );
}
```

with `import type { Subscription } from "@/components/subscription/use-subscription";`. Ensure `Button` is already imported in the file (it is — the form uses it).

- [ ] **Step 2: Gate + commit**

```bash
npm run type-check && npm run lint
git add components/settings/ProfileForm.tsx
git commit -m "feat(plan): plan row in profile settings"
```

---

### Task 4: New Quote low-quota banner  [parallel after Task 1]

**Files:**
- Modify: `components/quote/NewQuoteForm.tsx`

**Interfaces:**
- Consumes: `useSubscription()` (Task 1), existing `upgrade` state + `UpgradeDialog` wiring already present in this file (from the 403 conversion), `nextTier`, `TIER_LABEL`, `quoteLimitLabel` from `@/lib/subscription`.

- [ ] **Step 1: Banner**

In `components/quote/NewQuoteForm.tsx`:

Imports (extend the existing `@/lib/subscription` import which already brings `type Tier`):

```tsx
import { nextTier, TIER_LABEL, quoteLimitLabel, type Tier } from "@/lib/subscription";
import { useSubscription } from "@/components/subscription/use-subscription";
```

Inside the component, add:

```tsx
  const { sub } = useSubscription();
```

Render the banner at the very top of the returned JSX (above the quote builder, inside the outer container):

```tsx
      {sub && sub.quotesRemaining !== null && sub.quotesRemaining <= 1 && (
        <div
          className="mb-4 flex items-center justify-between border border-accent bg-accent/10 px-4 py-3"
          data-testid="quota-banner"
        >
          <p className="text-sm">
            {sub.quotesRemaining === 1 ? (
              <>
                Last quote on your {sub.tierLabel} plan
                {nextTier(sub.tier) && (
                  <>
                    {" "}— {TIER_LABEL[nextTier(sub.tier)!]} gives you{" "}
                    {quoteLimitLabel(nextTier(sub.tier)!).toLowerCase() === "unlimited"
                      ? "unlimited quotes"
                      : `${quoteLimitLabel(nextTier(sub.tier)!)} quotes`}
                  </>
                )}
                .
              </>
            ) : (
              <>You&apos;ve used all {sub.quoteLimit} quotes on {sub.tierLabel}.</>
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setUpgrade({
                tier: sub.tier,
                reason:
                  sub.quotesRemaining === 0
                    ? `You've used all ${sub.quoteLimit} quotes on your ${sub.tierLabel} plan.`
                    : `Last quote on your ${sub.tierLabel} plan — upgrade to keep quoting.`,
              })
            }
          >
            Upgrade
          </Button>
        </div>
      )}
```

Notes: the file already has `upgrade` state of type `{ tier: Tier; reason: string } | null` and renders `UpgradeDialog` from it (the 403 conversion) — the banner reuses exactly that state/dialog; do NOT add a second dialog. Confirm `Button` import exists (it does).

- [ ] **Step 2: Gate + commit**

```bash
npm run type-check && npm run lint
git add components/quote/NewQuoteForm.tsx
git commit -m "feat(plan): low-quota banner on new quote"
```

---

### Task 5: e2e + gate

**Files:**
- Modify: `e2e/tiers.spec.ts`

- [ ] **Step 1: extend the API test + add a visibility test**

In the existing `subscription API reports usage` test, add after the current expects:

```ts
    expect(body.tierLabel).toBe("Pro");
    expect(body.quotesRemaining).toBe(Math.max(0, 15 - body.quotesUsed));
```

Add a new test inside the describe (afterEach already restores ultimate):

```ts
  test("plan visibility surfaces show tier and remaining", async ({ page, request }) => {
    await request.patch("/api/subscription", { data: { tier: "free" } });

    // Dashboard: badge shows tier + zero-remaining state (e2e user is over the cap)
    await page.goto("/dashboard");
    await expect(page.getByTestId("quota-badge")).toContainText("Free");
    await expect(page.getByTestId("quota-remaining")).toHaveText("No quotes left");

    // Header chip visible on any authenticated page
    await expect(page.getByTestId("plan-chip")).toHaveText("Free");

    // New Quote banner appears at 0 remaining
    await page.goto("/new-quote");
    await expect(page.getByTestId("quota-banner")).toBeVisible();
    await expect(page.getByTestId("quota-banner")).toContainText("used all 3 quotes");
  });
```

- [ ] **Step 2: run**

```bash
lsof -ti:3000 | xargs kill 2>/dev/null
npx playwright test e2e/tiers.spec.ts
```
Expected: 3 tests + setup pass.

- [ ] **Step 3: full gate**

```bash
npm run type-check && npm run lint && npm run test:unit && npx playwright test e2e/tiers.spec.ts e2e/quote-flow.spec.ts
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/tiers.spec.ts
git commit -m "test(plan): visibility assertions — badge, chip, banner, API fields"
```

- [ ] **Step 5 (controller): visual pass** — screenshots: badge (free + ultimate), header chip, settings plan row, new-quote banner.

---

## Self-Review Notes

- **Spec coverage:** API fields (T1), badge rewording + zero-red (T1), chip (T2), plan row (T3), banner both variants (T4), silent-fail via hook null (T1 hook consumed everywhere), exact copy strings from the spec table embedded in code, e2e (T5).
- **Type consistency:** `Subscription` interface (T1) consumed in T3 (`import type`); `useSubscription` named identically T1→T2→T3→T4; testids `quota-remaining`/`plan-chip`/`plan-row`/`quota-banner` match T5 assertions; banner reuses NewQuoteForm's existing `upgrade` state shape `{ tier, reason }`.
- **Fixed during self-review:** T3 originally hooked inside PlanRow but the dialog needs `currentTier` — lifted the hook to ProfileForm and made PlanRow a pure prop component (both the wrong and corrected versions shown; implement the corrected one).
- **Parallel-safety:** T2/T3/T4 file-disjoint after T1; T5 last.
