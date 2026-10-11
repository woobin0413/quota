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

  // `code` is asserted, not just the status: native clients branch on it, and
  // it is the field that makes a middleware rejection indistinguishable from a
  // route-handler one.
  it("401s an invalid token with the UNAUTHORIZED code", async () => {
    verifyBearerToken.mockResolvedValue(null);
    const res = denied(await bearerGate("/api/quotes", "Bearer bad"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  // A token on a page route means a misconfigured client, not a session. Serving
  // HTML would hand a native client a login redirect it cannot follow.
  it("401s a valid token aimed at a page route with the UNAUTHORIZED code", async () => {
    verifyBearerToken.mockResolvedValue(VERIFIED);
    const res = denied(await bearerGate("/dashboard", "Bearer good"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: "UNAUTHORIZED" });
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
