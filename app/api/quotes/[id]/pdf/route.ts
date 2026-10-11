/**
 * Quote PDF Export Route
 *
 * GET /api/quotes/[id]/pdf - Download the quote as a PDF file.
 * Same document that gets attached to the quote email.
 *
 * @module api/quotes/pdf
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getQuoteWithContact, getQuoteLineItems } from "@/lib/db/quotes";
import { ensureDefaultSchedule, getPayments } from "@/lib/db/payments";
import { deriveMilestoneViews } from "@/lib/payment-schedule";
import { buildQuotePdfPayload, generateQuotePDF } from "@/lib/quote-pdf";
import { formatCurrency } from "@/lib/quote-calculations";
import { logger } from "@/lib/logger";
import { resolveTier } from "@/lib/subscription";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
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

    // Ownership enforced by the user-scoped queries
    const [quote, lineItems] = await Promise.all([
      getQuoteWithContact(params.id, user.id),
      getQuoteLineItems(params.id, user.id),
    ]);

    if (!quote) {
      return NextResponse.json(
        { success: false, message: "Quote not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const { quoteData, companyInfo } = buildQuotePdfPayload(quote, lineItems, user);

    const [milestones, payments] = await Promise.all([
      ensureDefaultSchedule(params.id, user.id),
      getPayments(params.id, user.id),
    ]);
    const scheduleLines = deriveMilestoneViews(milestones, payments, quote.total).map(
      (m) => `${m.name} — ${m.percentage}% — ${formatCurrency(m.amount)}`
    );

    const buffer = await generateQuotePDF(
      quoteData,
      companyInfo,
      quote.quote_number,
      new Date(quote.created_at),
      quote.valid_until ? new Date(quote.valid_until) : undefined,
      scheduleLines,
      undefined,
      resolveTier(user.subscription_tier)
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quote.quote_number}.pdf"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Quote PDF export error", {
      err: error,
      route: "GET /api/quotes/[id]/pdf",
      userId,
      quoteId: params.id,
    });
    return NextResponse.json(
      { success: false, message: "Failed to generate PDF", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
