/**
 * Subscription tier policy — the single source of truth for quote limits
 * and the upgrade ladder. Quote count is the only limiter; every tier gets
 * every feature. Limits are metered per calendar month (UTC), enforced as a
 * live count of a user's quotes created in the current month.
 */

import type { SubscriptionTier } from "@/types/database";

export type Tier = SubscriptionTier;

export const TIERS: Tier[] = ["free", "pro", "ultimate"];

export const QUOTE_LIMIT: Record<Tier, number> = {
  free: 3,
  pro: 15,
  ultimate: Infinity,
};

/** When the month's cap resets — quotes are metered per calendar month (UTC). */
export const QUOTA_RESET_NOTE = "Your quota resets on the 1st of next month.";

export const TIER_LABEL: Record<Tier, string> = {
  free: "Free",
  pro: "Pro",
  ultimate: "Ultimate",
};

export const TIER_PRICE: Record<Tier, string> = {
  free: "$0",
  pro: "$15",
  ultimate: "$29",
};

/**
 * Tiers not yet purchasable because a headline feature hasn't shipped.
 * Ultimate has no differentiator on the web app today — voice to invoice
 * moved to the native mobile app, a separate project — so it stays "coming
 * soon" in the UI with its upgrade CTA hidden until something replaces it.
 * (UI-only — existing Ultimate subs are unaffected.)
 */
export const UNAVAILABLE_TIERS: readonly Tier[] = ["ultimate"];

export function isTierAvailable(tier: Tier): boolean {
  return !UNAVAILABLE_TIERS.includes(tier);
}

/** The next tier up the ladder (raises the quote ceiling); null at the top. */
export function nextTier(tier: Tier): Tier | null {
  const i = TIERS.indexOf(tier);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
}

/**
 * The next tier a user can actually buy — skips tiers gated as "coming soon".
 * Null while nothing above the current plan is purchasable (Pro today, since
 * Ultimate is unavailable). Every upgrade CTA must derive from this, not from
 * `nextTier`, or we advertise a plan the UI then refuses to sell.
 */
export function nextAvailableTier(tier: Tier): Tier | null {
  const i = TIERS.indexOf(tier);
  if (i < 0) return null;
  return TIERS.slice(i + 1).find(isTierAvailable) ?? null;
}

/** Hint shown on disabled "New Quote" controls when the month's cap is hit. */
export function noQuotesLeftTitle(tier: Tier): string {
  return nextAvailableTier(tier)
    ? "No quotes left this month — upgrade your plan to create more."
    : `No quotes left this month — ${QUOTA_RESET_NOTE.toLowerCase()}`;
}

/**
 * Coerce a stored tier to a known one, falling back to the cheapest plan.
 *
 * `users.subscription_tier` is a nullable VARCHAR typed as `Tier` on the way
 * out, so the compiler guarantees nothing about what is actually in the row.
 * A CHECK constraint keeps non-null values within TIERS, but it accepts NULL
 * (`NULL IN (...)` is NULL, not false), and it would not survive a future tier
 * rename any better than the last one did.
 *
 * Indexing QUOTE_LIMIT with an unrecognized value yields `undefined`, which
 * reads as "not finite" — i.e. unlimited — so every metered or gated path must
 * normalize first or it fails open and gives the product away.
 */
export function resolveTier(value: unknown): Tier {
  return TIERS.includes(value as Tier) ? (value as Tier) : "free";
}

/** Human label for a tier's quote ceiling. */
export function quoteLimitLabel(tier: Tier): string {
  const n = QUOTE_LIMIT[tier];
  return Number.isFinite(n) ? String(n) : "Unlimited";
}
