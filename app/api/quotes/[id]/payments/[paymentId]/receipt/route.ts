/**
 * Per-Payment Receipt Route
 *
 * POST /api/quotes/[id]/payments/[paymentId]/receipt - Email a receipt for
 * ONE recorded payment, showing that payment plus the running balance.
 * Tracked separately from the whole-quote receipt (quotes.receipt_sent_count).
 *
 * @module api/quotes/payments/receipt
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getQuoteWithContact, getQuoteLineItems } from "@/lib/db/quotes";
import { getPayments, ensureDefaultSchedule, markPaymentReceiptSent } from "@/lib/db/payments";
import { deriveMilestoneViews } from "@/lib/payment-schedule";
import { buildQuotePdfPayload } from "@/lib/quote-pdf";
import { formatCurrency } from "@/lib/quote-calculations";
import { buildPaymentReceiptEmailContent, validateQuoteEmail } from "@/lib/email-content";
import { sendQuoteEmailWithRetry } from "@/lib/email-sender";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { resolveTier } from "@/lib/subscription";

export async function POST(
  _request: Request,
  props: { params: Promise<{ id: string; paymentId: string }> }
) {
  const params = await props.params;
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

    // Same budget as quote sends — receipts are emails too
    const rateLimit = await checkRateLimit(`receipt:${user.id}`);
    if (!rateLimit.allowed) {
      const resetInSeconds = Math.ceil((rateLimit.resetTime - Date.now()) / 1000);
      return NextResponse.json(
        {
          success: false,
          message: `Rate limit exceeded. Try again in ${resetInSeconds} seconds.`,
          code: "RATE_LIMIT_EXCEEDED",
        },
        { status: 429, headers: { "Retry-After": resetInSeconds.toString() } }
      );
    }

    // Email invoicing (incl. payment receipts) is a Pro feature — same gate as
    // /api/send-quote. Free users can record payments, just not email receipts.
    if (resolveTier(user.subscription_tier) === "free") {
      return NextResponse.json(
        {
          success: false,
          code: "EMAIL_REQUIRES_PRO",
          message: "Emailing receipts is a Pro feature. Upgrade to send.",
        },
        { status: 403 }
      );
    }

    const [quote, lineItems, payments] = await Promise.all([
      getQuoteWithContact(params.id, user.id),
      getQuoteLineItems(params.id, user.id),
      getPayments(params.id, user.id),
    ]);

    if (!quote) {
      return NextResponse.json(
        { success: false, message: "Quote not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const payment = payments.find((p) => p.id === params.paymentId);
    if (!payment) {
      return NextResponse.json(
        { success: false, message: "Payment not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const milestones = await ensureDefaultSchedule(params.id, user.id);
    const milestone = milestones.find((m) => m.id === payment.milestone_id);
    const milestoneName = milestone?.name ?? "Payment";

    const scheduleLines = deriveMilestoneViews(milestones, payments, quote.total).map(
      (m) =>
        `${m.name} — ${m.percentage}% — ${formatCurrency(m.amount)}` +
        (m.paidAmount > 0 ? ` — received ${formatCurrency(m.paidAmount)}` : "")
    );

    const recipientEmail = quote.recipient_email || quote.contact?.email;
    if (!recipientEmail) {
      return NextResponse.json(
        {
          success: false,
          message: "No client email on this quote — send the quote first or add an email to the client",
          code: "NO_RECIPIENT",
        },
        { status: 400 }
      );
    }

    const { quoteData, companyInfo } = buildQuotePdfPayload(quote, lineItems, user, {
      recipientEmail,
    });

    const content = buildPaymentReceiptEmailContent(
      quoteData,
      companyInfo,
      quote.quote_number,
      { amount: payment.amount, paidAt: payment.paid_at, milestoneName },
      quote.amount_paid
    );

    // Same pre-send gate as quote emails: figures must reconcile
    const validation = validateQuoteEmail(quoteData, content.subject, content.message, {
      allowTestData: process.env.RESEND_MOCK === "1",
    });
    if (!validation.ok) {
      return NextResponse.json(
        {
          success: false,
          message: `DATA_ERROR: ${validation.errors.join("; ")}`,
          code: "DATA_ERROR",
        },
        { status: 422 }
      );
    }

    const result = await sendQuoteEmailWithRetry(
      {
        quote: quoteData,
        recipientEmail,
        recipientName: quoteData.clientInfo.name,
        companyInfo,
        quoteNumber: quote.quote_number,
        quoteDate: new Date(quote.created_at),
        validUntil: quote.valid_until ? new Date(quote.valid_until) : undefined,
        replyTo: companyInfo.email,
        customSubject: content.subject,
        customMessage: content.message,
        headerLabel: "Payment Receipt",
        tags: ["receipt", "payment-receipt"],
        scheduleLines,
        tier: resolveTier(user.subscription_tier),
        paymentReceipt: {
          amount: payment.amount,
          paidAt: payment.paid_at,
          method: payment.method,
          milestoneName,
          amountPaid: quote.amount_paid,
        },
      },
      3
    );

    if (!result.success) {
      logger.error("Failed to send receipt", {
        err: result.error,
        route: "POST /api/quotes/[id]/payments/[paymentId]/receipt",
        userId,
        quoteId: params.id,
        paymentId: params.paymentId,
        recipientEmail,
      });
      return NextResponse.json(
        {
          success: false,
          message: result.error || "Failed to send receipt",
          code: "EMAIL_SEND_FAILED",
        },
        { status: 500 }
      );
    }

    // Per-payment tracking supersedes the quote-level receipt_sent_count.
    await markPaymentReceiptSent(params.paymentId, user.id);

    return NextResponse.json({
      success: true,
      emailId: result.emailId,
      sentAt: result.sentAt,
      recipientEmail,
    });
  } catch (error) {
    logger.error("Payment receipt send error", {
      err: error,
      route: "POST /api/quotes/[id]/payments/[paymentId]/receipt",
      userId,
      quoteId: params.id,
      paymentId: params.paymentId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to send receipt", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
