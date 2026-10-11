# Billing UX + Brand Polish — Design

**Date:** 2026-07-18
**Status:** Draft (pending user approval)
**Depends on:** stripe-billing + production-readiness (both merged).

## Scope

Four connected pieces, all on the just-shipped billing/legal/nav surfaces:

1. **In-app billing management** — cancel / reactivate / plan status inside
   Quota's own UI; Stripe only for card edits + invoice history.
2. **User dropdown expansion** — Plan & billing, Work Catalog, Help/Contact,
   Admin (conditional), alongside Profile + Sign out.
3. **Footer redesign** — drop the sign-in link; legal links aligned right,
   above the copyright; corporate polish.
4. **Legal + About redesign** — on-brand, editorial, not a wall of text
   (exact legal strings preserved verbatim).

## 1. In-app billing management

### Decision
Cancellation, reactivation, and plan status live in Quota. The hosted Stripe
Customer Portal is used ONLY for card edits and invoice history (PCI + card
UI stay off our servers). No more "here's the whole Stripe portal" as the
default management surface.

### New routes
- `POST /api/billing/cancel` — resolve the customer's active subscription,
  `stripe.subscriptions.update(subId, { cancel_at_period_end: true })`.
  Webhook (`customer.subscription.updated`) syncs `cancel_at_period_end` +
  `current_period_end`. Rate-limited (`billing:${user.id}`). 200
  `{ success, currentPeriodEnd }`. 400 if no active sub.
- `POST /api/billing/reactivate` — same lookup,
  `{ cancel_at_period_end: false }`; undoes a pending cancel before period
  end. Rate-limited.
- `POST /api/billing/portal` (existing) — extend body `{ intent?:
  "payment_method" | "history" }`: `payment_method` →
  `flow_data: { type: "payment_method_update" }`; `history`/absent → plain
  portal (invoices are the portal home). Card + history stay on Stripe.

Sole-writer invariant preserved: cancel/reactivate change Stripe state only;
tier/flags are still written exclusively by the webhook + reconciliation.

### UI — `BillingPanel` (replaces the single "Manage billing" button)
A dedicated section (in ProfileSettings, and reachable via the new "Plan &
billing" menu item). Shows: tier + price, quotes used/remaining, renewal
date (`current_period_end`) or the cancel notice, and actions:
- **Change plan** → UpgradeDialog (upgrade = existing Checkout).
- **Cancel subscription** (paid + not already canceling) → confirm dialog
  ("You'll keep {tier} until {date}, then drop to Free") → `POST
  /api/billing/cancel` → refetch.
- **Reactivate** (when `cancelAtPeriodEnd`) → `POST /api/billing/reactivate`.
- **Update payment method** → `portal { intent: "payment_method" }`.
- **Billing history / invoices** → `portal { intent: "history" }`.
Free tier: only "Choose a plan" (UpgradeDialog). Errors inline, never silent.

`GET /api/subscription` already returns tier/period/cancel fields — extend
with `renewsOrEnds` only if needed (else derive client-side).

## 2. User dropdown expansion

Add to the desktop dropdown AND the mobile menu, in this order:
Profile Settings · **Plan & billing** (opens BillingPanel) · **Work Catalog**
(`/dashboard?tab=catalog`) · **Help & Contact** (`/about` or `mailto:
SUPPORT_EMAIL`) · **Admin** (only when admin) · Sign out.

Admin visibility: `GET /api/profile` returns `isAdmin` (server compares
session email to `ADMIN_EMAILS`; never trust the client). The menu shows the
Admin item only when `isAdmin` — the `/admin` page keeps its own 404 gate
regardless (defense in depth).

Icons per item (lucide): CreditCard, BookOpen, LifeBuoy, ShieldCheck.
Keep testids stable; add `menu-billing`, `menu-catalog`, `menu-help`,
`menu-admin`.

## 3. Footer redesign

- **Landing footer** (`components/landing/sections.tsx`): remove the sign-in
  link (CTA button already covers "get started"). Structure: brand + short
  tagline left; legal nav (Terms · Privacy · Refunds · About) aligned right;
  a thin rule; the copyright line beneath, full-width and muted. Corporate
  restraint — generous spacing, uppercase eyebrow-style link labels,
  accent-underline on hover.
- **AppFooter** (authenticated pages): same right-aligned legal nav pattern,
  compact, above a slim copyright line.

## 4. Legal + About redesign (frontend-design skill)

Goal: editorial, branded, trustworthy — not a text dump. Keep the ledger
aesthetic (cream/paper bg, `font-display` uppercase headings, accent rule,
`figure`/eyebrow type system already in the app). Every EXACT legal string
(sharing clause, NJ governing law, 3-day refund rule) stays verbatim.

Shared legal template upgrades (`app/(legal)/layout.tsx` + pages):
- **Page header block**: eyebrow ("Legal" / "Company"), large display title,
  a one-line plain-language summary under it, "Last updated" as a small
  figure-styled stamp.
- **Section numbering**: `01 / 02 …` markers on Terms/Privacy (real sequence)
  with an accent divider — encodes the document's ordered structure.
- **Sticky in-page nav / table of contents** on the long pages (Terms,
  Privacy) for scannability on desktop; collapses on mobile.
- **Contact card** at the foot of each page (accent-bordered) with
  SUPPORT_EMAIL and a "Questions?" prompt.
- **About**: give it a real identity — a hero line (the product thesis),
  2–3 value cards (Price book · Quote fast · Get paid), and the story
  paragraphs; not just centered text.
- Consistent max-width, readable measure (~65ch), section spacing rhythm.

Design guardrail: spend the boldness on the About hero + the section-number
system; keep the legal body calm and disciplined. Respect reduced-motion,
keyboard focus, mobile down to 360px.

## Non-Goals
- Rebuilding invoice/receipt emails or the PDF.
- Full in-app card entry via Stripe Elements (portal hop is fine for cards).
- Downgrade-in-app between paid tiers via API (upgrade=Checkout; downgrade
  path = cancel→resubscribe or portal for v1; revisit if asked).
- Spanish legal translations.
- Any change to the tier/quota enforcement or the sole-writer invariant.

## Testing
- Unit: cancel/reactivate route handlers (mock Stripe: correct
  `cancel_at_period_end` set, no-active-sub → 400); `isAdmin` in profile
  route.
- e2e: dropdown shows the new items (Admin hidden for non-admin); legal
  pages still 200 + h1; footer has no sign-in link, has the 4 legal links.
- type-check + lint clean; visual pass on legal/About + BillingPanel +
  footer (controller).
