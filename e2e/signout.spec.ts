/**
 * Sign-out must actually end the session in the browser, not just navigate.
 *
 * Two failure modes this guards, both of which look fine in manual testing
 * unless you press the right button:
 *   - the dashboard renders from browser history cache after sign-out
 *   - the catalog-onboarding dismissal is keyed per *device*, so the next
 *     person to sign in on a shared laptop never sees the first-run prompt
 */

import { test, expect } from "@playwright/test";

test.describe("sign out", () => {
  test("back button does not re-render the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("menu-sign-out").click();

    // Auth0 logout bounces through the tenant and back to the landing page.
    // Wait for the signed-out landing page itself, not merely for the URL to
    // stop being /dashboard: that weaker condition also matches the
    // intermediate URL on the Auth0 domain, so goBack() would fire while the
    // session cookie is still live and the dashboard would render from a fresh,
    // legitimately authenticated request. Locally the round trip is quick
    // enough to hide the race; on CI it fails outright.
    await expect(page.getByTestId("nav-signup")).toBeVisible({ timeout: 30_000 });

    await page.goBack();

    // Either the login redirect or the landing page is fine. A rendered
    // dashboard is not.
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).not.toBeVisible();
  });

  test("sign out clears the per-device onboarding dismissal", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.evaluate(() =>
      localStorage.setItem("quota_catalog_onboarding_dismissed", "1")
    );
    // A language preference is not session data and must survive.
    await page.evaluate(() =>
      localStorage.setItem("quota-landing-lang", "es")
    );

    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("menu-sign-out").click();
    await page.waitForURL((url) => !url.pathname.startsWith("/dashboard"), {
      timeout: 30_000,
    });

    expect(
      await page.evaluate(() =>
        localStorage.getItem("quota_catalog_onboarding_dismissed")
      )
    ).toBeNull();
    expect(
      await page.evaluate(() => localStorage.getItem("quota-landing-lang"))
    ).toBe("es");
  });
});
