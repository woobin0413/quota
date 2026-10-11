/**
 * Resend Webhook Handler
 *
 * Receives delivery status updates from Resend and updates email activity.
 * Handles events: email.sent, email.delivered, email.bounced, email.complained
 *
 * Setup Instructions:
 * 1. Go to Resend Dashboard → Settings → Webhooks
 * 2. Add webhook URL: https://your-domain.com/api/webhooks/resend
 * 3. Select events to listen to
 * 4. Copy the signing secret and add to RESEND_WEBHOOK_SECRET env var
 *
 * Signatures are Svix, not a bare HMAC: Resend delivers `svix-id`,
 * `svix-timestamp`, and `svix-signature`, and signs `${id}.${timestamp}.${body}`
 * with the base64 half of the whsec_ secret. The `svix` SDK is the only
 * supported way to check that — it also enforces the timestamp window that
 * stops a captured request being replayed later.
 */

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { Webhook, WebhookVerificationError } from "svix";
import { updateEmailStatus } from "@/lib/email-sender";
import { logger } from "@/lib/logger";

// =====================================================
// TYPES
// =====================================================

type ResendEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.complained"
  | "email.bounced"
  | "email.opened"
  | "email.clicked";

interface ResendWebhookPayload {
  type: ResendEventType;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    // Event-specific fields
    delivered_at?: string;
    opened_at?: string;
    clicked_at?: string;
    bounce_type?: "hard" | "soft";
    bounce_reason?: string;
    complaint_type?: string;
    delay_reason?: string;
  };
}

// =====================================================
// WEBHOOK SIGNATURE VERIFICATION
// =====================================================

/**
 * Verify a Resend (Svix) webhook signature against the raw request body and
 * return the parsed payload, or null if it doesn't check out.
 *
 * All three svix-* headers are required — `Webhook.verify` rejects the request
 * if any is missing or the timestamp is outside its tolerance window. It also
 * parses the body, so callers get the payload back rather than re-parsing
 * bytes that have already been authenticated.
 */
// Not exported: a Next.js route module may only export its handlers and the
// route config fields, and `next build` fails on anything else.
function verifyWebhookSignature(
  payload: string,
  svixHeaders: Record<string, string | null>,
  secret: string
): ResendWebhookPayload | null {
  try {
    return new Webhook(secret).verify(payload, {
      "svix-id": svixHeaders["svix-id"] ?? "",
      "svix-timestamp": svixHeaders["svix-timestamp"] ?? "",
      "svix-signature": svixHeaders["svix-signature"] ?? "",
    }) as ResendWebhookPayload;
  } catch (error) {
    // A bad signature is an expected, uninteresting event — someone probing the
    // endpoint. Anything else means the secret itself is malformed, which is a
    // misconfiguration worth shouting about.
    if (error instanceof WebhookVerificationError || error instanceof SyntaxError) {
      logger.warn("Resend webhook: rejected unverified request", {
        err: error instanceof Error ? error.message : String(error),
        route: "POST /api/webhooks/resend",
      });
    } else {
      logger.error("Resend webhook: verifier error (bad RESEND_WEBHOOK_SECRET?)", {
        err: error,
        route: "POST /api/webhooks/resend",
      });
    }
    return null;
  }
}

// =====================================================
// EVENT HANDLERS
// =====================================================

async function handleEmailSent(payload: ResendWebhookPayload): Promise<void> {
  const { email_id, created_at } = payload.data;

  await updateEmailStatus(email_id, "sent", {
    deliveredAt: new Date(created_at),
  });

  console.log(`Email sent: ${email_id}`);
}

async function handleEmailDelivered(payload: ResendWebhookPayload): Promise<void> {
  const { email_id, delivered_at } = payload.data;

  await updateEmailStatus(email_id, "delivered", {
    deliveredAt: delivered_at ? new Date(delivered_at) : new Date(),
  });

  console.log(`Email delivered: ${email_id}`);
}

async function handleEmailBounced(payload: ResendWebhookPayload): Promise<void> {
  const { email_id, bounce_type, bounce_reason } = payload.data;

  const failureReason = bounce_reason || `Email bounced (${bounce_type})`;

  await updateEmailStatus(email_id, "bounced", {
    failureReason,
  });

  logger.warn("Email bounced", {
    emailId: email_id,
    bounceType: bounce_type,
    bounceReason: bounce_reason,
  });
}

async function handleEmailComplained(payload: ResendWebhookPayload): Promise<void> {
  const { email_id, complaint_type } = payload.data;

  const failureReason = `Email marked as spam (${complaint_type})`;

  await updateEmailStatus(email_id, "failed", {
    failureReason,
  });

  logger.warn("Email complained", {
    emailId: email_id,
    complaintType: complaint_type,
  });
}

async function handleEmailDelayed(payload: ResendWebhookPayload): Promise<void> {
  const { email_id, delay_reason } = payload.data;

  console.log(`Email delivery delayed: ${email_id}`, {
    delayReason: delay_reason,
  });

  // Keep status as "sent" but log the delay
  // In production, you might want to track this separately
}

async function handleEmailOpened(payload: ResendWebhookPayload): Promise<void> {
  const { email_id, opened_at } = payload.data;

  await updateEmailStatus(email_id, "delivered", {
    openedAt: opened_at ? new Date(opened_at) : new Date(),
  });

  console.log(`Email opened: ${email_id}`);
}

async function handleEmailClicked(payload: ResendWebhookPayload): Promise<void> {
  const { email_id, clicked_at } = payload.data;

  await updateEmailStatus(email_id, "delivered", {
    clickedAt: clicked_at ? new Date(clicked_at) : new Date(),
  });

  console.log(`Email clicked: ${email_id}`);
}

// =====================================================
// API ROUTE HANDLER
// =====================================================

export async function POST(request: NextRequest) {
  try {
    // ============================================
    // 1. VERIFY WEBHOOK SIGNATURE
    // ============================================

    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error("RESEND_WEBHOOK_SECRET not configured", {
        route: "POST /api/webhooks/resend",
      });
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 500 }
      );
    }

    const headersList = await headers();
    // Raw body BEFORE any JSON parsing — re-serialising changes the bytes and
    // breaks the signature.
    const rawBody = await request.text();

    // 2. PARSE PAYLOAD — verify() authenticates and parses in one step, so a
    // malformed body is rejected as unverified rather than reaching a handler.
    const payload = verifyWebhookSignature(
      rawBody,
      {
        "svix-id": headersList.get("svix-id"),
        "svix-timestamp": headersList.get("svix-timestamp"),
        "svix-signature": headersList.get("svix-signature"),
      },
      webhookSecret
    );

    if (!payload) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    if (typeof payload.type !== "string" || typeof payload.data?.email_id !== "string") {
      logger.warn("Resend webhook: verified payload has an unexpected shape", {
        route: "POST /api/webhooks/resend",
      });
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 }
      );
    }

    // ============================================
    // 3. HANDLE EVENT
    // ============================================

    console.log("Received Resend webhook:", {
      type: payload.type,
      emailId: payload.data.email_id,
      createdAt: payload.created_at,
    });

    switch (payload.type) {
      case "email.sent":
        await handleEmailSent(payload);
        break;

      case "email.delivered":
        await handleEmailDelivered(payload);
        break;

      case "email.bounced":
        await handleEmailBounced(payload);
        break;

      case "email.complained":
        await handleEmailComplained(payload);
        break;

      case "email.delivery_delayed":
        await handleEmailDelayed(payload);
        break;

      case "email.opened":
        await handleEmailOpened(payload);
        break;

      case "email.clicked":
        await handleEmailClicked(payload);
        break;

      default:
        console.log("Unhandled webhook event type:", payload.type);
    }

    // ============================================
    // 4. RETURN SUCCESS
    // ============================================

    return NextResponse.json(
      {
        success: true,
        message: "Webhook processed",
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Error processing Resend webhook", {
      err: error,
      route: "POST /api/webhooks/resend",
    });

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}

// =====================================================
// HEALTH CHECK (optional)
// =====================================================

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Resend webhook endpoint is active",
  });
}
