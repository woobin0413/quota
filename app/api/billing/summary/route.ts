/**
 * GET /api/billing/summary — the billing page's header data: plan, period,
 * cancellation/pending-downgrade state, and the default card.
 *
 * The displayed **tier comes from the DB `subscription_tier`** — the same
 * authoritative feature-access tier used by quota limits and the plan chip,
 * written only by the Stripe webhook. Billing DETAILS (period, cancellation,
 * pending downgrade, card) are overlaid live from Stripe when a subscription
 * exists. This keeps the billing page consistent with the rest of the app
 * even when a tier was set outside a live Stripe subscription.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, getActiveSubscription, tierByPriceId } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { resolveTier, TIER_LABEL, TIER_PRICE, type Tier } from "@/lib/subscription";
import { toCardSummary, type BillingSummary } from "@/lib/billing/summary";

/** Summary for a tier with no live Stripe billing details. */
function baseSummary(tier: Tier, paymentMethod: BillingSummary["paymentMethod"] = null): BillingSummary {
  return {
    tier, tierLabel: TIER_LABEL[tier], price: TIER_PRICE[tier],
    status: "none", currentPeriodEnd: null, cancelAtPeriodEnd: false,
    pendingDowngradeTier: null, pendingChangeDate: null, paymentMethod,
  };
}

export async function GET() {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
    }
    userId = user.id;
    const rate = await checkRateLimit(`billing:${user.id}`, { maxRequests: 10 });
    if (!rate.allowed) {
      return NextResponse.json({ success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." }, { status: 429 });
    }
    // Authoritative feature-access tier (DB, webhook-written) — what the
    // billing page displays, matching the plan chip + quota limits.
    const tier = resolveTier(user.subscription_tier);

    if (!user.stripe_customer_id) {
      return NextResponse.json({ success: true, summary: baseSummary(tier) });
    }

    const stripe = getStripe();
    const sub = await getActiveSubscription(user.stripe_customer_id);
    const customer = (await stripe.customers.retrieve(user.stripe_customer_id, {
      expand: ["invoice_settings.default_payment_method"],
    })) as Stripe.Customer;
    const pm = (customer.invoice_settings?.default_payment_method as Stripe.PaymentMethod | null) ?? null;

    if (!sub) {
      return NextResponse.json({ success: true, summary: baseSummary(tier, toCardSummary(pm)) });
    }

    // The live sub's own tier — used only to detect a pending downgrade.
    const currentPrice = sub.items.data[0]?.price?.id ?? "";
    const subTier: Tier = tierByPriceId(currentPrice) ?? tier;

    // Pending downgrade: a subscription schedule whose next phase targets a
    // lower price. Read it live so the DB stays webhook-only.
    let pendingDowngradeTier: Tier | null = null;
    let pendingChangeDate: string | null = null;
    if (sub.schedule) {
      const scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      const nextPhase = schedule.phases.find((p) => (p.start_date ?? 0) > sub.current_period_end - 1);
      const nextPrice = nextPhase?.items?.[0]?.price;
      const nextPriceId = typeof nextPrice === "string" ? nextPrice : nextPrice?.id;
      const nextTier = nextPriceId ? tierByPriceId(nextPriceId) : null;
      if (nextTier && nextTier !== subTier) {
        pendingDowngradeTier = nextTier;
        pendingChangeDate = new Date(sub.current_period_end * 1000).toISOString();
      }
    }

    const summary: BillingSummary = {
      // Live subscription's tier is the billing truth when one exists.
      tier: subTier,
      tierLabel: TIER_LABEL[subTier],
      price: TIER_PRICE[subTier],
      status: sub.status,
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      pendingDowngradeTier,
      pendingChangeDate,
      paymentMethod: toCardSummary(pm),
    };
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    logger.error("Billing summary error", { err: error, route: "GET /api/billing/summary", userId });
    return NextResponse.json({ success: false, code: "INTERNAL_ERROR", message: "Could not load billing" }, { status: 500 });
  }
}
