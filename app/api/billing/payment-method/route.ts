/**
 * POST /api/billing/payment-method { setupIntentId } — after Elements
 * confirms the SetupIntent, make that card the customer's default (and the
 * subscription's, if any). Verifies the intent succeeded and belongs to
 * this customer. Never accepts a raw card number.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { getStripe, getActiveSubscription } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { toCardSummary } from "@/lib/billing/summary";

const bodySchema = z.object({ setupIntentId: z.string().min(1) });

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
    if (!user.stripe_customer_id) {
      return NextResponse.json({ success: false, code: "NO_BILLING_ACCOUNT", message: "No billing account" }, { status: 400 });
    }
    const parsed = await parseJsonBody(request, bodySchema);
    if (parsed.response) return parsed.response;

    const stripe = getStripe();
    const intent = await stripe.setupIntents.retrieve(parsed.data.setupIntentId);
    const intentCustomer = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
    const pmId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
    if (intent.status !== "succeeded" || intentCustomer !== user.stripe_customer_id || !pmId) {
      return NextResponse.json({ success: false, code: "SETUP_NOT_COMPLETE", message: "Card setup did not complete" }, { status: 400 });
    }

    await stripe.customers.update(user.stripe_customer_id, {
      invoice_settings: { default_payment_method: pmId },
    });
    const sub = await getActiveSubscription(user.stripe_customer_id);
    if (sub) {
      await stripe.subscriptions.update(sub.id, { default_payment_method: pmId });
    }

    const pm = (await stripe.paymentMethods.retrieve(pmId)) as Stripe.PaymentMethod;
    return NextResponse.json({ success: true, paymentMethod: toCardSummary(pm) });
  } catch (error) {
    logger.error("Billing payment-method error", { err: error, route: "POST /api/billing/payment-method", userId });
    return NextResponse.json({ success: false, code: "INTERNAL_ERROR", message: "Could not save card" }, { status: 500 });
  }
}
