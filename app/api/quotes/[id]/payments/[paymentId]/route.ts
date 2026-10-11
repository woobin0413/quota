/**
 * Payment Route
 *
 * DELETE /api/quotes/[id]/payments/[paymentId] - Remove a mistaken payment.
 * The DB trigger recomputes amount_paid/is_paid.
 *
 * @module api/quotes/payments/payment
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deletePayment } from "@/lib/db/payments";
import { NotFoundError } from "@/types/database";
import { logger } from "@/lib/logger";

export async function DELETE(
  _request: NextRequest,
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

    await deletePayment(params.id, user.id, params.paymentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    logger.error("Payment delete error", {
      err: error,
      route: "DELETE /api/quotes/[id]/payments/[paymentId]",
      userId,
      quoteId: params.id,
      paymentId: params.paymentId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to delete payment", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
