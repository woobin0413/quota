// lib/__tests__/send-quote-gate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
// Stop the handler before it does real work: make body parsing throw after
// the tier gate would have run. We only assert the gate's behavior.
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));

import { POST as sendQuotePOST } from "@/app/api/send-quote/route";

function reqWith(body: unknown) {
  return new Request("http://localhost/api/send-quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/send-quote — email gate", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await sendQuotePOST(reqWith({}));
    expect(res.status).toBe(401);
  });

  it("403 EMAIL_REQUIRES_PRO for a free user", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: "free" });
    const res = await sendQuotePOST(reqWith({ quoteId: "q1", recipientName: "X", recipientEmail: "x@y.com" }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("EMAIL_REQUIRES_PRO");
  });

  // The gate asks "is this free?", so anything unrecognized must fail closed
  // to Free rather than be waved through on the strength of not matching.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a tier name the product no longer defines", "enterprise"],
  ])("403 EMAIL_REQUIRES_PRO when the tier is %s", async (_label, stored) => {
    getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: stored });
    const res = await sendQuotePOST(reqWith({ quoteId: "q1", recipientName: "X", recipientEmail: "x@y.com" }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("EMAIL_REQUIRES_PRO");
  });
});
