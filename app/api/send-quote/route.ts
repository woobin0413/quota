/**
 * Send Quote Email API Route
 *
 * Handles sending quotes via email with PDF attachments.
 * Includes authentication, rate limiting, and delivery tracking.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { z } from "zod";
import { sendQuoteEmailWithRetry } from "@/lib/email-sender";
import { getQuoteWithContact, getQuoteLineItems } from "@/lib/db/quotes";
import { ensureDefaultSchedule, getPayments } from "@/lib/db/payments";
import { deriveMilestoneViews } from "@/lib/payment-schedule";
import { supabaseAdmin } from "@/lib/db/core";
import { isValidEmail, sanitizeEmail } from "@/lib/email-sender";
import { buildQuotePdfPayload } from "@/lib/quote-pdf";
import { formatCurrency } from "@/lib/quote-calculations";
import { validateQuoteEmail } from "@/lib/email-content";
import { generateQuoteEmailSubject } from "@/lib/email-templates";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { resolveTier } from "@/lib/subscription";

// =====================================================
// REQUEST VALIDATION
// =====================================================

const sendQuoteRequestSchema = z.object({
  quoteId: z.string().uuid("Invalid quote ID format"),
  recipientEmail: z
    .string()
    .email("Invalid email address")
    .max(255, "Email address too long"),
  recipientName: z
    .string()
    .min(1, "Recipient name is required")
    .max(255, "Recipient name too long"),
  // quoteViewUrl is deliberately NOT accepted from callers.
  //
  // It renders as the "View Full Quote" button in an email sent from a
  // DKIM-signed, SPF-aligned @sendquota.com address. A caller-supplied
  // destination therefore buys an attacker a domain-aligned phishing message
  // for the price of one Pro subscription — and escaping does not help, since
  // the payload is the link target, not markup.
  //
  // Nothing in the app ever sent it (no client code references it), and the
  // quote page it would point at requires a session the recipient does not
  // have. If a public quote-view page is ever built, derive the URL server-side
  // from the quote id; do not take it from the request.
  contractorName: z.string().max(255).optional(),
  replyTo: z.string().email("Invalid reply-to email").optional(),
  tags: z.array(z.string()).max(10, "Too many tags").optional(),
  subject: z.string().max(200, "Subject too long").optional(),
  message: z.string().max(2000, "Message too long").optional(),
});

type SendQuoteRequest = z.infer<typeof sendQuoteRequestSchema>;

// =====================================================
// API ROUTE HANDLER
// =====================================================

export async function POST(request: NextRequest) {
  let userId: string | undefined;
  try {
    // ============================================
    // 1. AUTHENTICATION
    // ============================================

    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }
    userId = user.id;

    // Email invoicing is a Pro feature. Free users export/download instead.
    if (resolveTier(user.subscription_tier) === "free") {
      return NextResponse.json(
        {
          success: false,
          code: "EMAIL_REQUIRES_PRO",
          message: "Emailing invoices is a Pro feature. Upgrade to send, or download the PDF.",
        },
        { status: 403 }
      );
    }

    // ============================================
    // 2. RATE LIMITING
    // ============================================

    const rateLimit = await checkRateLimit(`send-quote:${user.id}`);

    if (!rateLimit.allowed) {
      const resetInSeconds = Math.ceil((rateLimit.resetTime - Date.now()) / 1000);

      return NextResponse.json(
        {
          success: false,
          error: `Rate limit exceeded. Try again in ${resetInSeconds} seconds.`,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: resetInSeconds,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": "10",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": rateLimit.resetTime.toString(),
            "Retry-After": resetInSeconds.toString(),
          },
        }
      );
    }

    // ============================================
    // 3. REQUEST VALIDATION
    // ============================================

    let body: SendQuoteRequest;

    try {
      const rawBody = await request.json();
      body = sendQuoteRequestSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid request data",
            code: "VALIDATION_ERROR",
            details: error.errors.map((e) => ({
              path: e.path.join("."),
              message: e.message,
            })),
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          code: "INVALID_REQUEST",
        },
        { status: 400 }
      );
    }

    // Sanitize email
    const recipientEmail = sanitizeEmail(body.recipientEmail);

    // Validate email format
    if (!isValidEmail(recipientEmail)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid email address format",
          code: "INVALID_EMAIL",
        },
        { status: 400 }
      );
    }

    // ============================================
    // 4. FETCH & VALIDATE QUOTE
    // ============================================

    // Ownership enforced by the user-scoped queries; both fetches are
    // independent so they run in parallel
    const [quote, lineItems] = await Promise.all([
      getQuoteWithContact(body.quoteId, user.id),
      getQuoteLineItems(body.quoteId, user.id),
    ]);

    if (!quote) {
      return NextResponse.json(
        {
          success: false,
          error: "Quote not found",
          code: "QUOTE_NOT_FOUND",
        },
        { status: 404 }
      );
    }

    // Quotations are only sent before payment; paid quotes use the
    // per-payment receipt route (/api/quotes/[id]/payments/[paymentId]/receipt)
    if (quote.is_paid) {
      return NextResponse.json(
        {
          success: false,
          error: "This quote is already paid — send a receipt instead",
          code: "INVALID_QUOTE_STATUS",
        },
        { status: 409 }
      );
    }

    // ============================================
    // 5. ASSEMBLE EMAIL/PDF PAYLOAD
    // ============================================

    // Shared with the PDF export route (lib/quote-pdf.ts)
    const { quoteData, companyInfo } = buildQuotePdfPayload(quote, lineItems, user, {
      recipientEmail,
      recipientName: body.recipientName,
    });

    const [milestones, payments] = await Promise.all([
      ensureDefaultSchedule(body.quoteId, user.id),
      getPayments(body.quoteId, user.id),
    ]);
    const scheduleLines = deriveMilestoneViews(milestones, payments, quote.total).map(
      (m) => `${m.name} — ${m.percentage}% — ${formatCurrency(m.amount)}`
    );

    // The exact subject that will be sent: contractor's edit or the
    // generated default, newlines stripped (header-injection insurance).
    // Validating this same string means the gate can't be bypassed by
    // omitting the field.
    const effectiveSubject = (
      body.subject?.trim() ||
      generateQuoteEmailSubject(quote.quote_number, companyInfo.name)
    ).replace(/[\r\n]+/g, " ");

    // Pre-send gate: figures must reconcile with the authoritative payload
    // and no test data in the contractor-edited copy (client can't bypass)
    const validation = validateQuoteEmail(
      quoteData,
      effectiveSubject,
      body.message ?? "",
      { allowTestData: process.env.RESEND_MOCK === "1" }
    );
    if (!validation.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `DATA_ERROR: ${validation.errors.join("; ")}`,
          code: "DATA_ERROR",
          details: validation.errors.map((message) => ({ path: "email", message })),
        },
        { status: 422 }
      );
    }

    // ============================================
    // 6. SEND EMAIL WITH RETRY
    // ============================================

    const result = await sendQuoteEmailWithRetry(
      {
        quote: quoteData,
        recipientEmail,
        recipientName: body.recipientName,
        companyInfo,
        quoteNumber: quote.quote_number,
        quoteDate: new Date(quote.created_at),
        validUntil: quote.valid_until ? new Date(quote.valid_until) : undefined,
        contractorName: body.contractorName,
        replyTo: body.replyTo || companyInfo.email,
        tags: body.tags,
        customSubject: effectiveSubject,
        customMessage: body.message,
        scheduleLines,
        tier: resolveTier(user.subscription_tier),
      },
      3 // Max retries
    );

    // ============================================
    // 7. HANDLE RESULT
    // ============================================

    if (!result.success) {
      // Log failure (in production, this would go to your database)
      logger.error("Failed to send quote email", {
        err: result.error,
        route: "POST /api/send-quote",
        quoteId: quote.id,
        userId: user.id,
        recipientEmail,
      });

      return NextResponse.json(
        {
          success: false,
          error: result.error || "Failed to send email",
          code: "EMAIL_SEND_FAILED",
        },
        { status: 500 }
      );
    }

    // Log success (in production, this would go to your database)
    logger.info("Quote email sent successfully", {
      quoteId: quote.id,
      userId: user.id,
      recipientEmail,
      emailId: result.emailId,
      sentAt: result.sentAt,
    });

    // Record send metadata (sending does not change quote status).
    // Atomic DB-side increment — concurrent sends can't lose an update.
    await supabaseAdmin.rpc("record_quote_send", {
      p_quote_id: quote.id,
      p_user_id: user.id,
      p_recipient_email: recipientEmail,
    });

    // ============================================
    // 8. RETURN SUCCESS RESPONSE
    // ============================================

    return NextResponse.json(
      {
        success: true,
        emailId: result.emailId,
        sentAt: result.sentAt,
        deliveryStatus: "sent",
        message: "Quote sent successfully",
      },
      {
        status: 200,
        headers: {
          "X-RateLimit-Limit": "10",
          "X-RateLimit-Remaining": rateLimit.remaining.toString(),
          "X-RateLimit-Reset": rateLimit.resetTime.toString(),
        },
      }
    );
  } catch (error) {
    logger.error("Unexpected error in send-quote API", {
      err: error,
      route: "POST /api/send-quote",
      userId,
    });

    return NextResponse.json(
      {
        success: false,
        error: "An unexpected error occurred",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}

// =====================================================
// RESPONSE TYPES (for reference)
// =====================================================

export interface SendQuoteSuccessResponse {
  success: true;
  emailId: string;
  sentAt: Date;
  deliveryStatus: "sent";
  message: string;
}

export interface SendQuoteErrorResponse {
  success: false;
  error: string;
  code:
    | "UNAUTHORIZED"
    | "USER_NOT_FOUND"
    | "RATE_LIMIT_EXCEEDED"
    | "VALIDATION_ERROR"
    | "INVALID_REQUEST"
    | "INVALID_EMAIL"
    | "DATA_ERROR"
    | "QUOTE_NOT_FOUND"
    | "EMAIL_REQUIRES_PRO"
    | "FORBIDDEN"
    | "INVALID_QUOTE_STATUS"
    | "EMAIL_SEND_FAILED"
    | "INTERNAL_ERROR";
  details?: Array<{ path: string; message: string }>;
  retryAfter?: number;
}
