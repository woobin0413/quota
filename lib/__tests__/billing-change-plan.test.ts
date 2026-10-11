/**
 * Tests for POST /api/billing/change-plan — plan transitions.
 *
 * Regression focus: a brand-new free user with NO Stripe customer must be
 * able to start a paid plan. The route returns `needsPaymentMethod` (so the
 * UI collects a card, which creates the customer) instead of hard-failing —
 * and it never creates a subscription before a card exists. Sole-writer
 * invariant: no tier is written here; the webhook syncs the DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const checkRateLimit = vi.fn((..._a: unknown[]) => ({ allowed: true, remaining: 9, resetTime: 0 }));
const getActiveSubscription = vi.fn();
const subscriptionsCreate = vi.fn();
const subscriptionsUpdate = vi.fn();
const customersRetrieve = vi.fn();

let bodyData: { targetTier: "free" | "pro" | "ultimate" } = { targetTier: "pro" };

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/api-validation", () => ({ parseJsonBody: () => ({ data: bodyData }) }));
vi.mock("@/lib/stripe", () => ({
  getActiveSubscription: (...a: unknown[]) => getActiveSubscription(...a),
  releaseSubscriptionSchedule: vi.fn(async () => {}),
  PRICE_BY_TIER: () => ({ pro: "price_pro", ultimate: "price_ultimate" }),
  tierByPriceId: (id: string) => (id === "price_pro" ? "pro" : id === "price_ultimate" ? "ultimate" : null),
  getStripe: () => ({
    subscriptions: {
      create: (...a: unknown[]) => subscriptionsCreate(...a),
      update: (...a: unknown[]) => subscriptionsUpdate(...a),
    },
    customers: { retrieve: (...a: unknown[]) => customersRetrieve(...a) },
  }),
}));

import { POST as changePlanPOST } from "@/app/api/billing/change-plan/route";

const req = {} as never; // parseJsonBody is mocked, request unused

beforeEach(() => {
  vi.clearAllMocks();
  bodyData = { targetTier: "pro" };
  checkRateLimit.mockReturnValue({ allowed: true, remaining: 9, resetTime: 0 });
});

describe("POST /api/billing/change-plan", () => {
  it("new free user with no Stripe customer → needsPaymentMethod, no subscription created", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", stripe_customer_id: null, subscription_tier: "free" });
    const res = await changePlanPOST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.needsPaymentMethod).toBe(true);
    expect(subscriptionsCreate).not.toHaveBeenCalled();
  });

  it("free user with a customer but no default card → needsPaymentMethod", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", stripe_customer_id: "cus_1", subscription_tier: "free" });
    getActiveSubscription.mockResolvedValue(null);
    customersRetrieve.mockResolvedValue({ invoice_settings: { default_payment_method: null } });
    const res = await changePlanPOST(req);
    const body = await res.json();
    expect(body.needsPaymentMethod).toBe(true);
    expect(subscriptionsCreate).not.toHaveBeenCalled();
  });

  it("free user with a card on file → creates the subscription", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", stripe_customer_id: "cus_1", subscription_tier: "free" });
    getActiveSubscription.mockResolvedValue(null);
    customersRetrieve.mockResolvedValue({ invoice_settings: { default_payment_method: "pm_1" } });
    subscriptionsCreate.mockResolvedValue({ id: "sub_new" });
    const res = await changePlanPOST(req);
    const body = await res.json();
    expect(body.applied).toBe("upgrade");
    expect(subscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", items: [{ price: "price_pro" }] })
    );
  });

  // A "coming soon" tier must not be purchasable through a stale page or a
  // direct POST — no subscription, no charge.
  it("upgrade to an unavailable tier → 400 TIER_UNAVAILABLE, nothing created", async () => {
    bodyData = { targetTier: "ultimate" };
    getCurrentUser.mockResolvedValue({ id: "u1", stripe_customer_id: "cus_1", subscription_tier: "pro" });
    getActiveSubscription.mockResolvedValue({
      id: "sub_1",
      items: { data: [{ id: "si_1", price: { id: "price_pro" } }] },
      schedule: null,
    });
    const res = await changePlanPOST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("TIER_UNAVAILABLE");
    expect(subscriptionsCreate).not.toHaveBeenCalled();
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  // Existing subscribers aren't punished by the gate: no-op and downgrade paths
  // stay open for a tier that's merely unpurchasable for new buyers.
  it("existing Ultimate sub targeting Ultimate → noop, not blocked", async () => {
    bodyData = { targetTier: "ultimate" };
    getCurrentUser.mockResolvedValue({ id: "u1", stripe_customer_id: "cus_1", subscription_tier: "ultimate" });
    getActiveSubscription.mockResolvedValue({
      id: "sub_1",
      items: { data: [{ id: "si_1", price: { id: "price_ultimate" } }] },
      schedule: null,
    });
    const res = await changePlanPOST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.applied).toBe("noop");
  });

  it("cancel with no customer → 400 NO_ACTIVE_SUBSCRIPTION", async () => {
    bodyData = { targetTier: "free" };
    getCurrentUser.mockResolvedValue({ id: "u1", stripe_customer_id: null, subscription_tier: "pro" });
    const res = await changePlanPOST(req);
    expect(res.status).toBe(400);
  });

  // Cancellation guarantee: a paid member who downgrades to Free is NOT
  // charged again — the route flips cancel_at_period_end so Stripe stops
  // renewing. Access continues until period end (tier stays until the
  // subscription.deleted webhook), and no new subscription/charge is created.
  it("paid sub → Free flips cancel_at_period_end (no future charge)", async () => {
    bodyData = { targetTier: "free" };
    getCurrentUser.mockResolvedValue({ id: "u1", stripe_customer_id: "cus_1", subscription_tier: "pro" });
    getActiveSubscription.mockResolvedValue({
      id: "sub_1",
      items: { data: [{ id: "si_1", price: { id: "price_pro" } }] },
      schedule: null,
    });
    subscriptionsUpdate.mockResolvedValue({});
    const res = await changePlanPOST(req);
    const body = await res.json();

    expect(subscriptionsUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(subscriptionsCreate).not.toHaveBeenCalled(); // no new charge
    expect(res.status).toBe(200);
    expect(body.applied).toBe("cancel");
  });
});
