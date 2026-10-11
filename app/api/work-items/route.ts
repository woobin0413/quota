/**
 * Work Items API Route
 *
 * GET  /api/work-items - List the user's work catalog
 * POST /api/work-items - Create a new work item
 *
 * @module api/work-items
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { getWorkItems, createWorkItem } from "@/lib/db/work-items";
import { ValidationError } from "@/types/database";
import { logger } from "@/lib/logger";

const createWorkItemSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().max(2000).optional(),
  unitOfMeasure: z.string().max(50).optional(),
  defaultUnitPrice: z.number().min(0, "Price cannot be negative"),
  category: z.string().max(100).optional(),
  sortOrder: z.number().int().optional(),
});

export async function GET(request: NextRequest) {
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

    const includeInactive =
      request.nextUrl.searchParams.get("includeInactive") === "true";

    const items = await getWorkItems(user.id, { includeInactive });

    return NextResponse.json({ success: true, items });
  } catch (error) {
    logger.error("Work items list error", {
      err: error,
      route: "GET /api/work-items",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to load work items", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    const parsed = await parseJsonBody(request, createWorkItemSchema);
    if (parsed.response) return parsed.response;

    const item = await createWorkItem(user.id, parsed.data);

    return NextResponse.json({ success: true, item }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { success: false, message: error.message, code: "VALIDATION_ERROR" },
        { status: 422 }
      );
    }
    logger.error("Work item create error", {
      err: error,
      route: "POST /api/work-items",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to create work item", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
