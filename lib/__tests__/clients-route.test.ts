// lib/__tests__/clients-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const getAllContacts = vi.fn();
const getUserQuotes = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/db/contacts", () => ({
  getAllContacts: (...a: unknown[]) => getAllContacts(...a),
}));
vi.mock("@/lib/db/quotes", () => ({
  getUserQuotes: (...a: unknown[]) => getUserQuotes(...a),
}));

import { GET } from "@/app/api/clients/route";

function req(query = "") {
  return new Request(`http://localhost/api/clients${query}`) as never;
}

/** Shape lib/db returns: PaginatedResult<T>. */
function page<T>(data: T[], total: number, limit: number, offset = 0) {
  return { data, total, limit, offset, hasMore: offset + limit < total };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1" });
  getAllContacts.mockResolvedValue(page([{ id: "c1" }], 1, 200));
  getUserQuotes.mockResolvedValue(page([{ id: "q1", contact_id: "c1" }], 1, 500));
});

describe("GET /api/clients", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });

  it("joins each contact's quotes", async () => {
    const body = await (await GET(req())).json();
    expect(body.success).toBe(true);
    expect(body.clients).toEqual([{ id: "c1", quotes: [{ id: "q1", contact_id: "c1" }] }]);
  });

  // The whole point of the fix: the caller must be able to tell a complete list
  // from a truncated one. Before this, 201 contacts returned 200 with no signal.
  it("reports contact pagination so truncation is visible", async () => {
    getAllContacts.mockResolvedValue(page([{ id: "c1" }], 340, 200));
    const body = await (await GET(req())).json();
    expect(body.pagination).toEqual({
      total: 340,
      limit: 200,
      offset: 0,
      hasMore: true,
    });
  });

  it("reports hasMore false when the page covers everything", async () => {
    getAllContacts.mockResolvedValue(page([{ id: "c1" }], 1, 200));
    const body = await (await GET(req())).json();
    expect(body.pagination.hasMore).toBe(false);
  });

  // Quotes are fetched globally and joined in memory, so hitting that cap means
  // some contact's `quotes` array is short — silently wrong without this flag.
  it("flags quotesTruncated when the quote cap was hit", async () => {
    getUserQuotes.mockResolvedValue(page([{ id: "q1", contact_id: "c1" }], 900, 500));
    const body = await (await GET(req())).json();
    expect(body.quotesTruncated).toBe(true);
  });

  it("reports quotesTruncated false when all quotes fit", async () => {
    const body = await (await GET(req())).json();
    expect(body.quotesTruncated).toBe(false);
  });

  it("passes limit and offset through to the contacts query", async () => {
    await GET(req("?limit=50&offset=100"));
    expect(getAllContacts).toHaveBeenCalledWith("u1", { limit: 50, offset: 100 });
  });

  it("defaults to limit 200 offset 0, preserving the previous behaviour", async () => {
    await GET(req());
    expect(getAllContacts).toHaveBeenCalledWith("u1", { limit: 200, offset: 0 });
  });

  it.each([
    ["limit above the cap", "?limit=201"],
    ["limit below one", "?limit=0"],
    ["negative offset", "?offset=-1"],
    ["non-numeric limit", "?limit=abc"],
  ])("400 VALIDATION_ERROR for %s", async (_label, query) => {
    const res = await GET(req(query));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("500 INTERNAL_ERROR when the repository throws", async () => {
    getAllContacts.mockRejectedValue(new Error("db down"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("INTERNAL_ERROR");
  });
});
