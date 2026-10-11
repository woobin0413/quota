# Mobile Shared API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a separate native iOS/Android repo call this web app's existing Next.js route handlers by adding Auth0 bearer-token authentication and a versioned `/api/v1` surface, without touching any of the 24 existing route files.

**Architecture:** Every authed route handler reads identity through exactly one function — `getCurrentUser()` in `lib/auth.ts:21`. That is the only seam that needs to change. `getCurrentUser()` gains a bearer branch that reads `Authorization` from `next/headers`, verifies the JWT against Auth0's JWKS, and returns the same `User` object as the cookie path — so the 24 route files, their Zod schemas, tier gates, and `user_id` scoping are reused untouched. `middleware.ts` gains a matching branch because it 401s bearer requests before they reach a handler. A thin `/api/v1/*` directory re-exports the base handlers so a shipped app binary depends on a frozen path, not on the web's internal contract.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, `jose` (JWKS + JWT verify), Auth0 (Resource Server + Native app + post-login Action), Vitest, Supabase service-role.

> **Decisions taken during execution that supersede text below.** This plan was
> written before implementation. Two contract choices were made mid-run and the
> **code is authoritative** — `docs/api/v1.md` is the live contract:
>
> 1. **`/api/v1/me` names the quota field `quotesUsed`, not `quotesUsedThisMonth`.**
>    Task 6's text below still says the latter. Renamed so it matches what
>    `/api/v1/subscription` already publishes for the same quantity — `/api/v1` is
>    additive-only, so two permanent names for one number could never be fixed later.
> 2. **`bearerGate` returns `{ success: false, code: "UNAUTHORIZED", message }` on
>    401, not the bare `{ error: "Unauthorized" }` in Task 3's code block.** Mobile
>    clients must branch on `code`. Scoped to the bearer path only — the cookie-path
>    401 in `middleware.ts` keeps its original shape because the running web app
>    already consumes it. Do not "harmonize" the two.
>
> Also: Task 4 is `--dry` only for agents; the tenant mutation and Action deployment
> are the human partner's to run. Task 7 Step 7 (Playwright e2e) is run once after the
> final whole-branch review, not per task.

## Global Constraints

- Node `>=22`; Next.js `^14.2.35` App Router; TypeScript strict mode.
- Unit tests are Vitest, run with `npm run test`. Follow the existing style in `lib/__tests__/send-quote-gate.test.ts`: `vi.mock` the module boundary, assert status + `code`.
- `npm run type-check` and `npm run lint` must pass before any task is considered done.
- Every DB query stays scoped by `user_id`. No task adds a query that isn't.
- **Fail closed** on auth and tier, matching `needsVerification()` in `lib/email-verification.ts:40` and `resolveTier()` in `lib/subscription.ts:86`. A missing claim, a missing env var, or an unrecognized value means "deny", never "allow".
- **No CORS headers anywhere.** Native iOS/Android HTTP clients are not browsers, send no `Origin`, and are not subject to the same-origin policy. Adding `Access-Control-Allow-Origin: *` would only open the API to hostile web pages. If a future browser client needs it, that is a separate, deliberate change.
- **Billing endpoints stay out of `/api/v1`.** `/api/billing/*` drives Stripe Elements (web-only), and selling a digital subscription inside an iOS binary is an App Store policy question, not a technical one. The mobile app reads subscription state and links to `https://sendquota.com/billing`.
- **`/api/v1` is additive-only once the first binary ships.** A field may be added. A field may never be removed, renamed, or have its type changed. Breaking changes go to `/api/v2`.
- New env vars introduced by this plan: `AUTH0_AUDIENCE`, `AUTH0_MOBILE_CLIENT_ID`.
- Auth0 custom claims are namespaced under `https://sendquota.com/`. Access tokens for a custom API do **not** carry `email` or `email_verified` by default — Task 4's Action adds them.

---

### Task 1: Bearer token verification module

Verifies an Auth0 access token against the tenant's JWKS and reduces it to the three facts the app needs. Pure module, no Next.js and no database, so it is testable on its own and safe to import from Edge middleware.

**Files:**
- Create: `lib/auth/bearer.ts`
- Create: `lib/auth/__tests__/bearer.test.ts`
- Modify: `package.json` (add `jose`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `EMAIL_CLAIM: "https://sendquota.com/email"`
  - `EMAIL_VERIFIED_CLAIM: "https://sendquota.com/email_verified"`
  - `type BearerClaims = { sub: string; email: string; emailVerified: boolean }`
  - `extractBearerToken(headerValue: string | null | undefined): string | null`
  - `verifyBearerToken(token: string): Promise<BearerClaims | null>`
  - `resetJwksCache(): void` — test seam only

- [ ] **Step 1: Install the JWT library**

```bash
npm install jose@^5.9.6
```

- [ ] **Step 2: Write the failing test**

Create `lib/auth/__tests__/bearer.test.ts`:

```ts
// lib/auth/__tests__/bearer.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// The real createRemoteJWKSet would fetch the tenant over the network. Swap it
// for a resolver that hands back the local test public key; everything else in
// jose (signing, verification, claim checks) stays real so the test exercises
// the actual verification path.
const keys = vi.hoisted(() => ({ current: null as unknown as CryptoKeyPair }));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: () => async () => keys.current.publicKey,
  };
});

import { SignJWT, generateKeyPair } from "jose";
import {
  extractBearerToken,
  verifyBearerToken,
  resetJwksCache,
  EMAIL_CLAIM,
  EMAIL_VERIFIED_CLAIM,
} from "@/lib/auth/bearer";

const DOMAIN = "auth.sendquota.test";
const AUDIENCE = "https://api.sendquota.test";

beforeAll(async () => {
  keys.current = (await generateKeyPair("RS256")) as CryptoKeyPair;
});

beforeEach(() => {
  process.env.AUTH0_DOMAIN = DOMAIN;
  process.env.AUTH0_AUDIENCE = AUDIENCE;
  resetJwksCache();
});

async function signToken(
  payload: Record<string, unknown> = {},
  opts: { issuer?: string; audience?: string; expiresIn?: string; sub?: string | null } = {}
) {
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? `https://${DOMAIN}/`)
    .setAudience(opts.audience ?? AUDIENCE)
    .setExpirationTime(opts.expiresIn ?? "5m");
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? "auth0|abc123");
  return jwt.sign(keys.current.privateKey);
}

describe("extractBearerToken", () => {
  it.each([
    ["null header", null, null],
    ["empty header", "", null],
    ["wrong scheme", "Basic abc123", null],
    ["scheme with no token", "Bearer", null],
    ["scheme with blank token", "Bearer   ", null],
    ["plain token", "Bearer abc123", "abc123"],
    ["lowercase scheme", "bearer abc123", "abc123"],
    ["surrounding whitespace", "  Bearer abc123  ", "abc123"],
  ])("%s", (_label, input, expected) => {
    expect(extractBearerToken(input)).toBe(expected);
  });
});

describe("verifyBearerToken", () => {
  it("returns claims for a valid token", async () => {
    const token = await signToken({
      [EMAIL_CLAIM]: "sam@example.com",
      [EMAIL_VERIFIED_CLAIM]: true,
    });
    expect(await verifyBearerToken(token)).toEqual({
      sub: "auth0|abc123",
      email: "sam@example.com",
      emailVerified: true,
    });
  });

  // The claims are added by an Auth0 Action. If that Action is disabled or
  // fails, the token still verifies — so the absence of the claim must read as
  // "unverified", never as "verified". Same fail-closed rule as
  // needsVerification() in lib/email-verification.ts.
  it("treats a missing email_verified claim as unverified", async () => {
    const token = await signToken({ [EMAIL_CLAIM]: "sam@example.com" });
    expect(await verifyBearerToken(token)).toEqual({
      sub: "auth0|abc123",
      email: "sam@example.com",
      emailVerified: false,
    });
  });

  it("treats a non-boolean email_verified claim as unverified", async () => {
    const token = await signToken({ [EMAIL_VERIFIED_CLAIM]: "true" });
    expect((await verifyBearerToken(token))?.emailVerified).toBe(false);
  });

  it("returns an empty email when the claim is missing", async () => {
    const token = await signToken({ [EMAIL_VERIFIED_CLAIM]: true });
    expect((await verifyBearerToken(token))?.email).toBe("");
  });

  it.each([
    ["a token for another audience", { audience: "https://api.someone-else.test" }],
    ["a token from another issuer", { issuer: "https://evil.example.com/" }],
    ["an expired token", { expiresIn: "-1s" }],
    ["a token with no subject", { sub: null as null }],
  ])("rejects %s", async (_label, opts) => {
    const token = await signToken({ [EMAIL_VERIFIED_CLAIM]: true }, opts);
    expect(await verifyBearerToken(token)).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await verifyBearerToken("not-a-jwt")).toBeNull();
  });

  // Without an audience configured, jwtVerify would accept a token minted for
  // any API in the tenant. Refusing to run is the only safe response.
  it("rejects every token when AUTH0_AUDIENCE is unset", async () => {
    const token = await signToken({ [EMAIL_VERIFIED_CLAIM]: true });
    delete process.env.AUTH0_AUDIENCE;
    resetJwksCache();
    expect(await verifyBearerToken(token)).toBeNull();
  });

  it("rejects every token when AUTH0_DOMAIN is unset", async () => {
    const token = await signToken({ [EMAIL_VERIFIED_CLAIM]: true });
    delete process.env.AUTH0_DOMAIN;
    resetJwksCache();
    expect(await verifyBearerToken(token)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/auth/__tests__/bearer.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/auth/bearer"`

- [ ] **Step 4: Write the implementation**

Create `lib/auth/bearer.ts`:

```ts
/**
 * Auth0 access-token verification for non-browser clients.
 *
 * The web app authenticates with an Auth0 session cookie, which the native
 * iOS/Android app cannot hold. Those clients send an Auth0 access token as a
 * bearer credential instead. @auth0/nextjs-auth0 is a cookie-session SDK and
 * does not verify bearer tokens, so verification is ours.
 *
 * No Next.js and no database imports: this module is pulled into the Edge
 * middleware bundle as well as into route handlers.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Access tokens issued for a custom API carry only OIDC-registered claims —
 * not `email` or `email_verified`. The post-login Action in
 * scripts/auth0-actions/add-api-claims.js adds these two, namespaced because
 * Auth0 silently drops non-namespaced custom claims.
 */
export const EMAIL_CLAIM = "https://sendquota.com/email";
export const EMAIL_VERIFIED_CLAIM = "https://sendquota.com/email_verified";

export type BearerClaims = {
  sub: string;
  email: string;
  emailVerified: boolean;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Cached across invocations: the key set is fetched once, then rotated by jose. */
function getJwks(domain: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
  }
  return jwks;
}

/** Test seam — drops the cached key set so env changes take effect. */
export function resetJwksCache(): void {
  jwks = null;
}

/**
 * Pull the credential out of an `Authorization` header value.
 *
 * Returns null for anything that is not exactly one bearer token, so a
 * malformed header is treated as "no credential" rather than as a broken one.
 */
export function extractBearerToken(
  headerValue: string | null | undefined
): string | null {
  if (!headerValue) return null;
  const parts = headerValue.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.length > 0 ? token : null;
}

/**
 * Verify an Auth0 access token.
 *
 * @returns the claims the app acts on, or null for any token that fails
 *          verification. Fails closed on missing configuration: without an
 *          audience, jwtVerify would accept a token minted for any other API
 *          in the tenant.
 */
export async function verifyBearerToken(
  token: string
): Promise<BearerClaims | null> {
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;
  if (!domain || !audience) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(domain), {
      issuer: `https://${domain}/`,
      audience,
    });

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }

    return {
      sub: payload.sub,
      email: typeof payload[EMAIL_CLAIM] === "string" ? (payload[EMAIL_CLAIM] as string) : "",
      // Strict equality, not truthiness: the string "false" is truthy.
      emailVerified: payload[EMAIL_VERIFIED_CLAIM] === true,
    };
  } catch {
    // Expired, wrong audience, wrong issuer, bad signature, malformed — all of
    // them mean the same thing to a caller, and distinguishing them in a
    // response would help an attacker probe.
    return null;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/auth/__tests__/bearer.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/auth/bearer.ts lib/auth/__tests__/bearer.test.ts
git commit -m "feat(auth): verify Auth0 bearer tokens for non-browser clients"
```

---

### Task 2: Accept bearer tokens in getCurrentUser()

This is the task that makes all 24 authed route handlers work for mobile without editing any of them. `getCurrentUser()` already calls `headers()` (`lib/auth.ts:37`), so it can read `Authorization` without changing its signature or any call site.

**Files:**
- Modify: `lib/auth.ts:21-45`
- Create: `lib/__tests__/auth-bearer.test.ts`

**Interfaces:**
- Consumes: `extractBearerToken`, `verifyBearerToken` from `lib/auth/bearer.ts` (Task 1).
- Produces: `getCurrentUser(): Promise<User | null>` — unchanged signature, now resolving either credential. `requireUser()` is unchanged and stays cookie-only (it redirects, which is meaningless to a native client).

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/auth-bearer.test.ts`:

```ts
// lib/__tests__/auth-bearer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const headerValues = new Map<string, string>();
const getSession = vi.fn();
const verifyBearerToken = vi.fn();
const getOrCreateUser = vi.fn();

vi.mock("next/headers", () => ({
  headers: () => ({ get: (name: string) => headerValues.get(name.toLowerCase()) ?? null }),
}));
vi.mock("@/lib/auth0", () => ({ auth0: { getSession: () => getSession() } }));
vi.mock("@/lib/db/sync-user", () => ({
  getOrCreateUser: (input: unknown) => getOrCreateUser(input),
}));
vi.mock("@/lib/usage-tracking", () => ({ recordUsage: vi.fn() }));
vi.mock("@/lib/auth/bearer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/bearer")>();
  return { ...actual, verifyBearerToken: (t: string) => verifyBearerToken(t) };
});

import { getCurrentUser } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  headerValues.clear();
  getOrCreateUser.mockResolvedValue({ id: "u1", email: "sam@example.com" });
});

describe("getCurrentUser — bearer credential", () => {
  it("resolves the user from a valid bearer token without touching the cookie session", async () => {
    headerValues.set("authorization", "Bearer good-token");
    verifyBearerToken.mockResolvedValue({
      sub: "auth0|abc123",
      email: "sam@example.com",
      emailVerified: true,
    });

    const user = await getCurrentUser();

    expect(user).toEqual({ id: "u1", email: "sam@example.com" });
    expect(getSession).not.toHaveBeenCalled();
    expect(getOrCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ auth0UserId: "auth0|abc123", email: "sam@example.com" })
    );
  });

  // A request that presents a token is asserting that token is the identity.
  // Falling back to a cookie would make the effective identity depend on which
  // credential happened to be valid, which is neither predictable nor auditable.
  it("returns null for an invalid bearer token instead of falling back to the cookie", async () => {
    headerValues.set("authorization", "Bearer bad-token");
    verifyBearerToken.mockResolvedValue(null);
    getSession.mockResolvedValue({ user: { sub: "auth0|cookie-user", email: "other@example.com" } });

    expect(await getCurrentUser()).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(getOrCreateUser).not.toHaveBeenCalled();
  });

  it("ignores a non-bearer Authorization header and uses the cookie session", async () => {
    headerValues.set("authorization", "Basic abc123");
    getSession.mockResolvedValue({ user: { sub: "auth0|cookie-user", email: "sam@example.com" } });

    expect(await getCurrentUser()).toEqual({ id: "u1", email: "sam@example.com" });
    expect(verifyBearerToken).not.toHaveBeenCalled();
    expect(getOrCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ auth0UserId: "auth0|cookie-user" })
    );
  });

  it("still resolves the cookie session when no Authorization header is present", async () => {
    getSession.mockResolvedValue({
      user: { sub: "auth0|cookie-user", email: "sam@example.com", given_name: "Sam" },
    });

    expect(await getCurrentUser()).toEqual({ id: "u1", email: "sam@example.com" });
    expect(getOrCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ auth0UserId: "auth0|cookie-user", firstName: "Sam" })
    );
  });

  it("returns null when there is neither a token nor a session", async () => {
    getSession.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/auth-bearer.test.ts`
Expected: FAIL — the bearer cases fall through to `auth0.getSession()`, so "resolves the user from a valid bearer token" fails on `expect(getSession).not.toHaveBeenCalled()`.

- [ ] **Step 3: Write the implementation**

Replace `lib/auth.ts` lines 1-45 (imports plus `getCurrentUser`) with:

```ts
/**
 * Auth Helpers
 *
 * Bridges Auth0 identity to database users. Server-side only.
 *
 * Two credentials resolve to the same User: the browser's Auth0 session cookie,
 * and an Auth0 access token sent as a bearer by the native app. Because every
 * authed route handler reads identity through getCurrentUser(), supporting the
 * second credential here is what makes the whole API reachable from mobile —
 * no route file knows which one was used.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getOrCreateUser } from "@/lib/db/sync-user";
import { recordUsage } from "@/lib/usage-tracking";
import { needsVerification, VERIFY_EMAIL_PATH } from "@/lib/email-verification";
import { extractBearerToken, verifyBearerToken } from "@/lib/auth/bearer";
import type { User } from "@/types/database";

type Identity = {
  auth0UserId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

/** headers() throws outside a request scope; treat that as "no header". */
function readHeader(name: string): string | null {
  try {
    return headers().get(name);
  } catch {
    return null;
  }
}

/**
 * Resolve the caller's Auth0 identity from whichever credential is present.
 *
 * A bearer token wins outright: a request that presents one is asserting it as
 * the identity, so an invalid token denies rather than falling back to a
 * cookie. Otherwise the effective user would depend on which credential
 * happened to verify.
 */
async function resolveIdentity(): Promise<Identity | null> {
  const token = extractBearerToken(readHeader("authorization"));
  if (token) {
    const claims = await verifyBearerToken(token);
    if (!claims) return null;
    // Database connections never issue given_name/family_name, and the access
    // token carries no profile beyond what the Action adds — same as web
    // signup, so ProfileOnboarding prompts for the business name either way.
    return { auth0UserId: claims.sub, email: claims.email };
  }

  const session = await auth0.getSession();
  if (!session?.user?.sub) return null;

  return {
    auth0UserId: session.user.sub,
    email: session.user.email ?? "",
    firstName: session.user.given_name,
    lastName: session.user.family_name,
    avatarUrl: session.user.picture,
  };
}

/**
 * Get the current database user for the active credential.
 * Auto-provisions the user row on first login.
 *
 * @returns The user, or null when there is no valid credential
 */
export async function getCurrentUser(): Promise<User | null> {
  const identity = await resolveIdentity();
  if (!identity) return null;

  const user = await getOrCreateUser(identity);

  try {
    const h = headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    recordUsage(user.id, ip, h.get("user-agent") ?? "unknown");
  } catch {
    // headers() unavailable in some contexts — tracking is best-effort
  }

  return user;
}
```

Leave `requireUser()` (lines 47-67 of the original file) exactly as it is. It redirects, which only makes sense for a browser, and it is only called from Server Components.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/__tests__/auth-bearer.test.ts`
Expected: PASS, 5 cases.

- [ ] **Step 5: Run the full unit suite for regressions**

Run: `npm run test`
Expected: PASS. The existing gate specs (`send-quote-gate`, `receipt-gate`, `quotes-limit-gate`, `profile-route`) mock `@/lib/auth` wholesale, so they are unaffected.

- [ ] **Step 6: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts lib/__tests__/auth-bearer.test.ts
git commit -m "feat(auth): resolve getCurrentUser from a bearer token or a session cookie"
```

---

### Task 3: Let bearer requests past the middleware gate

`middleware.ts:59` calls `auth0.getSession(request)` and 401s when there is no cookie — so without this task every mobile request dies before reaching a handler, and Task 2's work is unreachable. The decision is extracted into a testable helper rather than written inline, for the same reason `lib/email-verification.ts` exists.

**Files:**
- Create: `lib/auth/bearer-gate.ts`
- Create: `lib/auth/__tests__/bearer-gate.test.ts`
- Modify: `middleware.ts:38-87`

**Interfaces:**
- Consumes: `extractBearerToken`, `verifyBearerToken` from `lib/auth/bearer.ts` (Task 1); `isVerificationExempt`, `EMAIL_NOT_VERIFIED_BODY` from `lib/email-verification.ts`; `applyNoStore` from `lib/no-store.ts`.
- Produces: `bearerGate(pathname: string, authorizationHeader: string | null): Promise<BearerGateResult>`, where

  ```ts
  type BearerGateResult =
    | { status: "no-credential" }              // fall through to the cookie path
    | { status: "allow"; subject: string }     // verified; subject is the Auth0 `sub`
    | { status: "deny"; response: Response };  // 401 or 403, return as-is
  ```

  The `subject` is carried out rather than discarded because Task 7 keys the write rate limiter on it.

- [ ] **Step 1: Write the failing test**

Create `lib/auth/__tests__/bearer-gate.test.ts`:

```ts
// lib/auth/__tests__/bearer-gate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyBearerToken = vi.fn();
vi.mock("@/lib/auth/bearer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/bearer")>();
  return { ...actual, verifyBearerToken: (t: string) => verifyBearerToken(t) };
});

import { bearerGate } from "@/lib/auth/bearer-gate";

const VERIFIED = { sub: "auth0|abc", email: "sam@example.com", emailVerified: true };
const UNVERIFIED = { ...VERIFIED, emailVerified: false };

beforeEach(() => vi.clearAllMocks());

/** Narrow to the deny branch so the Response is reachable without casting. */
function denied(result: Awaited<ReturnType<typeof bearerGate>>): Response {
  if (result.status !== "deny") throw new Error(`expected deny, got ${result.status}`);
  return result.response;
}

describe("bearerGate", () => {
  it("reports no-credential when there is no Authorization header", async () => {
    expect(await bearerGate("/api/quotes", null)).toEqual({ status: "no-credential" });
    expect(verifyBearerToken).not.toHaveBeenCalled();
  });

  it("reports no-credential for a non-bearer scheme", async () => {
    expect(await bearerGate("/api/quotes", "Basic abc")).toEqual({ status: "no-credential" });
  });

  it("allows a verified token on an API route and carries the subject out", async () => {
    verifyBearerToken.mockResolvedValue(VERIFIED);
    expect(await bearerGate("/api/quotes", "Bearer good")).toEqual({
      status: "allow",
      subject: "auth0|abc",
    });
  });

  it("401s an invalid token", async () => {
    verifyBearerToken.mockResolvedValue(null);
    const res = denied(await bearerGate("/api/quotes", "Bearer bad"));
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  // A token on a page route means a misconfigured client, not a session. Serving
  // HTML would hand a native client a login redirect it cannot follow.
  it("401s a valid token aimed at a page route", async () => {
    verifyBearerToken.mockResolvedValue(VERIFIED);
    expect(denied(await bearerGate("/dashboard", "Bearer good")).status).toBe(401);
  });

  it("403s EMAIL_NOT_VERIFIED for an unverified token", async () => {
    verifyBearerToken.mockResolvedValue(UNVERIFIED);
    const res = denied(await bearerGate("/api/quotes", "Bearer good"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  // Without this the gate blocks the one call that lets the app fix the problem.
  it("allows an unverified token through to the resend-verification route", async () => {
    verifyBearerToken.mockResolvedValue(UNVERIFIED);
    expect(await bearerGate("/api/auth/resend-verification", "Bearer good")).toEqual({
      status: "allow",
      subject: "auth0|abc",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/auth/__tests__/bearer-gate.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/auth/bearer-gate"`

- [ ] **Step 3: Write the implementation**

Create `lib/auth/bearer-gate.ts`:

```ts
/**
 * Middleware-side decision for bearer-credentialed requests.
 *
 * middleware.ts is the single enforcement point for both authentication and the
 * email-verification gate. It reads a session cookie, which a native client
 * never has, so bearer requests would 401 before reaching any handler. This
 * mirrors that gate for the token credential.
 *
 * Extracted from middleware.ts so it is testable without Edge-runtime plumbing
 * — the same reason lib/email-verification.ts is its own module.
 */

import { NextResponse } from "next/server";
import { applyNoStore } from "@/lib/no-store";
import { extractBearerToken, verifyBearerToken } from "@/lib/auth/bearer";
import { isVerificationExempt, EMAIL_NOT_VERIFIED_BODY } from "@/lib/email-verification";

export type BearerGateResult =
  | { status: "no-credential" }
  | { status: "allow"; subject: string }
  | { status: "deny"; response: Response };

function deny(response: Response): BearerGateResult {
  return { status: "deny", response };
}

function unauthorized(): BearerGateResult {
  return deny(applyNoStore(NextResponse.json({ error: "Unauthorized" }, { status: 401 })));
}

/**
 * @param pathname  request path, already known to be non-public
 * @param authorizationHeader  raw `Authorization` header value
 * @returns "no-credential" to fall through to the cookie path, "allow" plus the
 *          Auth0 subject to proceed, or the Response to return unchanged.
 */
export async function bearerGate(
  pathname: string,
  authorizationHeader: string | null
): Promise<BearerGateResult> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) return { status: "no-credential" };

  // A bearer token is an API credential. Aimed at a page route it means a
  // misconfigured client, and answering with HTML or a login redirect gives a
  // native client something it cannot act on.
  if (!pathname.startsWith("/api")) return unauthorized();

  const claims = await verifyBearerToken(token);
  if (!claims) return unauthorized();

  if (!claims.emailVerified && !isVerificationExempt(pathname)) {
    return deny(applyNoStore(NextResponse.json(EMAIL_NOT_VERIFIED_BODY, { status: 403 })));
  }

  // The subject rides out so middleware can key the write rate limiter on it
  // without verifying the token a second time.
  return { status: "allow", subject: claims.sub };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/auth/__tests__/bearer-gate.test.ts`
Expected: PASS, 7 cases.

- [ ] **Step 5: Wire the gate into middleware**

In `middleware.ts`, add to the imports at the top:

```ts
import { bearerGate } from "@/lib/auth/bearer-gate";
```

Then insert this block immediately after the `isPublicRoute` early return (currently `middleware.ts:54-56`) and before the `const session = await auth0.getSession(request);` line:

```ts
  // Bearer credential (native app). Checked before the cookie path so a token
  // request is never answered with a login redirect.
  const gate = await bearerGate(pathname, request.headers.get("authorization"));
  if (gate.status === "deny") return gate.response;
  if (gate.status === "allow") {
    return applyNoStore(NextResponse.next());
  }
```

The rest of the function is unchanged: the cookie session check, the verification gate, and the final `applyNoStore(authResponse)` all still run for browser requests. Task 7 adds a rate-limit call inside the `allow` branch and a matching one on the cookie path.

- [ ] **Step 6: Verify the whole suite and the build**

Run: `npm run test && npm run type-check && npm run lint && npm run build`
Expected: all PASS. The build matters here specifically — `middleware.ts` compiles to the Edge runtime, and this step is what proves `jose` bundles for it.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/bearer-gate.ts lib/auth/__tests__/bearer-gate.test.ts middleware.ts
git commit -m "feat(auth): admit bearer-credentialed API requests through middleware"
```

---

### Task 4: Auth0 tenant configuration for the mobile client

Nothing above works until the tenant issues verifiable JWTs carrying the two custom claims. Script follows the existing `scripts/auth0-*.mjs` pattern; the Action is a paste-in file, matching `scripts/auth0-actions/skip-mfa-for-e2e.js`.

**Files:**
- Create: `scripts/auth0-mobile-api.mjs`
- Create: `scripts/auth0-actions/add-api-claims.js`
- Modify: `.env.example` (or `CLAUDE.md`'s env block if no `.env.example` exists — check with `ls -a`)

**Interfaces:**
- Consumes: `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET`, and `AUTH0_MGMT_DOMAIN || AUTH0_DOMAIN` — the same resolution every other script in `scripts/` uses, because the Management API audience never moves to the custom domain.
- Produces: an Auth0 Resource Server whose identifier becomes `AUTH0_AUDIENCE`, and a Native application whose client id becomes `AUTH0_MOBILE_CLIENT_ID` (consumed by the mobile repo, not by this one).

- [ ] **Step 1: Write the Action source**

Create `scripts/auth0-actions/add-api-claims.js`:

```js
/**
 * Auth0 post-login Action — add profile claims to the mobile API access token.
 *
 * Paste into Auth0 Dashboard → Actions → Library → Build Custom (Login / Post
 * Login), then drag it into the Login flow.
 *
 * Access tokens minted for a custom API carry only OIDC-registered claims, so
 * lib/auth/bearer.ts would see no email and no verification state. Claims must
 * be namespaced — Auth0 silently drops custom claims that are not URIs.
 *
 * Keep the namespace in sync with EMAIL_CLAIM / EMAIL_VERIFIED_CLAIM in
 * lib/auth/bearer.ts. The verifier fails closed, so a mismatch does not open a
 * hole — it locks every mobile user out at the verification gate instead.
 */
exports.onExecutePostLogin = async (event, api) => {
  const NAMESPACE = "https://sendquota.com/";

  // Only tokens for the mobile API need these; the web app reads the session.
  if (!event.resource_server || event.resource_server.identifier !== "https://api.sendquota.com") {
    return;
  }

  api.accessToken.setCustomClaim(`${NAMESPACE}email`, event.user.email);
  api.accessToken.setCustomClaim(
    `${NAMESPACE}email_verified`,
    event.user.email_verified === true
  );
};
```

- [ ] **Step 2: Write the provisioning script**

Create `scripts/auth0-mobile-api.mjs`:

```js
#!/usr/bin/env node
/**
 * Provision the Auth0 objects the native app needs.
 *
 *   node scripts/auth0-mobile-api.mjs --dry
 *   node scripts/auth0-mobile-api.mjs
 *
 * Creates (idempotently):
 *   1. a Resource Server (API) — its identifier is AUTH0_AUDIENCE, and it is
 *      what makes access tokens verifiable JWTs instead of opaque strings
 *   2. a Native application using Authorization Code + PKCE — its client id is
 *      AUTH0_MOBILE_CLIENT_ID, consumed by the mobile repo
 *
 * The claims Action is NOT created here: Actions are versioned, deployed, and
 * bound to a flow through three separate API calls, and getting that wrong
 * silently breaks every login. Paste scripts/auth0-actions/add-api-claims.js in
 * by hand — same convention as skip-mfa-for-e2e.js.
 *
 * M2M scopes required: create:resource_servers, read:resource_servers,
 * update:resource_servers, create:clients, read:clients, update:clients.
 * The update: scopes are not optional — a re-run PATCHes the token lifetimes
 * and the refresh-token rotation policy onto objects that already exist.
 */

const DRY = process.argv.includes("--dry");

const AUDIENCE = process.env.AUTH0_AUDIENCE || "https://api.sendquota.com";
const MGMT_DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET;
const MOBILE_SCHEME = process.env.AUTH0_MOBILE_SCHEME || "com.sendquota.app";

if (!MGMT_DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Missing AUTH0_MGMT_DOMAIN/AUTH0_DOMAIN, AUTH0_MGMT_CLIENT_ID or AUTH0_MGMT_CLIENT_SECRET"
  );
  process.exit(1);
}

async function token() {
  const res = await fetch(`https://${MGMT_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      audience: `https://${MGMT_DOMAIN}/api/v2/`,
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function api(tok, path, init = {}) {
  const res = await fetch(`https://${MGMT_DOMAIN}/api/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const resourceServer = {
  name: "Quota Mobile API",
  identifier: AUDIENCE,
  signing_alg: "RS256",
  // One hour. Access tokens are verified offline against JWKS, so there is no
  // revocation path — the lifetime IS the exposure window for a token lifted
  // off a device or a debug proxy. Short-lived access token plus a rotating
  // refresh token is what makes revocation possible at all.
  token_lifetime: 3600,
  // Required for the tenant to issue refresh tokens for this audience. Without
  // it, requesting the `offline_access` scope silently returns none, and the
  // app is stuck re-running the full login every hour.
  allow_offline_access: true,
  skip_consent_for_verifiable_first_party_clients: true,
};

const nativeApp = {
  name: "Quota Mobile",
  app_type: "native",
  // PKCE. A native binary cannot hold a client secret — it ships to the device.
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  callbacks: [`${MOBILE_SCHEME}://callback`],
  allowed_logout_urls: [`${MOBILE_SCHEME}://callback`],
  oidc_conformant: true,
  refresh_token: {
    // Rotating, not reusable. Each refresh returns a new token and invalidates
    // the old one, which buys two things a static refresh token cannot:
    // revocation, and automatic reuse detection — replaying a spent token makes
    // Auth0 revoke the entire family, cutting off a thief and the real device
    // together. That is the signal you want on a stolen-credential event.
    rotation_type: "rotating",
    expiration_type: "expiring",
    // Absolute ceiling: 30 days. A device untouched longer than that re-logs in.
    token_lifetime: 2592000,
    // Idle ceiling: 15 days without use and the token dies, so an abandoned or
    // resold phone stops being a live credential.
    idle_token_lifetime: 1296000,
    infinite_token_lifetime: false,
    infinite_idle_token_lifetime: false,
    // Grace window for a rotation whose response was lost to a dropped
    // connection. Without it, a contractor in a basement with one bar gets
    // logged out by a network blip; too wide and a stolen token has a usable
    // replay window. 30s is Auth0's documented default for this reason.
    leeway: 30,
  },
};

const tok = await token();

// Existing objects are PATCHed rather than skipped: the token lifetimes and the
// refresh-token rotation policy are the security-relevant part, and a run that
// silently left an old 24h lifetime in place would report success while leaving
// the tenant misconfigured.
const existingApis = await api(tok, "/resource-servers?per_page=100");
const foundApi = existingApis.find((r) => r.identifier === AUDIENCE);
if (DRY) {
  console.log(
    `[dry] would ${foundApi ? "update" : "create"} resource server:`,
    JSON.stringify(resourceServer, null, 2)
  );
} else if (foundApi) {
  // identifier is immutable; PATCHing it 400s.
  const { identifier, ...patch } = resourceServer;
  await api(tok, `/resource-servers/${foundApi.id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  console.log(`Updated API ${AUDIENCE} (id ${foundApi.id})`);
} else {
  const created = await api(tok, "/resource-servers", {
    method: "POST",
    body: JSON.stringify(resourceServer),
  });
  console.log(`Created API ${created.identifier} (id ${created.id})`);
}

const clients = await api(tok, "/clients?per_page=100&fields=client_id,name,app_type&include_fields=true");
const foundApp = clients.find((c) => c.name === nativeApp.name);
if (DRY) {
  console.log(
    `[dry] would ${foundApp ? "update" : "create"} native app:`,
    JSON.stringify(nativeApp, null, 2)
  );
} else if (foundApp) {
  // app_type is immutable on an existing client.
  const { app_type, ...patch } = nativeApp;
  await api(tok, `/clients/${foundApp.client_id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  console.log(`Updated native app (client_id ${foundApp.client_id})`);
} else {
  const created = await api(tok, "/clients", {
    method: "POST",
    body: JSON.stringify(nativeApp),
  });
  console.log(`Created native app (client_id ${created.client_id})`);
}

console.log("");
console.log("Next, by hand:");
console.log("  1. Paste scripts/auth0-actions/add-api-claims.js into");
console.log("     Actions → Library → Build Custom (Login / Post Login), deploy it,");
console.log("     and drag it into the Login flow.");
console.log(`  2. Set AUTH0_AUDIENCE=${AUDIENCE} in .env.local and in Vercel.`);
console.log("  3. Set AUTH0_MOBILE_CLIENT_ID in the mobile repo (not this one).");
console.log("  4. The app must request the `offline_access` scope alongside");
console.log("     `openid profile email`, or it gets no refresh token and has to");
console.log("     re-run the full login every hour.");
```

- [ ] **Step 3: Preview against the tenant**

Run: `node scripts/auth0-mobile-api.mjs --dry`
Expected: prints the two objects it would create, or reports them as already existing. No 403 — if you get `insufficient_scope`, add `create:resource_servers`, `read:resource_servers`, `create:clients`, `read:clients` to the M2M app.

- [ ] **Step 4: Apply, then paste the Action**

Run: `node scripts/auth0-mobile-api.mjs`
Then follow the three printed manual steps. Set `AUTH0_AUDIENCE=https://api.sendquota.com` in `.env.local`.

- [ ] **Step 5: Verify a real token end to end**

The Action only fires on a login, so mint a token through the tenant and inspect it:

```bash
# Requires the native app's client_id; a device login is the real path, but the
# claims can be checked from any token the tenant issues for this audience.
node -e '
const t = process.argv[1];
const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
console.log({ iss: p.iss, aud: p.aud, sub: p.sub,
  lifetimeSeconds: p.exp - p.iat,
  email: p["https://sendquota.com/email"],
  email_verified: p["https://sendquota.com/email_verified"] });
' "<paste access token>"
```

Expected: `iss` matches `https://$AUTH0_DOMAIN/`, `aud` includes `https://api.sendquota.com`, `lifetimeSeconds` is `3600`, and both custom claims are present.

Two failure modes to distinguish:
- **Claims missing** — the Action is not deployed or not bound to the Login flow. The API will 403 every mobile user at the verification gate until it is. Fails closed, so this is loud, not silent.
- **`lifetimeSeconds` is 86400** — the resource server was created by an earlier run and the PATCH did not apply. Check the M2M app has `update:resource_servers`; without it the script 403s rather than reporting success.

Also confirm the token response carried a `refresh_token`. If it did not, either `allow_offline_access` did not apply or the app did not request the `offline_access` scope.

- [ ] **Step 6: Document the new env vars**

Add to whichever env reference the repo uses (`.env.example` if present, otherwise the Environment Variables block in `CLAUDE.md`):

```bash
# Mobile API (native iOS/Android clients — see docs/api/v1.md)
AUTH0_AUDIENCE=https://api.sendquota.com   # Auth0 API identifier; bearer tokens are verified against it
AUTH0_MOBILE_SCHEME=com.sendquota.app      # optional; native callback scheme, used by scripts/auth0-mobile-api.mjs
```

`AUTH0_MOBILE_CLIENT_ID` belongs in the mobile repo, not here — this app never authenticates as the native client.

- [ ] **Step 7: Commit**

```bash
git add scripts/auth0-mobile-api.mjs scripts/auth0-actions/add-api-claims.js
git add .env.example CLAUDE.md 2>/dev/null
git commit -m "feat(auth): provision the Auth0 API and native app for mobile clients"
```

---

### Task 5: Versioned /api/v1 surface

A shipped binary cannot be force-updated, so it must not depend on paths the web app is free to reshape. Each file re-exports the base handler's methods verbatim — no logic, no duplication, and the re-export is type-checked, so deleting a base handler breaks the build rather than the app.

**Files:**
- Create: `app/api/v1/quotes/route.ts`
- Create: `app/api/v1/quotes/[id]/route.ts`
- Create: `app/api/v1/quotes/[id]/pdf/route.ts`
- Create: `app/api/v1/quotes/[id]/payments/route.ts`
- Create: `app/api/v1/quotes/[id]/payments/[paymentId]/route.ts`
- Create: `app/api/v1/quotes/[id]/payments/[paymentId]/receipt/route.ts`
- Create: `app/api/v1/quotes/[id]/milestones/route.ts`
- Create: `app/api/v1/work-items/route.ts`
- Create: `app/api/v1/work-items/[id]/route.ts`
- Create: `app/api/v1/work-items/import/route.ts`
- Create: `app/api/v1/clients/route.ts`
- Create: `app/api/v1/send-quote/route.ts`
- Create: `app/api/v1/subscription/route.ts`
- Create: `app/api/v1/profile/route.ts`
- Create: `app/api/v1/__tests__/parity.test.ts`

**Interfaces:**
- Consumes: the bearer path from Tasks 2 and 3 — `/api/v1/*` is under `/api`, so `bearerGate` already covers it and `middleware.ts` needs no change.
- Produces: the frozen paths the mobile repo codes against. `/api/billing/*` is deliberately absent (see Global Constraints).

- [ ] **Step 1: Write the failing parity test**

Create `app/api/v1/__tests__/parity.test.ts`:

```ts
// app/api/v1/__tests__/parity.test.ts
import { describe, it, expect } from "vitest";

/**
 * Each v1 route must re-export exactly the HTTP methods its base route defines.
 * A method added to a base route without being re-exported is a 405 the mobile
 * app only discovers in production; a method re-exported that no longer exists
 * is a build break. This asserts both.
 */
const PAIRS: Array<[string, () => Promise<Record<string, unknown>>, () => Promise<Record<string, unknown>>]> = [
  ["quotes", () => import("@/app/api/quotes/route"), () => import("@/app/api/v1/quotes/route")],
  ["quotes/[id]", () => import("@/app/api/quotes/[id]/route"), () => import("@/app/api/v1/quotes/[id]/route")],
  ["quotes/[id]/pdf", () => import("@/app/api/quotes/[id]/pdf/route"), () => import("@/app/api/v1/quotes/[id]/pdf/route")],
  ["quotes/[id]/payments", () => import("@/app/api/quotes/[id]/payments/route"), () => import("@/app/api/v1/quotes/[id]/payments/route")],
  ["quotes/[id]/payments/[paymentId]", () => import("@/app/api/quotes/[id]/payments/[paymentId]/route"), () => import("@/app/api/v1/quotes/[id]/payments/[paymentId]/route")],
  ["quotes/[id]/payments/[paymentId]/receipt", () => import("@/app/api/quotes/[id]/payments/[paymentId]/receipt/route"), () => import("@/app/api/v1/quotes/[id]/payments/[paymentId]/receipt/route")],
  ["quotes/[id]/milestones", () => import("@/app/api/quotes/[id]/milestones/route"), () => import("@/app/api/v1/quotes/[id]/milestones/route")],
  ["work-items", () => import("@/app/api/work-items/route"), () => import("@/app/api/v1/work-items/route")],
  ["work-items/[id]", () => import("@/app/api/work-items/[id]/route"), () => import("@/app/api/v1/work-items/[id]/route")],
  ["work-items/import", () => import("@/app/api/work-items/import/route"), () => import("@/app/api/v1/work-items/import/route")],
  ["clients", () => import("@/app/api/clients/route"), () => import("@/app/api/v1/clients/route")],
  ["send-quote", () => import("@/app/api/send-quote/route"), () => import("@/app/api/v1/send-quote/route")],
  ["subscription", () => import("@/app/api/subscription/route"), () => import("@/app/api/v1/subscription/route")],
  ["profile", () => import("@/app/api/profile/route"), () => import("@/app/api/v1/profile/route")],
];

const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

function methodsOf(mod: Record<string, unknown>): string[] {
  return METHODS.filter((m) => typeof mod[m] === "function");
}

describe("/api/v1 re-export parity", () => {
  it.each(PAIRS)("%s exposes the same methods as its base route", async (_name, base, v1) => {
    const [baseMod, v1Mod] = await Promise.all([base(), v1()]);
    expect(methodsOf(v1Mod).sort()).toEqual(methodsOf(baseMod).sort());
  });

  it.each(PAIRS)("%s re-exports the identical handler, not a copy", async (_name, base, v1) => {
    const [baseMod, v1Mod] = await Promise.all([base(), v1()]);
    for (const m of methodsOf(baseMod)) {
      expect(v1Mod[m]).toBe(baseMod[m]);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/v1/__tests__/parity.test.ts`
Expected: FAIL — every v1 import is unresolvable.

- [ ] **Step 3: Write the re-export files**

Each file is one line plus a header. Create them exactly as listed:

`app/api/v1/quotes/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { GET, POST } from "@/app/api/quotes/route";
```

`app/api/v1/quotes/[id]/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { PATCH } from "@/app/api/quotes/[id]/route";
```

`app/api/v1/quotes/[id]/pdf/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { GET } from "@/app/api/quotes/[id]/pdf/route";
```

`app/api/v1/quotes/[id]/payments/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { GET, POST } from "@/app/api/quotes/[id]/payments/route";
```

`app/api/v1/quotes/[id]/payments/[paymentId]/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { DELETE } from "@/app/api/quotes/[id]/payments/[paymentId]/route";
```

`app/api/v1/quotes/[id]/payments/[paymentId]/receipt/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { POST } from "@/app/api/quotes/[id]/payments/[paymentId]/receipt/route";
```

`app/api/v1/quotes/[id]/milestones/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { GET, PUT } from "@/app/api/quotes/[id]/milestones/route";
```

`app/api/v1/work-items/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { GET, POST } from "@/app/api/work-items/route";
```

`app/api/v1/work-items/[id]/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { PATCH, DELETE } from "@/app/api/work-items/[id]/route";
```

`app/api/v1/work-items/import/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { POST } from "@/app/api/work-items/import/route";
```

`app/api/v1/clients/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { GET } from "@/app/api/clients/route";

// The base route sets this; route segment config is not inherited through a
// re-export, so it has to be restated here or the response gets cached.
export const dynamic = "force-dynamic";
```

`app/api/v1/send-quote/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { POST } from "@/app/api/send-quote/route";
```

`app/api/v1/subscription/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { GET, PATCH } from "@/app/api/subscription/route";
```

`app/api/v1/profile/route.ts`
```ts
/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { GET, PATCH } from "@/app/api/profile/route";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/api/v1/__tests__/parity.test.ts`
Expected: PASS, 28 cases.

- [ ] **Step 5: Verify the routes actually mount**

Run: `npm run build`
Expected: build succeeds and the route manifest lists every `/api/v1/...` path. Confirm with:

```bash
npm run build 2>&1 | grep -c "/api/v1/"
```

Expected: `14`.

- [ ] **Step 6: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/api/v1
git commit -m "feat(api): add a frozen /api/v1 surface for native clients"
```

---

### Task 6: GET /api/v1/me bootstrap endpoint

A cold app launch needs profile, tier, and remaining quota before it can render anything. Without this it makes three calls and stitches them; more importantly, it is where the app learns that billing lives on the web.

**Files:**
- Create: `app/api/v1/me/route.ts`
- Create: `lib/__tests__/me-route.test.ts`

**Interfaces:**
- Consumes: `getCurrentUser()` from `lib/auth.ts` (Task 2); `resolveTier`, `QUOTE_LIMIT` from `lib/subscription.ts`; `countUserQuotesThisMonth` from `lib/db/users.ts`.
- Produces: `GET /api/v1/me` → `200 { success, user, subscription }` or `401 { success: false, code: "UNAUTHORIZED" }`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/me-route.test.ts`:

```ts
// lib/__tests__/me-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const countUserQuotesThisMonth = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/db/users", () => ({
  countUserQuotesThisMonth: (id: string) => countUserQuotesThisMonth(id),
}));

import { GET } from "@/app/api/v1/me/route";

const USER = {
  id: "u1",
  email: "sam@example.com",
  first_name: "Sam",
  last_name: "Rivera",
  company_name: "Rivera Plumbing",
  subscription_tier: "pro",
};

beforeEach(() => {
  vi.clearAllMocks();
  countUserQuotesThisMonth.mockResolvedValue(4);
});

describe("GET /api/v1/me", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });

  it("returns profile, tier and monthly quota usage", async () => {
    getCurrentUser.mockResolvedValue(USER);
    const body = await (await GET()).json();

    expect(body.success).toBe(true);
    expect(body.user).toMatchObject({
      id: "u1",
      email: "sam@example.com",
      firstName: "Sam",
      lastName: "Rivera",
      companyName: "Rivera Plumbing",
    });
    expect(body.subscription).toMatchObject({
      tier: "pro",
      quoteLimit: 15,
      quotesUsedThisMonth: 4,
    });
  });

  // null is the documented "no limit", distinct from 0. Infinity is not valid
  // JSON — JSON.stringify turns it into null anyway, so state it deliberately.
  it("reports an unlimited tier as a null quoteLimit", async () => {
    getCurrentUser.mockResolvedValue({ ...USER, subscription_tier: "ultimate" });
    const body = await (await GET()).json();
    expect(body.subscription.quoteLimit).toBeNull();
    expect(body.subscription.tier).toBe("ultimate");
  });

  // Same fail-closed rule as every other metered path: an unrecognized stored
  // value must resolve to free, never to unlimited.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a tier the product no longer defines", "enterprise"],
  ])("resolves %s to the free tier", async (_label, stored) => {
    getCurrentUser.mockResolvedValue({ ...USER, subscription_tier: stored });
    const body = await (await GET()).json();
    expect(body.subscription.tier).toBe("free");
    expect(body.subscription.quoteLimit).toBe(3);
  });

  it("points billing at the web app", async () => {
    getCurrentUser.mockResolvedValue(USER);
    const body = await (await GET()).json();
    expect(body.subscription.manageUrl).toMatch(/\/billing$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/me-route.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/me/route"`

- [ ] **Step 3: Write the implementation**

Create `app/api/v1/me/route.ts`:

```ts
/**
 * GET /api/v1/me — session bootstrap for native clients.
 *
 * One call for everything the app needs before its first render: who the user
 * is, what tier they are on, and how much of the monthly quota is left.
 *
 * Not a re-export: there is no web equivalent. The web app gets this from
 * Server Components, which a native client cannot render.
 *
 * @module api/v1/me
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { countUserQuotesThisMonth } from "@/lib/db/users";
import { QUOTE_LIMIT, resolveTier } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  // resolveTier, never `as Tier` — subscription_tier is a nullable VARCHAR and
  // an unrecognized value would index QUOTE_LIMIT to undefined, which reads as
  // unlimited.
  const tier = resolveTier(user.subscription_tier);
  const limit = QUOTE_LIMIT[tier];
  const quotesUsedThisMonth = await countUserQuotesThisMonth(user.id);

  return NextResponse.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      companyName: user.company_name,
    },
    subscription: {
      tier,
      // null means unlimited. Infinity is not representable in JSON.
      quoteLimit: Number.isFinite(limit) ? limit : null,
      quotesUsedThisMonth,
      // Subscriptions are not sold in the app — see docs/api/v1.md.
      manageUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://sendquota.com"}/billing`,
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/__tests__/me-route.test.ts`
Expected: PASS, 7 cases. If `first_name` / `company_name` do not type-check, confirm the real column names in `types/database.ts` and use those — the test's `USER` fixture must match.

- [ ] **Step 5: Full verification**

Run: `npm run test && npm run type-check && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/me/route.ts lib/__tests__/me-route.test.ts
git commit -m "feat(api): add GET /api/v1/me session bootstrap for native clients"
```

---

### Task 7: Rate-limit write requests at the middleware

A native app is a **public client** — no client secret, the client id ships inside the binary. Anyone can extract it, sign up, and script writes. `lib/rate-limit.ts` already covers the email-sending routes (`send-quote`, receipt, `resend-verification`) and billing, but every CRUD write — quotes, work items, payments, milestones, profile — is unlimited. This closes that, for the web session path as well as for bearer, because both credentials reach the same handlers.

Enforced in middleware rather than in nine route files, for the reason `lib/email-verification.ts` gives: one enforcement point instead of nine chances to forget one.

**Files:**
- Create: `lib/api-rate-limit.ts`
- Create: `lib/__tests__/api-rate-limit.test.ts`
- Modify: `middleware.ts`

**Interfaces:**
- Consumes: `applyNoStore` from `lib/no-store.ts`; the `{ status: "allow"; subject }` result from `bearerGate` (Task 3).
- Produces:
  - `WRITE_WINDOW_MS: number`, `MAX_WRITES_PER_WINDOW: number`
  - `writeRateLimitResponse(method: string, pathname: string, subject: string): Response | null` — the 429 to return, or null to proceed
  - `resetWriteRateLimit(): void` — test seam

**Note:** deliberately does **not** import `lib/rate-limit.ts`. That module calls `setInterval` at import time for window cleanup, and this one is pulled into the Edge middleware bundle where a module-scope timer is both unsupported ground and a leak across ephemeral instances. This limiter prunes lazily instead.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/api-rate-limit.test.ts`:

```ts
// lib/__tests__/api-rate-limit.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  writeRateLimitResponse,
  resetWriteRateLimit,
  MAX_WRITES_PER_WINDOW,
  WRITE_WINDOW_MS,
} from "@/lib/api-rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-09T12:00:00Z"));
  resetWriteRateLimit();
});

afterEach(() => vi.useRealTimers());

/** Burn n writes for a subject; returns the response from the nth. */
function writeTimes(n: number, subject = "auth0|abc"): Response | null {
  let last: Response | null = null;
  for (let i = 0; i < n; i++) {
    last = writeRateLimitResponse("POST", "/api/quotes", subject);
  }
  return last;
}

describe("writeRateLimitResponse", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("does not limit %s", (method) => {
    for (let i = 0; i < MAX_WRITES_PER_WINDOW * 2; i++) {
      expect(writeRateLimitResponse(method, "/api/quotes", "auth0|abc")).toBeNull();
    }
  });

  it("allows writes up to the limit", () => {
    expect(writeTimes(MAX_WRITES_PER_WINDOW)).toBeNull();
  });

  it("429s the write past the limit", async () => {
    writeTimes(MAX_WRITES_PER_WINDOW);
    const res = writeRateLimitResponse("POST", "/api/quotes", "auth0|abc");

    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(await res!.json()).toMatchObject({
      success: false,
      code: "RATE_LIMIT_EXCEEDED",
    });
    expect(res!.headers.get("Retry-After")).toBe("60");
    expect(res!.headers.get("Cache-Control")).toContain("no-store");
  });

  it("gives each subject an independent budget", () => {
    writeTimes(MAX_WRITES_PER_WINDOW, "auth0|abc");
    expect(writeRateLimitResponse("POST", "/api/quotes", "auth0|xyz")).toBeNull();
  });

  it("shares one budget across write paths for the same subject", () => {
    writeTimes(MAX_WRITES_PER_WINDOW, "auth0|abc");
    // A different endpoint, same user — the budget is per user, not per route,
    // because the thing being limited is scripted abuse, not one endpoint.
    expect(writeRateLimitResponse("POST", "/api/work-items", "auth0|abc")).not.toBeNull();
  });

  it("reopens the budget after the window elapses", () => {
    writeTimes(MAX_WRITES_PER_WINDOW);
    vi.advanceTimersByTime(WRITE_WINDOW_MS);
    expect(writeRateLimitResponse("POST", "/api/quotes", "auth0|abc")).toBeNull();
  });

  // Double-limiting would make the effective budget the smaller of the two and
  // make a 429 impossible to attribute to a policy.
  it.each([
    "/api/send-quote",
    "/api/v1/send-quote",
    "/api/quotes/q1/payments/p1/receipt",
    "/api/v1/quotes/q1/payments/p1/receipt",
    "/api/auth/resend-verification",
    "/api/billing/change-plan",
  ])("skips %s, which runs its own limiter", (pathname) => {
    for (let i = 0; i < MAX_WRITES_PER_WINDOW * 2; i++) {
      expect(writeRateLimitResponse("POST", pathname, "auth0|abc")).toBeNull();
    }
  });

  it("limits a v1 path the same as its base path", () => {
    writeTimes(MAX_WRITES_PER_WINDOW, "auth0|abc");
    expect(writeRateLimitResponse("POST", "/api/v1/quotes", "auth0|abc")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/api-rate-limit.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/api-rate-limit"`

- [ ] **Step 3: Write the implementation**

Create `lib/api-rate-limit.ts`:

```ts
/**
 * Per-user write budget for the API, enforced in middleware.
 *
 * The native app is a public client: no secret, and its client id ships inside
 * the binary. Anyone can extract it, sign up, and script writes. lib/rate-limit
 * already guards the routes that spend money or send mail; this covers the CRUD
 * writes that do neither but can still be used to hammer the database.
 *
 * In middleware rather than in nine route handlers — same reasoning as
 * lib/email-verification.ts, which exists because per-route enforcement is
 * per-route forgetting.
 *
 * Not built on lib/rate-limit.ts: that module starts a setInterval at import
 * time, and this one is bundled into the Edge middleware, where a module-scope
 * timer is unsupported ground and leaks across ephemeral instances. Pruning
 * here is lazy instead.
 *
 * LIMITATION: in-memory and per-instance. Vercel runs middleware in several
 * ephemeral instances per region, so a determined attacker spread across
 * instances gets a multiple of this budget. It is a speed bump against scripted
 * abuse, not a guarantee. A hard guarantee needs Vercel Firewall rate limiting
 * or a shared store; revisit when there is traffic worth defending.
 */

import { NextResponse } from "next/server";
import { applyNoStore } from "@/lib/no-store";

export const WRITE_WINDOW_MS = 60_000;

/**
 * 60 writes/minute. A contractor building a busy quote might spend 20 in a
 * burst, so this does not touch real use; a script trying to enumerate or
 * exhaust hits it in a second.
 */
export const MAX_WRITES_PER_WINDOW = 60;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

/** Test seam — drop all windows. */
export function resetWriteRateLimit(): void {
  windows.clear();
}

/**
 * `/api/v1/foo` re-exports the handler at `/api/foo`, so they are one endpoint
 * and must share one policy. Without this, a client moves to the v1 path and
 * silently gets a second budget.
 */
function canonicalPath(pathname: string): string {
  return pathname.replace(/^\/api\/v\d+\//, "/api/");
}

/** Routes that already run their own, tighter limiter. */
function isSelfLimited(canonical: string): boolean {
  return (
    canonical.startsWith("/api/send-quote") ||
    canonical.startsWith("/api/auth/resend-verification") ||
    canonical.startsWith("/api/billing/") ||
    // Receipt sends are nested under /api/quotes, so a prefix check misses them.
    canonical.endsWith("/receipt")
  );
}

function prune(now: number): void {
  for (const [key, w] of windows.entries()) {
    if (now >= w.resetAt) windows.delete(key);
  }
}

/**
 * @param subject  the authenticated Auth0 `sub` — never an IP. Behind a mobile
 *                 carrier NAT thousands of users share an address, so keying on
 *                 IP would throttle a whole region off one abuser.
 * @returns the 429 to return, or null to let the request through
 */
export function writeRateLimitResponse(
  method: string,
  pathname: string,
  subject: string
): Response | null {
  if (!WRITE_METHODS.has(method.toUpperCase())) return null;

  const canonical = canonicalPath(pathname);
  if (isSelfLimited(canonical)) return null;

  const now = Date.now();
  const key = `api-write:${subject}`;
  const entry = windows.get(key);

  if (!entry || now >= entry.resetAt) {
    // Only on window rollover, so the sweep cost is amortized rather than paid
    // on every request.
    prune(now);
    windows.set(key, { count: 1, resetAt: now + WRITE_WINDOW_MS });
    return null;
  }

  if (entry.count >= MAX_WRITES_PER_WINDOW) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return applyNoStore(
      NextResponse.json(
        {
          success: false,
          error: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(MAX_WRITES_PER_WINDOW),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(entry.resetAt),
            "Retry-After": String(retryAfter),
          },
        }
      )
    );
  }

  entry.count++;
  return null;
}
```

The response shape matches the existing 429 in `app/api/send-quote/route.ts:95-111` exactly, so a client has one thing to handle rather than two.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/__tests__/api-rate-limit.test.ts`
Expected: PASS, 15 cases.

- [ ] **Step 5: Wire it into both credential paths in middleware**

In `middleware.ts`, add to the imports:

```ts
import { writeRateLimitResponse } from "@/lib/api-rate-limit";
```

Extend the bearer branch added in Task 3 so the `allow` case is limited:

```ts
  const gate = await bearerGate(pathname, request.headers.get("authorization"));
  if (gate.status === "deny") return gate.response;
  if (gate.status === "allow") {
    const limited = writeRateLimitResponse(request.method, pathname, gate.subject);
    if (limited) return limited;
    return applyNoStore(NextResponse.next());
  }
```

Then add the cookie-path equivalent. Place it immediately after the existing verification gate block (the `if (needsVerification(session) && ...)` block) and before the final `return applyNoStore(authResponse);`:

```ts
  // Same write budget for the browser. A session cookie is not a smaller threat
  // than a bearer token — it is just a different credential on the same
  // handlers.
  if (pathname.startsWith("/api") && session.user?.sub) {
    const limited = writeRateLimitResponse(request.method, pathname, session.user.sub);
    if (limited) return limited;
  }
```

- [ ] **Step 6: Verify the unit suite and the build**

Run: `npm run test && npm run type-check && npm run lint && npm run build`
Expected: all PASS. The build again matters specifically — it proves the new module bundles for Edge.

- [ ] **Step 7: Verify the e2e suite still fits inside the budget**

This is the step that catches a limit set too low. The Playwright specs run single-worker against one shared user and create data fast — `catalog.spec.ts` and `quote-flow.spec.ts` are the dense ones.

Run: `npm run test:e2e`
Expected: PASS, with no "Rate limit exceeded" text and no 429 in any failure output.

If a spec does hit the limit, **raise `MAX_WRITES_PER_WINDOW` rather than exempting the test user** — an exemption is a production code path that exists only to be untested, and the e2e suite is the only automated signal that the limit is survivable.

- [ ] **Step 8: Commit**

```bash
git add lib/api-rate-limit.ts lib/__tests__/api-rate-limit.test.ts middleware.ts
git commit -m "feat(api): rate-limit write requests per user at the middleware"
```

---

### Task 8: API contract and versioning policy doc

The mobile repo is a separate repository with a separate release cadence. Its authors cannot read this codebase's conventions, and this codebase's authors cannot see what a shipped binary depends on. This document is the entire interface between the two.

**Files:**
- Create: `docs/api/v1.md`
- Modify: `CLAUDE.md` (Architecture section)

**Interfaces:**
- Consumes: everything built in Tasks 1-7.
- Produces: the reference the mobile repo's own plan is written against.

- [ ] **Step 1: Write the contract doc**

Create `docs/api/v1.md`:

````markdown
# Quota API v1

The interface between this web repo and the separate native iOS/Android repo.

## Authentication

Auth0 Authorization Code + PKCE against a **Native** application. The app sends
the resulting access token as `Authorization: Bearer <token>` on every request.

- Auth0 domain: `AUTH0_DOMAIN` (custom domain `auth.sendquota.com`)
- Audience: `https://api.sendquota.com` — required, or the token comes back opaque
- Scopes: `openid profile email offline_access` — without `offline_access` no
  refresh token is issued and the app re-runs the full login every hour
- Tokens are RS256 JWTs, verified against the tenant JWKS in `lib/auth/bearer.ts`

**Token lifetimes.** Access token **1 hour**. It is verified offline against
JWKS, so there is no revocation path — the lifetime *is* the exposure window for
a token lifted off a device or read out of a debug proxy.

Refresh token: **rotating and expiring**, 30-day absolute ceiling, 15-day idle
ceiling, 30s rotation leeway. Rotation is what makes revocation possible at all,
and it gives reuse detection for free: replaying a spent refresh token makes
Auth0 revoke the whole family, cutting off the thief and the real device
together. That simultaneous logout is the intended signal, not a bug — treat it
as a credential-compromise event, not as something to engineer around.

Store the refresh token in the platform keystore — iOS Keychain, Android
Keystore. Never `AsyncStorage`, `UserDefaults`, or `SharedPreferences`.

There is no API key, no shared secret, and no separate mobile login. Identity is
the same Auth0 user as the web app: one account, both clients. The native app is
a **public client** — its client id is in the binary and is not a secret; PKCE,
not the client id, is what secures the exchange.

**No CORS headers are served.** Native HTTP clients send no `Origin` and are not
subject to the same-origin policy. A browser cannot call this API cross-origin,
by design.

## Error shape

Every error is JSON with a stable `code`. Branch on `code`, never on `message` —
message copy changes without notice.

| Status | `code` | Meaning |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing, malformed, expired, or wrong-audience token. Refresh, then re-login. |
| 403 | `EMAIL_NOT_VERIFIED` | Account exists but the email is unconfirmed. Call `POST /api/auth/resend-verification` — it is exempt from this gate. |
| 403 | `QUOTE_LIMIT` | Monthly quote cap reached for the tier. Show the cap; do not offer an in-app upgrade. |
| 403 | `EMAIL_REQUIRES_PRO` | Free tier attempted an email send. Offer the PDF instead. |
| 400 | `INVALID_JSON` | Body was not JSON. |
| 422 | `VALIDATION_ERROR` | Body failed schema validation; `errors[]` carries `{ field, message }`. |
| 429 | `RATE_LIMIT_EXCEEDED` | Write budget exhausted (60 writes/min per user, plus tighter per-route limits on email sends and billing). Honour `Retry-After`; do not retry in a tight loop. |
| 500 | `INTERNAL_ERROR` | Retry with backoff. |

Rate limiting applies per **authenticated user**, not per IP — behind a mobile
carrier NAT thousands of users share one address. Reads are not limited.

## Endpoints

Base: `https://sendquota.com/api/v1`

| Path | Methods | Notes |
|---|---|---|
| `/me` | GET | Session bootstrap: profile, tier, monthly quota usage |
| `/quotes` | GET, POST | List / create |
| `/quotes/{id}` | PATCH | Internal notes |
| `/quotes/{id}/pdf` | GET | PDF bytes; watermarked on Free, logo on Pro+ |
| `/quotes/{id}/payments` | GET, POST | Payment history / record a payment |
| `/quotes/{id}/payments/{paymentId}` | DELETE | Remove a recorded payment |
| `/quotes/{id}/payments/{paymentId}/receipt` | POST | Email a receipt (Pro+) |
| `/quotes/{id}/milestones` | GET, PUT | Deposit / progress schedule |
| `/work-items` | GET, POST | Catalog |
| `/work-items/{id}` | PATCH, DELETE | Update / soft-deactivate |
| `/work-items/import` | POST | Import starter templates by trade |
| `/clients` | GET | Contacts with their quotes |
| `/send-quote` | POST | Email the quote + PDF (Pro+) |
| `/subscription` | GET | Tier and usage (read-only from the app) |
| `/profile` | GET, PATCH | Business name and contact details |

## Not exposed, deliberately

- **`/api/billing/*`.** Card entry is Stripe Elements, which is web-only, and
  selling a digital subscription inside an iOS binary is an App Store policy
  question rather than a technical one. The app reads tier from `/me` and sends
  users to `subscription.manageUrl` to change plans.
- **`PATCH /api/subscription`.** Dev-only tier switch, guarded by
  `ALLOW_DEV_TIER_SWITCH`, never set in production.
- **`/api/webhooks/*`, `/api/cron/*`.** Server-to-server, separately authenticated.

## Versioning policy

`/api/v1/*` paths are frozen. A shipped App Store binary cannot be force-updated,
so an old version is calling these paths for as long as it exists on a device.

**Allowed** without a version bump:
- adding a new endpoint
- adding a new optional request field
- adding a new response field

**Requires `/api/v2`:**
- removing or renaming any request or response field
- changing a field's type or its null semantics
- changing a status code or a `code` value
- making an optional request field required

The v1 files in `app/api/v1/` re-export the base handlers in `app/api/`, so
editing a base handler edits v1. The parity test in
`app/api/v1/__tests__/parity.test.ts` catches a method appearing or disappearing;
it cannot catch a renamed response field. That one is on review.

## Repository split

- **This repo** owns the API, the database, PDF generation, email, and Stripe.
- **The mobile repo** owns the native app and consumes only `/api/v1`.
- Shared types are published from here as `@quota/types` (Zod schemas plus the
  DB row types) rather than by making either repo a monorepo — the native
  toolchain has no overlap with the Next.js build, and a shared repo would run
  both CI pipelines on every push.
````

- [ ] **Step 2: Point CLAUDE.md at the contract**

Add to `CLAUDE.md`, at the end of the "API Routes" section, immediately after the routes table:

```markdown
### Mobile API (`/api/v1`)

The native iOS/Android app is a **separate repository** and consumes `/api/v1/*`
— thin re-exports of the handlers above, plus `GET /api/v1/me`. Contract and
versioning policy: `docs/api/v1.md`.

Those clients authenticate with an Auth0 **bearer token**, not a session cookie.
`lib/auth/bearer.ts` verifies it, `getCurrentUser()` resolves either credential
to the same `User`, and `lib/auth/bearer-gate.ts` mirrors the middleware
auth + email-verification gate for it. This is why route handlers needed no
changes: `getCurrentUser()` is the only place any of them reads identity.

Access tokens carry **namespaced** custom claims —
`https://sendquota.com/email` and `.../email_verified` — added by the post-login
Action in `scripts/auth0-actions/add-api-claims.js`. Auth0 silently drops
non-namespaced custom claims, and access tokens for a custom API carry no
profile otherwise. Verification **fails closed**: if the Action is undeployed,
every mobile user is held at the 403 gate rather than waved through.
`node scripts/auth0-mobile-api.mjs --dry` provisions the API + native app.

Access tokens live **1 hour**; refresh tokens **rotate** (30d absolute / 15d
idle). Rotation is the only revocation this design has — a JWT verified offline
against JWKS cannot be recalled, so the lifetime is the exposure window. Replay
of a spent refresh token revokes the whole family, logging out thief and owner
together; that is the intended signal.

**Write requests are rate limited per user in middleware** —
`lib/api-rate-limit.ts`, 60 writes/min, keyed on the Auth0 `sub` and shared
across both credentials. Keyed on the subject and never on IP: mobile carrier
NAT puts thousands of users behind one address. `/api/send-quote`, receipt
sends, `resend-verification` and `/api/billing/*` are skipped because they run
their own tighter limiters. In-memory and per-instance, so it is a speed bump
against scripted abuse, not a guarantee — Vercel Firewall or a shared store is
the upgrade when traffic warrants it.

`/api/v1` is **additive-only** once a binary ships — no removed or renamed
fields, no changed types. Billing is deliberately excluded; the app links to
`/billing` on the web.
```

- [ ] **Step 3: Verify nothing broke**

Run: `npm run test && npm run type-check && npm run lint`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/api/v1.md CLAUDE.md
git commit -m "docs(api): document the v1 mobile contract and versioning policy"
```

---

## Follow-on: the mobile repo

Out of scope for this plan and for this repository. Once Tasks 1-8 are merged and
deployed, the mobile repo needs its own plan covering, at minimum:

1. Framework choice — Expo/React Native vs. two native codebases. Neither shares
   code with this repo, so it is decided on mobile-team grounds alone.
2. Auth0 native SDK wiring: PKCE with `AUTH0_MOBILE_CLIENT_ID`, `audience` set to
   `https://api.sendquota.com`, scopes including `offline_access`, refresh tokens
   in the platform keystore (iOS Keychain / Android Keystore) — never in
   `AsyncStorage`, `UserDefaults`, or `SharedPreferences`.
3. Silent refresh on a 1-hour access token: one refresh in flight at a time.
   Rotation invalidates the old token, so two concurrent refreshes race and the
   loser's replay looks like token theft to Auth0 — which revokes the family and
   logs the user out. Serialize refreshes behind a single promise and have all
   waiting requests await it.
4. A generated or hand-written client for `/api/v1`, branching on the `code`
   values in `docs/api/v1.md`, including `429 RATE_LIMIT_EXCEEDED` — honour
   `Retry-After` with backoff, never a tight retry loop.
5. Offline behavior. Contractors quote in basements and crawlspaces; decide
   read-cache vs. write-queue before building screens, not after. A write queue
   that flushes on reconnect will burst straight into the write rate limit —
   pace the flush.
6. The `403 QUOTE_LIMIT` and `403 EMAIL_REQUIRES_PRO` paths, both of which must
   deep-link to `subscription.manageUrl` rather than offering in-app purchase.

Write that plan in the mobile repo, against `docs/api/v1.md` as its spec.
