/**
 * POST /api/billing/setup-intent — mint a SetupIntent client secret so the
 * in-app Stripe Elements form can tokenize a card. Ensures a Stripe
 * customer exists first. No card data passes through here.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { linkStripeCustomer } from "@/lib/db/users";
import { logger } from "@/lib/logger";

export async function POST() {
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

    const stripe = getStripe();
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
      customerId = customer.id;
      await linkStripeCustomer(user.id, customerId);
    }

    const intent = await stripe.setupIntents.create({ customer: customerId, payment_method_types: ["card"] });
    return NextResponse.json({ success: true, clientSecret: intent.client_secret });
  } catch (error) {
    logger.error("Billing setup-intent error", { err: error, route: "POST /api/billing/setup-intent", userId });
    return NextResponse.json({ success: false, code: "INTERNAL_ERROR", message: "Could not start card setup" }, { status: 500 });
  }
}
