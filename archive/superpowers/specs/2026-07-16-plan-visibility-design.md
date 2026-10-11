# Plan Visibility — Design

**Date:** 2026-07-16
**Status:** Approved (design)
**Depends on:** quote-tier-limits (merged). **Ships before** Stripe billing
(spec `2026-07-16-stripe-billing-design.md`); the Upgrade affordances here
initially open the existing UpgradeDialog and are re-pointed to Stripe
Checkout by that spec.

## Problem

Users can't see which tier they're on or how many quotes they have left.
The tier name appears only inside the UpgradeDialog; the dashboard badge
shows "11 of 3 quotes" (used/limit) rather than what users actually ask:
"how many do I have left?"

## Decisions (locked)

- Surfaces (all four): dashboard badge (re-worded), header chip (every
  page), profile-settings plan row, New Quote low-quota banner.
- Language is **remaining-centric**: "2 quotes left", not "1 of 3 used".
- Server computes remaining; the UI never derives eligibility.

## Design

### 1. API — extend `GET /api/subscription`

Response gains two fields (existing fields unchanged):

```
{ success, tier, quotesUsed, quoteLimit,          // existing
  tierLabel: "Free" | "Pro" | "Ultimate",          // TIER_LABEL[tier]
  quotesRemaining: number | null }                 // max(0, limit - used); null = unlimited
```

### 2. Dashboard badge (`components/subscription/QuotaBadge.tsx`)

- Finite tier: `Free · 2 quotes left` (+ Upgrade button).
- Zero left: `Free · No quotes left` — count in stamp-red (`text-destructive`).
- Unlimited: `Ultimate · Unlimited quotes`, no Upgrade button.
- Same testids; text change only + a `data-testid="quota-remaining"` span.

### 3. Header plan chip (`components/layout/Header.tsx`)

- Small chip next to the user menu on authenticated pages: tier label
  (e.g. `FREE`), stamp-outline styling.
- Click → opens UpgradeDialog (current tier fetched like QuotaBadge; the
  chip reuses a shared hook).
- New client component `components/subscription/PlanChip.tsx`; shared
  data hook `useSubscription()` in `components/subscription/use-subscription.ts`
  (fetch once, shared by chip/badge/banner to avoid triple-fetching:
  simple module-level cache or each component fetches — decision:
  **each surface fetches independently**; the route is cheap and this
  avoids client cache invalidation complexity. Revisit if it ever shows.)
- `data-testid="plan-chip"`.

### 4. Profile settings plan row (`components/settings/ProfileForm.tsx` area)

- Section under the logo block: **Plan** — `Pro · $15/mo · 8 of 15 quotes
  used (7 left)` + button `Upgrade` (opens UpgradeDialog). After Stripe
  ships, this button becomes `Manage billing` for paid tiers.
- Data from `GET /api/subscription` fetched when the dialog opens (the
  dialog already fetches `/api/profile`; a second small fetch is fine).
- `data-testid="plan-row"`.

### 5. New Quote banner (`components/quote/NewQuoteForm.tsx`)

- On mount, fetch subscription; when `quotesRemaining !== null &&
  quotesRemaining <= 1`, render a banner above the builder:
  - 1 left: `Last quote on your Free plan — Pro gives you 15.` + Upgrade
    button (opens the existing UpgradeDialog with that reason).
  - 0 left: `You've used all 3 quotes on Free.` + Upgrade (the save 403
    path already exists as backstop).
- `data-testid="quota-banner"`.

## Copy (exact)

| Context | Copy |
|---|---|
| Badge finite | `{TierLabel} · {n} quote{s} left` |
| Badge zero | `{TierLabel} · No quotes left` |
| Badge unlimited | `Ultimate · Unlimited quotes` |
| Banner 1 left | `Last quote on your {TierLabel} plan — {NextTierLabel} gives you {nextLimitLabel}.` |
| Banner 0 left | `You've used all {limit} quotes on {TierLabel}.` |
| Plan row | `{TierLabel} · {price}/mo · {used} of {limit} used ({left} left)`; Free shows `{TierLabel} · Free plan · …`; Ultimate shows `Ultimate · $29/mo · Unlimited quotes` |

## Error handling

All surfaces render nothing (chip/banner) or fall back to existing layout
(badge already null-on-fail) when the subscription fetch fails.

## Testing

- Unit: none new (display math `max(0, limit-used)` lives in the route —
  covered by extending the API e2e assertion).
- e2e (`e2e/tiers.spec.ts` additions): as `free` — badge shows "No quotes
  left" (user is over cap), plan chip visible, New Quote banner appears;
  API returns `tierLabel`/`quotesRemaining` fields. Restore `ultimate`.
- type-check + lint clean; controller visual pass.

## Surface

`app/api/subscription/route.ts` (+2 fields), `QuotaBadge.tsx` (reword),
`PlanChip.tsx` (new) + `Header.tsx` (mount), settings plan row,
`NewQuoteForm.tsx` banner, e2e additions.
