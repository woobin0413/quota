/**
 * Tests for POST /api/billing/payment-method — the card-ownership + status
 * gate. A SetupIntent that did not succeed, or that belongs to another
 * customer, must be rejected with 400 BEFORE the default card is changed.
 * Only the Stripe contract is asserted (DB sync is the webhook's job).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const checkRateLimit = vi.fn((..._a: unknown[]) => ({ allowed: true, remaining: 9, resetTime: 0 }));
const getActiveSubscription = vi.fn();
const setupIntentsRetrieve = vi.fn();
const customersUpdate = vi.fn();
const subscriptionsUpdate = vi.fn();
const paymentMethodsRetrieve = vi.fn();

let bodyData: { setupIntentId: string } = { setupIntentId: "seti_1" };

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/api-validation", () => ({ parseJsonBody: () => ({ data: bodyData }) }));
vi.mock("@/lib/stripe", () => ({
  getActiveSubscription: (...a: unknown[]) => getActiveSubscription(...a),
  getStripe: () => ({
    setupIntents: { retrieve: (...a: unknown[]) => setupIntentsRetrieve(...a) },
    customers: { update: (...a: unknown[]) => customersUpdate(...a) },
    subscriptions: { update: (...a: unknown[]) => subscriptionsUpdate(...a) },
    paymentMethods: { retrieve: (...a: unknown[]) => paymentMethodsRetrieve(...a) },
  }),
}));

import { POST as paymentMethodPOST } from "@/app/api/billing/payment-method/route";

const authed = { id: "u1", stripe_customer_id: "cus_1" };
const req = {} as never; // parseJsonBody is mocked, so the request is unused

beforeEach(() => {
  vi.clearAllMocks();
  bodyData = { setupIntentId: "seti_1" };
  checkRateLimit.mockReturnValue({ allowed: true, remaining: 9, resetTime: 0 });
  getCurrentUser.mockResolvedValue(authed);
});

describe("POST /api/billing/payment-method — ownership + status gate", () => {
  it("rejects a SetupIntent belonging to another customer (400, no card change)", async () => {
    setupIntentsRetrieve.mockResolvedValue({
      status: "succeeded",
      customer: "cus_ATTACKER",
      payment_method: "pm_x",
    });
    const res = await paymentMethodPOST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("SETUP_NOT_COMPLETE");
    expect(customersUpdate).not.toHaveBeenCalled();
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("rejects an un-succeeded SetupIntent (400, no card change)", async () => {
    setupIntentsRetrieve.mockResolvedValue({
      status: "requires_payment_method",
      customer: "cus_1",
      payment_method: "pm_x",
    });
    const res = await paymentMethodPOST(req);
    expect(res.status).toBe(400);
    expect(customersUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the SetupIntent has no payment method (400)", async () => {
    setupIntentsRetrieve.mockResolvedValue({ status: "succeeded", customer: "cus_1", payment_method: null });
    const res = await paymentMethodPOST(req);
    expect(res.status).toBe(400);
    expect(customersUpdate).not.toHaveBeenCalled();
  });

  it("sets the default card when the intent succeeded and is owned by the caller", async () => {
    setupIntentsRetrieve.mockResolvedValue({ status: "succeeded", customer: "cus_1", payment_method: "pm_ok" });
    getActiveSubscription.mockResolvedValue(null);
    paymentMethodsRetrieve.mockResolvedValue({ card: { brand: "visa", last4: "4242", exp_month: 8, exp_year: 2027 } });
    const res = await paymentMethodPOST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(customersUpdate).toHaveBeenCalledWith("cus_1", {
      invoice_settings: { default_payment_method: "pm_ok" },
    });
  });

  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await paymentMethodPOST(req);
    expect(res.status).toBe(401);
    expect(setupIntentsRetrieve).not.toHaveBeenCalled();
  });
});
