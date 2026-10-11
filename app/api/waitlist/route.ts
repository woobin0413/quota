/**
 * Waitlist Route (public)
 *
 * POST /api/waitlist — landing-page email capture for the
 * voice-to-invoice teaser. No auth. Anti-abuse: per-IP rate limit
 * (5/min), zod validation,
 * `website` honeypot (bots fill it → silent success, no write),
 * and duplicate emails return success without a second row
 * (no enumeration signal either way).
 *
 * @module api/waitlist
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/db/core";
import { parseJsonBody } from "@/lib/api-validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const waitlistSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  locale: z.enum(["en", "es"]).optional().default("en"),
  // Honeypot: humans never see it; bots fill it
  website: z.string().optional().default(""),
});

export async function POST(request: NextRequest) {
  try {
    // Unauthenticated public write — cap per client IP before doing any work
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||

      "unknown";
    const rateLimit = await checkRateLimit(`waitlist:${ip}`, { maxRequests: 5 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many requests. Try again later.", code: "RATE_LIMITED" },
        { status: 429 }
      );
    }

    const parsed = await parseJsonBody(request, waitlistSchema);
    if (parsed.response) return parsed.response;

    const { email, locale, website } = parsed.data;

    // Honeypot tripped — pretend success, write nothing
    if (website !== "") {
      return NextResponse.json({ success: true });
    }

    const { error } = await supabaseAdmin
      .from("waitlist_signups")
      .insert({ email: email.toLowerCase(), locale, source: "voice-teaser" });

    // 23505 = unique_violation → already signed up → idempotent success
    if (error && error.code !== "23505") throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Waitlist signup error", {
      err: error,
      route: "POST /api/waitlist",
    });
    return NextResponse.json(
      { success: false, message: "Something went wrong. Try again.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
