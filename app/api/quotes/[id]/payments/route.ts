/**
 * Payments Route
 *
 * GET  /api/quotes/[id]/payments - Recorded payments (newest first)
 * POST /api/quotes/[id]/payments - Record a payment against a milestone
 *
 * @module api/quotes/payments
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { getQuote } from "@/lib/db/quotes";
import { getPayments, recordPayment } from "@/lib/db/payments";
import { NotFoundError } from "@/types/database";
import { logger } from "@/lib/logger";

const postSchema = z.object({
  milestoneId: z.string().uuid(),
  amount: z.number().gt(0).max(99999999),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  method: z.enum(["cash", "check", "zelle", "other"]).optional(),
  note: z.string().max(500).optional(),
});

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
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

    const quote = await getQuote(params.id, user.id);
    if (!quote) {
      return NextResponse.json(
        { success: false, message: "Quote not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      payments: await getPayments(params.id, user.id),
    });
  } catch (error) {
    logger.error("Payments load error", {
      err: error,
      route: "GET /api/quotes/[id]/payments",
      userId,
      quoteId: params.id,
    });
    return NextResponse.json(
      { success: false, message: "Failed to load payments", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
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

    const parsed = await parseJsonBody(request, postSchema);
    if (parsed.response) return parsed.response;

    const quote = await getQuote(params.id, user.id);
    if (!quote) {
      return NextResponse.json(
        { success: false, message: "Quote not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const payment = await recordPayment(params.id, user.id, parsed.data);
    return NextResponse.json({ success: true, payment }, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    logger.error("Payment record error", {
      err: error,
      route: "POST /api/quotes/[id]/payments",
      userId,
      quoteId: params.id,
    });
    return NextResponse.json(
      { success: false, message: "Failed to record payment", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
