# Quote Tier Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce per-tier lifetime quote limits (Free 3 / Pro 15 / Ultimate ∞) with a self-serve upgrade flow, a quota badge, an upgrade dialog, a "Made with Quota" PDF footer on all tiers, and realigned landing pricing copy.

**Architecture:** A single policy module (`lib/subscription.ts`) holds the tier→limit map and upgrade ladder. Enforcement is one server chokepoint in `/api/quotes` POST that live-counts the user's existing quotes against `QUOTE_LIMIT[tier]`. Upgrades go through a self-serve `PATCH /api/subscription` (billing placeholder). UI reads `GET /api/subscription` for the badge and converts the 403 limit response into an UpgradeDialog moment.

**Tech Stack:** Next.js 14 App Router, Supabase, Vitest, Playwright, @react-pdf/renderer.

**Spec:** `docs/superpowers/specs/2026-07-15-quote-tier-limits-design.md`

## Global Constraints

- Tiers: **`free | pro | ultimate`** (replaces `free | pro | enterprise`).
- Lifetime quote limits: **Free 3, Pro 15, Ultimate ∞** — enforced as a **live count of existing (non-deleted) quotes**; deleting a quote frees a slot.
- Quote count is the ONLY limiter. All features (send/milestones/logo/receipts) stay ungated. No client cap.
- Upgrade is self-serve/instant/no payment — persuasive "upgrade now" copy, never "join the list."
- Prices for copy: Free **$0**, Pro **$15**, Ultimate **$29**.
- "Made with Quota" PDF footer on **ALL** tiers (no tier logic).
- Landing bullets realign: Free "3 quotes", Pro "15 quotes", Ultimate "Unlimited quotes" (EN + ES).
- Voice-to-invoice stays listed on pricing but unbuilt/unenforced.
- Server is authoritative — the UI never decides eligibility.
- Gates per task: `npm run type-check && npm run lint` clean (2 pre-existing warnings in `lib/email-sender.ts` + `lib/quote-calculations.ts` OK).
- Branch: `feat/quote-tier-limits`.

## File Structure

| File | Responsibility |
|---|---|
| `lib/subscription.ts` (create) | Tier policy: `Tier`, `QUOTE_LIMIT`, `TIER_LABEL`, `TIER_PRICE`, `nextTier`, `quoteLimitLabel` |
| `lib/__tests__/subscription.test.ts` (create) | Unit tests for the policy |
| `types/database.ts` (modify) | `SubscriptionTier` → `free\|pro\|ultimate` |
| `db/migrations/009_tier_ultimate.sql` + `009_rollback.sql` + supabase mirror | CHECK constraint + data migration |
| `lib/db/users.ts` (modify) | `updateSubscription(userId, tier)` (drop limit); add `countUserQuotes(userId)` |
| `app/api/quotes/route.ts` (modify) | Swap `checkQuotaLimit` → tier count check |
| `app/api/subscription/route.ts` (create) | `GET` (tier + usage) / `PATCH` (set tier) |
| `components/subscription/UpgradeDialog.tsx` (create) | 3-plan upgrade dialog |
| `components/subscription/QuotaBadge.tsx` (create) | Usage badge + upgrade entry |
| `components/quote/NewQuoteForm.tsx` (modify) | Convert 403 QUOTE_LIMIT → UpgradeDialog |
| `components/dashboard/DashboardContent.tsx` (modify) | Mount QuotaBadge |
| `components/quote/QuotePDFDocument.tsx` (modify) | "Made with Quota" footer line |
| `lib/landing-copy.ts` (modify) | Pricing bullets EN + ES |
| `e2e/global.setup.ts` (modify) | Baseline e2e user → ultimate |
| `e2e/tiers.spec.ts` (create) | Limit → upgrade → unblock journey |

**Parallel groups:** Task 5 (PDF footer + landing copy) shares no files with Tasks 1–4 → MAY run parallel. Tasks 1→2→3→4 are sequential (type → repo → API → UI). Task 6 last.

---

### Task 1: Tier policy module + type change (TDD)

**Files:**
- Create: `lib/subscription.ts`, `lib/__tests__/subscription.test.ts`
- Modify: `types/database.ts:14`

**Interfaces:**
- Produces: `type Tier = SubscriptionTier`; `QUOTE_LIMIT: Record<Tier, number>`; `TIER_LABEL`/`TIER_PRICE: Record<Tier, string>`; `TIERS: Tier[]`; `nextTier(t: Tier): Tier | null`; `quoteLimitLabel(t: Tier): string`. Tasks 3–4 consume these.

- [ ] **Step 1: Change the DB type**

`types/database.ts` line 14:

```ts
export type SubscriptionTier = "free" | "pro" | "ultimate";
```

- [ ] **Step 2: Write failing tests**

`lib/__tests__/subscription.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  QUOTE_LIMIT, TIER_LABEL, TIER_PRICE, TIERS,
  nextTier, quoteLimitLabel,
} from "../subscription";

describe("QUOTE_LIMIT", () => {
  it("free is 3", () => expect(QUOTE_LIMIT.free).toBe(3));
  it("pro is 15", () => expect(QUOTE_LIMIT.pro).toBe(15));
  it("ultimate is unlimited", () => expect(QUOTE_LIMIT.ultimate).toBe(Infinity));
});

describe("nextTier ladder", () => {
  it("free → pro", () => expect(nextTier("free")).toBe("pro"));
  it("pro → ultimate", () => expect(nextTier("pro")).toBe("ultimate"));
  it("ultimate → null (top)", () => expect(nextTier("ultimate")).toBeNull());
});

describe("quoteLimitLabel", () => {
  it("finite → number string", () => expect(quoteLimitLabel("free")).toBe("3"));
  it("infinite → Unlimited", () => expect(quoteLimitLabel("ultimate")).toBe("Unlimited"));
});

describe("metadata tables", () => {
  it("labels", () => expect([TIER_LABEL.free, TIER_LABEL.pro, TIER_LABEL.ultimate]).toEqual(["Free","Pro","Ultimate"]));
  it("prices", () => expect([TIER_PRICE.free, TIER_PRICE.pro, TIER_PRICE.ultimate]).toEqual(["$0","$15","$29"]));
  it("order", () => expect(TIERS).toEqual(["free","pro","ultimate"]));
});
```

- [ ] **Step 3: Run — expect fail**

Run: `npx vitest run lib/__tests__/subscription.test.ts`
Expected: FAIL — `Cannot find module '../subscription'`

- [ ] **Step 4: Implement**

`lib/subscription.ts`:

```ts
/**
 * Subscription tier policy — the single source of truth for quote limits
 * and the upgrade ladder. Quote count is the only limiter; every tier gets
 * every feature. Limits are lifetime, enforced as a live count of a user's
 * existing (non-deleted) quotes.
 */

import type { SubscriptionTier } from "@/types/database";

export type Tier = SubscriptionTier;

export const TIERS: Tier[] = ["free", "pro", "ultimate"];

export const QUOTE_LIMIT: Record<Tier, number> = {
  free: 3,
  pro: 15,
  ultimate: Infinity,
};

export const TIER_LABEL: Record<Tier, string> = {
  free: "Free",
  pro: "Pro",
  ultimate: "Ultimate",
};

export const TIER_PRICE: Record<Tier, string> = {
  free: "$0",
  pro: "$15",
  ultimate: "$29",
};

/** The next tier up (raises the quote ceiling); null at the top. */
export function nextTier(tier: Tier): Tier | null {
  const i = TIERS.indexOf(tier);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
}

/** Human label for a tier's quote ceiling. */
export function quoteLimitLabel(tier: Tier): string {
  const n = QUOTE_LIMIT[tier];
  return Number.isFinite(n) ? String(n) : "Unlimited";
}
```

- [ ] **Step 5: Run — expect pass**

Run: `npx vitest run lib/__tests__/subscription.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 6: Gate + commit**

```bash
npm run type-check && npm run lint
git add lib/subscription.ts lib/__tests__/subscription.test.ts types/database.ts
git commit -m "feat(tiers): subscription policy module + free|pro|ultimate type"
```

Note: changing `SubscriptionTier` may surface a type error in `lib/db/users.ts` `updateSubscription` (which hardcodes `"enterprise"`). That's fixed in Task 2 — if `type-check` fails here on exactly that line, proceed to commit anyway ONLY if the failure is confined to `updateSubscription`'s `"enterprise"` literal; otherwise fix the surfaced caller. (Recommended: do Tasks 1+2 back-to-back.)

---

### Task 2: Migration + repo helpers

**Files:**
- Create: `db/migrations/009_tier_ultimate.sql`, `db/migrations/009_rollback.sql`, `supabase/migrations/20260715000000_tier_ultimate.sql`
- Modify: `lib/db/users.ts` (`updateSubscription`, add `countUserQuotes`)

**Interfaces:**
- Consumes: `SubscriptionTier` (Task 1).
- Produces: `updateSubscription(userId: string, tier: SubscriptionTier): Promise<User>`; `countUserQuotes(userId: string): Promise<number>`. Task 3 consumes both.

- [ ] **Step 1: Migration files**

`db/migrations/009_tier_ultimate.sql`:

```sql
-- 009: rename subscription tier 'enterprise' → 'ultimate'

UPDATE users SET subscription_tier = 'ultimate' WHERE subscription_tier = 'enterprise';

ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_subscription_tier;
ALTER TABLE users ADD CONSTRAINT valid_subscription_tier
  CHECK (subscription_tier IN ('free', 'pro', 'ultimate'));
```

`db/migrations/009_rollback.sql`:

```sql
-- Rollback 009
UPDATE users SET subscription_tier = 'enterprise' WHERE subscription_tier = 'ultimate';
ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_subscription_tier;
ALTER TABLE users ADD CONSTRAINT valid_subscription_tier
  CHECK (subscription_tier IN ('free', 'pro', 'enterprise'));
```

Mirror: `cp db/migrations/009_tier_ultimate.sql supabase/migrations/20260715000000_tier_ultimate.sql`

- [ ] **Step 2: Apply + verify (local DB running)**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f db/migrations/009_tier_ultimate.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='valid_subscription_tier';"
```
Expected: constraint def contains `('free'::character varying, 'pro'::character varying, 'ultimate'::character varying)`.

- [ ] **Step 3: Fix `updateSubscription`**

In `lib/db/users.ts`, replace the `updateSubscription` function (~line 375):

```ts
/**
 * Set a user's subscription tier. Self-serve for now (no billing);
 * the quote limit is derived from the tier at enforcement time, so no
 * per-user limit column is written.
 */
export async function updateSubscription(
  userId: string,
  tier: SubscriptionTier
): Promise<User> {
  const { data: row, error } = await supabaseAdmin
    .from("users")
    .update({ subscription_tier: tier })
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new NotFoundError("User not found", "User", userId);
    }
    throw error;
  }

  return transformUser(row as UserRow);
}
```

- [ ] **Step 4: Add `countUserQuotes`**

Append to `lib/db/users.ts`:

```ts
/**
 * Count a user's existing (non-deleted) quotes — the live basis for
 * lifetime tier limits.
 */
export async function countUserQuotes(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
  return count ?? 0;
}
```

- [ ] **Step 5: Gate + commit**

```bash
npm run type-check && npm run lint
git add db/migrations/009_tier_ultimate.sql db/migrations/009_rollback.sql supabase/migrations/20260715000000_tier_ultimate.sql lib/db/users.ts
git commit -m "feat(tiers): ultimate tier migration; updateSubscription + countUserQuotes"
```

---

### Task 3: Enforcement + subscription API

**Files:**
- Modify: `app/api/quotes/route.ts` (~lines 20, 93–105)
- Create: `app/api/subscription/route.ts`

**Interfaces:**
- Consumes: `QUOTE_LIMIT`, `TIER_LABEL`, `quoteLimitLabel`, `nextTier` (Task 1); `updateSubscription`, `countUserQuotes` (Task 2).
- Produces:
  - `/api/quotes` POST → 403 `{ success:false, code:"QUOTE_LIMIT", tier, limit, message }` when at cap.
  - `GET /api/subscription` → `{ success:true, tier, quotesUsed, quoteLimit }` (`quoteLimit` is a number or `null` for ∞).
  - `PATCH /api/subscription` `{ tier }` → `{ success:true, tier }`.

- [ ] **Step 1: Swap enforcement in `/api/quotes`**

Remove the `checkQuotaLimit` import (line ~21) and replace the "3. Check quota" block (lines ~93–105) with:

```ts
    // 3. Enforce the tier's lifetime quote limit (quote count is the only limiter)
    const tier = user.subscription_tier as Tier;
    const limit = QUOTE_LIMIT[tier];
    if (Number.isFinite(limit)) {
      const used = await countUserQuotes(user.id);
      if (used >= limit) {
        return NextResponse.json(
          {
            success: false,
            code: "QUOTE_LIMIT",
            tier,
            limit,
            message: `You've used all ${limit} quotes on your ${TIER_LABEL[tier]} plan.`,
          },
          { status: 403 }
        );
      }
    }
```

Add imports at the top:

```ts
import { QUOTE_LIMIT, TIER_LABEL, type Tier } from "@/lib/subscription";
import { countUserQuotes } from "@/lib/db/users";
```

(The dormant `checkQuotaLimit`/`getQuotaInfo` stay in `lib/db/users.ts` unused; leaving them is fine — do not delete in this task.)

- [ ] **Step 2: Create the subscription route**

`app/api/subscription/route.ts`:

```ts
/**
 * Subscription Route
 *
 * GET   /api/subscription — current tier + quote usage (for badges)
 * PATCH /api/subscription — set tier. Self-serve/instant, no payment:
 *   this is the seam where real billing gating will live later.
 *
 * @module api/subscription
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { countUserQuotes, updateSubscription } from "@/lib/db/users";
import { QUOTE_LIMIT, type Tier } from "@/lib/subscription";
import { logger } from "@/lib/logger";

function unauthorized() {
  return NextResponse.json(
    { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
    { status: 401 }
  );
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const tier = user.subscription_tier as Tier;
    const limit = QUOTE_LIMIT[tier];
    const quotesUsed = await countUserQuotes(user.id);

    return NextResponse.json({
      success: true,
      tier,
      quotesUsed,
      quoteLimit: Number.isFinite(limit) ? limit : null,
    });
  } catch (error) {
    logger.error("Subscription GET error", { err: error, route: "GET /api/subscription" });
    return NextResponse.json(
      { success: false, message: "Failed to load plan", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({ tier: z.enum(["free", "pro", "ultimate"]) });

export async function PATCH(request: NextRequest) {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    userId = user.id;

    const parsed = await parseJsonBody(request, patchSchema);
    if (parsed.response) return parsed.response;

    await updateSubscription(user.id, parsed.data.tier);
    return NextResponse.json({ success: true, tier: parsed.data.tier });
  } catch (error) {
    logger.error("Subscription PATCH error", {
      err: error,
      route: "PATCH /api/subscription",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to update plan", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Verify with curl (dev server running, authenticated cookie needed)**

Unauthenticated smoke (middleware requires session on `/api/*` except public list):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/subscription
# → 401 (or redirect) — proves the guard; authenticated paths are covered by Task 6 e2e
```

- [ ] **Step 4: Gate + commit**

```bash
npm run type-check && npm run lint
git add app/api/quotes/route.ts app/api/subscription/route.ts
git commit -m "feat(tiers): enforce quote limit in /api/quotes; subscription GET/PATCH"
```

---

### Task 4: Quota badge + upgrade dialog + limit-hit conversion

**Files:**
- Create: `components/subscription/UpgradeDialog.tsx`, `components/subscription/QuotaBadge.tsx`
- Modify: `components/quote/NewQuoteForm.tsx`, `components/dashboard/DashboardContent.tsx`

**Interfaces:**
- Consumes: `TIERS`, `TIER_LABEL`, `TIER_PRICE`, `QUOTE_LIMIT`, `quoteLimitLabel`, `nextTier`, `type Tier` (Task 1); `GET`/`PATCH /api/subscription` (Task 3).
- Produces: `<UpgradeDialog open onOpenChange currentTier reason? />`; `<QuotaBadge />`.

- [ ] **Step 1: UpgradeDialog**

`components/subscription/UpgradeDialog.tsx`:

```tsx
"use client";

/**
 * Upgrade dialog — three plan cards with the current plan marked and an
 * upgrade button per higher tier. Self-serve: PATCH /api/subscription then
 * refresh. `reason` shows a persuasive line (e.g. the limit-hit message).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Loader2 } from "lucide-react";
import {
  TIERS, TIER_LABEL, TIER_PRICE, quoteLimitLabel, type Tier,
} from "@/lib/subscription";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier: Tier;
  reason?: string;
}

export function UpgradeDialog({ open, onOpenChange, currentTier, reason }: UpgradeDialogProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentIndex = TIERS.indexOf(currentTier);

  const choose = async (tier: Tier) => {
    setBusy(tier);
    setError(null);
    try {
      const res = await fetch("/api/subscription", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Upgrade failed");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upgrade failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="upgrade-dialog">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-wide">Upgrade your plan</DialogTitle>
          <DialogDescription>
            {reason ?? "More quotes, same Quota. Upgrade any time."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          {TIERS.map((tier, i) => {
            const isCurrent = tier === currentTier;
            const isUpgrade = i > currentIndex;
            return (
              <div
                key={tier}
                className={`flex flex-col border p-4 ${isCurrent ? "border-2 border-primary" : ""}`}
                data-testid={`plan-${tier}`}
              >
                <p className="font-display text-sm font-bold uppercase tracking-wide">{TIER_LABEL[tier]}</p>
                <p className="mt-1">
                  <span className="figure text-2xl font-bold">{TIER_PRICE[tier]}</span>
                  {tier !== "free" && <span className="text-xs text-muted-foreground">/mo</span>}
                </p>
                <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-accent" aria-hidden="true" />
                  {quoteLimitLabel(tier)} quotes
                </p>
                <div className="mt-auto pt-4">
                  {isCurrent ? (
                    <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Current plan
                    </p>
                  ) : isUpgrade ? (
                    <Button
                      className="w-full"
                      onClick={() => choose(tier)}
                      disabled={busy !== null}
                      data-testid={`upgrade-to-${tier}`}
                    >
                      {busy === tier ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        `Upgrade to ${TIER_LABEL[tier]}`
                      )}
                    </Button>
                  ) : (
                    <Button variant="outline" className="w-full" onClick={() => choose(tier)} disabled={busy !== null}>
                      Switch to {TIER_LABEL[tier]}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: QuotaBadge**

`components/subscription/QuotaBadge.tsx`:

```tsx
"use client";

/**
 * Dashboard quota badge: "N of M quotes" (or "Unlimited") + an upgrade
 * entry point. Reads GET /api/subscription; renders nothing on failure.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { UpgradeDialog } from "@/components/subscription/UpgradeDialog";
import { nextTier, type Tier } from "@/lib/subscription";

interface Usage {
  tier: Tier;
  quotesUsed: number;
  quoteLimit: number | null;
}

export function QuotaBadge() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetch("/api/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.success && setUsage({ tier: d.tier, quotesUsed: d.quotesUsed, quoteLimit: d.quoteLimit }))
      .catch(() => {});
  }, []);

  if (!usage) return null;

  const label =
    usage.quoteLimit === null
      ? "Unlimited quotes"
      : `${usage.quotesUsed} of ${usage.quoteLimit} quotes`;
  const canUpgrade = nextTier(usage.tier) !== null;

  return (
    <div className="flex items-center gap-3" data-testid="quota-badge">
      <span className="eyebrow">{label}</span>
      {canUpgrade && (
        <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)} data-testid="quota-upgrade">
          Upgrade
        </Button>
      )}
      <UpgradeDialog open={dialogOpen} onOpenChange={setDialogOpen} currentTier={usage.tier} />
    </div>
  );
}
```

- [ ] **Step 3: Convert the 403 in NewQuoteForm**

In `components/quote/NewQuoteForm.tsx`, add state near the other `useState`s:

```tsx
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);
```

Import at the top:

```tsx
import { UpgradeDialog } from "@/components/subscription/UpgradeDialog";
import { useUser } from "@auth0/nextjs-auth0";
```

In `handleSave`, after `const response = await fetch("/api/quotes", …)` and `const data = await response.json()`, before the generic error handling, add:

```tsx
      if (response.status === 403 && data.code === "QUOTE_LIMIT") {
        setUpgradeReason(
          `${data.message} Upgrade to keep quoting.`
        );
        setIsSaving(false);
        return;
      }
```

Render the dialog at the end of the component's JSX (needs the current tier — fetch it lazily inside UpgradeDialog is not available, so pass the tier from the 403 payload):

```tsx
      {upgradeReason && (
        <UpgradeDialog
          open={true}
          onOpenChange={(o) => !o && setUpgradeReason(null)}
          currentTier={"free" as const}
          reason={upgradeReason}
        />
      )}
```

Note: the 403 payload carries `tier`, so prefer storing it. Replace the `upgradeReason` string state with an object:

```tsx
  const [upgrade, setUpgrade] = useState<{ tier: Tier; reason: string } | null>(null);
```
```tsx
      if (response.status === 403 && data.code === "QUOTE_LIMIT") {
        setUpgrade({ tier: data.tier, reason: `${data.message} Upgrade to keep quoting.` });
        setIsSaving(false);
        return;
      }
```
```tsx
      {upgrade && (
        <UpgradeDialog
          open={true}
          onOpenChange={(o) => !o && setUpgrade(null)}
          currentTier={upgrade.tier}
          reason={upgrade.reason}
        />
      )}
```
with `import { type Tier } from "@/lib/subscription";` added. Drop the unused `useUser` import if not otherwise needed.

- [ ] **Step 4: Mount the badge**

In `components/dashboard/DashboardContent.tsx`, import and render `<QuotaBadge />` in the dashboard header row (near the "New Quote" action — match the existing header layout; place it left of or beside the primary action). Import:

```tsx
import { QuotaBadge } from "@/components/subscription/QuotaBadge";
```

- [ ] **Step 5: Gate + commit**

```bash
npm run type-check && npm run lint
git add components/subscription/UpgradeDialog.tsx components/subscription/QuotaBadge.tsx components/quote/NewQuoteForm.tsx components/dashboard/DashboardContent.tsx
git commit -m "feat(tiers): quota badge, upgrade dialog, limit-hit conversion"
```

---

### Task 5: PDF footer + landing copy  [parallel-group]

**Files:**
- Modify: `components/quote/QuotePDFDocument.tsx` (footer ~line 562, styles ~line 267)
- Modify: `lib/landing-copy.ts` (EN tiers ~line 93, ES tiers ~line 172)

**Interfaces:** none consumed/produced; content-only.

- [ ] **Step 1: PDF footer line**

In `components/quote/QuotePDFDocument.tsx`, add a style near `footerThankYou` (in `StyleSheet.create`):

```ts
  footerBrand: {
    fontSize: 7,
    color: MUTED,
    marginTop: 3,
  },
```

(Use whatever the file names its muted color constant — check the top of the file; if it's not `MUTED`, match the existing footer text color.)

In the footer `<View style={styles.footer} fixed>` block, after the contact `<Text>`:

```tsx
          <Text style={styles.footerBrand}>Made with Quota</Text>
```

- [ ] **Step 2: Landing pricing bullets (EN)**

In `lib/landing-copy.ts`, EN `pricing.tiers` (~line 93), change the bullet arrays:

```ts
        { name: "Free", price: "$0", blurb: "For trying it on a real job", bullets: ["3 quotes", "PDF export", "Milestone schedules", "“Made with Quota” footer"] },
        { name: "Pro", price: "$15", blurb: "For the working contractor", bullets: ["15 quotes", "Email invoicing", "Your logo on PDFs", "Payment tracking"] },
        { name: "Ultimate", price: "$29", blurb: "Everything, plus what's next", bullets: ["Unlimited quotes", "Payment receipts", "Follow-up reminders", "Voice-to-invoice at launch", "Spanish client documents"] },
```

- [ ] **Step 3: Landing pricing bullets (ES)**

ES `pricing.tiers` (~line 172):

```ts
        { name: "Free", price: "$0", blurb: "Para probarlo en un trabajo real", bullets: ["3 presupuestos", "Exportar PDF", "Calendario de pagos", "Pie “Hecho con Quota”"] },
        { name: "Pro", price: "$15", blurb: "Para el contratista en activo", bullets: ["15 presupuestos", "Facturas por correo", "Tu logo en los PDF", "Seguimiento de pagos"] },
        { name: "Ultimate", price: "$29", blurb: "Todo, más lo que viene", bullets: ["Presupuestos ilimitados", "Recibos de pago", "Recordatorios de seguimiento", "Voz a factura al lanzar", "Documentos en español para clientes"] },
```

- [ ] **Step 4: Gate + commit**

```bash
npm run type-check && npm run lint
git add components/quote/QuotePDFDocument.tsx lib/landing-copy.ts
git commit -m "feat(tiers): Made with Quota PDF footer; realign landing pricing to quote limits"
```

---

### Task 6: e2e journey + baseline + full gate

**Files:**
- Modify: `e2e/global.setup.ts`
- Create: `e2e/tiers.spec.ts`

**Why the baseline edit:** enforcement now blocks quote creation at the cap. The shared e2e user already has many quotes, so if it were `free` (limit 3) every other spec that creates a quote would 403. Baseline it to `ultimate` (unlimited) once in global setup; the tiers spec flips to `free` locally to test the wall, then restores `ultimate`.

**Interfaces:**
- Consumes: `PATCH /api/subscription` (Task 3), testids `quota-badge`, `quota-upgrade`, `upgrade-dialog`, `upgrade-to-*`, `plan-*` (Task 4), `save-quote-button` (existing).

- [ ] **Step 1: Baseline the e2e user to ultimate**

`e2e/global.setup.ts` runs auth and saves `storageState`. After it saves state, add an authenticated request to set the tier. Read the file; after the storageState is written and while the authenticated `page`/`context` is still available, add:

```ts
  // Baseline: the shared e2e user is Ultimate (unlimited) so tier
  // enforcement never blocks the other specs. tiers.spec flips locally.
  const res = await page.request.patch("/api/subscription", {
    data: { tier: "ultimate" },
  });
  if (!res.ok()) throw new Error(`Failed to baseline e2e tier: ${res.status()}`);
```

(Place it where an authenticated `page` exists. If setup uses a `request` fixture instead, use that; the storageState cookies authenticate it.)

- [ ] **Step 2: Write the spec**

`e2e/tiers.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// This spec mutates the shared e2e user's tier. It restores ultimate in
// afterEach so other specs (and reruns) start unblocked.
test.afterEach(async ({ request }) => {
  await request.patch("/api/subscription", { data: { tier: "ultimate" } });
});

test.describe("tier limits", () => {
  test("free user at the cap is blocked and can upgrade to unblock", async ({ page, request }) => {
    // The e2e user already has >3 quotes, so Free (limit 3) is immediately at cap.
    await request.patch("/api/subscription", { data: { tier: "free" } });

    // Build a quote and try to save → expect the upgrade dialog, not success
    await page.goto("/quote/new");
    await page.getByTestId("client-name-input").fill(`Tier Test ${Date.now()}`);
    await page.getByTestId("line-description-input").last().fill("Test work");
    await page.getByTestId("line-price-input").last().fill("100");
    await page.getByTestId("save-quote-button").click();

    await expect(page.getByTestId("upgrade-dialog")).toBeVisible();
    await expect(page).not.toHaveURL(/\/quote\/(Q-|[0-9a-f-]{8})/);

    // Upgrade to Ultimate from the dialog
    await page.getByTestId("upgrade-to-ultimate").click();
    await expect(page.getByTestId("upgrade-dialog")).toBeHidden();

    // Save again → now succeeds (redirects to the quote page)
    await page.getByTestId("save-quote-button").click();
    await page.waitForURL(/\/quote\/(Q-\d{4}-\d+|[0-9a-f-]+)/, { timeout: 30_000 });
    await expect(page.getByTestId("quote-status-badge")).toBeVisible();
  });

  test("subscription API reports usage", async ({ request }) => {
    await request.patch("/api/subscription", { data: { tier: "pro" } });
    const res = await request.get("/api/subscription");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.tier).toBe("pro");
    expect(body.quoteLimit).toBe(15);
    expect(typeof body.quotesUsed).toBe("number");
  });
});
```

Note: verify the new-quote selectors (`client-name-input`, `line-description-input`, `line-price-input`, `save-quote-button`, route `/quote/new`) against `e2e/quote-flow.spec.ts` and adjust to match that spec's actual selectors before running — reuse exactly what quote-flow uses.

- [ ] **Step 3: Run the tiers spec**

Kill any :3000 server first (`reuseExistingServer: false`):

```bash
lsof -ti:3000 | xargs kill 2>/dev/null
npx playwright test e2e/tiers.spec.ts
```
Expected: 2 passed. Clean up the quote(s) the test created if they carry a recognizable client name (optional; the DB is a dev DB).

- [ ] **Step 4: Full gate (prove no regression)**

```bash
npm run type-check && npm run lint && npm run test:unit && npx playwright test e2e/tiers.spec.ts e2e/quote-flow.spec.ts e2e/landing.spec.ts
```
Expected: all green — `quote-flow` proves the ultimate baseline keeps the critical journey unblocked; `landing` proves the pricing copy still renders.

- [ ] **Step 5: Commit**

```bash
git add e2e/global.setup.ts e2e/tiers.spec.ts
git commit -m "test(tiers): limit→upgrade→unblock journey; baseline e2e user to ultimate"
```

- [ ] **Step 6 (controller): visual check** — dev server up: dashboard shows the quota badge; open UpgradeDialog; flip a throwaway to free and confirm the limit-hit dialog copy reads persuasively. Restore ultimate.

---

## Self-Review Notes

- **Spec coverage:** policy module (T1), migration + type + repo (T1/T2), enforcement swap + quote-cap removal (T3), subscription API (T3), badge + dialog + conversion (T4), PDF footer all tiers (T5), landing copy EN+ES (T5), e2e + baseline (T6), unit tests (T1). Downgrade non-guard = inherent (no code). Dormant columns left (T3 note).
- **Type consistency:** `Tier`/`SubscriptionTier` unified (T1); `updateSubscription(userId, tier)` + `countUserQuotes(userId)` names match across T2→T3; `QUOTE_LIMIT`/`TIER_LABEL`/`TIER_PRICE`/`nextTier`/`quoteLimitLabel` consistent T1→T3→T4; 403 shape `{ code:"QUOTE_LIMIT", tier, limit, message }` consistent T3→T4→T6; testids consistent T4→T6.
- **Flagged soft spots:** Task 1↔2 type-check coupling (do back-to-back); NewQuoteForm selector + 403-insertion point verified against actual file; global.setup authenticated-request shape verified against actual file; PDF muted-color constant name; DashboardContent header placement.
- **Parallel-safety:** T5 disjoint from T1–T4; T6 last.
