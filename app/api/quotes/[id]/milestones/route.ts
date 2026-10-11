/**
 * Milestones Route
 *
 * GET /api/quotes/[id]/milestones - Derived schedule (amounts, paid, status)
 * PUT /api/quotes/[id]/milestones - Replace the schedule (guarded)
 *
 * @module api/quotes/milestones
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { getQuote } from "@/lib/db/quotes";
import {
  ensureDefaultSchedule,
  replaceSchedule,
  getPayments,
} from "@/lib/db/payments";
import { deriveMilestoneViews, validateSchedule } from "@/lib/payment-schedule";
import { logger } from "@/lib/logger";

const putSchema = z.object({
  milestones: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(255),
        percentage: z.number().gt(0).max(100),
        sortOrder: z.number().int().min(0),
      })
    )
    .min(1)
    .max(20),
});

async function loadViews(quoteId: string, userId: string) {
  const quote = await getQuote(quoteId, userId);
  if (!quote) return null;
  const [milestones, payments] = await Promise.all([
    ensureDefaultSchedule(quoteId, userId),
    getPayments(quoteId, userId),
  ]);
  return { quote, milestones, payments };
}

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

    const loaded = await loadViews(params.id, user.id);
    if (!loaded) {
      return NextResponse.json(
        { success: false, message: "Quote not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      milestones: deriveMilestoneViews(
        loaded.milestones,
        loaded.payments,
        loaded.quote.total
      ),
    });
  } catch (error) {
    logger.error("Milestones load error", {
      err: error,
      route: "GET /api/quotes/[id]/milestones",
      userId,
      quoteId: params.id,
    });
    return NextResponse.json(
      { success: false, message: "Failed to load schedule", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
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

    const parsed = await parseJsonBody(request, putSchema);
    if (parsed.response) return parsed.response;

    const loaded = await loadViews(params.id, user.id);
    if (!loaded) {
      return NextResponse.json(
        { success: false, message: "Quote not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const currentViews = deriveMilestoneViews(
      loaded.milestones,
      loaded.payments,
      loaded.quote.total
    );
    const errors = validateSchedule(parsed.data.milestones, currentViews);
    if (errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Schedule is invalid",
          code: "SCHEDULE_INVALID",
          details: errors.map((message) => ({ path: "schedule", message })),
        },
        { status: 422 }
      );
    }

    const updated = await replaceSchedule(params.id, user.id, parsed.data.milestones);
    return NextResponse.json({
      success: true,
      milestones: deriveMilestoneViews(updated, loaded.payments, loaded.quote.total),
    });
  } catch (error) {
    logger.error("Milestones update error", {
      err: error,
      route: "PUT /api/quotes/[id]/milestones",
      userId,
      quoteId: params.id,
    });
    return NextResponse.json(
      { success: false, message: "Failed to update schedule", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
