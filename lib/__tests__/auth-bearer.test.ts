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
