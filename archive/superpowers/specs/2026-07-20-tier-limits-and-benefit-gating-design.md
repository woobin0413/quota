# Tier Limits + Benefit Gating — Design

**Date:** 2026-07-20
**Status:** Approved (design)

## Goal

Make the subscription tiers match what the pricing page promises: meter
quotes **per calendar month**, and gate the paid benefits (email invoicing,
logo on PDFs, no "Made with Quota" watermark) so Free no longer gets them.
Clients stay unlimited on all tiers.

## Background — audit findings (current state)

- **Quotes:** `QUOTE_LIMIT` = Free 3, Pro 15, Ultimate ∞. Enforced in
  `/api/quotes` POST via `countUserQuotes(userId)` (from `lib/db/users.ts`)
  → 403 when `used >= limit`. But the count is **lifetime**, not monthly.
  `/api/subscription` GET reports `quotesUsed` from the same lifetime count.
- **Clients:** no limit anywhere (intentional — keep unlimited).
- **Email invoicing:** `/api/send-quote` has **no tier gate** — Free users
  can email.
- **Logo on PDF:** `lib/quote-pdf.ts` includes `logoSrc` whenever the user
  has a `logoUrl`, **no tier gate** — Free gets its logo.
- **"Made with Quota" footer:** `QuotePDFDocument.tsx` renders it
  **unconditionally** — paid tiers get the watermark too.

## Decisions (locked)

- **Reset window:** calendar month (UTC). Count = quotes with `created_at >=`
  first of the current month; resets for everyone on the 1st.
- **Free email UX:** the Send button stays visible for Free; clicking it
  opens the upgrade prompt ("Email invoicing is a Pro feature") with a
  **Download PDF** action. The server also rejects Free email sends.
- **Clients:** unchanged — unlimited on every tier.

## Changes

### 1. Monthly quote metering

- **`lib/db/users.ts`** — add `countUserQuotesThisMonth(userId: string):
  Promise<number>`: counts `quotes` rows for the user with `created_at >=`
  the first instant of the current UTC month.
- **`app/api/quotes` POST** — replace `countUserQuotes` with
  `countUserQuotesThisMonth`; the 403 message reads
  `You've used all ${limit} quotes this month on your ${TIER_LABEL[tier]} plan.`
- **`app/api/subscription` GET** — `quotesUsed` uses
  `countUserQuotesThisMonth`; `quotesRemaining` unchanged formula. So the
  header badge / BillingPanel read "X of 3 this month."
- **Copy:** `lib/landing-copy.ts` pricing bullets → "3 quotes / mo",
  "15 quotes / mo" (EN + ES; Ultimate stays "Unlimited quotes"). Quota
  badge/banner wording that says "quotes" gains "this month" where it names
  the cap.

### 2. Email invoicing = Pro+

- **`app/api/send-quote` POST** — after the auth guard, if
  `user.subscription_tier === "free"` → 403
  `{ success:false, code:"EMAIL_REQUIRES_PRO", message:"Emailing invoices is
  a Pro feature. Upgrade to send, or download the PDF." }`.
- **`components/quote/SendQuoteButton.tsx`** — read the tier via
  `useSubscription()`. When `tier === "free"`: the primary click does NOT
  call `/api/send-quote`; it opens the shared `UpgradeDialog`
  (`reason="Email invoicing is a Pro feature."`) which already routes
  Upgrade → `/billing`, plus a **Download PDF** link to
  `/api/quotes/${quoteId}/pdf`. Pro/Ultimate behave exactly as today. The
  existing `isPaid` (quote paid-status) behavior is preserved.

### 3. Logo on PDF = Pro+  ·  4. Watermark = Free only

- **`lib/quote-pdf.ts`** — the PDF-render entry point gains a `tier: Tier`
  argument (threaded from the caller's `user.subscription_tier`). It passes
  `logoSrc` only when `tier !== "free"`, and computes
  `showBranding = tier === "free"`, forwarding it to `QuotePDFDocument`.
- **`components/quote/QuotePDFDocument.tsx`** — add a `showBranding: boolean`
  prop; render the "Made with Quota" footer line only when `showBranding`.
  (The "Thank you / contact" footer stays for all tiers.)
- **`app/api/send-quote` POST** and **`app/api/quotes/[id]/pdf` GET** — pass
  `user.subscription_tier` into the PDF render. Result: a Free user's PDF
  (emailed or downloaded) has the watermark and no logo; Pro/Ultimate get
  their logo and no watermark.

## Data flow

- **Quote create:** POST `/api/quotes` → `countUserQuotesThisMonth` vs
  `QUOTE_LIMIT[tier]` → allow or 403.
- **Send (Pro+):** `SendQuoteButton` → `/api/send-quote` → tier check passes
  → render PDF (tier-gated logo/branding) → email.
- **Send (Free):** `SendQuoteButton` → UpgradeDialog + Download PDF; if the
  API is called directly it returns 403.
- **Download PDF (any tier):** `/api/quotes/[id]/pdf` → render with the
  caller's tier (Free: watermark, no logo).

## Error handling

- Free email attempt → 403 `EMAIL_REQUIRES_PRO` (server) + upgrade prompt
  (UI); no email sent.
- Over monthly quota → 403 `QUOTE_LIMIT` with "this month" message + the
  existing upgrade dialog on the New Quote screen.
- Missing tier / unknown → treat as `free` (safe default).

## Testing

- **Unit:**
  - `countUserQuotesThisMonth` — counts only current-month rows (boundary:
    a quote from last month is excluded).
  - `lib/quote-pdf` gating — `tier: "free"` → no `logoSrc`,
    `showBranding: true`; `tier: "pro"/"ultimate"` → `logoSrc` present,
    `showBranding: false`.
  - `send-quote` Free block — `subscription_tier: "free"` → 403
    `EMAIL_REQUIRES_PRO`, no send; paid → proceeds.
- **e2e (`e2e/tiers.spec.ts` extended, dev tier switch):**
  - Free at 3 this month → blocked at save (existing test, message now
    "this month").
  - Free quote page → `Send` opens the upgrade dialog, no email fires.
  - Pro tier → `Send` emails (mocked) as today.

## Out of scope

- No client/contact limit (unlimited on all tiers).
- No change to Ultimate's future items (receipts/reminders/voice — "at
  launch").
- No proration/billing changes (this is app-side gating only).
