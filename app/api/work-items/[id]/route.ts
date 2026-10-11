/**
 * Work Item API Route
 *
 * PATCH  /api/work-items/[id] - Update a work item
 * DELETE /api/work-items/[id] - Deactivate a work item (soft delete)
 *
 * @module api/work-items/[id]
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  updateWorkItem,
  setWorkItemActive,
  getWorkItemById,
} from "@/lib/db/work-items";
import { NotFoundError, ValidationError } from "@/types/database";
import { logger } from "@/lib/logger";

const updateWorkItemSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  unitOfMeasure: z.string().max(50).optional(),
  defaultUnitPrice: z.number().min(0).optional(),
  category: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, props: RouteParams) {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON in request body", code: "INVALID_JSON" },
        { status: 400 }
      );
    }

    const validation = updateWorkItemSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Validation failed",
          code: "VALIDATION_ERROR",
          errors: validation.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 422 }
      );
    }

    const item = await updateWorkItem(user.id, params.id, {
      ...validation.data,
      description: validation.data.description ?? undefined,
      category: validation.data.category ?? undefined,
    });

    return NextResponse.json({ success: true, item });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: "Work item not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { success: false, message: error.message, code: "VALIDATION_ERROR" },
        { status: 422 }
      );
    }
    logger.error("Work item update error", {
      err: error,
      route: "PATCH /api/work-items/[id]",
      userId,
      workItemId: params.id,
    });
    return NextResponse.json(
      { success: false, message: "Failed to update work item", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, props: RouteParams) {
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

    const existing = await getWorkItemById(user.id, params.id);

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Work item not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    await setWorkItemActive(user.id, params.id, false);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Work item delete error", {
      err: error,
      route: "DELETE /api/work-items/[id]",
      userId,
      workItemId: params.id,
    });
    return NextResponse.json(
      { success: false, message: "Failed to deactivate work item", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
