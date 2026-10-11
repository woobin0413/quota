# In-App Signup/Login + Account-Nav Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add branded, bilingual in-app `/signup` and `/login` pages that hand credential entry to Auth0, and de-duplicate the authenticated account nav (separate titled Profile vs Billing popups; a dashboard link on the Help/About page).

**Architecture:** The new pages collect an email and redirect to the existing Auth0 SDK route `/auth/login` with `screen_hint=signup` (signup) / none (login), `login_hint=<email>`, and `returnTo=/dashboard`. Auth0 Universal Login owns password capture; first-login provisioning already exists. Account-nav changes are pure UI: pull `BillingPanel` out of the Profile dialog into its own titled `BillingDialog`, and add a session-gated Dashboard link to the legal layout.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Tailwind + shadcn/ui, `@auth0/nextjs-auth0` v4, Vitest (node env — logic tests only), Playwright (UI).

## Global Constraints

- No DB schema changes; no custom password handling; no `/dbconnections/signup`; no ROPG. Auth0 handoff only.
- Bilingual EN/ES, key-identical by type; every user-facing string lives in `lib/landing-copy.ts` (`LandingCopy` interface + both locales).
- `buildAuthHandoffUrl` always sets `returnTo=/dashboard`; sets `screen_hint=signup` only for signup; omits `login_hint` when email is empty.
- Middleware public-route matching stays exact-or-slash-boundary (never bare `startsWith`).
- Vitest is node-env: unit-test pure logic only; verify components via Playwright.
- No Claude/AI attribution in any commit message.
- Run `npm run type-check` and `npm run lint` before considering work done.

---

### Task 1: `buildAuthHandoffUrl` helper

**Files:**
- Create: `lib/auth-urls.ts`
- Test: `lib/__tests__/auth-urls.test.ts`

**Interfaces:**
- Produces: `buildAuthHandoffUrl(mode: "signup" | "login", email: string): string` — returns `/auth/login?...` with `returnTo=/dashboard`, `screen_hint=signup` (signup only), `login_hint=<email>` (omitted when email blank). Values URL-encoded via `URLSearchParams`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/auth-urls.test.ts
import { describe, it, expect } from "vitest";
import { buildAuthHandoffUrl } from "@/lib/auth-urls";

function params(url: string) {
  return new URLSearchParams(url.split("?")[1] ?? "");
}

describe("buildAuthHandoffUrl", () => {
  it("signup: sets screen_hint=signup, returnTo, and login_hint", () => {
    const url = buildAuthHandoffUrl("signup", "new@example.com");
    expect(url.startsWith("/auth/login?")).toBe(true);
    const p = params(url);
    expect(p.get("screen_hint")).toBe("signup");
    expect(p.get("returnTo")).toBe("/dashboard");
    expect(p.get("login_hint")).toBe("new@example.com");
  });

  it("login: no screen_hint, still sets returnTo + login_hint", () => {
    const p = params(buildAuthHandoffUrl("login", "me@example.com"));
    expect(p.get("screen_hint")).toBeNull();
    expect(p.get("returnTo")).toBe("/dashboard");
    expect(p.get("login_hint")).toBe("me@example.com");
  });

  it("omits login_hint when email is blank/whitespace", () => {
    expect(params(buildAuthHandoffUrl("signup", "   ")).get("login_hint")).toBeNull();
  });

  it("URL-encodes special characters in the email", () => {
    const url = buildAuthHandoffUrl("login", "a+b@c.com");
    expect(url).toContain("login_hint=a%2Bb%40c.com");
  });

  it("trims surrounding whitespace before encoding", () => {
    expect(params(buildAuthHandoffUrl("login", "  x@y.com  ")).get("login_hint")).toBe("x@y.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/auth-urls.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth-urls`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/auth-urls.ts
/**
 * Build the Auth0 handoff URL for the in-app signup/login pages.
 *
 * The branded pages collect an email, then redirect here; Auth0's SDK
 * `/auth/login` route forwards these params to Universal Login. Auth0
 * owns credential entry — this app never handles passwords.
 */
export function buildAuthHandoffUrl(
  mode: "signup" | "login",
  email: string
): string {
  const params = new URLSearchParams();
  params.set("returnTo", "/dashboard");
  if (mode === "signup") params.set("screen_hint", "signup");
  const trimmed = email.trim();
  if (trimmed) params.set("login_hint", trimmed);
  return `/auth/login?${params.toString()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/auth-urls.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth-urls.ts lib/__tests__/auth-urls.test.ts
git commit -m "feat(auth): buildAuthHandoffUrl helper for in-app signup/login handoff"
```

---

### Task 2: Bilingual auth copy + AuthHandoffForm

**Files:**
- Modify: `lib/landing-copy.ts` (add `auth` block to `LandingCopy` interface + `en` + `es`)
- Create: `components/auth/AuthHandoffForm.tsx`

**Interfaces:**
- Consumes: `buildAuthHandoffUrl` (Task 1); `useLandingCopy()` from `@/components/landing/LanguageProvider`.
- Produces: `AuthHandoffForm({ mode }: { mode: "signup" | "login" })` — renders the email field + submit + cross-link; must be rendered inside a `LanguageProvider` (Task 3 pages provide it).

- [ ] **Step 1: Extend the `LandingCopy` interface**

In `lib/landing-copy.ts`, add this member to the `LandingCopy` interface (after `footer`):

```ts
  auth: {
    signup: {
      eyebrow: string; headline: string; subline: string;
      emailLabel: string; emailPlaceholder: string; submit: string;
      altPrompt: string; altLink: string;
    };
    login: {
      eyebrow: string; headline: string; subline: string;
      emailLabel: string; emailPlaceholder: string; submit: string;
      altPrompt: string; altLink: string;
    };
    invalidEmail: string;
    errorBanner: string;
  };
```

- [ ] **Step 2: Add the English copy**

In `LANDING_COPY.en`, after the `footer` block, add:

```ts
    auth: {
      signup: {
        eyebrow: "Start free",
        headline: "Create your Quota account",
        subline: "3 quotes free. No card required.",
        emailLabel: "Work email",
        emailPlaceholder: "you@company.com",
        submit: "Create account",
        altPrompt: "Already have an account?",
        altLink: "Sign in",
      },
      login: {
        eyebrow: "Welcome back",
        headline: "Sign in to Quota",
        subline: "Pick up right where you left off.",
        emailLabel: "Work email",
        emailPlaceholder: "you@company.com",
        submit: "Continue",
        altPrompt: "New to Quota?",
        altLink: "Create an account",
      },
      invalidEmail: "Enter a valid email address.",
      errorBanner: "Something went wrong. Please try again.",
    },
```

- [ ] **Step 3: Add the Spanish copy**

In `LANDING_COPY.es`, after its `footer` block, add:

```ts
    auth: {
      signup: {
        eyebrow: "Empieza gratis",
        headline: "Crea tu cuenta de Quota",
        subline: "3 presupuestos gratis. Sin tarjeta.",
        emailLabel: "Correo de trabajo",
        emailPlaceholder: "tu@empresa.com",
        submit: "Crear cuenta",
        altPrompt: "¿Ya tienes una cuenta?",
        altLink: "Inicia sesión",
      },
      login: {
        eyebrow: "Bienvenido de nuevo",
        headline: "Inicia sesión en Quota",
        subline: "Continúa donde lo dejaste.",
        emailLabel: "Correo de trabajo",
        emailPlaceholder: "tu@empresa.com",
        submit: "Continuar",
        altPrompt: "¿Nuevo en Quota?",
        altLink: "Crea una cuenta",
      },
      invalidEmail: "Introduce un correo electrónico válido.",
      errorBanner: "Algo salió mal. Inténtalo de nuevo.",
    },
```

- [ ] **Step 4: Create the form component**

```tsx
// components/auth/AuthHandoffForm.tsx
"use client";

/**
 * Email-first auth form for the in-app /signup and /login pages. Collects
 * an email, then hands off to Auth0 Universal Login (password lives there).
 */

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLandingCopy } from "@/components/landing/LanguageProvider";
import { buildAuthHandoffUrl } from "@/lib/auth-urls";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthHandoffForm({ mode }: { mode: "signup" | "login" }) {
  const copy = useLandingCopy().auth;
  const c = copy[mode];
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError(copy.invalidEmail);
      return;
    }
    setError(null);
    window.location.href = buildAuthHandoffUrl(mode, trimmed);
  };

  const altHref = mode === "signup" ? "/login" : "/signup";

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="auth-handoff-form"
      noValidate
    >
      <div className="space-y-2">
        <Label htmlFor="auth-email">{c.emailLabel}</Label>
        <Input
          id="auth-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={c.emailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          data-testid="auth-email"
        />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        data-testid="auth-submit"
      >
        {c.submit}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {c.altPrompt}{" "}
        <Link
          href={altHref}
          className="font-semibold text-foreground underline-offset-4 hover:text-accent hover:underline"
          data-testid="auth-alt-link"
        >
          {c.altLink}
        </Link>
      </p>
    </form>
  );
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run type-check`
Expected: no errors (both locales now satisfy the extended `LandingCopy`; a missing key would fail here).

- [ ] **Step 6: Commit**

```bash
git add lib/landing-copy.ts components/auth/AuthHandoffForm.tsx
git commit -m "feat(auth): bilingual auth copy + email-first handoff form"
```

---

### Task 3: `/signup` + `/login` pages, middleware, landing CTAs

**Files:**
- Create: `components/auth/AuthPageShell.tsx`
- Create: `app/signup/page.tsx`
- Create: `app/login/page.tsx`
- Modify: `middleware.ts` (add `/signup`, `/login` to `PUBLIC_ROUTES`)
- Modify: `components/landing/sections.tsx` (repoint 4 CTAs)

**Interfaces:**
- Consumes: `AuthHandoffForm` (Task 2); `LanguageProvider`, `useLandingCopy` from `@/components/landing/LanguageProvider`; `LangToggle` from `@/components/landing/LangToggle`.
- Produces: `AuthPageShell({ mode, hasError }: { mode: "signup" | "login"; hasError: boolean })`.

- [ ] **Step 1: Create the page shell**

```tsx
// components/auth/AuthPageShell.tsx
"use client";

/**
 * Branded, bilingual shell for the in-app /signup and /login pages. Wraps
 * the content in LanguageProvider so the shared landing copy + LangToggle
 * work here too.
 */

import Link from "next/link";
import { FileText } from "lucide-react";
import {
  LanguageProvider,
  useLandingCopy,
} from "@/components/landing/LanguageProvider";
import { LangToggle } from "@/components/landing/LangToggle";
import { AuthHandoffForm } from "@/components/auth/AuthHandoffForm";

export function AuthPageShell({
  mode,
  hasError,
}: {
  mode: "signup" | "login";
  hasError: boolean;
}) {
  return (
    <LanguageProvider>
      <AuthPageInner mode={mode} hasError={hasError} />
    </LanguageProvider>
  );
}

function AuthPageInner({
  mode,
  hasError,
}: {
  mode: "signup" | "login";
  hasError: boolean;
}) {
  const copy = useLandingCopy().auth;
  const c = copy[mode];
  return (
    <main
      className="flex min-h-screen flex-col bg-background"
      data-testid={`auth-page-${mode}`}
    >
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 font-display font-bold uppercase tracking-wide focus-visible:text-accent"
          >
            <FileText className="h-5 w-5 text-accent" aria-hidden="true" />
            Quota
          </Link>
          <LangToggle />
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <p className="eyebrow mb-3 text-accent">{c.eyebrow}</p>
          <h1 className="font-display text-3xl font-bold uppercase leading-[0.95] tracking-tight sm:text-4xl">
            {c.headline}
          </h1>
          <p className="mb-8 mt-3 text-sm text-muted-foreground">{c.subline}</p>

          {hasError && (
            <div
              className="mb-6 border-2 border-destructive/60 bg-destructive/5 px-3 py-2"
              data-testid="auth-error-banner"
            >
              <p className="text-sm font-medium text-destructive">
                {copy.errorBanner}
              </p>
            </div>
          )}

          <AuthHandoffForm mode={mode} />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create the signup route**

```tsx
// app/signup/page.tsx
import type { Metadata } from "next";
import { AuthPageShell } from "@/components/auth/AuthPageShell";

export const metadata: Metadata = { title: "Create your account — Quota" };

export default function SignupPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return <AuthPageShell mode="signup" hasError={Boolean(searchParams?.error)} />;
}
```

- [ ] **Step 3: Create the login route**

```tsx
// app/login/page.tsx
import type { Metadata } from "next";
import { AuthPageShell } from "@/components/auth/AuthPageShell";

export const metadata: Metadata = { title: "Sign in — Quota" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return <AuthPageShell mode="login" hasError={Boolean(searchParams?.error)} />;
}
```

- [ ] **Step 4: Make the pages public in middleware**

In `middleware.ts`, add `"/signup"` and `"/login"` to the `PUBLIC_ROUTES` array (after `"/about"`):

```ts
const PUBLIC_ROUTES = [
  "/",
  "/og",
  "/terms",
  "/privacy",
  "/refunds",
  "/about",
  "/signup",
  "/login",
  "/api/webhooks",
  "/api/waitlist",
  "/api/cron",
];
```

- [ ] **Step 5: Repoint the landing CTAs by intent**

In `components/landing/sections.tsx`, change these four `Link` hrefs:

- Line ~45 (header sign-in): `href="/auth/login"` → `href="/login"`
- Line ~73 (hero primary CTA, wraps `{copy.hero.ctaPrimary}`): `href="/auth/login"` → `href="/signup"`
- Line ~267 (pricing CTA, wraps `{copy.pricing.cta}`): `href="/auth/login"` → `href="/signup"`
- Line ~350 (footer CTA button, wraps `{copy.footer.ctaButton}`): `href="/auth/login"` → `href="/signup"`

(Leave any non-CTA `/auth/*` usage untouched. After editing, `grep -n '"/auth/login"' components/landing/sections.tsx` should return nothing.)

- [ ] **Step 6: Verify build + no stray CTA**

Run: `npm run type-check && grep -c '"/auth/login"' components/landing/sections.tsx`
Expected: type-check clean; grep prints `0`.

- [ ] **Step 7: Commit**

```bash
git add components/auth/AuthPageShell.tsx app/signup/page.tsx app/login/page.tsx middleware.ts components/landing/sections.tsx
git commit -m "feat(auth): in-app /signup + /login pages, public routes, CTA repoint"
```

---

### Task 4: e2e for the auth pages

**Files:**
- Create: `e2e/auth-pages.spec.ts`

**Interfaces:**
- Consumes: testids `auth-page-signup`, `auth-page-login`, `auth-handoff-form`, `auth-email`, `auth-submit`, `auth-alt-link` (Tasks 2–3).

- [ ] **Step 1: Write the spec**

```ts
// e2e/auth-pages.spec.ts
import { test, expect } from "@playwright/test";

test.describe("in-app auth pages (public)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/signup hands off to Auth0 with screen_hint=signup", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByTestId("auth-page-signup")).toBeVisible();
    await expect(page.getByTestId("auth-handoff-form")).toBeVisible();

    // Capture the handoff without hitting real Auth0.
    let handoff = "";
    await page.route("**/auth/login**", (route) => {
      handoff = route.request().url();
      return route.abort();
    });

    await page.getByTestId("auth-email").fill("newuser@example.com");
    await page.getByTestId("auth-submit").click();

    await expect.poll(() => handoff).toContain("/auth/login?");
    const p = new URL(handoff).searchParams;
    expect(p.get("screen_hint")).toBe("signup");
    expect(p.get("login_hint")).toBe("newuser@example.com");
    expect(p.get("returnTo")).toBe("/dashboard");
  });

  test("/login hands off without screen_hint", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("auth-page-login")).toBeVisible();

    let handoff = "";
    await page.route("**/auth/login**", (route) => {
      handoff = route.request().url();
      return route.abort();
    });

    await page.getByTestId("auth-email").fill("me@example.com");
    await page.getByTestId("auth-submit").click();

    await expect.poll(() => handoff).toContain("/auth/login?");
    const p = new URL(handoff).searchParams;
    expect(p.get("screen_hint")).toBeNull();
    expect(p.get("login_hint")).toBe("me@example.com");
  });

  test("invalid email blocks handoff and shows an error", async ({ page }) => {
    await page.goto("/signup");
    let navigated = false;
    await page.route("**/auth/login**", (route) => {
      navigated = true;
      return route.abort();
    });
    await page.getByTestId("auth-email").fill("not-an-email");
    await page.getByTestId("auth-submit").click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(navigated).toBe(false);
  });

  test("cross-links point at each other", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByTestId("auth-alt-link")).toHaveAttribute("href", "/login");
    await page.goto("/login");
    await expect(page.getByTestId("auth-alt-link")).toHaveAttribute("href", "/signup");
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/auth-pages.spec.ts`
Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add e2e/auth-pages.spec.ts
git commit -m "test(e2e): in-app signup/login pages + Auth0 handoff params"
```

---

### Task 5: De-duplicate Profile vs Billing (titled dialogs)

**Files:**
- Modify: `components/settings/ProfileForm.tsx` (remove `BillingPanel` + `useSubscription`)
- Create: `components/settings/BillingDialog.tsx`
- Modify: `components/layout/Header.tsx` (billing item → new dialog, both desktop + mobile)

**Interfaces:**
- Consumes: `BillingPanel` from `@/components/subscription/BillingPanel`; shadcn `Dialog` primitives from `@/components/ui/dialog`.
- Produces: `BillingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void })` — testid `billing-dialog`, title "Plan & Billing".

- [ ] **Step 1: Remove billing from the profile form**

In `components/settings/ProfileForm.tsx`:
- Delete the import line `import { BillingPanel } from "@/components/subscription/BillingPanel";`
- Delete the import line `import { useSubscription } from "@/components/subscription/use-subscription";`
- Delete the line `const { sub } = useSubscription();`
- Delete the line `{sub && <BillingPanel />}`

- [ ] **Step 2: Create the billing dialog**

```tsx
// components/settings/BillingDialog.tsx
"use client";

/**
 * Plan & Billing dialog — the billing home, opened from the header's
 * "Plan & billing" item. Kept separate from Profile Settings so each
 * popup is titled with the section the user clicked.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BillingPanel } from "@/components/subscription/BillingPanel";

export function BillingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="billing-dialog">
        <DialogHeader>
          <DialogTitle>Plan &amp; Billing</DialogTitle>
          <DialogDescription>
            Manage your plan, payment method, and invoice history.
          </DialogDescription>
        </DialogHeader>
        <BillingPanel />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire the header to the new dialog**

In `components/layout/Header.tsx`:
- Add the import: `import { BillingDialog } from "@/components/settings/BillingDialog";`
- Add state after `const [settingsOpen, setSettingsOpen] = useState(false);`:
  `const [billingOpen, setBillingOpen] = useState(false);`
- Desktop billing item (`data-testid="menu-billing"`): change `onClick={() => setSettingsOpen(true)}` → `onClick={() => setBillingOpen(true)}`
- Mobile "Plan & billing" button: change its `onClick` from `{ setMobileMenuOpen(false); setSettingsOpen(true); }` → `{ setMobileMenuOpen(false); setBillingOpen(true); }`
- Mount the dialog next to `<ProfileSettingsDialog ... />`:

```tsx
      <BillingDialog open={billingOpen} onOpenChange={setBillingOpen} />
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run type-check && npx next lint --file components/settings/ProfileForm.tsx --file components/settings/BillingDialog.tsx --file components/layout/Header.tsx`
Expected: type-check clean (no unused `sub`/imports left in ProfileForm); lint clean.

- [ ] **Step 5: Commit**

```bash
git add components/settings/ProfileForm.tsx components/settings/BillingDialog.tsx components/layout/Header.tsx
git commit -m "feat(nav): split Plan & Billing into its own titled dialog; drop billing from Profile Settings"
```

---

### Task 6: Dashboard link on the Help/About (legal) layout

**Files:**
- Modify: `app/(legal)/layout.tsx`

**Interfaces:**
- Consumes: `auth0` from `@/lib/auth0` (`auth0.getSession()` returns the session or `null` in a server component).

- [ ] **Step 1: Add a session-gated Dashboard link**

In `app/(legal)/layout.tsx`:
- Add import: `import { auth0 } from "@/lib/auth0";`
- Make the component async and read the session:

```tsx
export default async function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth0.getSession();
```

- In the header `<nav>`, after the `LEGAL_LINKS.map(...)` block (still inside the `<nav>`), add:

```tsx
            {session && (
              <Link
                href="/dashboard"
                className="font-semibold text-foreground underline-offset-4 hover:text-accent hover:underline"
                data-testid="legal-dashboard-link"
              >
                Dashboard
              </Link>
            )}
```

- [ ] **Step 2: Verify build**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(legal)/layout.tsx"
git commit -m "feat(nav): dashboard link on legal/help pages for signed-in users"
```

---

### Task 7: Account-nav e2e + full gate

**Files:**
- Create: `e2e/account-nav.spec.ts`

**Interfaces:**
- Consumes: testids `user-menu-trigger`, `menu-billing`, `menu-profile-settings`, `billing-dialog`, `billing-panel`, `profile-settings-dialog`, `legal-dashboard-link`.

- [ ] **Step 1: Write the spec**

```ts
// e2e/account-nav.spec.ts
import { test, expect } from "@playwright/test";

test.describe("account nav (authenticated)", () => {
  test("Plan & Billing opens its own titled dialog", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("menu-billing").click();

    const dialog = page.getByTestId("billing-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Plan & Billing");
    await expect(dialog.getByTestId("billing-panel")).toBeVisible();
  });

  test("Profile Settings no longer contains the billing panel", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("menu-profile-settings").click();

    const dialog = page.getByTestId("profile-settings-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Profile Settings");
    await expect(dialog.getByTestId("billing-panel")).toHaveCount(0);
  });

  test("Help/About shows a Dashboard link when signed in", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByTestId("legal-dashboard-link")).toBeVisible();
    await expect(page.getByTestId("legal-dashboard-link")).toHaveAttribute("href", "/dashboard");
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/account-nav.spec.ts`
Expected: 3 passed.

- [ ] **Step 3: Full gate** (stop any dev server first — config uses `reuseExistingServer:false`):

```bash
npx vitest run
npm run type-check
npm run lint
npx playwright test e2e/auth-pages.spec.ts e2e/account-nav.spec.ts e2e/legal.spec.ts e2e/nav-footer.spec.ts e2e/quote-flow.spec.ts
```

Expected: all green (lint may show the 2 pre-existing warnings in `lib/email-sender.ts` + `lib/quote-calculations.ts` — those are unrelated).

- [ ] **Step 4: Commit**

```bash
git add e2e/account-nav.spec.ts
git commit -m "test(e2e): titled billing dialog, profile has no billing, help dashboard link"
```

---

## Notes for the executor

- **Auth0 dashboard prerequisite (user-side, not code):** a Database connection enabled for the app with Sign Ups **not** disabled — required for `screen_hint=signup` to land on the signup screen. No task depends on it beyond the handoff URL.
- The e2e user is non-admin; nothing here changes admin gating.
- If `auth0.getSession()` in an RSC needs a request context and throws during static generation, mark `app/(legal)/layout.tsx` dynamic with `export const dynamic = "force-dynamic";` (only if the build complains).
