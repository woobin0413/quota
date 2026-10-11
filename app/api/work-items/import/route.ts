/**
 * Work Items Import API Route
 *
 * POST /api/work-items/import - Import starter catalog items by trade
 *
 * @module api/work-items/import
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { bulkCreateWorkItems } from "@/lib/db/work-items";
import { CATALOG_TEMPLATES, TRADES } from "@/lib/catalog-templates";
import { logger } from "@/lib/logger";

const importSchema = z.object({
  trades: z.array(z.enum(TRADES)).min(1, "Select at least one trade"),
});

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

    const parsed = await parseJsonBody(request, importSchema);
    if (parsed.response) return parsed.response;

    const items = parsed.data.trades.flatMap(
      (trade) => CATALOG_TEMPLATES[trade]
    );

    const created = await bulkCreateWorkItems(user.id, items);

    return NextResponse.json({
      success: true,
      created,
      skipped: items.length - created,
    });
  } catch (error) {
    logger.error("Work items import error", {
      err: error,
      route: "POST /api/work-items/import",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to import starter items", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
