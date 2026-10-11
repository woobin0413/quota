/**
 * Stripe client + price↔tier mapping.
 *
 * All env reads are lazy (call time, not import time) so builds and unit
 * tests without Stripe keys never crash. The client is a per-process
 * singleton pinned to one API version.
 */

import Stripe from "stripe";

export type PaidTier = "pro" | "ultimate";

let stripeSingleton: Stripe | null = null;

/** Lazy Stripe client. Throws if STRIPE_SECRET_KEY is not configured. */
export function getStripe(): Stripe {
  if (!stripeSingleton) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeSingleton = new Stripe(key, { apiVersion: "2023-10-16" });
  }
  return stripeSingleton;
}

/** Price IDs per paid tier, read from env at call time. */
export function PRICE_BY_TIER(): Record<PaidTier, string> {
  return {
    pro: process.env.STRIPE_PRICE_PRO ?? "",
    ultimate: process.env.STRIPE_PRICE_ULTIMATE ?? "",
  };
}

/** Reverse lookup: Stripe price id → paid tier (null if unknown). */
export function tierByPriceId(priceId: string): PaidTier | null {
  const prices = PRICE_BY_TIER();
  if (priceId && priceId === prices.pro) return "pro";
  if (priceId && priceId === prices.ultimate) return "ultimate";
  return null;
}

/** Subscription statuses that represent a live plan the user still holds. */
const LIVE_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
]);

/**
 * The customer's current live subscription, or null. Fetches recent subs
 * (including canceled) and returns the first live one, so a stale canceled
 * subscription is never mistaken for the active plan. Shared by
 * cancel/reactivate/change-plan/summary.
 */
export async function getActiveSubscription(
  customerId: string
): Promise<Stripe.Subscription | null> {
  const subs = await getStripe().subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });
  return subs.data.find((s) => LIVE_STATUSES.has(s.status)) ?? null;
}

/**
 * Release any subscription schedule controlling this subscription (e.g. a
 * pending downgrade) so a direct update — cancel, reactivate, or immediate
 * upgrade — isn't rejected by Stripe and the scheduled switch doesn't still
 * fire after the user changed their mind. No-op when there is no schedule.
 */
export async function releaseSubscriptionSchedule(
  sub: Stripe.Subscription
): Promise<void> {
  if (!sub.schedule) return;
  const scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
  await getStripe().subscriptionSchedules.release(scheduleId);
}
