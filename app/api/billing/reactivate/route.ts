/**
 * POST /api/billing/reactivate — undo a pending cancellation before the
 * period end. Clears the Stripe subscription's cancel_at_period_end; the
 * webhook syncs our DB flags. Tier is NOT changed here (webhook remains
 * the sole writer).
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, getActiveSubscription } from "@/lib/stripe";
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

    await getStripe().subscriptions.update(sub.id, { cancel_at_period_end: false });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Billing reactivate error", {
      err: error,
      route: "POST /api/billing/reactivate",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Could not reactivate subscription", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
