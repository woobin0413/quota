/**
 * Tests for POST /api/quotes/[id]/payments/[paymentId]/receipt — the Pro gate.
 *
 * Emailing a receipt is a paid benefit, gated identically to /api/send-quote
 * (see send-quote-gate.test.ts). Free users may still *record* payments; only
 * the email is withheld. A regression here either leaks a Pro benefit or
 * breaks receipts for paying customers, and neither shows up in the UI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const getQuoteWithContact = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, remaining: 9, resetTime: 0 }),
}));
// Fail loudly if the gate ever lets a free user reach the data layer.
vi.mock("@/lib/db/quotes", () => ({
  getQuoteWithContact: (...a: unknown[]) => getQuoteWithContact(...a),
  getQuoteLineItems: vi.fn(async () => []),
}));
vi.mock("@/lib/db/payments", () => ({
  getPayments: vi.fn(async () => []),
  ensureDefaultSchedule: vi.fn(async () => []),
  markPaymentReceiptSent: vi.fn(async () => {}),
}));

import { POST as receiptPOST } from "@/app/api/quotes/[id]/payments/[paymentId]/receipt/route";

const params = { params: Promise.resolve({ id: "q1", paymentId: "p1" }) };
const req = {} as never; // route ignores the request object

beforeEach(() => {
  vi.clearAllMocks();
  getQuoteWithContact.mockResolvedValue(null);
});

describe("POST /api/quotes/[id]/payments/[paymentId]/receipt — email gate", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await receiptPOST(req, params);
    expect(res.status).toBe(401);
    expect(getQuoteWithContact).not.toHaveBeenCalled();
  });

  it("403 EMAIL_REQUIRES_PRO for a free user", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: "free" });

    const res = await receiptPOST(req, params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("EMAIL_REQUIRES_PRO");
    // The gate must short-circuit before any quote is loaded.
    expect(getQuoteWithContact).not.toHaveBeenCalled();
  });

  // Same fail-closed rule as the quote cap, from the other direction: the gate
  // asks "is this free?", so an unrecognized value must not be waved through
  // as though it were a paid plan.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a tier name the product no longer defines", "enterprise"],
  ])("403 EMAIL_REQUIRES_PRO when the tier is %s", async (_label, stored) => {
    getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: stored });

    const res = await receiptPOST(req, params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("EMAIL_REQUIRES_PRO");
  });

  it.each(["pro", "ultimate"])("lets %s past the gate", async (tier) => {
    getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: tier });

    const res = await receiptPOST(req, params);

    // Past the gate the quote lookup runs and 404s on the stub — the point is
    // that it was reached at all, and with no EMAIL_REQUIRES_PRO.
    expect(getQuoteWithContact).toHaveBeenCalledWith("q1", "u1");
    expect(res.status).not.toBe(403);
  });
});
