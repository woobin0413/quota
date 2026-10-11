/**
 * Quote Update Route
 *
 * PATCH /api/quotes/[id] - Update quote fields (internal notes).
 *
 * @module api/quotes/update
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { updateQuote } from "@/lib/db/quotes";
import { NotFoundError } from "@/types/database";
import { logger } from "@/lib/logger";

const updateQuoteSchema = z
  .object({
    internalNotes: z
      .string()
      .max(5000, "Note is too long")
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  });

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
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

    const parsed = await parseJsonBody(request, updateQuoteSchema);
    if (parsed.response) return parsed.response;

    const quote = await updateQuote(params.id, user.id, {
      internalNotes: parsed.data.internalNotes,
    });

    return NextResponse.json({
      success: true,
      quote: {
        id: quote.id,
        total: quote.total,
        internalNotes: quote.internal_notes,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    logger.error("Quote update error", {
      err: error,
      route: "PATCH /api/quotes/[id]",
      userId,
      quoteId: params.id,
    });
    return NextResponse.json(
      { success: false, message: "Failed to update quote", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
