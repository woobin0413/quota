/**
 * Middleware-side decision for bearer-credentialed requests.
 *
 * middleware.ts is the single enforcement point for both authentication and the
 * email-verification gate. It reads a session cookie, which a native client
 * never has, so bearer requests would 401 before reaching any handler. This
 * mirrors that gate for the token credential.
 *
 * Extracted from middleware.ts so it is testable without Edge-runtime plumbing
 * — the same reason lib/email-verification.ts is its own module.
 */

import { NextResponse } from "next/server";
import { applyNoStore } from "@/lib/no-store";
import { extractBearerToken, verifyBearerToken } from "@/lib/auth/bearer";
import { isVerificationExempt, EMAIL_NOT_VERIFIED_BODY } from "@/lib/email-verification";
import { logger } from "@/lib/logger";

export type BearerGateResult =
  | { status: "no-credential" }
  | { status: "allow"; subject: string }
  | { status: "deny"; response: Response };

function deny(response: Response): BearerGateResult {
  return { status: "deny", response };
}

/**
 * 401 in the shape the route handlers use — `{ success, code, message }`.
 *
 * This deliberately differs from the cookie-path 401 in middleware.ts, which
 * still returns `{ error: "Unauthorized" }`. Do NOT harmonize them by changing
 * the cookie path: the running web app already consumes that shape, and every
 * client-side fetch that inspects an error body would need auditing first.
 * Bearer requests have no deployed clients yet, so this side is free to match
 * the handlers — and it must, because the mobile contract has native clients
 * branch on `code`, and a credential rejected by middleware would otherwise
 * arrive shaped differently from one rejected by a route.
 */
function unauthorized(): BearerGateResult {
  return deny(
    applyNoStore(
      NextResponse.json(
        { success: false, code: "UNAUTHORIZED", message: "Authentication required" },
        { status: 401 }
      )
    )
  );
}

/**
 * @param pathname  request path, already known to be non-public
 * @param authorizationHeader  raw `Authorization` header value
 * @returns "no-credential" to fall through to the cookie path, "allow" plus the
 *          Auth0 subject to proceed, or the Response to return unchanged.
 */
export async function bearerGate(
  pathname: string,
  authorizationHeader: string | null
): Promise<BearerGateResult> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) return { status: "no-credential" };

  // A bearer token is an API credential. Aimed at a page route it means a
  // misconfigured client, and answering with HTML or a login redirect gives a
  // native client something it cannot act on.
  // Denials are logged with a REASON because the response cannot carry one.
  // Every rejection below returns the same opaque 401/403 to the client — that
  // is deliberate, since distinguishing them for the caller would help an
  // attacker probe. But an operator answering "the app stopped working" needs
  // to tell an expired token from a wrong audience from an undeployed claims
  // Action, and this is the only place that distinction exists. Never log the
  // token itself.
  if (!pathname.startsWith("/api")) {
    logger.warn("Bearer token rejected", { reason: "page_route", path: pathname });
    return unauthorized();
  }

  const claims = await verifyBearerToken(token);
  if (!claims) {
    // Covers bad signature, expired, wrong issuer, wrong audience, and missing
    // AUTH0_DOMAIN/AUTH0_AUDIENCE config — verifyBearerToken collapses them all.
    logger.warn("Bearer token rejected", {
      reason: "verification_failed",
      path: pathname,
      audienceConfigured: Boolean(process.env.AUTH0_AUDIENCE),
    });
    return unauthorized();
  }

  if (!claims.emailVerified && !isVerificationExempt(pathname)) {
    // If this fires for every user at once, suspect the post-login Action that
    // injects the namespaced email_verified claim rather than the users.
    logger.warn("Bearer token rejected", {
      reason: "email_not_verified",
      subject: claims.sub,
      path: pathname,
    });
    return deny(applyNoStore(NextResponse.json(EMAIL_NOT_VERIFIED_BODY, { status: 403 })));
  }

  // The subject rides out so middleware can key the write rate limiter on it
  // without verifying the token a second time.
  return { status: "allow", subject: claims.sub };
}
