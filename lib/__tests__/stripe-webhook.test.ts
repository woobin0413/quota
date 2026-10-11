import { test, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
const mocks = vi.hoisted(() => ({ user: vi.fn(), link: vi.fn(), state: vi.fn(), apply: vi.fn(), sync: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/db/users", () => ({ getUserByStripeCustomerId: mocks.user, linkStripeCustomer: mocks.link }));
vi.mock("@/lib/billing-state", () => ({ syncBillingCustomer: (...args: unknown[]) => { mocks.sync(...args); return mocks.state().then((state: typeof paid) => mocks.apply().then((applied: boolean) => ({state, applied}))); } }));
vi.mock("@/lib/billing/cancellation-email", () => ({ sendCancellationConfirmation: mocks.email }));
import { processStripeEvent } from "@/lib/stripe-webhook";
const paid = { tier: "ultimate", status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null };
function event(type = "customer.subscription.updated") { return { id: "evt_test", type, data: { object: { id: "sub_old", customer: "cus_test", metadata: { userId: "user_test" }, cancel_at_period_end: false }, previous_attributes: { cancel_at_period_end: false } } } as unknown as Stripe.Event; }
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "user_test" }); mocks.state.mockResolvedValue(paid); mocks.apply.mockResolvedValue(true); });
test("delayed updates and deletion of an old subscription preserve the live paid state", async () => {
  for (const type of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]) {
    await processStripeEvent(event(type));
    expect(mocks.sync).toHaveBeenLastCalledWith("user_test", "cus_test", "evt_test");
  }
  expect(mocks.email).not.toHaveBeenCalled();
});
test("duplicate or superseded writes send no cancellation email", async () => {
  mocks.state.mockResolvedValue({ ...paid, cancelAtPeriodEnd: true }); mocks.apply.mockResolvedValue(false);
  await processStripeEvent(event()); expect(mocks.email).not.toHaveBeenCalled();
});
test("successful cancellation transition sends a confirmation once", async () => {
  mocks.state.mockResolvedValue({ ...paid, cancelAtPeriodEnd: true });
  await processStripeEvent(event()); expect(mocks.email).toHaveBeenCalledTimes(1);
});
test("provider failures propagate for webhook retry without changing entitlements", async () => {
  mocks.state.mockRejectedValue(new Error("Provider unavailable"));
  await expect(processStripeEvent(event())).rejects.toThrow(); expect(mocks.apply).not.toHaveBeenCalled();
});
test("unknown events are ignored", async () => { await processStripeEvent(event("invoice.finalized")); expect(mocks.state).not.toHaveBeenCalled(); });
