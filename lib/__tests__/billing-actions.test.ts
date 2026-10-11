/**
 * Tests for the billing action routes: cancel / reactivate.
 *
 * The routes only talk to Stripe (cancel_at_period_end flag); DB sync is
 * the webhook's job, so no DB writes are asserted here — only the Stripe
 * calls and HTTP contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const checkRateLimit = vi.fn((..._a: unknown[]) => ({ allowed: true, remaining: 9, resetTime: 0 }));
const getActiveSubscription = vi.fn();
const subscriptionsUpdate = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/stripe", () => ({
  getActiveSubscription: (...a: unknown[]) => getActiveSubscription(...a),
  releaseSubscriptionSchedule: vi.fn(async () => {}),
  getStripe: () => ({ subscriptions: { update: (...a: unknown[]) => subscriptionsUpdate(...a) } }),
}));

import { POST as cancelPOST } from "@/app/api/billing/cancel/route";
import { POST as reactivatePOST } from "@/app/api/billing/reactivate/route";

const authed = { id: "u1", stripe_customer_id: "cus_1" };

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockReturnValue({ allowed: true, remaining: 9, resetTime: 0 });
});

describe("POST /api/billing/cancel", () => {
  it("sets cancel_at_period_end on the active sub", async () => {
    getCurrentUser.mockResolvedValue(authed);
    getActiveSubscription.mockResolvedValue({ id: "sub_1", current_period_end: 1790000000 });
    subscriptionsUpdate.mockResolvedValue({});
    const res = await cancelPOST();
    const body = await res.json();
    expect(subscriptionsUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Note: the confirmation email is sent by the Stripe webhook (sole
    // sender), not by this route — covered in stripe-webhook.test.ts.
  });

  it("400 when there is no active subscription", async () => {
    getCurrentUser.mockResolvedValue(authed);
    getActiveSubscription.mockResolvedValue(null);
    const res = await cancelPOST();
    expect(res.status).toBe(400);
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await cancelPOST();
    expect(res.status).toBe(401);
  });
});

describe("POST /api/billing/reactivate", () => {
  it("clears cancel_at_period_end", async () => {
    getCurrentUser.mockResolvedValue(authed);
    getActiveSubscription.mockResolvedValue({ id: "sub_1" });
    subscriptionsUpdate.mockResolvedValue({});
    const res = await reactivatePOST();
    expect(subscriptionsUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: false });
    expect(res.status).toBe(200);
  });
});
