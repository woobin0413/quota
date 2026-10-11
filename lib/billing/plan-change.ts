/**
 * Pure decision logic for a plan change. Maps (current, target) tiers to the
 * billing action to take. No Stripe calls here — the route acts on this.
 */
import type { Tier } from "@/lib/subscription";
import type { PaidTier } from "@/lib/stripe";

export type PlanChange =
  | { kind: "noop" }
  | { kind: "upgrade"; target: PaidTier }
  | { kind: "downgrade"; target: PaidTier }
  | { kind: "cancel" };

const RANK: Record<Tier, number> = { free: 0, pro: 1, ultimate: 2 };

export function planChange(current: Tier, target: Tier): PlanChange {
  if (current === target) return { kind: "noop" };
  if (target === "free") return { kind: "cancel" };
  // target is paid here
  if (RANK[target] > RANK[current]) return { kind: "upgrade", target };
  return { kind: "downgrade", target };
}
