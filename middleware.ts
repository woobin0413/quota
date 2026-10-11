import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { bearerGate } from "@/lib/auth/bearer-gate";
import { writeRateLimitResponse } from "@/lib/api-rate-limit";
import { applyClearSiteData, applyNoStore } from "@/lib/no-store";
import {
  needsVerification,
  isVerificationExempt,
  EMAIL_NOT_VERIFIED_BODY,
  VERIFY_EMAIL_PATH,
} from "@/lib/email-verification";

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  "/",
  "/og",
  // Auth0 fetches this for the Universal Login header — it must be reachable
  // without a session, or the login screen renders with a broken image.
  "/logo",
  "/terms",
  "/privacy",
  "/refunds",
  "/about",
  "/api/webhooks",
  "/api/waitlist",
  "/api/cron",
];

function isPublicRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  // Exact match or slash boundary only — `/api/waitlist-admin` must NOT
  // match the `/api/waitlist` entry.
  return PUBLIC_ROUTES.some(
    (route) =>
      route !== "/" &&
      (pathname === route || pathname.startsWith(route + "/"))
  );
}

export async function middleware(request: NextRequest) {
  const authResponse = await auth0.middleware(request);
  const { pathname } = request.nextUrl;

  // Let the SDK handle its own routes (/auth/login, /auth/callback, ...)
  if (pathname.startsWith("/auth")) {
    // Sign-out is the one that needs a header of its own. Chrome restores
    // `no-store` pages from bfcache since March 2025, so without an explicit
    // eviction the Back button re-renders the dashboard of the user who just
    // signed out. See applyClearSiteData.
    if (pathname === "/auth/logout") {
      return applyClearSiteData(applyNoStore(authResponse));
    }
    return authResponse;
  }

  if (isPublicRoute(pathname)) {
    return authResponse;
  }

  // Bearer credential (native app). Checked before the cookie path so a token
  // request is never answered with a login redirect.
  const gate = await bearerGate(pathname, request.headers.get("authorization"));
  if (gate.status === "deny") return gate.response;
  if (gate.status === "allow") {
    // Keyed on the subject the gate already verified — no second verification.
    const limited = writeRateLimitResponse(request.method, pathname, gate.subject);
    if (limited) return limited;
    return applyNoStore(NextResponse.next());
  }

  // Protect everything else
  const session = await auth0.getSession(request);
  if (!session) {
    if (pathname.startsWith("/api")) {
      return applyNoStore(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
    }
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("returnTo", pathname);
    return applyNoStore(NextResponse.redirect(loginUrl));
  }

  // Verification gate. Here rather than in each route because 26 files call
  // getCurrentUser()/requireUser() — one enforcement point instead of 26
  // chances to forget one.
  if (needsVerification(session) && !isVerificationExempt(pathname)) {
    if (pathname.startsWith("/api")) {
      return applyNoStore(
        NextResponse.json(EMAIL_NOT_VERIFIED_BODY, { status: 403 })
      );
    }
    return applyNoStore(
      NextResponse.redirect(new URL(VERIFY_EMAIL_PATH, request.url))
    );
  }

  // Same write budget for the browser. A session cookie is not a smaller threat
  // than a bearer token — it is just a different credential on the same
  // handlers. The `sub` claim keys it, so one user gets one budget whichever
  // credential they present.
  if (pathname.startsWith("/api") && session.user?.sub) {
    const limited = writeRateLimitResponse(request.method, pathname, session.user.sub);
    if (limited) return limited;
  }

  // Past this point the route is authenticated: never let it be stored.
  return applyNoStore(authResponse);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
