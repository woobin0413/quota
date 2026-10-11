/**
 * GET /api/billing/invoices — the customer's recent invoices, rendered in
 * our own UI (no hosted portal). Empty array when there is no customer.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { toInvoiceRows } from "@/lib/billing/summary";

export async function GET() {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
    }
    userId = user.id;
    const rate = await checkRateLimit(`billing:${user.id}`, { maxRequests: 10 });
    if (!rate.allowed) {
      return NextResponse.json({ success: false, code: "RATE_LIMITED", message: "Too many requests — try again soon." }, { status: 429 });
    }
    if (!user.stripe_customer_id) {
      return NextResponse.json({ success: true, invoices: [] });
    }
    const list = await getStripe().invoices.list({ customer: user.stripe_customer_id, limit: 24 });
    return NextResponse.json({ success: true, invoices: toInvoiceRows(list.data) });
  } catch (error) {
    logger.error("Billing invoices error", { err: error, route: "GET /api/billing/invoices", userId });
    return NextResponse.json({ success: false, code: "INTERNAL_ERROR", message: "Could not load invoices" }, { status: 500 });
  }
}
