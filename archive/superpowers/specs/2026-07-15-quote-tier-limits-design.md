# Quote Tier Limits — Design

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation plan
**App:** Quota

## Problem

The landing page sells three tiers but nothing enforces them. Add tier
enforcement with a single limiter — **quote count** — plus a self-serve
upgrade flow, so Free users hit a wall that persuades them to upgrade.

## Decisions (locked)

- **Quote count is the ONLY limiter.** Every tier gets every feature (send,
  milestones, logo, receipts all remain ungated). No client cap.
- **Lifetime limits per user:** Free **3**, Pro **15**, Ultimate **∞**.
  Enforced as a **live count of existing (non-deleted) quotes** — deleting a
  quote frees a slot. No counter column, no monthly reset.
- **Tiers:** `free | pro | ultimate` (replaces the old `free | pro |
  enterprise`).
- **Upgrade is self-serve, instant, no payment** (placeholder until a real
  processor). Pro/Ultimate are immediately available — persuasive
  "upgrade now" copy, never "join the list."
- **PDF footer "Made with Quota" on ALL tiers** (no tier logic).
- Voice-to-invoice stays an unbuilt Ultimate-only perk — listed on pricing,
  not enforced, not built.

## Non-Goals

- Real billing / Stripe / checkout (self-serve tier switch stands in)
- Feature gating of send/milestones/logo/receipts (explicitly dropped)
- Client-count limits (dropped)
- Removing the dormant `monthly_quote_limit` / `quotes_this_month` columns
  (left in place, unused, like the dormant Stripe tables)
- Downgrade guards (a user with 10 quotes downgrading to Free is not forced
  to delete; they simply can't create new ones until under the limit)

## Architecture

### 1. Tier policy — `lib/subscription.ts` (new)

```ts
export type Tier = "free" | "pro" | "ultimate";
export const QUOTE_LIMIT: Record<Tier, number> = {
  free: 3,
  pro: 15,
  ultimate: Infinity,
};
export const TIER_LABEL: Record<Tier, string> = {
  free: "Free", pro: "Pro", ultimate: "Ultimate",
};
export const TIER_PRICE: Record<Tier, string> = {
  free: "$0", pro: "$15", ultimate: "$29",
};
// The next tier up that raises the quote ceiling (for upgrade prompts)
export function nextTier(tier: Tier): Tier | null { ... } // free→pro, pro→ultimate, ultimate→null
```

Single source of truth for limits, labels, prices, and the upgrade ladder.
The UpgradeDialog and landing page both read from here (landing copy strings
stay in `landing-copy.ts`, but the numeric limits are sourced here to avoid
drift).

### 2. Data / types

- **Migration** `009_tier_ultimate.sql` (+ rollback, + supabase mirror):
  - `UPDATE users SET subscription_tier = 'ultimate' WHERE subscription_tier
    = 'enterprise';`
  - Drop + recreate the CHECK constraint to
    `subscription_tier IN ('free','pro','ultimate')`.
- `types/database.ts`: `SubscriptionTier = "free" | "pro" | "ultimate"`.
- `lib/db/users.ts`:
  - `updateSubscriptionTier(userId, tier)` — signature drops the `limit`
    param and the `monthly_quote_limit` write; sets only `subscription_tier`.
  - New `countUserQuotes(userId): Promise<number>` — `count: "exact"` on
    `quotes` where `user_id` and `deleted_at IS NULL`.

### 3. Enforcement — `/api/quotes` POST

Replace the existing `checkQuotaLimit(user.id)` block with:

```ts
const tier = user.subscription_tier as Tier;
const limit = QUOTE_LIMIT[tier];
if (Number.isFinite(limit)) {
  const count = await countUserQuotes(user.id);
  if (count >= limit) {
    return NextResponse.json(
      { success: false, code: "QUOTE_LIMIT", tier, limit,
        message: `You've used all ${limit} quotes on your ${TIER_LABEL[tier]} plan.` },
      { status: 403 }
    );
  }
}
```

`getCurrentUser()` already returns the full user incl. `subscription_tier`,
so no extra fetch. Server-authoritative — the UI never decides eligibility.

### 4. Upgrade API — `/api/subscription` PATCH (new)

- Body: `{ tier: "free" | "pro" | "ultimate" }` (zod).
- Auth via `getCurrentUser()`.
- `updateSubscriptionTier(user.id, tier)` → returns `{ success: true, tier }`.
- Comment marks it a pre-billing placeholder (any authenticated user can set
  their own tier for now).

### 5. UI

- **`GET /api/subscription`** (or extend `/api/profile`) returns
  `{ tier, quotesUsed, quoteLimit }` for badges — new small route
  `GET /api/subscription` returning tier + `countUserQuotes` + limit
  (limit as number or `null` for ∞).
- **QuotaBadge** (`components/subscription/QuotaBadge.tsx`) — shown on the
  dashboard: "2 of 3 quotes" (or "Unlimited" for Ultimate) + an Upgrade
  button when `nextTier` exists. Opens UpgradeDialog.
- **UpgradeDialog** (`components/subscription/UpgradeDialog.tsx`) — three
  plan cards (label, price, quote limit, current-plan marker), an
  optional persuasive `reason` line (e.g. the limit-hit message), and
  "Upgrade to Pro / Ultimate" buttons → `PATCH /api/subscription` →
  `router.refresh()`. Reuses the landing pricing palette/ledger styling.
- **Limit-hit conversion in NewQuoteForm** — when the save POST returns 403
  `QUOTE_LIMIT`, show the persuasive message inline and open UpgradeDialog
  pre-seeded with the reason, rather than a bare error toast.

### 6. PDF footer

`QuotePDFDocument` footer (`styles.footer`, ~line 562) already renders
"Thank you for your business!". Add a small muted second line: "Made with
Quota". No props, no tier logic — every PDF.

### 7. Landing copy (EN + ES) — `lib/landing-copy.ts`

Rewrite the pricing tier bullets to match the new limits:
- Free: "**3 quotes**" (replace "Unlimited quotes" + "3 clients")
- Pro: "**15 quotes**" (replace "Unlimited clients")
- Ultimate: "**Unlimited quotes**" (keep the rest)

Keep every other bullet. Spanish mirrors: "3 presupuestos" / "15
presupuestos" / "Presupuestos ilimitados".

## Error Handling

- 403 `QUOTE_LIMIT` is the only new failure; UI converts it to an upgrade
  moment. All other quote-create errors keep their current handling.
- Upgrade PATCH: invalid tier → 400; unauth → 401.
- Badge route failure → badge renders nothing (non-blocking).

## Security

- Tier read from the server session user, never from the client.
- Enforcement is server-side in the create path; a crafted client request
  still hits the count check.
- `PATCH /api/subscription` is intentionally self-serve for now — documented
  as the seam where real billing gating lands later. No privilege beyond
  setting one's own tier.

## Testing

- **Unit** (vitest): `QUOTE_LIMIT`, `nextTier` ladder (free→pro→ultimate→null).
- **e2e** (`e2e/tiers.spec.ts`): a Free user at the limit gets the 403-driven
  upgrade prompt; upgrading via the dialog raises the limit and lets the next
  quote save. (Test resets the e2e user's tier + cleans created quotes.)
- Existing `quote-flow` spec must stay green — the enforcement only triggers
  at the cap, and the e2e user may need its tier/quote state managed so the
  critical-journey test isn't blocked by the new limit (set the e2e user to
  Ultimate, or ensure it's under the Free cap).
- `type-check` + `lint` clean.

## Implementation Surface

- Migration 009 + mirror; `SubscriptionTier` type; `updateSubscriptionTier` +
  `countUserQuotes` in `lib/db/users.ts`
- `lib/subscription.ts`
- `/api/quotes` POST enforcement swap
- `/api/subscription` GET + PATCH
- `components/subscription/QuotaBadge.tsx`, `UpgradeDialog.tsx`; wire into
  dashboard + NewQuoteForm 403 handling
- `QuotePDFDocument` footer line
- `lib/landing-copy.ts` pricing bullets (EN + ES)
- `e2e/tiers.spec.ts` + unit tests
