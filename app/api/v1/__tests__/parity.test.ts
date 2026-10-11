// app/api/v1/__tests__/parity.test.ts
import { describe, it, expect } from "vitest";

/**
 * Each v1 route must re-export exactly the HTTP methods its base route defines.
 * A method added to a base route without being re-exported is a 405 the mobile
 * app only discovers in production; a method re-exported that no longer exists
 * is a build break. This asserts both.
 */
const PAIRS: Array<[string, () => Promise<Record<string, unknown>>, () => Promise<Record<string, unknown>>]> = [
  ["quotes", () => import("@/app/api/quotes/route"), () => import("@/app/api/v1/quotes/route")],
  ["quotes/[id]", () => import("@/app/api/quotes/[id]/route"), () => import("@/app/api/v1/quotes/[id]/route")],
  ["quotes/[id]/pdf", () => import("@/app/api/quotes/[id]/pdf/route"), () => import("@/app/api/v1/quotes/[id]/pdf/route")],
  ["quotes/[id]/payments", () => import("@/app/api/quotes/[id]/payments/route"), () => import("@/app/api/v1/quotes/[id]/payments/route")],
  ["quotes/[id]/payments/[paymentId]", () => import("@/app/api/quotes/[id]/payments/[paymentId]/route"), () => import("@/app/api/v1/quotes/[id]/payments/[paymentId]/route")],
  ["quotes/[id]/payments/[paymentId]/receipt", () => import("@/app/api/quotes/[id]/payments/[paymentId]/receipt/route"), () => import("@/app/api/v1/quotes/[id]/payments/[paymentId]/receipt/route")],
  ["quotes/[id]/milestones", () => import("@/app/api/quotes/[id]/milestones/route"), () => import("@/app/api/v1/quotes/[id]/milestones/route")],
  ["work-items", () => import("@/app/api/work-items/route"), () => import("@/app/api/v1/work-items/route")],
  ["work-items/[id]", () => import("@/app/api/work-items/[id]/route"), () => import("@/app/api/v1/work-items/[id]/route")],
  ["work-items/import", () => import("@/app/api/work-items/import/route"), () => import("@/app/api/v1/work-items/import/route")],
  ["clients", () => import("@/app/api/clients/route"), () => import("@/app/api/v1/clients/route")],
  ["send-quote", () => import("@/app/api/send-quote/route"), () => import("@/app/api/v1/send-quote/route")],
  ["subscription", () => import("@/app/api/subscription/route"), () => import("@/app/api/v1/subscription/route")],
  ["profile", () => import("@/app/api/profile/route"), () => import("@/app/api/v1/profile/route")],
];

// HEAD and OPTIONS are valid Next.js route handlers. No base route exports
// either today, so including them changes no current result — they are here so
// that a future one cannot slip past the parity check.
const METHODS = ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] as const;

/**
 * Next.js route segment config is NOT inherited through a re-export: a base
 * route's `export const dynamic = "force-dynamic"` does nothing on the v1 twin
 * unless the twin restates it. Nothing about that failure is loud — the v1
 * route just quietly becomes cacheable, which on an authenticated response
 * means one user's data served to another. So the values are compared, not
 * merely their presence: a base route switching `force-dynamic` to something
 * else must fail here too.
 */
const SEGMENT_CONFIG = [
  "dynamic",
  "runtime",
  "revalidate",
  "fetchCache",
  "maxDuration",
  "preferredRegion",
  "dynamicParams",
] as const;

function methodsOf(mod: Record<string, unknown>): string[] {
  return METHODS.filter((m) => typeof mod[m] === "function");
}

function segmentConfigOf(mod: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(SEGMENT_CONFIG.filter((k) => mod[k] !== undefined).map((k) => [k, mod[k]]));
}

describe("/api/v1 re-export parity", () => {
  it.each(PAIRS)("%s exposes the same methods as its base route", async (_name, base, v1) => {
    const [baseMod, v1Mod] = await Promise.all([base(), v1()]);
    expect(methodsOf(v1Mod).sort()).toEqual(methodsOf(baseMod).sort());
  });

  it.each(PAIRS)("%s re-exports the identical handler, not a copy", async (_name, base, v1) => {
    const [baseMod, v1Mod] = await Promise.all([base(), v1()]);
    for (const m of methodsOf(baseMod)) {
      expect(v1Mod[m]).toBe(baseMod[m]);
    }
  });

  it.each(PAIRS)("%s restates its base route's segment config", async (_name, base, v1) => {
    const [baseMod, v1Mod] = await Promise.all([base(), v1()]);
    expect(segmentConfigOf(v1Mod)).toEqual(segmentConfigOf(baseMod));
  });
});
