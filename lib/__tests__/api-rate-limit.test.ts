import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  writeRateLimitResponse,
  resetWriteRateLimit,
  MAX_WRITES_PER_WINDOW,
  WRITE_WINDOW_MS,
} from "@/lib/api-rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-09T12:00:00Z"));
  resetWriteRateLimit();
});

afterEach(() => vi.useRealTimers());

/** Burn n writes for a subject; returns the response from the nth. */
function writeTimes(n: number, subject = "auth0|abc"): Response | null {
  let last: Response | null = null;
  for (let i = 0; i < n; i++) {
    last = writeRateLimitResponse("POST", "/api/quotes", subject);
  }
  return last;
}

describe("writeRateLimitResponse", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("does not limit %s", (method) => {
    for (let i = 0; i < MAX_WRITES_PER_WINDOW * 2; i++) {
      expect(writeRateLimitResponse(method, "/api/quotes", "auth0|abc")).toBeNull();
    }
  });

  it("allows writes up to the limit", () => {
    expect(writeTimes(MAX_WRITES_PER_WINDOW)).toBeNull();
  });

  it("429s the write past the limit", async () => {
    writeTimes(MAX_WRITES_PER_WINDOW);
    const res = writeRateLimitResponse("POST", "/api/quotes", "auth0|abc");

    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(await res!.json()).toMatchObject({
      success: false,
      code: "RATE_LIMIT_EXCEEDED",
    });
    expect(res!.headers.get("Retry-After")).toBe("60");
    expect(res!.headers.get("Cache-Control")).toContain("no-store");
  });

  it("gives each subject an independent budget", () => {
    writeTimes(MAX_WRITES_PER_WINDOW, "auth0|abc");
    expect(writeRateLimitResponse("POST", "/api/quotes", "auth0|xyz")).toBeNull();
  });

  it("shares one budget across write paths for the same subject", () => {
    writeTimes(MAX_WRITES_PER_WINDOW, "auth0|abc");
    // A different endpoint, same user — the budget is per user, not per route,
    // because the thing being limited is scripted abuse, not one endpoint.
    expect(writeRateLimitResponse("POST", "/api/work-items", "auth0|abc")).not.toBeNull();
  });

  it("reopens the budget after the window elapses", () => {
    writeTimes(MAX_WRITES_PER_WINDOW);
    vi.advanceTimersByTime(WRITE_WINDOW_MS);
    expect(writeRateLimitResponse("POST", "/api/quotes", "auth0|abc")).toBeNull();
  });

  // Double-limiting would make the effective budget the smaller of the two and
  // make a 429 impossible to attribute to a policy.
  it.each([
    "/api/send-quote",
    "/api/v1/send-quote",
    "/api/quotes/q1/payments/p1/receipt",
    "/api/v1/quotes/q1/payments/p1/receipt",
    "/api/auth/resend-verification",
    "/api/billing/change-plan",
  ])("skips %s, which runs its own limiter", (pathname) => {
    for (let i = 0; i < MAX_WRITES_PER_WINDOW * 2; i++) {
      expect(writeRateLimitResponse("POST", pathname, "auth0|abc")).toBeNull();
    }
  });

  // canonicalPath's real and only job. The budget key carries no path, so a
  // versioned path shares its base path's counter no matter what this function
  // does — that part is covered above by "shares one budget across write paths".
  // What canonicalPath actually decides is whether a versioned alias of a
  // self-limited route is recognized as exempt. An identity canonicalPath
  // passes every other case in this file and fails these.
  it.each(["/api/v1/send-quote", "/api/v2/send-quote", "/api/v10/send-quote"])(
    "resolves %s to its exempt base path",
    (pathname) => {
      for (let i = 0; i < MAX_WRITES_PER_WINDOW * 2; i++) {
        expect(writeRateLimitResponse("POST", pathname, "auth0|abc")).toBeNull();
      }
    }
  );

  // ...without exempting a versioned path whose base is not self-limited.
  // Stripping the prefix must not be mistaken for a licence to skip.
  it("still limits a versioned path whose base path is not exempt", () => {
    writeTimes(MAX_WRITES_PER_WINDOW, "auth0|abc");
    expect(writeRateLimitResponse("POST", "/api/v1/quotes", "auth0|abc")).not.toBeNull();
  });
});
