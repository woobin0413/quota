/**
 * POST /api/quotes delegates quota enforcement and the entire create workflow
 * to one atomic database operation. These tests pin the HTTP contract around
 * that boundary, including the additive exact-client-id field.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const createQuoteAtomic = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/db/quotes", () => ({
  createQuoteAtomic: (...args: unknown[]) => createQuoteAtomic(...args),
  getUserQuotes: vi.fn(),
  getQuoteStats: vi.fn(),
}));

import { POST as quotesPOST } from "@/app/api/quotes/route";

function reqWith(body: unknown) {
  return new Request("http://localhost/api/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const clientId = "11111111-1111-4111-8111-111111111111";
const validBody = {
  clientId,
  clientInfo: { name: "Ramirez Residence", email: "j@ramirez.test" },
  lineItems: [{ description: "Copper repipe", quantity: 1, unitPrice: 4600 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: "free" });
  createQuoteAtomic.mockResolvedValue({
    kind: "created",
    quote: { id: "q1", quote_number: "Q-2026-001" },
  });
});

describe("POST /api/quotes — atomic creation", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await quotesPOST(reqWith(validBody));

    expect(res.status).toBe(401);
    expect(createQuoteAtomic).not.toHaveBeenCalled();
  });

  it("passes the selected owned client id into the atomic operation", async () => {
    const res = await quotesPOST(reqWith(validBody));

    expect(res.status).toBe(201);
    expect(createQuoteAtomic).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        clientId,
        clientInfo: expect.objectContaining({ name: "Ramirez Residence" }),
      })
    );
  });

  it.each([
    ["free", 3],
    ["pro", 15],
  ])(
    "preserves the existing 403 QUOTE_LIMIT response for %s",
    async (tier, limit) => {
      createQuoteAtomic.mockResolvedValue({
        kind: "quotaExceeded",
        tier,
        limit,
      });

      const res = await quotesPOST(reqWith(validBody));
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toMatchObject({
        success: false,
        code: "QUOTE_LIMIT",
        tier,
        limit,
      });
    }
  );

  it("returns the created quote from the atomic operation", async () => {
    const res = await quotesPOST(
      reqWith({ ...validBody, clientId: undefined })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      success: true,
      id: "q1",
      quoteNumber: "Q-2026-001",
    });
  });
});
