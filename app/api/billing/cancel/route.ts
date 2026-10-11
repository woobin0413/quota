/**
 * POST /api/billing/cancel — schedule cancellation at period end.
 * Flips the Stripe subscription's cancel_at_period_end; the webhook syncs
 * our DB flags. Access continues until current_period_end. Tier is NOT
 * changed here (webhook remains the sole writer).
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, getActiveSubscription, releaseSubscriptionSchedule } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function POST() {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    userId = user.id;

    const rate = await checkRateLimit(`billing:${user.id}`, { maxRequests: 10 });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." },
        { status: 429 }
      );
    }

    if (!user.stripe_customer_id) {
      return NextResponse.json(
        { success: false, message: "No billing account", code: "NO_BILLING_ACCOUNT" },
        { status: 400 }
      );
    }

    const sub = await getActiveSubscription(user.stripe_customer_id);
    if (!sub) {
      return NextResponse.json(
        { success: false, message: "No active subscription", code: "NO_ACTIVE_SUBSCRIPTION" },
        { status: 400 }
      );
    }

    // Release a pending downgrade schedule first — a scheduled sub can't be
    // updated directly.
    await releaseSubscriptionSchedule(sub);
    await getStripe().subscriptions.update(sub.id, { cancel_at_period_end: true });
    // Confirmation email is sent by the Stripe webhook (sole sender) when it
    // observes cancel_at_period_end flip to true — covers dashboard cancels too.

    return NextResponse.json({
      success: true,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
    });
  } catch (error) {
    logger.error("Billing cancel error", { err: error, route: "POST /api/billing/cancel", userId });
    return NextResponse.json(
      { success: false, message: "Could not cancel subscription", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
