vi.mock("@/lib/billing-state", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/billing-state")>();
  return { ...original, syncBillingCustomer: async (id: string, customer: string | null) => {
    const state = await original.currentBillingState(customer);
    setTierFromBilling(id, state.tier, state.status, { cancelAtPeriodEnd: state.cancelAtPeriodEnd, currentPeriodEnd: state.currentPeriodEnd });
    return { applied: true, state };
  } };
});
import { describe, it, expect, vi, beforeEach } from "vitest";

const setTierFromBilling = vi.fn();
const getBillingRelevantUsers = vi.fn();
const subscriptionsList = vi.fn();

vi.mock("@/lib/db/users", () => ({
  setTierFromBilling: (...a: unknown[]) => setTierFromBilling(...a),
  getBillingRelevantUsers: (...a: unknown[]) => getBillingRelevantUsers(...a),
}));

vi.mock("@/lib/stripe", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stripe")>();
  return {
    ...mod,
    getStripe: () => ({
      subscriptions: { list: (...a: unknown[]) => subscriptionsList(...a) },
    }),
  };
});

import { reconcileBilling } from "@/lib/billing-reconcile";

function user(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    subscription_tier: "pro",
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    cancel_at_period_end: false,
    current_period_end: null,
    ...over,
  };
}

function sub(priceId: string, over: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: 1790000000,
    items: { data: [{ price: { id: priceId } }] },
    ...over,
  };
}

describe("reconcileBilling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_PRO = "price_pro_test";
    process.env.STRIPE_PRICE_ULTIMATE = "price_ult_test";
  });

  it("no drift still fences stale writes", async () => {
    getBillingRelevantUsers.mockResolvedValue([
      user({ current_period_end: new Date(1790000000 * 1000).toISOString() }),
    ]);
    subscriptionsList.mockResolvedValue({ data: [sub("price_pro_test")] });

    const report = await reconcileBilling();

    expect(setTierFromBilling).toHaveBeenCalledTimes(1);
    expect(report.checked).toBe(1);
    expect(report.drifted).toEqual([]);
  });

  it("no drift when stored period-end is PostgREST format (offset, no ms)", async () => {
    // PostgREST serializes timestamptz as e.g. "2026-09-21T17:33:20+00:00";
    // Stripe-derived value is toISOString() ("2026-09-21T17:33:20.000Z").
    // Same instant → must NOT be treated as drift.
    getBillingRelevantUsers.mockResolvedValue([
      user({
        current_period_end: new Date(1790000000 * 1000)
          .toISOString()
          .replace(".000Z", "+00:00"),
      }),
    ]);
    subscriptionsList.mockResolvedValue({ data: [sub("price_pro_test")] });

    const report = await reconcileBilling();

    expect(setTierFromBilling).toHaveBeenCalledTimes(1);
    expect(report.drifted).toEqual([]);
  });

  it("paid user with no subscription → free", async () => {
    getBillingRelevantUsers.mockResolvedValue([user()]);
    subscriptionsList.mockResolvedValue({ data: [] });

    const report = await reconcileBilling();

    expect(setTierFromBilling).toHaveBeenCalledWith("u1", "free", "canceled", {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    });
    expect(report.drifted).toEqual([{ userId: "u1", from: "pro", to: "free" }]);
  });

  it("free user with active subscription → paid", async () => {
    getBillingRelevantUsers.mockResolvedValue([
      user({ subscription_tier: "free", subscription_status: "canceled" }),
    ]);
    subscriptionsList.mockResolvedValue({ data: [sub("price_ult_test")] });

    await reconcileBilling();

    expect(setTierFromBilling).toHaveBeenCalledWith("u1", "ultimate", "active", {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(1790000000 * 1000).toISOString(),
    });
  });

  it("unknown price → skipped, counted as error, no write", async () => {
    getBillingRelevantUsers.mockResolvedValue([user()]);
    subscriptionsList.mockResolvedValue({ data: [sub("price_mystery")] });

    const report = await reconcileBilling();

    expect(setTierFromBilling).not.toHaveBeenCalled();
    expect(report.errors).toBe(1);
  });

  it("cancel-state drift alone triggers a sync write", async () => {
    getBillingRelevantUsers.mockResolvedValue([
      user({ current_period_end: new Date(1790000000 * 1000).toISOString() }),
    ]);
    subscriptionsList.mockResolvedValue({
      data: [sub("price_pro_test", { cancel_at_period_end: true })],
    });

    await reconcileBilling();

    expect(setTierFromBilling).toHaveBeenCalledWith("u1", "pro", "active", {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(1790000000 * 1000).toISOString(),
    });
  });

  it("user with paid tier but no stripe customer → free", async () => {
    getBillingRelevantUsers.mockResolvedValue([user({ stripe_customer_id: null })]);

    const report = await reconcileBilling();

    expect(subscriptionsList).not.toHaveBeenCalled();
    expect(setTierFromBilling).toHaveBeenCalledWith("u1", "free", "canceled", {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    });
    expect(report.drifted).toEqual([{ userId: "u1", from: "pro", to: "free" }]);
  });
});
