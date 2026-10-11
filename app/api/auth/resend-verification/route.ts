/**
 * POST /api/auth/resend-verification
 *
 * Re-sends Auth0's verification email for the signed-in user. Rate limited
 * because it makes Auth0 send mail on demand: unlimited, it is a spam cannon
 * aimed at our own Resend sending reputation.
 *
 * Exempt from the verification gate itself (lib/email-verification.ts) —
 * gating it would mean only verified users could ask to be verified.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendVerificationEmail } from "@/lib/auth0-management";

export async function POST(_request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
  }

  const limit = await checkRateLimit(`resend-verification:${user.id}`, {
    windowMs: 60 * 1000,
    maxRequests: 3,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      {
        success: false,
        code: "RATE_LIMITED",
        message: "Too many requests. Wait a minute and try again.",
      },
      { status: 429 }
    );
  }

  try {
    await sendVerificationEmail(user.auth0_user_id);
  } catch (error) {
    // Upstream detail (scope problems, tenant config) goes to the server log,
    // never to the client.
    console.error("[resend-verification]", (error as Error).message);
    return NextResponse.json(
      {
        success: false,
        code: "RESEND_FAILED",
        message: "Could not send the email just now. Try again shortly.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}
