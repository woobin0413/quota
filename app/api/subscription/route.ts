/**
 * Subscription Route
 *
 * GET   /api/subscription — current tier + quote usage (for badges)
 * PATCH /api/subscription — set tier. Dev/e2e only (ALLOW_DEV_TIER_SWITCH=1);
 *   in production, plan changes come from the Stripe webhook
 *   (see setTierFromBilling).
 *
 * @module api/subscription
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { countUserQuotesThisMonth, updateSubscription } from "@/lib/db/users";
import { QUOTE_LIMIT, TIER_LABEL, resolveTier } from "@/lib/subscription";
import { logger } from "@/lib/logger";

function unauthorized() {
  return NextResponse.json(
    { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
    { status: 401 }
  );
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const tier = resolveTier(user.subscription_tier);
    const limit = QUOTE_LIMIT[tier];
    const quotesUsed = await countUserQuotesThisMonth(user.id);

    return NextResponse.json({
      success: true,
      tier,
      tierLabel: TIER_LABEL[tier],
      quotesUsed,
      quoteLimit: Number.isFinite(limit) ? limit : null,
      quotesRemaining: Number.isFinite(limit) ? Math.max(0, limit - quotesUsed) : null,
      cancelAtPeriodEnd: user.cancel_at_period_end,
      currentPeriodEnd: user.current_period_end,
    });
  } catch (error) {
    logger.error("Subscription GET error", { err: error, route: "GET /api/subscription" });
    return NextResponse.json(
      { success: false, message: "Failed to load plan", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({ tier: z.enum(["free", "pro", "ultimate"]) });

export async function PATCH(request: NextRequest) {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    userId = user.id;

    // Billing gate: outside dev/e2e, plan changes go through Stripe only.
    if (process.env.ALLOW_DEV_TIER_SWITCH !== "1" || process.env.VERCEL_ENV === "production" || (process.env.NODE_ENV === "production" && (process.env.QUOTA_LOCAL_E2E !== "1" || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(process.env.APP_BASE_URL ?? "")))) {
      return NextResponse.json(
        {
          success: false,
          code: "BILLING_REQUIRED",
          message: "Plan changes go through billing.",
        },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, patchSchema);
    if (parsed.response) return parsed.response;

    await updateSubscription(user.id, parsed.data.tier);
    return NextResponse.json({ success: true, tier: parsed.data.tier });
  } catch (error) {
    logger.error("Subscription PATCH error", {
      err: error,
      route: "PATCH /api/subscription",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to update plan", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
