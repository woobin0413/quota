/**
 * Per-user write budget for the API, enforced in middleware.
 *
 * The native app is a public client: no secret, and its client id ships inside
 * the binary. Anyone can extract it, sign up, and script writes. lib/rate-limit
 * already guards the routes that spend money or send mail; this covers the CRUD
 * writes that do neither but can still be used to hammer the database.
 *
 * In middleware rather than in nine route handlers — same reasoning as
 * lib/email-verification.ts, which exists because per-route enforcement is
 * per-route forgetting.
 *
 * Not built on lib/rate-limit.ts: that module starts a setInterval at import
 * time, and this one is bundled into the Edge middleware, where a module-scope
 * timer is unsupported ground and leaks across ephemeral instances. Pruning
 * here is lazy instead.
 *
 * LIMITATION: in-memory and per-instance. Vercel runs middleware in several
 * ephemeral instances per region, so a determined attacker spread across
 * instances gets a multiple of this budget. It is a speed bump against scripted
 * abuse, not a guarantee. A hard guarantee needs Vercel Firewall rate limiting
 * or a shared store; revisit when there is traffic worth defending.
 */

import { NextResponse } from "next/server";
import { applyNoStore } from "@/lib/no-store";
import { logger } from "@/lib/logger";

export const WRITE_WINDOW_MS = 60_000;

/**
 * 60 writes/minute. A contractor building a busy quote might spend 20 in a
 * burst, so this does not touch real use; a script trying to enumerate or
 * exhaust hits it in a second.
 */
export const MAX_WRITES_PER_WINDOW = 60;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

/** Test seam — drop all windows. */
export function resetWriteRateLimit(): void {
  windows.clear();
}

/**
 * Strip an `/api/v1/` style prefix so a versioned path resolves to its base.
 *
 * This exists for **exemption matching only**. `/api/v1/foo` re-exports the
 * handler at `/api/foo`, so the two are one endpoint and must share one policy
 * — but the budget key below carries no path component, so the shared *counter*
 * is a property of the key, not of this function. What this function decides is
 * whether a versioned alias of a self-limited route is recognized as exempt:
 * without it, `/api/v1/send-quote` misses the exemption and gets double-limited.
 */
function canonicalPath(pathname: string): string {
  return pathname.replace(/^\/api\/v\d+\//, "/api/");
}

/** Routes that already run their own, tighter limiter. */
function isSelfLimited(canonical: string): boolean {
  return (
    canonical.startsWith("/api/send-quote") ||
    canonical.startsWith("/api/auth/resend-verification") ||
    canonical.startsWith("/api/billing/") ||
    // Receipt sends are nested under /api/quotes, so a prefix check misses them.
    canonical.endsWith("/receipt")
  );
}

function prune(now: number): void {
  for (const [key, w] of windows.entries()) {
    if (now >= w.resetAt) windows.delete(key);
  }
}

/**
 * @param subject  the authenticated Auth0 `sub` — never an IP. Behind a mobile
 *                 carrier NAT thousands of users share an address, so keying on
 *                 IP would throttle a whole region off one abuser.
 * @returns the 429 to return, or null to let the request through
 */
export function writeRateLimitResponse(
  method: string,
  pathname: string,
  subject: string
): Response | null {
  if (!WRITE_METHODS.has(method.toUpperCase())) return null;

  const canonical = canonicalPath(pathname);
  if (isSelfLimited(canonical)) return null;

  const now = Date.now();
  const key = `api-write:${subject}`;
  const entry = windows.get(key);

  if (!entry || now >= entry.resetAt) {
    // Only on window rollover, so the sweep cost is amortized rather than paid
    // on every request.
    prune(now);
    windows.set(key, { count: 1, resetAt: now + WRITE_WINDOW_MS });
    return null;
  }

  if (entry.count >= MAX_WRITES_PER_WINDOW) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    // A 429 is otherwise invisible: it is produced in middleware, before any
    // route handler runs, so nothing else in the app records it. Without this
    // line a user reporting "it stopped working" is indistinguishable from an
    // expired token, a revoked refresh family, or a misconfigured audience.
    logger.warn("Write rate limit exceeded", {
      subject,
      method,
      path: canonical,
      limit: MAX_WRITES_PER_WINDOW,
      windowMs: WRITE_WINDOW_MS,
      retryAfter,
    });
    return applyNoStore(
      NextResponse.json(
        {
          success: false,
          error: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(MAX_WRITES_PER_WINDOW),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(entry.resetAt),
            "Retry-After": String(retryAfter),
          },
        }
      )
    );
  }

  entry.count++;
  return null;
}
