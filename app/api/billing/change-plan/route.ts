/**
 * POST /api/billing/change-plan { targetTier } — move between plans:
 *  - upgrade: immediate + prorated (create subscription if first paid; a
 *    card is required → needsPaymentMethod when none on file)
 *  - downgrade (ultimate→pro): subscription schedule, switches at period end
 *  - downgrade to free: cancel at period end
 * Upgrades to a tier in UNAVAILABLE_TIERS are rejected 400 TIER_UNAVAILABLE.
 * Never writes tier — the webhook syncs our DB from the resulting Stripe state.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, getActiveSubscription, PRICE_BY_TIER, tierByPriceId, releaseSubscriptionSchedule } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { planChange } from "@/lib/billing/plan-change";
import { isTierAvailable, resolveTier, TIER_LABEL, type Tier } from "@/lib/subscription";

const bodySchema = z.object({ targetTier: z.enum(["free", "pro", "ultimate"]) });

async function customerHasDefaultCard(stripe: Stripe, customerId: string): Promise<boolean> {
  const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
  return Boolean(customer.invoice_settings?.default_payment_method);
}


export async function POST(request: NextRequest) {
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
    const parsed = await parseJsonBody(request, bodySchema);
    if (parsed.response) return parsed.response;

    const stripe = getStripe();
    const customerId = user.stripe_customer_id;
    const prices = PRICE_BY_TIER();

    // Current tier = the live Stripe subscription's tier when one exists
    // (billing reality, robust to webhook lag), else the DB tier. Fetched
    // once and reused below.
    const sub = customerId ? await getActiveSubscription(customerId) : null;
    const dbTier = resolveTier(user.subscription_tier);
    const current: Tier = sub
      ? tierByPriceId(sub.items.data[0]?.price?.id ?? "") ?? dbTier
      : dbTier;
    const decision = planChange(current, parsed.data.targetTier);

    if (decision.kind === "noop") {
      return NextResponse.json({ success: true, applied: "noop" });
    }

    // Never sell a tier the product shows as "coming soon" — a stale page or a
    // direct POST would otherwise start a real subscription for it. Only new
    // purchases are blocked: existing subscribers still noop/downgrade freely.
    if (decision.kind === "upgrade" && !isTierAvailable(decision.target)) {
      return NextResponse.json(
        {
          success: false,
          code: "TIER_UNAVAILABLE",
          message: `${TIER_LABEL[decision.target]} isn't available yet.`,
        },
        { status: 400 }
      );
    }

    if (decision.kind === "upgrade") {
      const newPrice = prices[decision.target];
      if (!newPrice) return NextResponse.json({ success: false, code: "BILLING_NOT_CONFIGURED", message: "Billing not configured" }, { status: 500 });

      if (!sub) {
        // No live subscription yet (first paid). Need a customer + card; the
        // card-setup step creates the customer, then the UI retries.
        if (!customerId || !(await customerHasDefaultCard(stripe, customerId))) {
          return NextResponse.json({ success: true, needsPaymentMethod: true });
        }
        await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: newPrice }],
          payment_behavior: "error_if_incomplete",
        });
        return NextResponse.json({ success: true, applied: "upgrade" });
      }

      // Undo any pending scheduled downgrade before upgrading immediately.
      await releaseSubscriptionSchedule(sub);
      const itemId = sub.items.data[0]?.id;
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: itemId, price: newPrice }],
        proration_behavior: "create_prorations",
      });
      return NextResponse.json({ success: true, applied: "upgrade" });
    }

    // cancel / downgrade both require a live subscription.
    if (!sub) {
      return NextResponse.json({ success: false, code: "NO_ACTIVE_SUBSCRIPTION", message: "No active subscription" }, { status: 400 });
    }

    if (decision.kind === "cancel") {
      await releaseSubscriptionSchedule(sub);
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      // Confirmation email sent by the Stripe webhook (sole sender) on the
      // cancel_at_period_end false→true transition.
      return NextResponse.json({ success: true, applied: "cancel" });
    }

    // decision.kind === "downgrade": schedule the switch at period end.
    const newPrice = prices[decision.target];
    if (!newPrice) return NextResponse.json({ success: false, code: "BILLING_NOT_CONFIGURED", message: "Billing not configured" }, { status: 500 });
    const currentPrice = sub.items.data[0]?.price?.id;

    let scheduleId: string;
    if (sub.schedule) {
      scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
    } else {
      const created = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
      scheduleId = created.id;
    }
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
    const phase0 = schedule.phases[0];
    await stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      phases: [
        { items: [{ price: currentPrice, quantity: 1 }], start_date: phase0.start_date, end_date: phase0.end_date },
        { items: [{ price: newPrice, quantity: 1 }] },
      ],
    });
    return NextResponse.json({ success: true, applied: "downgrade" });
  } catch (error) {
    logger.error("Billing change-plan error", { err: error, route: "POST /api/billing/change-plan", userId });
    return NextResponse.json({ success: false, code: "INTERNAL_ERROR", message: "Could not change plan" }, { status: 500 });
  }
}
