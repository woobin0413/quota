/**
 * Billing Reconciliation Cron — POST /api/cron/reconcile-billing
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (no session).
 * Schedule daily once infra is chosen, e.g. Vercel cron:
 *   { "crons": [{ "path": "/api/cron/reconcile-billing", "schedule": "0 9 * * *" }] }
 * (Vercel sends GET with the CRON_SECRET env auto-injected as Bearer —
 * hence the GET handler delegating to POST below.)
 * Manual run:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/cron/reconcile-billing
 */

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { reconcileBilling } from "@/lib/billing-reconcile";
import { logger } from "@/lib/logger";

/** Constant-time bearer check; length guard first (timingSafeEqual throws on unequal lengths). */
function isAuthorized(header: string | null, secret: string): boolean {
  if (!header) return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.error("Cron: CRON_SECRET not configured", {
      route: "/api/cron/reconcile-billing",
    });
    return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  }

  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await reconcileBilling();
    return NextResponse.json({ success: true, ...report });
  } catch (error) {
    logger.error("Cron: reconcile failed", {
      err: error,
      route: "/api/cron/reconcile-billing",
    });
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
