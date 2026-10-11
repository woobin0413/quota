# Auth Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop authenticated pages surviving sign-out in the browser cache, tell a returning user their email is already registered, and require email verification before Quota can be used.

**Architecture:** Three independent workstreams landed in order C → A → B. C adds `Cache-Control: no-store` to protected responses from `middleware.ts` and clears per-device state on sign-out. A extends the existing Auth0 branding script with signup error copy — tenant config, no app code. B configures Resend as Auth0's SMTP provider, then gates unverified sessions in `middleware.ts` (single enforcement point for pages and APIs) with a branded `/verify-email` page that can re-mint a stale session.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, `@auth0/nextjs-auth0` v4, Auth0 Management API, Resend (SMTP), Vitest (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-26-auth-hardening-design.md`

## Global Constraints

- `npm run type-check` and `npm run lint` must pass before any task is considered done.
- Every DB query stays scoped by `user_id`. Never trust client-provided ownership.
- Server Components by default; `"use client"` only where interactive.
- Zod for all API input validation.
- Public routes must stay cacheable: `/`, `/og`, `/logo`, `/terms`, `/privacy`, `/refunds`, `/about`, `/api/webhooks/*`, `/api/waitlist`, `/api/cron/*`. The `no-store` header applies to protected routes only.
- Interactive components carry `data-testid` attributes used by the e2e suite — keep existing ones stable, add them to anything new the suite touches.
- Do not reintroduce in-app `/signup` or `/login` pages. `CLAUDE.md` forbids it; `next.config.js` redirects both paths to Universal Login.
- API error bodies use the established shape: `{ success: false, code: "SCREAMING_SNAKE", message: "Human sentence." }` with a matching HTTP status.
- Rate limiting goes through `checkRateLimit(key, opts)` from `lib/rate-limit.ts`, with a route prefix in the key (e.g. `resend-verification:${userId}`).
- Management API calls read `AUTH0_MGMT_DOMAIN || AUTH0_DOMAIN`. The audience never moves to a custom domain.
- Unit tests live in `lib/__tests__/*.test.ts` and run under Vitest (`npm run test`). They mock `@/lib/auth` and `@/lib/rate-limit` per the pattern in `lib/__tests__/receipt-gate.test.ts`.

## File Structure

**Workstream C**

| File | Responsibility |
|---|---|
| `lib/no-store.ts` (create) | `applyNoStore(res)` — sets the cache headers on a response. Pure, unit-testable, no Next request plumbing. |
| `middleware.ts` (modify) | Calls `applyNoStore` on every protected-route response. |
| `components/layout/Header.tsx` (modify `:68`) | `handleSignOut` clears per-device state before navigating. |
| `lib/__tests__/no-store.test.ts` (create) | Header assertions. |
| `e2e/signout.spec.ts` (create) | Back-button-after-signout regression. |

**Workstream A**

| File | Responsibility |
|---|---|
| `scripts/auth0-branding.mjs` (modify) | Adds a `--show` mode that prints the tenant's accepted custom-text keys, plus the duplicate-email copy in `PROMPT_TEXT`. |

**Workstream B**

| File | Responsibility |
|---|---|
| `scripts/auth0-email-provider.mjs` (create) | One-shot: point Auth0's email provider at Resend SMTP. |
| `lib/email-verification.ts` (create) | `needsVerification(session)`, `isVerificationExempt(pathname)`, `EMAIL_NOT_VERIFIED_BODY`. The whole decision, testable without Edge runtime. |
| `lib/auth0-management.ts` (create) | Server-side Management API token + `sendVerificationEmail(userId)`. Keeps the route thin. |
| `middleware.ts` (modify) | Redirects unverified pages to `/verify-email`; 403s unverified API calls. |
| `lib/auth.ts` (modify `:50`) | `requireUser()` backstop redirect. |
| `app/verify-email/page.tsx` (create) | Branded "check your inbox" + resend + continue. |
| `app/api/auth/resend-verification/route.ts` (create) | Rate-limited resend. |
| `lib/__tests__/email-verification.test.ts` (create) | Gate decision matrix. |
| `lib/__tests__/resend-verification-route.test.ts` (create) | Auth, rate limit, Management API call. |
| `e2e/helpers/throwaway-account.ts` (modify) | `verifyAuth0User(email)` so signup fixtures clear the gate. |
| `e2e/verify-email.spec.ts` (create) | Unverified redirect + 403. |
| `.env.example`, `CLAUDE.md`, `docs/launch-checklist.md` (modify) | New prod env + tenant steps. |

---

## Task 1: No-store on protected responses

Closes the actual gap: `next.config.js` sets five security headers and none is `Cache-Control`, so the dashboard sits in browser history cache and the Back button re-renders it after sign-out.

**Files:**
- Create: `lib/no-store.ts`
- Create: `lib/__tests__/no-store.test.ts`
- Modify: `middleware.ts` (imports; `:31-56`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `applyNoStore<T extends Response>(res: T): T` — mutates `res.headers` and returns the same instance. Task 7 reuses it on the 403 it adds.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/no-store.test.ts`:

```ts
/**
 * Authenticated responses must not be storable. Without this the browser keeps
 * dashboard HTML in history cache and the Back button re-renders a signed-out
 * user's client list. next.config.js has no cache headers, so middleware is the
 * only thing standing between sign-out and a stale render.
 */

import { describe, it, expect } from "vitest";
import { applyNoStore } from "@/lib/no-store";

describe("applyNoStore", () => {
  it("marks the response non-storable", () => {
    const res = applyNoStore(new Response("ok"));

    expect(res.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate, max-age=0"
    );
    expect(res.headers.get("pragma")).toBe("no-cache");
  });

  it("returns the same response instance so it can be used inline", () => {
    const res = new Response("ok");
    expect(applyNoStore(res)).toBe(res);
  });

  it("overwrites a permissive Cache-Control already on the response", () => {
    const res = new Response("ok", {
      headers: { "cache-control": "public, max-age=3600" },
    });

    expect(applyNoStore(res).headers.get("cache-control")).toContain("no-store");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- no-store`
Expected: FAIL — `Failed to resolve import "@/lib/no-store"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/no-store.ts`:

```ts
/**
 * Cache headers for authenticated responses.
 *
 * next.config.js sets the site-wide security headers, but it cannot tell an
 * authenticated route from the public landing page — and the landing page, /og
 * and /logo must stay cacheable. So this is applied from middleware, which
 * already classifies public vs protected.
 *
 * Without it, signing out leaves the dashboard renderable from browser history
 * cache: the Back button shows a signed-out user their own client list.
 */

const NO_STORE = "no-store, no-cache, must-revalidate, max-age=0";

/** Mark a response non-storable. Returns the same instance for inline use. */
export function applyNoStore<T extends Response>(res: T): T {
  res.headers.set("Cache-Control", NO_STORE);
  // Pragma is redundant for modern browsers but costs nothing and covers
  // intermediaries that only understand HTTP/1.0.
  res.headers.set("Pragma", "no-cache");
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- no-store`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire it into middleware**

In `middleware.ts`, add the import beside the existing ones:

```ts
import { applyNoStore } from "@/lib/no-store";
```

Then replace the body of `middleware` (currently `:31-56`) with:

```ts
export async function middleware(request: NextRequest) {
  const authResponse = await auth0.middleware(request);
  const { pathname } = request.nextUrl;

  // Let the SDK handle its own routes (/auth/login, /auth/callback, ...)
  if (pathname.startsWith("/auth")) {
    return authResponse;
  }

  if (isPublicRoute(pathname)) {
    return authResponse;
  }

  // Protect everything else
  const session = await auth0.getSession(request);
  if (!session) {
    if (pathname.startsWith("/api")) {
      return applyNoStore(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
    }
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("returnTo", pathname);
    return applyNoStore(NextResponse.redirect(loginUrl));
  }

  // Past this point the route is authenticated: never let it be stored.
  return applyNoStore(authResponse);
}
```

Note what did *not* change: `/auth/*` and public routes return `authResponse` untouched, so Universal Login and the cacheable marketing pages keep their current behavior.

- [ ] **Step 6: Verify headers on a real server**

Run: `npm run dev`, then in another shell:

```bash
curl -s -o /dev/null -D - http://localhost:3000/ | grep -i "cache-control"
curl -s -o /dev/null -D - http://localhost:3000/dashboard | grep -i "cache-control"
```

Expected: the `/` response has no `no-store`. The `/dashboard` response (a redirect to login, since curl has no session) carries `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`.

- [ ] **Step 7: Run the full unit suite and static checks**

Run: `npm run test && npm run type-check && npm run lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add lib/no-store.ts lib/__tests__/no-store.test.ts middleware.ts
git commit -m "fix(security): mark authenticated responses no-store

next.config.js sets five security headers, none of them cache-related, so
every authenticated page was browser-cacheable. After sign-out the Back
button re-rendered the dashboard — client names, quote totals, billing
state — from history cache with no request reaching the server.

Applied from middleware rather than next.config.js: the config layer cannot
tell an authenticated route from the landing page, and /, /og and /logo must
stay cacheable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Clear per-device state on sign-out

**Files:**
- Modify: `components/layout/Header.tsx:68-70`
- Create: `e2e/signout.spec.ts`

**Interfaces:**
- Consumes: `applyNoStore` behavior from Task 1 (the Back-button assertion only passes once Task 1 has landed).
- Produces: nothing later tasks import.

- [ ] **Step 1: Write the failing e2e test**

Create `e2e/signout.spec.ts`:

```ts
/**
 * Sign-out must actually end the session in the browser, not just navigate.
 *
 * Two failure modes this guards, both of which look fine in manual testing
 * unless you press the right button:
 *   - the dashboard renders from browser history cache after sign-out
 *   - the catalog-onboarding dismissal is keyed per *device*, so the next
 *     person to sign in on a shared laptop never sees the first-run prompt
 */

import { test, expect } from "@playwright/test";

test.describe("sign out", () => {
  test("back button does not re-render the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("menu-sign-out").click();

    // Auth0 logout bounces through the tenant and back to the landing page.
    await page.waitForURL((url) => !url.pathname.startsWith("/dashboard"), {
      timeout: 30_000,
    });

    await page.goBack();

    // Either the login redirect or the landing page is fine. A rendered
    // dashboard is not.
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).not.toBeVisible();
  });

  test("sign out clears the per-device onboarding dismissal", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.evaluate(() =>
      localStorage.setItem("quota_catalog_onboarding_dismissed", "1")
    );
    // A language preference is not session data and must survive.
    await page.evaluate(() =>
      localStorage.setItem("quota-landing-lang", "es")
    );

    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("menu-sign-out").click();
    await page.waitForURL((url) => !url.pathname.startsWith("/dashboard"), {
      timeout: 30_000,
    });

    expect(
      await page.evaluate(() =>
        localStorage.getItem("quota_catalog_onboarding_dismissed")
      )
    ).toBeNull();
    expect(
      await page.evaluate(() => localStorage.getItem("quota-landing-lang"))
    ).toBe("es");
  });
});
```

- [ ] **Step 2: Run it to see how it fails**

Run: `npx playwright test e2e/signout.spec.ts`
Expected: the first test PASSES (Task 1 already fixed the Back button) and the second FAILS on `quota_catalog_onboarding_dismissed` still being present after sign-out.

Both selectors already exist: `user-menu-trigger` at `components/layout/Header.tsx:140` and `menu-sign-out` at `:197`. Do not rename them — other specs depend on the current ids.

- [ ] **Step 3: Implement the state clearing**

Replace `handleSignOut` (`components/layout/Header.tsx:68-70`) with:

```tsx
  const handleSignOut = () => {
    // The onboarding dismissal is keyed per device, not per user: leaving it
    // behind means the next person to sign in on a shared machine never sees
    // the catalog first-run prompt, which is the app's primary onboarding step.
    // The landing language preference is not session data — it stays.
    try {
      localStorage.removeItem("quota_catalog_onboarding_dismissed");
    } catch {
      // Private-browsing modes can throw on localStorage access. Signing out
      // matters more than clearing a UI flag, so never block the navigation.
    }
    window.location.href = "/auth/logout";
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test e2e/signout.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Confirm no other spec regressed**

Run: `npm run test:e2e`
Expected: all specs pass. `no-store` on protected routes is new for every spec, so a failure here means a page was relying on being cached.

- [ ] **Step 6: Commit**

```bash
git add components/layout/Header.tsx e2e/signout.spec.ts
git commit -m "fix(auth): clear per-device state on sign out

handleSignOut only navigated. The catalog-onboarding dismissal key is scoped
to the device rather than the user, so a second person signing in on a shared
laptop inherited the first user's dismissal and never saw the first-run
prompt. The landing language preference is left alone — it is a preference,
not session data.

Adds an e2e regression for the Back-button case too, which is what the
no-store header fixed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Verify the Auth0 session actually ends

No code. If `/auth/logout` clears only the local cookie and not the Auth0 tenant session, Sign Out → Sign In silently re-authenticates with no password prompt, and everything in Tasks 1–2 is cosmetic on a shared machine. `@auth0/nextjs-auth0` v4 performs RP-initiated logout, so this is expected to pass — it must be confirmed, not assumed, because the tenant's Allowed Logout URLs can silently break it.

**Files:**
- Modify: `docs/launch-checklist.md`

- [ ] **Step 1: Check the tenant configuration**

Auth0 Dashboard → Applications → Quota → Settings → **Allowed Logout URLs**. Confirm it contains both:

```
http://localhost:3000
https://sendquota.com
```

Add the production origin if missing, and Save. Auth0 rejects a logout redirect to an unlisted URL, which leaves the tenant session alive.

- [ ] **Step 2: Confirm the session really ends**

In a browser (not Playwright, so the Auth0 cookie behaves normally):

1. Sign in at `/auth/login?returnTo=%2Fdashboard`.
2. Sign out from the header menu.
3. Go to `/auth/login?returnTo=%2Fdashboard` again.

Expected: Universal Login prompts for credentials. If it drops you straight into the dashboard, the tenant session survived — stop and investigate before continuing to Task 4.

- [ ] **Step 3: Record the outcome**

Add to `docs/launch-checklist.md`, under whichever auth section exists:

```markdown
- [x] Allowed Logout URLs include the production origin — verified 2026-07-26.
      Without it Auth0 refuses the logout redirect and the tenant SSO session
      survives sign-out, so signing back in needs no password.
```

- [ ] **Step 4: Commit**

```bash
git add docs/launch-checklist.md
git commit -m "docs: record logout-URL verification in the launch checklist

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Duplicate-signup message

The Database connection already rejects duplicate emails — only the rendered text is in question, so this is prompt custom text. No Action, no app code.

**This discloses account existence by design.** The tradeoff was raised during design and the enumeration-safe alternative was declined; see the spec's Workstream A. Do not silently substitute a generic message.

**Files:**
- Modify: `scripts/auth0-branding.mjs` (`PROMPT_TEXT` at `:86`; `main()` at `:349`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable — a script mode plus tenant state.

- [ ] **Step 1: Add a key-discovery mode**

The custom-text key set is version-dependent, and writing an unrecognized key succeeds silently with no visible effect. So read the tenant before writing anything.

In `scripts/auth0-branding.mjs`, add beside `putPromptText` (`:157`):

```js
/**
 * Print the custom-text keys the tenant actually accepts for a prompt.
 *
 * Auth0's key set varies by Universal Login version, and a PUT with an
 * unrecognized key returns 200 while changing nothing — so guessing a key name
 * produces a green run and an unchanged login screen. Always read first.
 */
async function showPromptText(token, prompt) {
  const url = `${API}/prompts/${prompt}/custom-text/${LANG}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  if (!res.ok) {
    console.error(`  ✗ ${prompt}: ${res.status} ${body.slice(0, 200)}`);
    return;
  }
  console.log(`\n--- ${prompt} ---`);
  console.log(body === "{}" ? "(no custom text set)" : JSON.stringify(JSON.parse(body), null, 2));
}
```

Then in `main()`, before the write loop at `:349`, add:

```js
  if (process.argv.includes("--show")) {
    console.log("Current Universal Login prompt text:");
    for (const prompt of Object.keys(PROMPT_TEXT)) {
      await showPromptText(token, prompt);
    }
    return;
  }
```

- [ ] **Step 2: Read the tenant's signup keys**

Run: `node scripts/auth0-branding.mjs --show`

Expected: JSON per prompt. Find the key for the "user already exists" error on the signup screens. Auth0 names these under the signup prompts alongside the other error keys.

**Write down the exact key name you see.** If no such key is present in any signup prompt, skip to Step 6 (the Action fallback).

- [ ] **Step 3: Add the copy**

In `PROMPT_TEXT` (`:86`), extend the signup entries with the key discovered in Step 2. Using `user-exists` as the placeholder below — **replace it with the real key**; do not commit a guessed name:

```js
  signup: {
    signup: {
      pageTitle: "Create your Quota account",
      title: "Create your account",
      description: "Start quoting in minutes with Quota.",
      buttonText: "Create account",
      // Tells the visitor their address is already registered and routes them
      // to sign-in or reset. This intentionally discloses account existence —
      // see docs/superpowers/specs/2026-07-26-auth-hardening-design.md
      // (Workstream A) for the enumeration tradeoff that was accepted.
      "user-exists":
        "An account with this email already exists. Sign in instead, or reset your password.",
    },
  },
```

Apply the same key to `"signup-id"` and `"signup-password"` if Step 2 showed it on those screens.

- [ ] **Step 4: Preview, then write**

Run: `node scripts/auth0-branding.mjs --dry`
Expected: prints the intended writes, changes nothing.

Run: `node scripts/auth0-branding.mjs`
Expected: `✓ signup custom text updated` for each prompt.

- [ ] **Step 5: Verify on the real screen**

In a fresh incognito window, open `/auth/login?screen_hint=signup&returnTo=%2Fdashboard` and submit an email that already has an account.

Expected: the new message renders. Also confirm a password-reset affordance is reachable from that screen — New Universal Login renders "Forgot password?" on the password step, but confirm it is reachable from *signup*, not only from login. If it is not reachable, note it and raise it rather than working around it.

Then confirm signup with a genuinely new address still works end to end.

- [ ] **Step 6: Fallback, only if Step 2 found no key**

Create a `pre-user-registration` Action in the Auth0 Dashboard (Actions → Library → Build Custom):

```js
exports.onExecutePreUserRegistration = async (event, api) => {
  // Only reached for Database connection signups. Auth0 already rejects the
  // duplicate; this exists solely to control the message the user sees.
  api.access.deny(
    "email_exists",
    "An account with this email already exists. Sign in instead, or reset your password."
  );
};
```

Guard it so it fires only on the duplicate case, add it to the Pre User Registration flow, then repeat Step 5. Record in the plan's notes that the fallback was used and why.

- [ ] **Step 7: Commit**

```bash
git add scripts/auth0-branding.mjs
git commit -m "feat(auth): tell duplicate signups the account already exists

The Database connection already rejected duplicate emails; only the rendered
message was missing, so this is prompt custom text rather than an Action.

Adds a --show mode first. Auth0's custom-text key set is version-dependent
and a PUT with an unrecognized key returns 200 while changing nothing, so the
key is read from the tenant instead of guessed.

This intentionally discloses account existence. The user-enumeration tradeoff
was raised during design and the enumeration-safe alternative (identical
response, notify the mailbox owner) was declined; the reasoning is recorded in
the spec so it stays discoverable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Make verification email actually send

Root cause of "no verification email": the tenant has no email provider configured, so Auth0 falls back to its built-in test service — rate-limited, and it delivers **only to the tenant owner's own address**. No app-side change fixes this.

**Files:**
- Create: `scripts/auth0-email-provider.mjs`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable — tenant state plus a rerunnable script.

- [ ] **Step 1: Write the provider script**

Create `scripts/auth0-email-provider.mjs`:

```js
#!/usr/bin/env node
/**
 * Point Auth0's email provider at Resend over SMTP.
 *
 * Why this exists: with no provider configured, Auth0 sends verification and
 * password-reset mail through its own built-in test service, which is
 * rate-limited and delivers ONLY to the tenant owner's address. Real signups
 * silently receive nothing, and no application change can fix it.
 *
 * Resend is already the app's sender for quotes, and its domain is verified, so
 * SMTP here means one consistent From address and no new DNS work.
 *
 * Requires on the M2M app: update:emails read:emails
 *
 * Env: AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET,
 *      AUTH0_MGMT_DOMAIN || AUTH0_DOMAIN, RESEND_API_KEY, RESEND_FROM_EMAIL
 *
 * Usage: node scripts/auth0-email-provider.mjs [--dry]
 */

const DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM_EMAIL;
const DRY = process.argv.includes("--dry");

const API = `https://${DOMAIN}/api/v2`;

for (const [name, value] of Object.entries({
  AUTH0_MGMT_DOMAIN_or_AUTH0_DOMAIN: DOMAIN,
  AUTH0_MGMT_CLIENT_ID: CLIENT_ID,
  AUTH0_MGMT_CLIENT_SECRET: CLIENT_SECRET,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL: FROM,
})) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(2);
  }
}

if (FROM.endsWith("@resend.dev")) {
  console.error(
    `RESEND_FROM_EMAIL is ${FROM} — Resend's shared sandbox domain.\n` +
      "Auth0 mail must come from your verified domain or it will not deliver."
  );
  process.exit(2);
}

async function getToken() {
  const res = await fetch(`https://${DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      audience: `${API}/`,
      grant_type: "client_credentials",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.error(`Management API token failed: ${data.error} — ${data.error_description}`);
    process.exit(2);
  }
  return data.access_token;
}

// Resend's SMTP bridge: the username is the literal string "resend" and the
// password is the API key. Port 465 is implicit TLS.
const provider = {
  name: "smtp",
  enabled: true,
  default_from_address: FROM,
  credentials: {
    smtp_host: "smtp.resend.com",
    smtp_port: 465,
    smtp_user: "resend",
    smtp_pass: RESEND_API_KEY,
  },
};

async function main() {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const existing = await fetch(`${API}/emails/provider`, { headers });
  const hasProvider = existing.status === 200;
  console.log(
    hasProvider
      ? `Existing provider: ${(await existing.json()).name} — will PATCH`
      : "No provider configured — will POST"
  );

  if (DRY) {
    console.log("\n--dry, not writing:");
    console.log(JSON.stringify({ ...provider, credentials: { ...provider.credentials, smtp_pass: "***" } }, null, 2));
    return;
  }

  const res = await fetch(`${API}/emails/provider`, {
    method: hasProvider ? "PATCH" : "POST",
    headers,
    body: JSON.stringify(provider),
  });
  if (!res.ok) {
    console.error(`✗ ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`✓ Auth0 email provider set to Resend SMTP, from ${FROM}`);
  console.log(
    "\nNext, in the Auth0 Dashboard: Branding → Email Templates →\n" +
      "  Verification Email (using Link) → toggle Status to Enabled.\n" +
      "The provider alone does not enable the template."
  );
}

main();
```

- [ ] **Step 2: Preview, then apply**

Run: `node scripts/auth0-email-provider.mjs --dry`
Expected: reports whether a provider exists and prints the payload with the password masked.

Run: `node scripts/auth0-email-provider.mjs`
Expected: `✓ Auth0 email provider set to Resend SMTP, from ...`

If it fails with 403, the M2M app is missing `update:emails` — add it under Applications → Quota M2M → APIs → Auth0 Management API → Permissions.

- [ ] **Step 3: Enable the template**

Auth0 Dashboard → Branding → Email Templates → **Verification Email (using Link)** → set Status to **Enabled** → Save.

The provider carries mail; the template decides whether Auth0 sends this particular message. Both are required.

- [ ] **Step 4: Prove delivery to a non-owner address**

Sign up at `/auth/login?screen_hint=signup&returnTo=%2Fdashboard` with an address that is **not** the tenant owner's — that is the whole point, since the old fallback only reached the owner.

Expected: verification email arrives, from your verified domain. Clicking the link marks the user verified (confirm in Dashboard → User Management → Users).

- [ ] **Step 5: Document the new env requirement**

In `.env.example`, under the Auth0 block, add:

```bash
AUTH0_MGMT_DOMAIN=      # canonical tenant domain; Management API audience never moves to a custom domain
AUTH0_MGMT_CLIENT_ID=   # M2M app. Scopes: read:users update:users (verification resend),
AUTH0_MGMT_CLIENT_SECRET=  #   update:prompts read:branding update:branding (branding script),
                           #   read:emails update:emails (email provider script),
                           #   delete:users (e2e teardown only)
```

- [ ] **Step 6: Commit**

```bash
git add scripts/auth0-email-provider.mjs .env.example
git commit -m "feat(auth): send Auth0 mail through Resend SMTP

New signups received no verification email because the tenant had no email
provider: Auth0 falls back to its built-in test service, which is rate limited
and delivers only to the tenant owner's own address. No application change
fixes that.

Points Auth0 at Resend over SMTP, reusing the already-verified sending domain
so verification mail and quote mail share one From address. Refuses to run
with a @resend.dev from-address, which would not deliver.

Enabling the Verification Email template is a separate dashboard step the
script prints on success.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The verification gate decision

Pure logic first, wiring in Task 7. Splitting it this way keeps the decision unit-testable without Edge-runtime plumbing.

**Files:**
- Create: `lib/email-verification.ts`
- Create: `lib/__tests__/email-verification.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `needsVerification(session: { user?: { email_verified?: boolean } } | null): boolean`
  - `isVerificationExempt(pathname: string): boolean`
  - `EMAIL_NOT_VERIFIED_BODY: { success: false; code: "EMAIL_NOT_VERIFIED"; message: string }`
  - `VERIFY_EMAIL_PATH = "/verify-email"`

  Task 7 imports all four into `middleware.ts` and `lib/auth.ts`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/email-verification.test.ts`:

```ts
/**
 * The email-verification gate decision.
 *
 * Two ways this goes wrong and neither is visible in a happy-path click-through:
 *   - fail open: a missing or undefined email_verified claim is treated as
 *     verified, and the gate silently does nothing
 *   - redirect loop: /verify-email is itself gated, so an unverified user is
 *     bounced from the page that would let them fix the problem
 */

import { describe, it, expect } from "vitest";
import {
  needsVerification,
  isVerificationExempt,
  EMAIL_NOT_VERIFIED_BODY,
  VERIFY_EMAIL_PATH,
} from "@/lib/email-verification";

describe("needsVerification", () => {
  it("gates a session whose email is not verified", () => {
    expect(needsVerification({ user: { email_verified: false } })).toBe(true);
  });

  it("lets a verified session through", () => {
    expect(needsVerification({ user: { email_verified: true } })).toBe(false);
  });

  it("fails closed when the claim is missing", () => {
    // A tenant that stops sending the claim must not silently disable the gate.
    expect(needsVerification({ user: {} })).toBe(true);
  });

  it("does not gate an absent session — that is the login redirect's job", () => {
    expect(needsVerification(null)).toBe(false);
    expect(needsVerification({})).toBe(false);
  });
});

describe("isVerificationExempt", () => {
  it("exempts the verify-email page itself", () => {
    // Otherwise the gate redirects the only page that can fix the problem.
    expect(isVerificationExempt(VERIFY_EMAIL_PATH)).toBe(true);
  });

  it("exempts the resend endpoint", () => {
    expect(isVerificationExempt("/api/auth/resend-verification")).toBe(true);
  });

  it("exempts sign-out so a gated user is never trapped", () => {
    expect(isVerificationExempt("/auth/logout")).toBe(true);
  });

  it("does not exempt the dashboard or the app's APIs", () => {
    expect(isVerificationExempt("/dashboard")).toBe(false);
    expect(isVerificationExempt("/api/quotes")).toBe(false);
  });

  it("does not exempt a path that merely starts with an exempt string", () => {
    // /verify-email-blah must not inherit the exemption.
    expect(isVerificationExempt("/verify-email-blah")).toBe(false);
  });
});

describe("EMAIL_NOT_VERIFIED_BODY", () => {
  it("matches the established API error shape", () => {
    expect(EMAIL_NOT_VERIFIED_BODY.success).toBe(false);
    expect(EMAIL_NOT_VERIFIED_BODY.code).toBe("EMAIL_NOT_VERIFIED");
    expect(typeof EMAIL_NOT_VERIFIED_BODY.message).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- email-verification`
Expected: FAIL — `Failed to resolve import "@/lib/email-verification"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/email-verification.ts`:

```ts
/**
 * Email-verification gate.
 *
 * Auth0 does not block login on an unverified email — it only sets the
 * `email_verified` claim. Enforcement is ours.
 *
 * The decision lives here rather than inline in middleware for two reasons: it
 * is testable without Edge-runtime plumbing, and 26 files call getCurrentUser()
 * or requireUser(), so a per-route gate would be 26 chances to forget one.
 * middleware.ts is the single enforcement point; requireUser() is a backstop.
 */

export const VERIFY_EMAIL_PATH = "/verify-email";

/**
 * Paths reachable with an unverified session.
 *
 * Without the first two, the gate redirects the very page that would let the
 * user fix the problem. Without the third, a gated user cannot sign out.
 */
const EXEMPT_PATHS = [
  VERIFY_EMAIL_PATH,
  "/api/auth/resend-verification",
  "/auth/logout",
];

export const EMAIL_NOT_VERIFIED_BODY = {
  success: false,
  code: "EMAIL_NOT_VERIFIED",
  message: "Confirm your email address to finish setting up your account.",
} as const;

/**
 * Should this session be held at the gate?
 *
 * Fails CLOSED: a missing claim counts as unverified. An absent session is not
 * this function's problem — the login redirect handles that, and returning true
 * here would send anonymous visitors to /verify-email instead of to login.
 */
export function needsVerification(
  session: { user?: { email_verified?: boolean } } | null | undefined
): boolean {
  if (!session?.user) return false;
  return session.user.email_verified !== true;
}

/** Exact match or slash boundary only, so /verify-email-blah is still gated. */
export function isVerificationExempt(pathname: string): boolean {
  return EXEMPT_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + "/")
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- email-verification`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/email-verification.ts lib/__tests__/email-verification.test.ts
git commit -m "feat(auth): email-verification gate decision

Pure logic, wired up next. Fails closed: a missing email_verified claim
counts as unverified, so a tenant that stops sending it cannot silently
disable the gate. Exempts /verify-email, the resend endpoint, and
/auth/logout — without those an unverified user is bounced from the page
that fixes the problem, or trapped unable to sign out.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Resend endpoint and the verify-email page

**Files:**
- Create: `lib/auth0-management.ts`
- Create: `app/api/auth/resend-verification/route.ts`
- Create: `app/verify-email/page.tsx`
- Create: `lib/__tests__/resend-verification-route.test.ts`

**Interfaces:**
- Consumes: `EMAIL_NOT_VERIFIED_BODY` from Task 6; `checkRateLimit` from `lib/rate-limit.ts`; `getCurrentUser` from `lib/auth.ts`.
- Produces:
  - `sendVerificationEmail(auth0UserId: string): Promise<void>` from `lib/auth0-management.ts`
  - `POST /api/auth/resend-verification` → `{ success: true }` | 401 | 429 `RATE_LIMITED` | 502 `RESEND_FAILED`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/resend-verification-route.test.ts`:

```ts
/**
 * POST /api/auth/resend-verification
 *
 * This endpoint makes Auth0 send mail on request, so an unauthenticated or
 * unlimited version is a spam cannon pointed at our own sending reputation.
 * The rate limit is the feature, not a nicety.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const checkRateLimit = vi.fn();
const sendVerificationEmail = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));
vi.mock("@/lib/auth0-management", () => ({
  sendVerificationEmail: (...a: unknown[]) => sendVerificationEmail(...a),
}));

import { POST } from "@/app/api/auth/resend-verification/route";

const req = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockReturnValue({ allowed: true, remaining: 9, resetTime: 0 });
  sendVerificationEmail.mockResolvedValue(undefined);
});

describe("POST /api/auth/resend-verification", () => {
  it("401 when unauthenticated, without touching Auth0", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("sends for an authenticated user", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", auth0_user_id: "auth0|abc" });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // Auth0's own subject, not our row id — /api/v2/jobs/verification-email
    // takes the Auth0 user_id.
    expect(sendVerificationEmail).toHaveBeenCalledWith("auth0|abc");
  });

  it("429 when the caller is over the limit, without sending", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", auth0_user_id: "auth0|abc" });
    checkRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetTime: 0 });

    const res = await POST(req);

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("RATE_LIMITED");
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("rate-limits per user, not globally", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", auth0_user_id: "auth0|abc" });

    await POST(req);

    expect(checkRateLimit).toHaveBeenCalledWith(
      "resend-verification:u1",
      expect.anything()
    );
  });

  it("502 when Auth0 fails, without leaking the upstream error", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", auth0_user_id: "auth0|abc" });
    sendVerificationEmail.mockRejectedValue(new Error("mgmt 403 insufficient scope"));

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("RESEND_FAILED");
    expect(JSON.stringify(body)).not.toContain("insufficient scope");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- resend-verification-route`
Expected: FAIL — cannot resolve `@/app/api/auth/resend-verification/route`.

- [ ] **Step 3: Write the Management API client**

Create `lib/auth0-management.ts`:

```ts
/**
 * Auth0 Management API — server side.
 *
 * Until now the Management API was only used by scripts/ and the e2e helpers.
 * The verification resend needs it at runtime, which makes
 * AUTH0_MGMT_CLIENT_ID / AUTH0_MGMT_CLIENT_SECRET a production dependency with
 * `update:users` scope.
 *
 * The domain follows the same rule as scripts/auth0-*.mjs and the e2e helper:
 * the Management API audience stays on the canonical tenant domain even after
 * AUTH0_DOMAIN moves to a custom domain for the screens users see.
 */

const MGMT_DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;

async function managementToken(): Promise<string> {
  const res = await fetch(`https://${MGMT_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.AUTH0_MGMT_CLIENT_ID,
      client_secret: process.env.AUTH0_MGMT_CLIENT_SECRET,
      audience: `https://${MGMT_DOMAIN}/api/v2/`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Management token failed: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

/**
 * Ask Auth0 to re-send its verification email.
 * `auth0UserId` is the Auth0 subject (users.auth0_user_id), not our row id.
 */
export async function sendVerificationEmail(auth0UserId: string): Promise<void> {
  const token = await managementToken();
  const res = await fetch(`https://${MGMT_DOMAIN}/api/v2/jobs/verification-email`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: auth0UserId }),
  });
  if (!res.ok) {
    throw new Error(`verification-email job failed: ${res.status} ${await res.text()}`);
  }
}
```

- [ ] **Step 4: Write the route**

Create `app/api/auth/resend-verification/route.ts`:

```ts
/**
 * POST /api/auth/resend-verification
 *
 * Re-sends Auth0's verification email for the signed-in user. Rate limited
 * because it makes Auth0 send mail on demand: unlimited, it is a spam cannon
 * aimed at our own Resend sending reputation.
 *
 * Exempt from the verification gate itself (lib/email-verification.ts) —
 * gating it would mean only verified users could ask to be verified.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendVerificationEmail } from "@/lib/auth0-management";

export async function POST(_request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`resend-verification:${user.id}`, {
    windowMs: 60 * 1000,
    maxRequests: 3,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      {
        success: false,
        code: "RATE_LIMITED",
        message: "Too many requests. Wait a minute and try again.",
      },
      { status: 429 }
    );
  }

  try {
    await sendVerificationEmail(user.auth0_user_id);
  } catch (error) {
    // Upstream detail (scope problems, tenant config) goes to the server log,
    // never to the client.
    console.error("[resend-verification]", (error as Error).message);
    return NextResponse.json(
      {
        success: false,
        code: "RESEND_FAILED",
        message: "Could not send the email just now. Try again shortly.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}
```

Three sends per minute rather than the billing routes' ten: this one costs real email, and a person who needs more than three in a minute has a different problem.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- resend-verification-route`
Expected: PASS, 5 tests.

- [ ] **Step 6: Build the verify-email page**

Create `app/verify-email/page.tsx`:

```tsx
/**
 * The gate's landing page.
 *
 * The "I've confirmed" button is not decoration. The session cookie was minted
 * at login and still carries email_verified: false — clicking the link in the
 * email updates Auth0, not the cookie. Without a way to re-mint the session the
 * user stays stuck here after doing exactly what we asked. Sending them back
 * through /auth/login issues a fresh session with the updated claim; because
 * they still have an Auth0 session, it is a silent round trip, not a re-login.
 */

"use client";

import { useState } from "react";
import { useUser } from "@auth0/nextjs-auth0";
import { Button } from "@/components/ui/button";
import { MailCheck } from "lucide-react";

export default function VerifyEmailPage() {
  const { user } = useUser();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const resend = async () => {
    setStatus("sending");
    setMessage(null);
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("sent");
      } else {
        setStatus("error");
        setMessage(body.message ?? "Could not send the email. Try again shortly.");
      }
    } catch {
      setStatus("error");
      setMessage("Could not send the email. Check your connection and try again.");
    }
  };

  return (
    <div className="container mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <MailCheck className="mb-4 h-10 w-10 text-accent" aria-hidden="true" />
      <p className="eyebrow mb-1">One more step</p>
      <h1 className="font-display mb-3 text-4xl font-bold uppercase">
        Confirm your email
      </h1>
      <p className="text-muted-foreground mb-8">
        We sent a confirmation link to{" "}
        <span className="font-medium">{user?.email ?? "your email address"}</span>.
        Click it to finish setting up your account.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        {/* A full navigation, not a router push: this must re-mint the session
            cookie so the updated email_verified claim is picked up. */}
        <Button asChild data-testid="verify-email-continue">
          <a href="/auth/login?returnTo=%2Fdashboard">I&apos;ve confirmed — continue</a>
        </Button>
        <Button
          variant="outline"
          onClick={resend}
          disabled={status === "sending" || status === "sent"}
          data-testid="verify-email-resend"
        >
          {status === "sending"
            ? "Sending…"
            : status === "sent"
              ? "Email sent"
              : "Resend the email"}
        </Button>
      </div>

      {message && (
        <p className="text-destructive mt-4 text-sm" data-testid="verify-email-error">
          {message}
        </p>
      )}

      <p className="text-muted-foreground mt-8 text-sm">
        Wrong address? <a className="underline" href="/auth/logout">Sign out</a> and
        start again.
      </p>
    </div>
  );
}
```

- [ ] **Step 7: Wire the gate into middleware**

In `middleware.ts`, add to the imports:

```ts
import {
  needsVerification,
  isVerificationExempt,
  EMAIL_NOT_VERIFIED_BODY,
  VERIFY_EMAIL_PATH,
} from "@/lib/email-verification";
```

Then, in `middleware`, insert between the `if (!session)` block and the final `return`:

```ts
  // Verification gate. Here rather than in each route because 26 files call
  // getCurrentUser()/requireUser() — one enforcement point instead of 26
  // chances to forget one.
  if (needsVerification(session) && !isVerificationExempt(pathname)) {
    if (pathname.startsWith("/api")) {
      return applyNoStore(
        NextResponse.json(EMAIL_NOT_VERIFIED_BODY, { status: 403 })
      );
    }
    return applyNoStore(
      NextResponse.redirect(new URL(VERIFY_EMAIL_PATH, request.url))
    );
  }
```

`/auth/*` already returns early above this, so `/auth/logout` stays reachable regardless of the exemption list — the list covers it belt-and-braces.

- [ ] **Step 8: Add the requireUser backstop**

In `lib/auth.ts`, add the import:

```ts
import { needsVerification, VERIFY_EMAIL_PATH } from "@/lib/email-verification";
```

Then replace `requireUser` (`:50-56`) with:

```ts
export async function requireUser(): Promise<User> {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  // Backstop only — middleware is the primary gate. This covers any future
  // route that slips outside the middleware matcher.
  if (needsVerification(session)) {
    redirect(VERIFY_EMAIL_PATH);
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login");
  }
  return user;
}
```

- [ ] **Step 9: Run the unit suite and static checks**

Run: `npm run test && npm run type-check && npm run lint`
Expected: all pass. `lib/auth.ts` now calls `auth0.getSession()` twice on a page load; that reads the same cookie both times, no extra network call.

- [ ] **Step 10: Commit**

```bash
git add lib/auth0-management.ts app/api/auth/resend-verification/route.ts \
  app/verify-email/page.tsx lib/__tests__/resend-verification-route.test.ts \
  middleware.ts lib/auth.ts
git commit -m "feat(auth): require a verified email before using Quota

Auth0 sets email_verified but never blocks login, so enforcement is ours.
Gate lives in middleware: 26 files call getCurrentUser()/requireUser(), so a
per-route check would be 26 chances to miss one. Pages redirect to
/verify-email, APIs get 403 EMAIL_NOT_VERIFIED. requireUser() keeps a
backstop for anything outside the middleware matcher.

The page's continue button exists because the session cookie is minted at
login and keeps email_verified: false — clicking the emailed link updates
Auth0, not the cookie, so without a way to re-mint the session the user stays
stuck after doing what we asked.

Resend is capped at 3/minute per user rather than the billing routes' 10:
this one spends real email against our own sending reputation.

Makes AUTH0_MGMT_CLIENT_ID/SECRET a production dependency, scope update:users.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: E2E fixtures for the gate

Without this the whole suite fails: the shared user and every throwaway signup land on `/verify-email`. This is part of the workstream, not follow-up.

**Files:**
- Modify: `e2e/helpers/throwaway-account.ts`
- Modify: `e2e/billing-purchase.spec.ts`
- Create: `e2e/verify-email.spec.ts`

**Interfaces:**
- Consumes: the gate from Task 7.
- Produces: `verifyAuth0User(email: string): Promise<void>` exported from `e2e/helpers/throwaway-account.ts`.

- [ ] **Step 1: Verify the shared e2e user in the tenant**

Auth0 Dashboard → User Management → Users → the `E2E_AUTH0_USER_EMAIL` account → Details → set **Email Verified** to true → Save.

One-off manual step. It cannot be scripted into `global.setup.ts` without giving the suite `update:users`, and the shared user is a fixture, not a test subject.

- [ ] **Step 2: Confirm the suite is green again before touching signup**

Run: `npm run test:e2e -- --grep-invert "purchase"`
Expected: pass. If specs still land on `/verify-email`, Step 1 did not take effect — the storage state may be stale, so delete `e2e/.auth/user.json` and rerun.

- [ ] **Step 3: Add the verification helper**

In `e2e/helpers/throwaway-account.ts`, add after `deleteAuth0User` (`:100`):

```ts
/**
 * Mark a throwaway signup verified.
 *
 * The app gates unverified sessions at middleware, so a freshly signed-up
 * account lands on /verify-email instead of the dashboard and the purchase flow
 * never starts. Real users click the emailed link; the suite has no mailbox, so
 * it flips the flag directly.
 *
 * Needs `update:users` on the M2M app — the same scope the resend endpoint uses
 * in production.
 *
 * Note for callers: this updates Auth0, NOT the browser's session cookie, which
 * still carries email_verified: false. The caller must re-mint the session
 * afterwards (navigate to /auth/login) exactly as a real user does.
 */
export async function verifyAuth0User(email: string): Promise<void> {
  const domain = MGMT_DOMAIN;
  const token = await managementToken();
  const lookup = await fetch(
    `https://${domain}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!lookup.ok) {
    throw new Error(`users-by-email ${lookup.status} — need read:users`);
  }
  const users = (await lookup.json()) as { user_id: string }[];
  if (users.length === 0) {
    throw new Error(`No Auth0 user for ${email}`);
  }
  for (const user of users) {
    const res = await fetch(
      `https://${domain}/api/v2/users/${encodeURIComponent(user.user_id)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email_verified: true }),
      }
    );
    if (!res.ok) {
      throw new Error(`PATCH user ${res.status} — need update:users`);
    }
  }
}
```

- [ ] **Step 4: Use it in the purchase spec**

In `e2e/billing-purchase.spec.ts`, find where the spec finishes Auth0 signup and first expects the dashboard. Insert immediately after signup completes and before any assertion about app pages:

```ts
  // The gate sends a fresh signup to /verify-email. Flip the flag in Auth0,
  // then re-mint the session — the cookie still says unverified, exactly as it
  // would for a real user who just clicked the link in their email.
  await verifyAuth0User(email);
  await page.goto("/auth/login?returnTo=%2Fdashboard");
  await page.waitForURL("**/dashboard**", { timeout: 30_000 });
```

Add `verifyAuth0User` to the existing import from `./helpers/throwaway-account`.

- [ ] **Step 5: Write the gate's own e2e spec**

Create `e2e/verify-email.spec.ts`:

```ts
/**
 * The verification gate, from the outside.
 *
 * Uses a throwaway signup because the shared e2e user is verified by design.
 * Skips rather than half-runs when the Management API env is absent — same rule
 * as billing-purchase.spec.ts.
 */

import { test, expect } from "@playwright/test";
import {
  missingPurchaseEnv,
  throwawayEmail,
  throwawayPassword,
  verifyAuth0User,
  deleteAuth0User,
  deleteAppUser,
} from "./helpers/throwaway-account";

const missing = missingPurchaseEnv();

test.describe("email verification gate", () => {
  test.skip(
    missing.length > 0,
    `Needs Management API env: ${missing.join(", ")}`
  );

  const email = throwawayEmail();
  const password = throwawayPassword();

  test.afterAll(async () => {
    await deleteAppUser(email);
    await deleteAuth0User(email);
  });

  test("an unverified account is gated, and verifying releases it", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    // Sign up fresh through Universal Login.
    await page.goto("/auth/login?screen_hint=signup&returnTo=%2Fdashboard");
    await page.fill("input#email, input[name=email]", email);
    await page.fill("input#password, input[name=password]", password);
    await page
      .locator('button[type=submit][name=action], button[type=submit]')
      .first()
      .click();

    // Gated: the dashboard is not reachable yet.
    await page.waitForURL("**/verify-email**", { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: /confirm your email/i })
    ).toBeVisible();

    // APIs are gated too, with the documented code.
    const apiRes = await page.request.get("/api/work-items");
    expect(apiRes.status()).toBe(403);
    expect((await apiRes.json()).code).toBe("EMAIL_NOT_VERIFIED");

    // Verify in Auth0, then re-mint the session the way the page's own
    // continue button does.
    await verifyAuth0User(email);
    await page.getByTestId("verify-email-continue").click();

    await page.waitForURL("**/dashboard**", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await context.close();
  });
});
```

- [ ] **Step 6: Run the new spec**

Run: `npx playwright test e2e/verify-email.spec.ts`
Expected: PASS, or SKIP with a named missing env var. A 403 on `verifyAuth0User` means the M2M app lacks `update:users` — add it in the Auth0 Dashboard.

- [ ] **Step 7: Run everything**

Run: `npm run test:all`
Expected: type-check, lint, unit, and the full e2e suite all pass.

- [ ] **Step 8: Commit**

```bash
git add e2e/helpers/throwaway-account.ts e2e/billing-purchase.spec.ts \
  e2e/verify-email.spec.ts
git commit -m "test(e2e): fixtures and coverage for the verification gate

Every throwaway signup now lands on /verify-email, which broke the purchase
spec. verifyAuth0User() flips email_verified through the Management API since
the suite has no mailbox to click a link in.

The helper deliberately does not touch the browser session: callers must
re-mint it by navigating to /auth/login, because Auth0 and the session cookie
are separate pieces of state and a real user hits the same thing after
clicking the emailed link. Getting that wrong is precisely the bug the page's
continue button exists to prevent, so the spec exercises that button.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/launch-checklist.md`

- [ ] **Step 1: Update the architecture notes**

In `CLAUDE.md`, extend the **Authentication (Auth0)** section:

```markdown
- **Email verification is required.** Auth0 sets `email_verified` but never blocks
  login, so `middleware.ts` enforces it via `lib/email-verification.ts`: pages
  redirect to `/verify-email`, APIs return 403 `EMAIL_NOT_VERIFIED`.
  `requireUser()` keeps a backstop for routes outside the middleware matcher.
  Exempt: `/verify-email`, `/api/auth/resend-verification`, `/auth/logout` —
  without those a gated user cannot fix the problem or sign out.
  `needsVerification()` **fails closed**: a missing claim counts as unverified.
- **A verified email does not unstick a live session.** The session cookie is
  minted at login and keeps `email_verified: false` after the user clicks the
  emailed link. `/verify-email`'s continue button navigates to `/auth/login` to
  re-mint it — a silent round trip, since the Auth0 session is still valid.
- **Auth0 sends mail through Resend SMTP** (`scripts/auth0-email-provider.mjs`).
  With no provider configured Auth0 falls back to a test service that only
  delivers to the tenant owner, so real signups get nothing. Enabling Branding →
  Email Templates → Verification Email is a separate dashboard step.
- **Management API is a production dependency now.** `/api/auth/resend-verification`
  needs `AUTH0_MGMT_CLIENT_ID`/`SECRET` with `update:users` at runtime, not just
  in scripts and e2e.
- **Duplicate signup discloses account existence** by explicit product decision —
  the enumeration tradeoff is recorded in
  `docs/superpowers/specs/2026-07-26-auth-hardening-design.md`. Copy lives in
  `scripts/auth0-branding.mjs`. Run it with `--show` before adding text keys:
  Auth0's key set is version-dependent and an unknown key returns 200 while
  changing nothing.
- **Authenticated responses are `no-store`** (`lib/no-store.ts`, applied from
  middleware). Public routes stay cacheable. Without this the Back button
  re-renders the dashboard after sign-out.
```

- [ ] **Step 2: Update the launch checklist**

Add to `docs/launch-checklist.md`:

```markdown
### Auth hardening (2026-07-26)

- [ ] `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET` set in production
      (Vercel env), M2M scopes: `read:users`, `update:users`, `update:prompts`,
      `read:branding`, `update:branding`, `read:emails`, `update:emails`
- [ ] Auth0 email provider points at Resend SMTP
      (`node scripts/auth0-email-provider.mjs`)
- [ ] Branding → Email Templates → Verification Email is **Enabled**
- [ ] Verification email delivers to a non-owner address
- [ ] Duplicate signup shows the "account already exists" message, with reset
      reachable
- [ ] Allowed Logout URLs include the production origin
- [ ] Sign out → Back button does not re-render the dashboard
- [ ] `E2E_AUTH0_USER_EMAIL` is marked Email Verified in the tenant
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/launch-checklist.md
git commit -m "docs: record the auth hardening invariants

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| C1 `no-store` from middleware, public routes cacheable | 1 |
| C2 clear `quota_catalog_onboarding_dismissed`, keep `quota-landing-lang` | 2 |
| C2 both sign-out call sites | 2 (shared handler; asserted in Step 3) |
| C3 verify Auth0 SSO logout + Allowed Logout URLs | 3 |
| A `--show` before writing; duplicate-email copy; enumeration tradeoff recorded | 4 |
| A reset link reachable from signup | 4 Step 5 |
| A `pre-user-registration` fallback | 4 Step 6 |
| B1 Resend SMTP provider + template enabled | 5 |
| B2 middleware gate, `/verify-email`, resend route, 403 `EMAIL_NOT_VERIFIED` | 6, 7 |
| B2 `requireUser()` gate | 7 Step 8 (backstop; middleware is primary) |
| B `AUTH0_MGMT_*` in prod with `update:users` | 5 Step 5, 7, 9 |
| B e2e fixtures: throwaway verified, shared user verified | 8 |
| Testing strategy: C e2e + header test, A manual, B unit + e2e | 1, 2, 4, 6, 7, 8 |

Two deliberate deviations from the spec's wording, both documented in the tasks that make them:

1. **The gate is enforced in `middleware.ts`, not only `requireUser()`.** The spec named `requireUser()`; 26 files call it or `getCurrentUser()`, and APIs need the same gate. Middleware is one enforcement point covering both, with `requireUser()` retained as a backstop. Satisfies the spec's intent — app-side gate, branded page, testable.
2. **`/verify-email` gained a session re-mint action** not in the spec. Without it the gate is a trap: clicking the emailed link updates Auth0 while the session cookie keeps `email_verified: false`. Task 7 Step 6 and Task 8 Step 3 both explain it.

One spec item intentionally has no test: Workstream A is tenant configuration with no repo artifact beyond the script, verified manually per the spec's testing strategy.

**Placeholder scan:** No TBD/TODO. Every code step carries complete code. The one deliberately unresolved value — the Auth0 custom-text key in Task 4 — is resolved by Step 2 reading the tenant, with an explicit instruction not to commit a guessed name and a fallback if no key exists.

**Type consistency:** `applyNoStore` (Task 1) is used by name in Task 7. `needsVerification`, `isVerificationExempt`, `EMAIL_NOT_VERIFIED_BODY`, `VERIFY_EMAIL_PATH` (Task 6) are imported under those exact names in Task 7. `sendVerificationEmail(auth0UserId)` (Task 7 Step 3) matches the mock and the assertion in Task 7 Step 1. `verifyAuth0User(email)` (Task 8 Step 3) matches its uses in Steps 4 and 5. `user.auth0_user_id` matches the `UserRow` column name.
