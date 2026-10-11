/**
 * Stripe Webhook Handler — POST /api/webhooks/stripe
 *
 * Signature-verified against the RAW request body. This route (via
 * processStripeEvent) is the only production writer of paid tiers.
 *
 * Setup:
 * - Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
 *   → copy the printed whsec_… into STRIPE_WEBHOOK_SECRET.
 * - Prod: Dashboard → Developers → Webhooks → add endpoint for
 *   checkout.session.completed, customer.subscription.updated,
 *   customer.subscription.deleted.
 *
 * Responses: 400 bad signature/missing webhook secret · 200 processed or
 * ignored · 500 misconfigured Stripe key or handler error (Stripe retries).
 */

import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { processStripeEvent } from "@/lib/stripe-webhook";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("Stripe webhook: STRIPE_WEBHOOK_SECRET not configured", {
      route: "POST /api/webhooks/stripe",
    });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch (error) {
    logger.error("Stripe webhook: STRIPE_SECRET_KEY not configured", {
      err: error,
      route: "POST /api/webhooks/stripe",
    });
    return NextResponse.json({ error: "Webhook misconfigured" }, { status: 500 });
  }

  // Raw body BEFORE any JSON parsing — required for signature verification.
  const rawBody = await request.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    logger.warn("Stripe webhook: signature verification failed", {
      err: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    await processStripeEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error("Stripe webhook: handler error", {
      err: error,
      eventType: event.type,
      eventId: event.id,
    });
    // 500 → Stripe retries; their retry schedule is the recovery mechanism.
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }
}
