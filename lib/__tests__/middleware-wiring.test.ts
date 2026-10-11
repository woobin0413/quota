/**
 * Wiring tests for middleware.ts itself.
 *
 * lib/api-rate-limit.test.ts proves the limiter's *decisions*; nothing proved it
 * was ever *called*. Deleting either `writeRateLimitResponse` call site left the
 * unit suite, type-check, lint and build all green, and the e2e suite green too
 * — e2e never trips the limiter, so it passes with the wiring removed. These
 * tests are the only thing standing between a silent deletion and production.
 *
 * They also pin the ORDER of the three gates, which is not a style preference:
 *  - bearer above `isPublicRoute` would 401 `/api/cron/*`, which legitimately
 *    sends `Authorization: Bearer $CRON_SECRET` — a real outage.
 *  - bearer below `getSession` would answer native clients with a login
 *    redirect, which a native client cannot act on.
 *
 * Everything is mocked at the module boundary, so no real JWT, Auth0 tenant or
 * network is involved.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const auth0Middleware = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const bearerGate = vi.hoisted(() => vi.fn());
const writeRateLimitResponse = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth0", () => ({
  auth0: { middleware: auth0Middleware, getSession },
}));
vi.mock("@/lib/auth/bearer-gate", () => ({ bearerGate }));
vi.mock("@/lib/api-rate-limit", () => ({ writeRateLimitResponse }));

import { middleware } from "@/middleware";

/** A NextRequest is not needed — middleware only reads .nextUrl/.method/.headers. */
function req(
  pathname: string,
  { method = "GET", auth }: { method?: string; auth?: string } = {}
) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  return {
    nextUrl: new URL(`http://localhost:3000${pathname}`),
    url: `http://localhost:3000${pathname}`,
    method,
    headers,
  } as never;
}

const VERIFIED_SESSION = {
  user: { sub: "auth0|cookie", email_verified: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  auth0Middleware.mockResolvedValue(NextResponse.next());
  bearerGate.mockResolvedValue({ status: "no-credential" });
  getSession.mockResolvedValue(VERIFIED_SESSION);
  writeRateLimitResponse.mockReturnValue(null);
});

describe("middleware — public routes", () => {
  // The cron routes authenticate with `Authorization: Bearer $CRON_SECRET`,
  // which is NOT an Auth0 token. If the bearer gate ran before the public-route
  // check it would try to verify that secret as a JWT, fail, and 401 every
  // scheduled job.
  it("does not reach the bearer gate or the limiter for /api/cron", async () => {
    await middleware(req("/api/cron/reconcile-billing", { method: "POST", auth: "Bearer cron-secret" }));

    expect(bearerGate).not.toHaveBeenCalled();
    expect(writeRateLimitResponse).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it.each(["/", "/og", "/logo", "/api/webhooks/stripe"])(
    "leaves %s public — no gate, no budget",
    async (pathname) => {
      await middleware(req(pathname, { method: "POST" }));

      expect(bearerGate).not.toHaveBeenCalled();
      expect(writeRateLimitResponse).not.toHaveBeenCalled();
      expect(getSession).not.toHaveBeenCalled();
    }
  );
});

describe("middleware — bearer credential path", () => {
  beforeEach(() => {
    bearerGate.mockResolvedValue({ status: "allow", subject: "auth0|native" });
  });

  it("spends the write budget under the token's own subject", async () => {
    await middleware(req("/api/quotes", { method: "POST", auth: "Bearer t" }));

    expect(writeRateLimitResponse).toHaveBeenCalledTimes(1);
    expect(writeRateLimitResponse).toHaveBeenCalledWith("POST", "/api/quotes", "auth0|native");
  });

  // If the bearer branch moved below getSession, a native client with no cookie
  // would get the login redirect instead of being served.
  it("runs before the session is ever read", async () => {
    await middleware(req("/api/quotes", { method: "POST", auth: "Bearer t" }));

    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns the limiter's 429 instead of serving the request", async () => {
    const tooMany = NextResponse.json({ code: "RATE_LIMIT_EXCEEDED" }, { status: 429 });
    writeRateLimitResponse.mockReturnValue(tooMany);

    const res = await middleware(req("/api/quotes", { method: "POST", auth: "Bearer t" }));

    expect(res).toBe(tooMany);
    expect(res.status).toBe(429);
  });

  it("returns a denial from the gate without spending budget", async () => {
    const denied = NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
    bearerGate.mockResolvedValue({ status: "deny", response: denied });

    const res = await middleware(req("/api/quotes", { method: "POST", auth: "Bearer bad" }));

    expect(res).toBe(denied);
    expect(writeRateLimitResponse).not.toHaveBeenCalled();
  });
});

describe("middleware — cookie credential path", () => {
  it("spends the write budget under the session subject", async () => {
    await middleware(req("/api/quotes", { method: "POST" }));

    expect(writeRateLimitResponse).toHaveBeenCalledTimes(1);
    expect(writeRateLimitResponse).toHaveBeenCalledWith("POST", "/api/quotes", "auth0|cookie");
  });

  it("returns the limiter's 429 instead of serving the request", async () => {
    const tooMany = NextResponse.json({ code: "RATE_LIMIT_EXCEEDED" }, { status: 429 });
    writeRateLimitResponse.mockReturnValue(tooMany);

    const res = await middleware(req("/api/quotes", { method: "POST" }));

    expect(res).toBe(tooMany);
    expect(res.status).toBe(429);
  });

  // The limiter owns the read/write decision (lib/api-rate-limit.ts), so
  // middleware hands it every API method rather than pre-filtering — one place
  // decides what counts as a write.
  it("consults the limiter on reads too, and lets them through", async () => {
    await middleware(req("/api/quotes", { method: "GET" }));

    expect(writeRateLimitResponse).toHaveBeenCalledWith("GET", "/api/quotes", "auth0|cookie");
  });

  it("does not spend budget on page routes", async () => {
    await middleware(req("/dashboard"));

    expect(writeRateLimitResponse).not.toHaveBeenCalled();
  });

  it("does not spend budget when there is no session", async () => {
    getSession.mockResolvedValue(null);

    const res = await middleware(req("/api/quotes", { method: "POST" }));

    expect(res.status).toBe(401);
    expect(writeRateLimitResponse).not.toHaveBeenCalled();
  });

  // The verification gate sits above the limiter, so a write that will be 403'd
  // never consumes budget. Asserted so the ordering is a decision on record
  // rather than an accident of line order.
  it("does not spend budget on an unverified session", async () => {
    getSession.mockResolvedValue({ user: { sub: "auth0|cookie", email_verified: false } });

    const res = await middleware(req("/api/quotes", { method: "POST" }));

    expect(res.status).toBe(403);
    expect(writeRateLimitResponse).not.toHaveBeenCalled();
  });
});
