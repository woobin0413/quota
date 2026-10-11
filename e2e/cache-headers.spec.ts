import { test, expect } from "@playwright/test";

/**
 * Cache-Control regression for the bearer-auth / rate-limit middleware
 * rewrite (see middleware.ts).
 *
 * lib/no-store.ts's `applyNoStore` is only supposed to run for routes that
 * fall through to the authenticated branch of `middleware`. Public routes
 * (`isPublicRoute`) return the bare Auth0 SDK response untouched, on purpose:
 * Auth0 fetches `/logo` server-side with no session, and `/` + `/og` are
 * link-preview/landing traffic that should stay cacheable. Nothing in the
 * suite asserts the header split itself — signout.spec.ts checks the
 * stronger `Clear-Site-Data` eviction on `/auth/logout`, but not the
 * ordinary no-store/cacheable split this depends on. A regression here
 * (e.g. someone hoisting `applyNoStore` above the `isPublicRoute` check, or
 * dropping it from the authenticated branch) would not fail any existing
 * spec — the Back-button bug it exists to prevent, or a CDN caching a
 * signed-in dashboard, is exactly this failure mode.
 */

// The exact string lib/no-store.ts's applyNoStore() writes. Used as a
// fingerprint below rather than a loose "contains no-store" check — see the
// note in the next describe block for why that distinction matters.
const MIDDLEWARE_NO_STORE = "no-store, no-cache, must-revalidate, max-age=0";

test.describe("public routes stay cacheable", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of ["/", "/og", "/logo"] as const) {
    test(`${path}: middleware does not apply its no-store header`, async ({
      page,
    }) => {
      const res = await page.request.get(path);
      expect(res.status()).toBe(200);
      const cacheControl = res.headers()["cache-control"] ?? "";
      // Deliberately not "does not contain no-store": `next dev` (what this
      // suite runs against locally) sends its own no-store-flavoured
      // Cache-Control on every non-static response regardless of anything
      // this app's code does — that's dev mode disabling caching wholesale,
      // not a regression. It has a different exact shape from ours (no
      // "max-age=0", different field order/set), so it doesn't collide with
      // this fingerprint. What must never be true, in dev or prod, is that
      // *our* applyNoStore ran for a route isPublicRoute() says shouldn't
      // get it — that's the actual bug this guards (someone hoisting the
      // call above the isPublicRoute check).
      expect(
        cacheControl,
        `${path} must never carry the middleware's own no-store header — ` +
          `it is a public route (Auth0 fetches /logo without a session; ` +
          `/ and /og are landing/link-preview traffic)`
      ).not.toBe(MIDDLEWARE_NO_STORE);
      expect(res.headers()["pragma"]).not.toBe("no-cache");
    });
  }
});

test.describe("authenticated routes are no-store", () => {
  test("an authenticated page response carries no-store", async ({ page }) => {
    const res = await page.request.get("/dashboard");
    expect(res.status()).toBe(200);
    const cacheControl = res.headers()["cache-control"] ?? "";
    expect(cacheControl).toContain("no-store");
    expect(res.headers()["pragma"]).toBe("no-cache");
  });

  test("an authenticated API response carries no-store", async ({ page }) => {
    const res = await page.request.get("/api/work-items");
    expect(res.status()).toBe(200);
    const cacheControl = res.headers()["cache-control"] ?? "";
    expect(cacheControl).toContain("no-store");
  });

  test("an unauthenticated API request is itself no-store (401)", async ({
    browser,
  }) => {
    // Fresh, cookie-less context: proves the no-store header is applied on
    // the 401 branch too, not only on the happy authenticated path.
    const context = await browser.newContext({ storageState: undefined });
    const res = await context.request.get("/api/work-items");
    expect(res.status()).toBe(401);
    const cacheControl = res.headers()["cache-control"] ?? "";
    expect(cacheControl).toContain("no-store");
    await context.close();
  });
});
