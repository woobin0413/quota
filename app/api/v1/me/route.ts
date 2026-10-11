/**
 * GET /api/v1/me — session bootstrap for native clients.
 *
 * One call for everything the app needs before its first render: who the user
 * is, what tier they are on, and how much of the monthly quota is left.
 *
 * Not a re-export: there is no web equivalent. The web app gets this from
 * Server Components, which a native client cannot render.
 *
 * @module api/v1/me
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { countUserQuotesThisMonth } from "@/lib/db/users";
import { QUOTE_LIMIT, resolveTier } from "@/lib/subscription";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    // resolveTier, never `as Tier` — subscription_tier is a nullable VARCHAR and
    // an unrecognized value would index QUOTE_LIMIT to undefined, which reads as
    // unlimited.
    const tier = resolveTier(user.subscription_tier);
    const limit = QUOTE_LIMIT[tier];
    const quotesUsed = await countUserQuotesThisMonth(user.id);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        companyName: user.company_name,
      },
      subscription: {
        tier,
        // null means unlimited. Infinity is not representable in JSON.
        quoteLimit: Number.isFinite(limit) ? limit : null,
        // Same name as /api/v1/subscription's field — one quantity, one name.
        quotesUsed,
        // Subscriptions are not sold in the app — see docs/api/v1.md.
        manageUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://sendquota.com"}/billing`,
      },
    });
  } catch (error) {
    // Every other route in this app answers a thrown error with a JSON body
    // carrying a `code`. Without this the mobile client gets Next's HTML 500
    // and nothing to branch on.
    logger.error("Me GET error", { err: error, route: "GET /api/v1/me" });
    return NextResponse.json(
      { success: false, message: "Failed to load account", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
