# In-App Signup/Login + Account-Nav Polish — Design

**Date:** 2026-07-19
**Status:** Approved (design)

## Goal

Give Quota branded, in-app `/signup` and `/login` pages that hand credential
entry off to Auth0 (Universal Login), and clean up the authenticated
account navigation: de-duplicate Profile Settings vs Plan & Billing, title
each popup, and give logged-in users a way back to the dashboard from the
Help/About page.

## Background — current state

- Auth is Auth0 v4 (`@auth0/nextjs-auth0/server`, `lib/auth0.ts`) with the
  SDK middleware serving `/auth/login|logout|callback|profile`.
  `signInReturnToPath: "/dashboard"`. No custom auth UI today — CTAs point
  straight at `/auth/login` (hosted Universal Login).
- First-login provisioning already exists: `getCurrentUser()` →
  `getOrCreateUser()` upserts the `users` row from session claims. New
  signups need **no** extra backend.
- `middleware.ts` gates everything except `PUBLIC_ROUTES` (`/`, `/og`,
  legal pages, webhooks, waitlist, cron).
- Landing is bilingual (EN/ES) via `components/landing/LanguageProvider`
  + copy in `lib/landing-copy.ts` (`useLandingCopy()`), with a `lang-toggle`.
- Header dropdown (`components/layout/Header.tsx`): **both** "Profile
  Settings" and "Plan & billing" call `setSettingsOpen(true)` → the same
  `ProfileSettingsDialog`, which embeds `<BillingPanel/>` through
  `ProfileForm` (line ~132, `{sub && <BillingPanel/>}`). So billing shows
  inside Profile Settings and the billing menu item just reopens the
  identical popup.
- "Help & Contact" links to `/about`, rendered under
  `app/(legal)/layout.tsx`; that layout's only nav goes to `/` (marketing),
  so a logged-in user lands on `/about` with no path back to `/dashboard`.

## Chosen approach

**Signup/login:** branded in-app pages that collect an email and hand off
to Auth0 Universal Login (`/auth/login`) with `screen_hint=signup` (signup)
or none (login), plus `login_hint=<email>` to prefill and
`returnTo=/dashboard`. Auth0 owns password capture, storage, breach
detection, and the verification email. No custom credential handling, no
Resource Owner Password Grant, no DB schema change.

*Rejected:* fully custom form → `/dbconnections/signup` + ROPG (larger
attack surface, weaker security, bypasses Auth0 protections); pure-CTA page
with no email capture (worse conversion).

## Part A — In-app signup + login

### Routes (public, branded, bilingual)

- **`/signup`** — eyebrow + display headline + subline ("3 quotes free ·
  no card") + one email field → **Create account** button. Hands off to
  `buildAuthHandoffUrl("signup", email)`. Cross-link: "Already have one?
  Sign in" → `/login`.
- **`/login`** — same shell + email field → **Continue** button. Hands off
  to `buildAuthHandoffUrl("login", email)`. Cross-link: "New here? Create
  account" → `/signup`.

Both wrap content in `LanguageProvider` and carry a `lang-toggle`, matching
the landing pages. Both show an error banner when the URL carries `?error=`
(Auth0 bounce-back).

### Units

- **`lib/auth-urls.ts`** — pure helper:
  ```ts
  export function buildAuthHandoffUrl(
    mode: "signup" | "login",
    email: string
  ): string
  ```
  Returns `/auth/login?...` with `returnTo=/dashboard`,
  `login_hint=<encoded email>`, and — for `mode === "signup"` —
  `screen_hint=signup`. Trims email; omits `login_hint` when email is empty.
  Every param value URL-encoded.
- **`components/auth/AuthHandoffForm.tsx`** — `"use client"`. Props:
  `mode: "signup" | "login"`, plus the localized labels/copy it renders.
  One email input (`type=email`, testid `auth-email`), one submit button
  (testid `auth-submit`). On submit: validate non-empty + basic email
  shape; invalid → inline error, no navigation; valid →
  `window.location.href = buildAuthHandoffUrl(mode, email)`. Root testid
  `auth-handoff-form`.
- **`app/signup/page.tsx`**, **`app/login/page.tsx`** — thin server/client
  pages that render the branded shell, wrap in `LanguageProvider`, and
  mount `AuthHandoffForm` with the right `mode` and localized copy. Read
  `searchParams.error` to show the bounce-back banner.
- **`lib/landing-copy.ts`** — add an `auth` copy block (EN + ES):
  headline, subline, email label/placeholder, signup CTA, login CTA,
  cross-link prompts, and a generic error string.

### Wiring

- `middleware.ts` — add `/signup` and `/login` to `PUBLIC_ROUTES` (exact +
  slash-boundary match, consistent with existing entries).
- Landing CTAs — split by intent: primary "Start free / Start quoting free"
  CTAs (hero, header, pricing, footer) → `/signup`; the landing "Sign in"
  link → `/login`. Grep every `/auth/login` reference under
  `components/landing/` and repoint by intent. (The SDK route `/auth/login`
  stays the handoff target used by the new pages.)

### Auth0 prerequisite (dashboard, user-side)

A Database connection enabled for the app with Sign Ups **not** disabled —
required for `screen_hint=signup`. Documentation note only; no code depends
on it beyond the handoff URL.

## Part B — Account-nav polish

- **De-duplicate billing:** remove `{sub && <BillingPanel/>}` (and the now
  unused `useSubscription`/`BillingPanel` imports) from
  `components/settings/ProfileForm.tsx`. Profile Settings becomes
  business-profile-only.
- **New `components/settings/BillingDialog.tsx`** — a `Dialog` with
  `DialogTitle` **"Plan & Billing"** + a short description, rendering
  `<BillingPanel/>`. testid `billing-dialog`. Mirrors
  `ProfileSettingsDialog`'s shape.
- **Header** (`components/layout/Header.tsx`) — add `billingOpen` state;
  `menu-billing` (desktop) and the mobile "Plan & billing" button →
  `setBillingOpen(true)`; `menu-profile-settings` → `setSettingsOpen(true)`
  (unchanged). Mount `<BillingDialog open={billingOpen}
  onOpenChange={setBillingOpen} />`. Each popup now shows a distinct title
  naming the section the user clicked.
- **Help → dashboard:** in `app/(legal)/layout.tsx`, add a right-aligned
  **"Dashboard"** link in the header, shown only when
  `await auth0.getSession()` returns a session (make the layout an async
  server component). Anonymous visitors see the layout unchanged.

## Data flow (signup)

`/signup` (email) → `/auth/login?screen_hint=signup&login_hint=<email>&returnTo=/dashboard`
→ Auth0 hosted signup (password set) → `/auth/callback` → session cookie →
`/dashboard` → `getCurrentUser()` auto-provisions the `users` row. No DB
changes.

## Error handling

- Invalid/empty email on the form → inline field error, no handoff.
- Auth0 bounce-back with `?error=` (e.g. sign-ups disabled, duplicate) →
  error banner rendered on `/signup` or `/login`.

## Testing

- **Unit** (`lib/__tests__/auth-urls.test.ts`): `buildAuthHandoffUrl` for
  both modes — correct base, `returnTo`, `screen_hint` only on signup,
  `login_hint` encoding for normal and special-char emails, omitted when
  email empty.
- **e2e** (`e2e/signup.spec.ts`): `/signup` and `/login` render without
  auth; email + submit present; submitting a valid email navigates to
  `/auth/login` carrying the correct params (`screen_hint=signup` only for
  signup); cross-links point to each other. Stop before real Auth0 account
  creation.
- **e2e** (account-nav, in a new or existing spec): `menu-billing` opens
  `billing-dialog` titled "Plan & Billing"; `menu-profile-settings` opens
  `profile-settings-dialog` titled "Profile Settings" and it contains **no**
  `billing-panel`; visiting `/about` while authenticated shows a Dashboard
  link.

## Out of scope

- No custom password handling, no `/dbconnections/signup`, no ROPG.
- No DB schema changes.
- No changes to `/auth/logout|callback|profile` behavior.
- No social-connection buttons in-app (Auth0 hosted page handles those).
