# Billing UX + Brand Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move subscription cancel/reactivate/status into Quota's own UI (Stripe only for card + invoices), expand the user dropdown, redesign the footers, and give the legal/About pages an on-brand editorial identity.

**Architecture:** Two new thin Stripe-action routes (cancel, reactivate) that only flip `cancel_at_period_end` — the webhook stays the sole writer of tier/flags. A shared `getActiveSubscription` helper and a shared `isAdminEmail` helper remove duplication. UI work is a new `BillingPanel`, an expanded `Header` dropdown, redesigned footers, and a reworked `app/(legal)/` template + pages (frontend-design), preserving every exact legal string.

**Tech Stack:** Existing (Next.js 14 App Router, stripe v14, Tailwind/shadcn, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-07-18-billing-ux-and-brand-polish-design.md`

## Global Constraints

- **Sole-writer invariant unchanged:** `subscription_tier` / `cancel_at_period_end` / `current_period_end` are written ONLY by the webhook (`processStripeEvent`) + `reconcileBilling` + the flag-guarded dev PATCH. Cancel/reactivate routes call the Stripe API only; the resulting webhook does the DB write.
- Cancel = `cancel_at_period_end: true` (access continues to period end); Reactivate = `false`. Never immediate-delete.
- Card entry + invoice history stay on Stripe (portal hops). No Stripe Elements, no card data in-app.
- Admin visibility is server-decided: `isAdminEmail(session email)`; the client never computes admin status; `/admin`'s own 404 gate stays.
- Every EXACT legal string is preserved verbatim — the account-sharing clause, "State of New Jersey" governing law, and the 3-day refund rule (see Task 6 for the literals). A redesign that alters those words is a failure.
- Rate-limit new billing routes with `checkRateLimit(\`billing:${user.id}\`, { maxRequests: 10 })`, 429 shape `{ success:false, code:"RATE_LIMITED", message:"Too many requests — try again soon." }`.
- Existing testids stay stable; footer keeps `landing-footer` / `app-footer`; user menu keeps `user-menu-trigger`, `menu-profile-settings`, `menu-sign-out`.
- Commit messages plain — NO attribution trailers of any kind.
- Every task ends with `npm run type-check && npm run lint` clean and `npx vitest run` green.

## File Structure

- Create: `lib/admin.ts` (`isAdminEmail`), `app/api/billing/cancel/route.ts`, `app/api/billing/reactivate/route.ts`, `components/subscription/BillingPanel.tsx`, `components/subscription/CancelSubscriptionDialog.tsx`, `lib/__tests__/billing-actions.test.ts`, `e2e/nav-footer.spec.ts`
- Modify: `lib/stripe.ts` (`getActiveSubscription`), `app/api/billing/portal/route.ts` (intent), `app/api/profile/route.ts` (`isAdmin`), `app/admin/page.tsx` (use shared helper), `components/settings/ProfileForm.tsx` (BillingPanel replaces PlanRow button), `components/layout/Header.tsx` (dropdown + mobile), `components/landing/sections.tsx` (footer), `components/layout/AppFooter.tsx` (footer), `app/(legal)/layout.tsx` + the 4 legal pages, `CLAUDE.md`/docs as needed.

---

### Task 1: Stripe billing actions — helper + cancel/reactivate + portal intent (+ tests)

**Files:**
- Modify: `lib/stripe.ts`, `app/api/billing/portal/route.ts`
- Create: `app/api/billing/cancel/route.ts`, `app/api/billing/reactivate/route.ts`, `lib/__tests__/billing-actions.test.ts`

**Interfaces:**
- Produces: `getActiveSubscription(customerId: string): Promise<Stripe.Subscription | null>` in `lib/stripe.ts`; `POST /api/billing/cancel` → `{ success, currentPeriodEnd }`; `POST /api/billing/reactivate` → `{ success }`; `POST /api/billing/portal` now accepts `{ intent?: "payment_method" | "history" }`. BillingPanel (Task 3) calls all three.

- [ ] **Step 1: Add `getActiveSubscription` to `lib/stripe.ts`**

```ts
/**
 * The customer's current non-canceled subscription (Stripe list default
 * excludes only ended subs), or null. Shared by cancel/reactivate routes.
 */
export async function getActiveSubscription(
  customerId: string
): Promise<Stripe.Subscription | null> {
  const subs = await getStripe().subscriptions.list({ customer: customerId, limit: 1 });
  return subs.data[0] ?? null;
}
```

Add `import type Stripe from "stripe";` if not present.

- [ ] **Step 2: Write the failing tests** — `lib/__tests__/billing-actions.test.ts`

Mock the route deps and assert the Stripe update calls. Test the pure logic by importing the route POST handlers with a mocked `getStripe`/`getActiveSubscription`, `getCurrentUser`, `checkRateLimit`. Minimum cases:
- cancel with an active sub → `subscriptions.update(subId, { cancel_at_period_end: true })` called, 200.
- cancel with no active sub → 400 `NO_ACTIVE_SUBSCRIPTION`, no update.
- reactivate with active sub → `update(subId, { cancel_at_period_end: false })`, 200.
- cancel unauthenticated → 401.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const checkRateLimit = vi.fn(() => ({ allowed: true, remaining: 9, resetTime: 0 }));
const getActiveSubscription = vi.fn();
const subscriptionsUpdate = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/stripe", () => ({
  getActiveSubscription: (...a: unknown[]) => getActiveSubscription(...a),
  getStripe: () => ({ subscriptions: { update: (...a: unknown[]) => subscriptionsUpdate(...a) } }),
}));

import { POST as cancelPOST } from "@/app/api/billing/cancel/route";
import { POST as reactivatePOST } from "@/app/api/billing/reactivate/route";

const authed = { id: "u1", stripe_customer_id: "cus_1" };

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockReturnValue({ allowed: true, remaining: 9, resetTime: 0 });
});

describe("POST /api/billing/cancel", () => {
  it("sets cancel_at_period_end on the active sub", async () => {
    getCurrentUser.mockResolvedValue(authed);
    getActiveSubscription.mockResolvedValue({ id: "sub_1", current_period_end: 1790000000 });
    subscriptionsUpdate.mockResolvedValue({});
    const res = await cancelPOST(new Request("http://x", { method: "POST" }) as never);
    const body = await res.json();
    expect(subscriptionsUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("400 when there is no active subscription", async () => {
    getCurrentUser.mockResolvedValue(authed);
    getActiveSubscription.mockResolvedValue(null);
    const res = await cancelPOST(new Request("http://x", { method: "POST" }) as never);
    expect(res.status).toBe(400);
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await cancelPOST(new Request("http://x", { method: "POST" }) as never);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/billing/reactivate", () => {
  it("clears cancel_at_period_end", async () => {
    getCurrentUser.mockResolvedValue(authed);
    getActiveSubscription.mockResolvedValue({ id: "sub_1" });
    subscriptionsUpdate.mockResolvedValue({});
    const res = await reactivatePOST(new Request("http://x", { method: "POST" }) as never);
    expect(subscriptionsUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: false });
    expect(res.status).toBe(200);
  });
});
```

Run: `npx vitest run lib/__tests__/billing-actions.test.ts` → FAIL (routes missing).

- [ ] **Step 3: `app/api/billing/cancel/route.ts`**

```ts
/**
 * POST /api/billing/cancel — schedule cancellation at period end.
 * Flips the Stripe subscription's cancel_at_period_end; the webhook syncs
 * our DB flags. Access continues until current_period_end. Tier is NOT
 * changed here (webhook remains the sole writer).
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, getActiveSubscription } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
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

    const rate = checkRateLimit(`billing:${user.id}`, { maxRequests: 10 });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." },
        { status: 429 }
      );
    }

    if (!user.stripe_customer_id) {
      return NextResponse.json(
        { success: false, message: "No billing account", code: "NO_BILLING_ACCOUNT" },
        { status: 400 }
      );
    }

    const sub = await getActiveSubscription(user.stripe_customer_id);
    if (!sub) {
      return NextResponse.json(
        { success: false, message: "No active subscription", code: "NO_ACTIVE_SUBSCRIPTION" },
        { status: 400 }
      );
    }

    await getStripe().subscriptions.update(sub.id, { cancel_at_period_end: true });

    return NextResponse.json({
      success: true,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
    });
  } catch (error) {
    logger.error("Billing cancel error", { err: error, route: "POST /api/billing/cancel", userId });
    return NextResponse.json(
      { success: false, message: "Could not cancel subscription", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: `app/api/billing/reactivate/route.ts`** — same shape, `{ cancel_at_period_end: false }`, returns `{ success: true }`, error message "Could not reactivate subscription", route tag `POST /api/billing/reactivate`.

- [ ] **Step 5: Portal intent** — in `app/api/billing/portal/route.ts`, accept an optional JSON body (the route currently takes none). Read it defensively (empty body is valid):

```ts
import { NextRequest, NextResponse } from "next/server";
// ...
export async function POST(request: NextRequest) {
  // ...after the stripe_customer_id check...
  let intent: "payment_method" | "history" | undefined;
  try {
    const body = await request.json();
    if (body?.intent === "payment_method" || body?.intent === "history") intent = body.intent;
  } catch {
    // no/invalid body → default portal home
  }

  const appUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const portal = await getStripe().billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${appUrl}/dashboard`,
    ...(intent === "payment_method"
      ? { flow_data: { type: "payment_method_update" as const } }
      : {}),
  });
  return NextResponse.json({ success: true, url: portal.url });
}
```

(If the installed stripe v14 types reject `flow_data`, adapt to the supported literal or cast minimally and note it.)

- [ ] **Step 6: Pass tests + gate + commit**

Run: `npx vitest run lib/__tests__/billing-actions.test.ts` → PASS, then `npx vitest run && npm run type-check && npm run lint`.

```bash
git add lib/stripe.ts app/api/billing/cancel/route.ts app/api/billing/reactivate/route.ts app/api/billing/portal/route.ts lib/__tests__/billing-actions.test.ts
git commit -m "feat(billing): in-app cancel/reactivate routes + portal intents"
```

---

### Task 2: Shared `isAdminEmail` + profile `isAdmin` flag

**Files:**
- Create: `lib/admin.ts`
- Modify: `app/admin/page.tsx` (use shared helper), `app/api/profile/route.ts` (return `isAdmin`)

**Interfaces:**
- Produces: `isAdminEmail(email: string): boolean` in `lib/admin.ts`; `GET /api/profile` response gains `isAdmin: boolean`. Header (Task 4) reads it.

- [ ] **Step 1: `lib/admin.ts`**

```ts
/** True when the email is in ADMIN_EMAILS (comma-separated, case-insensitive). */
export function isAdminEmail(email: string): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
```

- [ ] **Step 2: Use it in `app/admin/page.tsx`** — replace the local `isAdmin` function with an import of `isAdminEmail`; call `if (!isAdminEmail(user.email)) notFound();`. Remove the now-dead local function.

- [ ] **Step 3: profile route** — in `GET /api/profile`, add `isAdmin` to the response:

```ts
import { isAdminEmail } from "@/lib/admin";
// ...
return NextResponse.json({
  success: true,
  profile: toProfile(user),
  isAdmin: isAdminEmail(user.email),
});
```

- [ ] **Step 4: Gate + commit**

Run: `npx vitest run && npm run type-check && npm run lint` (52 green; admin page still gates).

```bash
git add lib/admin.ts app/admin/page.tsx app/api/profile/route.ts
git commit -m "feat(admin): shared isAdminEmail helper; profile API returns isAdmin"
```

---

### Task 3: BillingPanel + cancel dialog (in-app management)

**Files:**
- Create: `components/subscription/BillingPanel.tsx`, `components/subscription/CancelSubscriptionDialog.tsx`
- Modify: `components/settings/ProfileForm.tsx` (render BillingPanel instead of the PlanRow button block)

**Interfaces:**
- Consumes: `useSubscription()` (tier, cancelAtPeriodEnd, currentPeriodEnd, quotes), the Task 1 routes, `UpgradeDialog`.
- Produces: `BillingPanel` (default section in ProfileSettings + openable via the menu's Plan & billing).

- [ ] **Step 1: `CancelSubscriptionDialog.tsx`** — shadcn Dialog. Props: `open`, `onOpenChange`, `tierLabel`, `periodEndLabel`, `onConfirm: () => Promise<void>`, `busy`. Copy: title "Cancel subscription?", body "You'll keep {tierLabel} until {periodEndLabel}, then move to the Free plan (3 quotes). You can reactivate any time before then." Buttons: "Keep my plan" (close) + destructive "Cancel subscription" (calls onConfirm, spinner while busy). `data-testid="cancel-subscription-dialog"`, confirm button `data-testid="confirm-cancel"`.

- [ ] **Step 2: `BillingPanel.tsx`** (client). Uses `useSubscription()`. Layout a bordered card matching the app's ledger look (`font-display` uppercase heading "Plan & Billing", `figure` for the price/quota numbers). Show:
  - Tier label + price + quotes used/remaining.
  - If `cancelAtPeriodEnd && currentPeriodEnd`: an accent/destructive notice "Cancels {date} — access until then" + a **Reactivate** button (`POST /api/billing/reactivate` → refetch/`router.refresh()`).
  - Else if paid: renewal line "Renews {date}" + buttons **Change plan** (opens UpgradeDialog), **Update payment method** (`POST /api/billing/portal { intent:"payment_method" }` → redirect), **Billing history** (`{ intent:"history" }` → redirect), and **Cancel subscription** (opens CancelSubscriptionDialog → on confirm `POST /api/billing/cancel` → refetch).
  - If free: "You're on the Free plan" + **Choose a plan** (UpgradeDialog).
  - All fetch failures → inline error line (`role="alert"`); buttons disabled while busy.
  - testids: `billing-panel`, `billing-cancel`, `billing-reactivate`, `billing-change-plan`, `billing-update-card`, `billing-history`.
  - Date formatting via `new Date(iso).toLocaleDateString()`.
  - After cancel/reactivate, re-read subscription: simplest is `router.refresh()` plus a local re-fetch of `/api/subscription`; since `useSubscription` fetches on mount, expose a manual refetch or just call `router.refresh()` and additionally re-run the fetch by keying the panel — implementer picks the minimal working approach (a local `reload()` that re-hits `/api/subscription` and setSub is cleanest; if extending the hook, keep its existing shape/back-compat).

- [ ] **Step 3: Wire into `ProfileForm.tsx`** — replace `{sub && <PlanRow … />}` (and the now-unneeded standalone `UpgradeDialog` mount if BillingPanel owns it) with `{sub && <BillingPanel />}`. Keep `data-testid="plan-row"` available if any e2e depends on it — if so, put it on the BillingPanel root as a secondary testid, or update the e2e in Task 7. Remove dead PlanRow code only if nothing else references it. Do NOT break the profile save form around it.

- [ ] **Step 4: Gate + commit**

Run: `npx vitest run && npm run type-check && npm run lint`.

```bash
git add components/subscription/BillingPanel.tsx components/subscription/CancelSubscriptionDialog.tsx components/settings/ProfileForm.tsx
git commit -m "feat(billing): in-app BillingPanel with cancel/reactivate/plan management"
```

---

### Task 4: Header user dropdown expansion

**Files:**
- Modify: `components/layout/Header.tsx`

**Interfaces:**
- Consumes: `/api/profile` `isAdmin` (already fetched in Header's effect — extend it to store `isAdmin`), `SUPPORT_EMAIL` from `@/lib/site`.
- Produces: expanded desktop dropdown + mobile menu.

- [ ] **Step 1: Read `isAdmin`** — Header already fetches `/api/profile`; store `const [isAdmin, setIsAdmin] = useState(false)` and set it from `data.isAdmin`.

- [ ] **Step 2: Desktop dropdown items** (between Profile Settings and Sign Out), each with a lucide icon:
  - **Plan & billing** (`CreditCard`) → opens the BillingPanel. Simplest: it lives in ProfileSettingsDialog; open that dialog (reuse `setSettingsOpen(true)`) — if the dialog scrolls to/【shows billing at top, that's enough for v1. `data-testid="menu-billing"`.
  - **Work Catalog** (`BookOpen`) → `Link href="/dashboard?tab=catalog"`. `data-testid="menu-catalog"`.
  - **Help & Contact** (`LifeBuoy`) → `Link href="/about"`. `data-testid="menu-help"`.
  - **Admin** (`ShieldCheck`) → `Link href="/admin"`, rendered only when `isAdmin`. `data-testid="menu-admin"`.
  Keep Profile Settings + Sign Out and their testids.

- [ ] **Step 3: Mirror in the mobile menu** — add the same links (Work Catalog, Help, Admin-when-admin) to the mobile `nav`, and a Plan & billing button that opens settings. Keep it tidy.

- [ ] **Step 4: Gate + commit**

Run: `npm run type-check && npm run lint && npx vitest run`.

```bash
git add components/layout/Header.tsx
git commit -m "feat(nav): expand user dropdown — plan & billing, catalog, help, admin"
```

---

### Task 5: Footer redesign (landing + app)

**Files:**
- Modify: `components/landing/sections.tsx`, `components/layout/AppFooter.tsx`

- [ ] **Step 1: Landing footer** — remove the sign-in `<Link>`. Restructure the bottom region: brand mark + one-line tagline on the left; a right-aligned legal nav (Terms · Privacy · Refunds · About from `LEGAL_LINKS`); a thin `border-t border-primary-foreground/20` rule; the `© {year} Quota. {rights}` line beneath, full-width, muted, small. Keep `data-testid="landing-footer"`. Uppercase eyebrow-style labels, accent underline on hover. Responsive: stack on mobile, row on `sm+`.

- [ ] **Step 2: AppFooter** — same right-aligned legal-nav pattern, compact, with a slim muted copyright line under a hairline rule. Keep `data-testid="app-footer"`.

- [ ] **Step 3: Gate + commit**

Run: `npm run type-check && npm run lint && npx vitest run`.

```bash
git add components/landing/sections.tsx components/layout/AppFooter.tsx
git commit -m "feat(footer): drop sign-in, right-align legal nav, corporate polish"
```

---

### Task 6: Legal + About redesign (frontend-design)

**Files:**
- Modify: `app/(legal)/layout.tsx`, `app/(legal)/terms/page.tsx`, `app/(legal)/privacy/page.tsx`, `app/(legal)/refunds/page.tsx`, `app/(legal)/about/page.tsx`

**REQUIRED SUB-SKILL for the implementer:** use `frontend-design`. This is the one design-led task.

**Verbatim strings that MUST survive unchanged** (copy exactly, apostrophes as straight `'`):
- Terms sharing clause: `Your account is licensed to a single business and its owner. Sharing login credentials with anyone outside your business — on any plan, including Ultimate — is a violation of these terms and grounds for suspension or termination.`
- Terms governing law: `These terms are governed by the laws of the State of New Jersey, USA.`
- Refund 3-day rule: `If you cancel within 3 days of a charge — whether it's your first payment or a monthly renewal — we'll refund that charge in full. After 3 days, the charge for that billing period is non-refundable.`

- [ ] **Step 1: Redesign the shared legal layout** (`app/(legal)/layout.tsx`) — keep `data-testid="legal-page"` on the main. Add: an eyebrow label slot, a large `font-display` title slot, an optional one-line summary, and a "Last updated" figure-styled stamp — implemented as the page passing props OR each page rendering a shared `<LegalHeader>` (implementer's choice; a small co-located component is fine). Ledger aesthetic: paper/cream bg, accent rule, readable ~65ch measure, section rhythm. Preserve the header nav with the legal links.

- [ ] **Step 2: Terms + Privacy** — add `01 / 02 / 03 …` accent section markers (real ordered sections), an optional sticky in-page table-of-contents on desktop (collapses/hidden on mobile), and an accent-bordered contact card at the foot referencing `SUPPORT_EMAIL`. Keep every section's plain-language content; only the presentation changes. The three verbatim strings above appear exactly.

- [ ] **Step 3: Refunds** — same header system + contact card; make the 3-day rule visually prominent (e.g. a highlighted callout) but with the EXACT wording. Keep the how-to-cancel / how-refunds-arrive sections.

- [ ] **Step 4: About** — give it a real identity: an eyebrow + hero thesis line, 2–3 value cards (Price book · Quote fast · Get paid), then the story paragraphs; end with the contact card. On-brand, not centered plain text.

- [ ] **Step 5: Quality bar** — responsive to 360px, visible keyboard focus, `prefers-reduced-motion` respected, one memorable signature element (the section-number system or the About hero) with the rest kept calm. Take a screenshot pass if the environment supports it.

- [ ] **Step 6: Verify the verbatim strings + gate + commit**

Grep the three literals to confirm they survived, then `npm run type-check && npm run lint && npx vitest run`.

```bash
git add app/\(legal\)/
git commit -m "feat(legal): on-brand editorial redesign of legal + about pages"
```

---

### Task 7: e2e + env/doc touch-ups + full gate

**Files:**
- Create: `e2e/nav-footer.spec.ts`
- Modify: existing e2e if a testid moved (e.g. `plan-row`)

- [ ] **Step 1: `e2e/nav-footer.spec.ts`**
  - Authenticated: open the user menu (`user-menu-trigger`), assert `menu-billing`, `menu-catalog`, `menu-help` visible; `menu-admin` NOT visible (e2e user is non-admin).
  - Public landing (`/`): `landing-footer` present, contains links to `/terms` `/privacy` `/refunds` `/about`, and has NO "Sign in" link text in the footer region.
  - Legal pages still 200 + h1 (already covered by `legal.spec.ts` — don't duplicate; only add if a redesign risk warrants).

- [ ] **Step 2: Reconcile any moved testids** — if Task 3 dropped `plan-row`, update any spec referencing it (grep `plan-row` under `e2e/`). Don't weaken assertions.

- [ ] **Step 3: Full gate** (stop any dev server first — `reuseExistingServer:false`):

```bash
npx vitest run
npm run type-check
npm run lint
npx playwright test e2e/nav-footer.spec.ts
npx playwright test e2e/legal.spec.ts
npx playwright test e2e/tiers.spec.ts
npx playwright test e2e/quote-flow.spec.ts
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/
git commit -m "test(e2e): user menu items + redesigned footer links"
```

---

## Post-merge manual steps (controller + user)

1. Stripe test-mode pass: with `stripe listen` running, on a paid test user — Cancel in BillingPanel → confirm dialog → cancel notice appears (webhook syncs `cancel_at_period_end`) → Reactivate clears it. Update-payment-method + Billing-history open the Stripe portal to the right surface.
2. Optional: brand the Stripe portal (logo/colors/custom domain) in Stripe Dashboard → Billing → Customer portal, so the card/history hops match Quota.
3. Visual pass: legal + About redesign, both footers, expanded menu (Admin visible only when your email is in `ADMIN_EMAILS`).
