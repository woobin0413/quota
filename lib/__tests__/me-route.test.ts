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
      quotesUsed: 4,
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

  // Repo convention: a thrown error still answers JSON with a `code`, so the
  // client has something to branch on instead of Next's HTML 500 page.
  it("answers a DB failure with a JSON 500", async () => {
    getCurrentUser.mockResolvedValue(USER);
    countUserQuotesThisMonth.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("INTERNAL_ERROR");
  });
});
