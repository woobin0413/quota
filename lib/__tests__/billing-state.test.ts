import { test, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ subscriptions: { list: mocks.list } }), tierByPriceId: (id: string) => ({ price_pro: "pro", price_ultimate: "ultimate" }[id]) }));
import { currentBillingState, syncBillingCustomer } from "@/lib/billing-state";
function subscription(price: string) { return { data: [{ status: "active", created: 100, items: { data: [{ price: { id: price } }] } }], has_more: false }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let revision: number; let tier: string; let processed: Set<string>;
beforeEach(() => {
  vi.clearAllMocks(); revision = 0; tier = "ultimate"; processed = new Set();
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === "read_billing_revision") return { data: revision };
    if (args.p_event_id && processed.has(args.p_event_id)) return { data: "duplicate" };
    if (args.p_revision !== revision) return { data: "conflict" };
    revision++; tier = args.p_tier; if (args.p_event_id) processed.add(args.p_event_id);
    return { data: "applied" };
  });
});
test.each(["evt_new", null])("fresh reads survive inverted provider responses, including no-change reconciliation (%s)", async eventId => {
  const stale = deferred<ReturnType<typeof subscription>>();
  mocks.list.mockImplementationOnce(() => stale.promise)
    .mockResolvedValueOnce(subscription("price_ultimate"))
    .mockResolvedValueOnce(subscription("price_ultimate"));
  const oldRequest = syncBillingCustomer("user", "customer", "evt_old");
  await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
  const fresh = await syncBillingCustomer("user", "customer", eventId);
  expect(fresh.state.tier).toBe("ultimate"); expect(revision).toBe(1);
  stale.resolve(subscription("price_pro"));
  const retried = await oldRequest;
  expect(retried.state.tier).toBe("ultimate"); expect(tier).toBe("ultimate");
  expect(mocks.list).toHaveBeenCalledTimes(3); expect(revision).toBe(2);
});
test("duplicate events do not apply twice", async () => {
  mocks.list.mockResolvedValue(subscription("price_pro"));
  expect((await syncBillingCustomer("user", "customer", "evt_repeat")).applied).toBe(true);
  expect((await syncBillingCustomer("user", "customer", "evt_repeat")).applied).toBe(false);
  expect(revision).toBe(1);
});
test("unknown prices, incomplete snapshots and persistent contention fail for retry", async () => {
  mocks.list.mockResolvedValue(subscription("unknown")); await expect(currentBillingState("customer")).rejects.toThrow();
  mocks.list.mockResolvedValue({ ...subscription("price_pro"), has_more: true }); await expect(currentBillingState("customer")).rejects.toThrow();
  mocks.list.mockResolvedValue(subscription("price_pro"));
  mocks.rpc.mockImplementation(async name => ({ data: name === "read_billing_revision" ? 0 : "conflict" }));
  await expect(syncBillingCustomer("user", "customer", "evt")).rejects.toThrow("contention");
});
