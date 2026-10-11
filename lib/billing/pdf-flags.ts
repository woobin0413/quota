import type { Tier } from "@/lib/subscription";

/** PDF appearance by tier: paid tiers get their logo and no watermark. */
export function pdfFlagsForTier(tier: Tier): { showLogo: boolean; showBranding: boolean } {
  return { showLogo: tier !== "free", showBranding: tier === "free" };
}
