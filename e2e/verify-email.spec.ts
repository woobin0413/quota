/**
 * The verification gate, from the outside.
 *
 * Uses a throwaway signup because the shared e2e user is verified by design.
 * Skips rather than half-runs when the Management API env is absent — same rule
 * as billing-purchase.spec.ts.
 */

import { test, expect } from "@playwright/test";
import { acceptConsentIfPresent, loginHostPattern } from "./helpers/auth0-host";
import {
  missingVerifyEmailEnv,
  throwawayEmail,
  throwawayPassword,
  verifyAuth0User,
  deleteAuth0User,
  deleteAppUser,
} from "./helpers/throwaway-account";

const missing = missingVerifyEmailEnv();

test.describe("email verification gate", () => {
  test.skip(
    missing.length > 0,
    `Needs Management API env: ${missing.join(", ")}`
  );

  const email = throwawayEmail();
  const password = throwawayPassword();

  test.afterAll(async () => {
    await deleteAppUser(email);
    await deleteAuth0User(email);
  });

  test("an unverified account is gated, and verifying releases it", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    // Sign up fresh through Universal Login.
    await page.goto("/auth/login?screen_hint=signup&returnTo=%2Fdashboard");
    await page.waitForURL(loginHostPattern(), { timeout: 30_000 });
    await page.fill("input#email, input[name=email], input#username", email);
    await page.fill("input#password, input[name=password]", password);
    await page
      .locator('button[type=submit][name=action], button[type=submit]')
      .first()
      .click();

    await acceptConsentIfPresent(page);

    // Gated: the dashboard is not reachable yet.
    await page.waitForURL("**/verify-email**", { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: /confirm your email/i })
    ).toBeVisible();

    // APIs are gated too, with the documented code.
    const apiRes = await page.request.get("/api/work-items");
    expect(apiRes.status()).toBe(403);
    expect((await apiRes.json()).code).toBe("EMAIL_NOT_VERIFIED");

    // Verify in Auth0, then re-mint the session the way the page's own
    // continue button does.
    await verifyAuth0User(email);
    await page.getByTestId("verify-email-continue").click();

    // Second trip through Universal Login — consent is asked again.
    await acceptConsentIfPresent(page);

    await page.waitForURL("**/dashboard**", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await context.close();
  });
});
