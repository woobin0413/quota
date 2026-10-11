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
    expect((await res.json()).code).toBe("UNAUTHORIZED");
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
