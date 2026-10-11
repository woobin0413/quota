# Auth hardening: sign-out cache, duplicate-signup message, email verification

**Date:** 2026-07-26
**Status:** Approved for planning

## Why

Three problems surfaced while testing signup on the production deployment:

1. Sign-out navigates away but leaves authenticated pages in the browser's
   history cache, and leaves per-device UI state behind.
2. Signing up with an email that already has an account gives no indication the
   account exists and no route to password reset.
3. New accounts receive no email-verification message, and nothing in the app
   requires verification.

A fourth issue was found and closed separately: the Google social connection was
removed from the tenant (it ran on Auth0 development keys, and its `google-oauth2`
subject crashed first-login provisioning against the `users.email` UNIQUE
constraint). That work is not part of this spec.

## Scope

Three independent workstreams, implemented in this order:

| Order | Workstream | Surface |
|---|---|---|
| 1 | C — sign-out cache hygiene | App code + middleware |
| 2 | A — duplicate-signup message | Auth0 tenant config |
| 3 | B — email verification gate | App code + Auth0 tenant + env + e2e |

C is first: smallest, closes a real security gap, and has no external
dependencies. B is last: it touches production environment variables and breaks
the e2e suite until the fixtures are updated.

Out of scope: reintroducing in-app `/signup` or `/login` pages (explicitly
forbidden by `CLAUDE.md`), account linking across Auth0 connections, and any
change to how quotes or billing work.

---

## Workstream C — Sign-out cache hygiene

### Problem

`next.config.js` defines five security headers (HSTS, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`). None of them is
`Cache-Control`. Authenticated pages are therefore browser-cacheable: after
sign-out, the browser Back button can re-render the dashboard — including client
names, quote totals, and billing state — from history cache without any request
reaching the server.

`handleSignOut` (`components/layout/Header.tsx:68`) is a bare
`window.location.href = "/auth/logout"`. It clears no client-side state.

### Design

**1. No-store on authenticated responses.**

Set `Cache-Control: no-store, must-revalidate` and `Pragma: no-cache` in
`middleware.ts` on every response for a non-public route.

This belongs in middleware, not `next.config.js` `headers()`, because the config
layer cannot distinguish an authenticated route from the public landing page —
and the landing page, `/og`, and `/logo` should stay cacheable. `middleware.ts`
already makes exactly this classification via `isPublicRoute()` (`middleware.ts:20`),
so the branch exists; only the header set is new.

Headers must be applied to the response the middleware actually returns,
including the `authResponse` passthrough at `middleware.ts:55`, not only to newly
constructed responses.

**2. Clear per-device state on sign-out.**

`handleSignOut` removes `quota_catalog_onboarding_dismissed` (defined at
`components/dashboard/CatalogOnboarding.tsx:16`) before navigating.

That key is scoped to the device, not the user. Today a second user signing in on
a shared laptop inherits the first user's dismissal and never sees the catalog
first-run prompt — which is the app's primary onboarding step.

`quota-landing-lang` (`components/landing/LanguageProvider.tsx:11`) is
deliberately preserved. It is a language preference, not user data, and it
belongs to the landing page rather than the session.

Both sign-out call sites must be covered: the desktop dropdown
(`Header.tsx:195`) and the mobile menu (`Header.tsx:323`). They already share
`handleSignOut`, so fixing the handler covers both — this is a constraint to
preserve, not new work.

**3. Verify the Auth0 session actually ends.**

`/auth/logout` must terminate the Auth0 tenant session, not just the local
application cookie. If it does not, Sign Out followed by Sign In silently
re-authenticates with no password prompt — on a shared machine, sign-out would be
cosmetic.

`@auth0/nextjs-auth0` v4 performs RP-initiated logout, so this is expected to
already work. It must be **verified against the tenant**, not assumed: the tenant's
Allowed Logout URLs must include the production origin, or Auth0 rejects the
logout redirect.

### Verification

- Sign in, open the dashboard, sign out, press Back. The dashboard must not
  render; the user must land on the landing page or login.
- `curl -I` a protected route with a valid session cookie: response carries
  `Cache-Control: no-store`.
- `curl -I /` and `/logo`: **no** `no-store` (they must stay cacheable).
- After sign-out, `localStorage` has no `quota_catalog_onboarding_dismissed` and
  still has `quota-landing-lang`.
- Sign out, then sign in: Auth0 prompts for credentials.

---

## Workstream A — Duplicate-signup message

### Decision and its tradeoff

The signup screen will state that an account with the given email already exists,
and offer password reset.

This was chosen with the tradeoff understood and accepted. Auth0's New Universal
Login suppresses this message by default because disclosing it creates a
**user-enumeration channel**: anyone can submit a list of addresses to the public
signup form and learn which have Quota accounts. That exposes the customer list
and tells a credential-stuffing attacker which addresses are worth attacking.
The enumeration-safe alternative (identical response either way, notify the
mailbox owner by email) was presented and declined. Recorded here so the
tradeoff is discoverable later, not to reopen it.

### Design

The Auth0 Database connection **already rejects** duplicate emails. Only the
rendered message is in question, so this is prompt custom text — no Auth0 Action,
no new script.

Extend the `PROMPT_TEXT` map in `scripts/auth0-branding.mjs:86` with the
duplicate-user error key for the signup screens. The script already authenticates
to the Management API and `PUT`s custom text per prompt (`putPromptText`,
`scripts/auth0-branding.mjs:157`); this adds map entries and reuses that path.

**The key name must not be guessed.** Before setting anything, the script performs
`GET /api/v2/prompts/{signup,signup-id,signup-password}/custom-text/en` and prints
the keys the tenant actually accepts. The implementation sets the real key
discovered there. Auth0's custom-text key set is version-dependent, and a wrong
key writes silently with no visible effect.

Copy: `An account with this email already exists. Sign in instead, or reset your
password.`

**Reset link:** New Universal Login renders a "Forgot password?" affordance on the
password step. Confirm it is reachable from the signup flow, not only from login.
If it is not, the copy above still directs the user, but the design should be
revisited rather than papered over.

**Fallback, only if needed:** if New Universal Login does not surface the
duplicate-user error as a distinct, customizable key, use a
`pre-user-registration` Action that calls `api.access.deny()` with the message.
More moving parts and another deploy target, so it is the second choice, not the
first.

### Verification

- Attempt signup with an email that already has an account. The stated message
  renders on screen.
- Password reset is reachable from that screen and delivers a working reset.
- Signup with a genuinely new email is unaffected.

---

## Workstream B — Email verification gate

### Part 1: make verification email actually send

Auth0 sends verification mail only through a configured email provider. This
tenant has none, so it falls back to Auth0's built-in test service, which is
rate-limited and delivers **only to the tenant owner's own address**. A real new
signup therefore receives nothing. This is the root cause of the reported
symptom, and no app-side change fixes it.

Configure **Resend over SMTP** as the Auth0 email provider
(`POST /api/v2/emails/provider`): host `smtp.resend.com`, username `resend`,
password = the Resend API key. Then enable Branding → Email Templates →
Verification Email.

This reuses the already-verified sending domain used for quote email, so no new
DNS work. The `RESEND_FROM_EMAIL` address should match what quotes send from, so
customers see one consistent sender.

### Part 2: gate the app on `email_verified`

Auth0 does not block login on an unverified email. `email_verified` is currently
read **nowhere** in the codebase (verified by grep: zero hits).

The gate goes in application code rather than a post-login Action, for two
reasons: the user gets a branded page with a working resend button instead of an
Auth0 error screen, and the behavior becomes testable by the existing Playwright
suite.

Components:

- **`requireUser()`** (`lib/auth.ts:50`) — when the session's `email_verified` is
  false, redirect to `/verify-email` instead of returning the user.
- **`app/verify-email/page.tsx`** — "check your inbox" state, resend button,
  sign-out link. Must not apply the gate to itself, or it redirect-loops.
- **`POST /api/auth/resend-verification`** — calls Management API
  `/api/v2/jobs/verification-email`. Rate limited via the existing `lib/rate-limit.ts`
  helper, at 3 requests / 60s per user — deliberately lower than the billing
  routes' 10/60s, because every call here spends a real email send.
- **Protected API routes** — return 403 `EMAIL_NOT_VERIFIED`, matching the shape
  of the existing `EMAIL_REQUIRES_PRO` response so the client error handling
  stays uniform.

`getCurrentUser()` keeps returning the user unchanged; only `requireUser()` and
the API guards enforce. But the guards run *before* `getCurrentUser()` is ever
called: `middleware.ts` decides on the session's `email_verified` claim alone
and never calls `getCurrentUser()`/`getOrCreateUser()`, and `requireUser()`
checks `needsVerification()` and redirects before it reaches its own
`getCurrentUser()` call. So an unverified user who never presses Resend gets
**no database row at all** until after they verify — first-login provisioning
only runs on the first request made *after* verification succeeds. This is
harmless: nothing depends on the row existing while the account is gated, and
there is no benefit to provisioning one for an account that cannot use the app
yet.

### Consequences to handle in the plan

**New production dependency.** `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET`
are currently used only by `scripts/` and e2e. The resend endpoint needs them in
production, with `update:users` scope on the M2M application. Add to
`.env.example` and to the launch checklist.

**The e2e suite breaks until fixtures are updated.** Both the shared user from
`e2e/global.setup.ts` and the throwaway accounts created by
`billing-purchase.spec.ts` will land on `/verify-email`, failing every spec. The
throwaway-account helper (`e2e/helpers/throwaway-account.ts`) must set
`email_verified: true` via the Management API at creation, and the shared e2e user
must be verified in the tenant. This is part of the workstream, not follow-up.

### Verification

- Fresh signup receives a verification email at a non-owner address.
- Before clicking the link: the dashboard redirects to `/verify-email`; a
  protected API returns 403 `EMAIL_NOT_VERIFIED`.
- Resend button delivers a second email; repeated presses hit the rate limit
  rather than spraying mail.
- After clicking the link: dashboard loads normally.
- Full `npm run test:e2e` passes.

---

## Testing strategy

Each workstream gets a failing test before its fix, per
`superpowers:test-driven-development`:

- **C** — Playwright: sign in, sign out, `goBack()`, assert the dashboard is not
  rendered. Plus a header assertion on a protected vs public route.
- **A** — no automated test. It is tenant configuration with no repo artifact
  beyond the script; verified manually against Universal Login. The script's
  dry-run mode (`--dry`) covers the write path.
- **B** — Playwright: an unverified account is redirected to `/verify-email` and
  a protected API returns 403; a verified account is not. Requires a Management
  API fixture that can create an unverified user.

`npm run type-check` and `npm run lint` must pass before any workstream is
considered done.

## Open items

- The exact Auth0 custom-text key for the duplicate-user error (Workstream A) —
  resolved by reading the tenant, not by guessing.
- Whether "Forgot password?" is reachable from the signup screen in this tenant's
  New Universal Login version (Workstream A).
- Whether the tenant's Allowed Logout URLs already include the production origin
  (Workstream C, item 3).

All three are verification steps inside their workstreams, not unresolved design
questions.
