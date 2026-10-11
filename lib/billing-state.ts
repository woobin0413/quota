import { getStripe, tierByPriceId } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase";
import type { SubscriptionTier } from "@/types/database";

/** Read the customer's live subscriptions, not the delayed webhook snapshot. */
export async function currentBillingState(customerId: string | null) {
  if (!customerId) return { tier: "free" as SubscriptionTier, status: "canceled", cancelAtPeriodEnd: false, currentPeriodEnd: null as string | null };
  const subscriptions = await getStripe().subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  if (subscriptions.has_more) throw new Error("Incomplete subscription snapshot");
  const sub = subscriptions.data.filter(s => !["canceled", "incomplete_expired"].includes(s.status))
    .sort((a, b) => b.created - a.created)[0];
  if (!sub) return { tier: "free" as SubscriptionTier, status: "canceled", cancelAtPeriodEnd: false, currentPeriodEnd: null as string | null };
  const tier = tierByPriceId(sub.items.data[0]?.price?.id ?? "");
  if (!tier) throw new Error("Unknown billing price");
  const item = sub.items.data[0] as unknown as { current_period_end?: number };
  const end = sub.current_period_end ?? item?.current_period_end;
  return { tier, status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end === true, currentPeriodEnd: end ? new Date(end * 1000).toISOString() : null };
}

export async function applyBillingState(userId: string, customerId: string | null, revision: number, state: Awaited<ReturnType<typeof currentBillingState>>, eventId: string | null = null): Promise<"applied" | "duplicate" | "conflict"> {
  const { data, error } = await supabaseAdmin.rpc("apply_billing_state", {
    p_user_id: userId, p_customer_id: customerId, p_revision: revision, p_tier: state.tier,
    p_status: state.status, p_cancel: state.cancelAtPeriodEnd, p_period_end: state.currentPeriodEnd, p_event_id: eventId,
  });
  if (error || !["applied", "duplicate", "conflict"].includes(data)) throw new Error("Billing synchronization failed");
  return data;
}

/** Optimistic serialization covers the live read AND write. On contention,
 * re-read both the database revision and Stripe rather than reuse an old snapshot. */
export async function syncBillingCustomer(userId: string, customerId: string | null, eventId: string | null = null) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabaseAdmin.rpc("read_billing_revision", { p_user_id: userId, p_customer_id: customerId });
    if (error || data === null || !Number.isSafeInteger(Number(data)) || Number(data) < 0) throw new Error("Billing revision unavailable");
    const state = await currentBillingState(customerId);
    const result = await applyBillingState(userId, customerId, Number(data), state, eventId);
    if (result !== "conflict") return { applied: result === "applied", state };
  }
  throw new Error("Billing synchronization contention; retry required");
}
