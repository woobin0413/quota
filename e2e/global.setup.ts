/**
 * Global auth setup
 *
 * Logs in once through the real Auth0 Universal Login with the
 * dedicated e2e test user and saves the session as storageState,
 * which every spec then reuses.
 */

import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  acceptConsentIfPresent,
  LOGIN_HOST,
  loginHostPattern,
} from "./helpers/auth0-host";

const AUTH_FILE = "e2e/.auth/user.json";

setup("authenticate via Auth0", async ({ page }) => {
  const email = process.env.E2E_AUTH0_USER_EMAIL;
  const password = process.env.E2E_AUTH0_USER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "E2E_AUTH0_USER_EMAIL / E2E_AUTH0_USER_PASSWORD must be set in .env.local"
    );
  }

  // Hitting a protected page redirects to Auth0 Universal Login
  await page.goto("/dashboard");
  await page.waitForURL(
    new RegExp(`${loginHostPattern().source}|/dashboard`),
    { timeout: 30_000 }
  );

  if (page.url().includes(LOGIN_HOST)) {
    // Universal Login form
    await page.fill("input#username, input[name=username]", email);
    // Some tenants use a two-step (identifier-first) flow
    const passwordVisible = await page
      .locator("input#password, input[name=password]")
      .isVisible()
      .catch(() => false);
    if (!passwordVisible) {
      await page
        .locator('button[type=submit][name=action], button[type=submit]')
        .first()
        .click();
    }
    await page.fill("input#password, input[name=password]", password);
    await page
      .locator('button[type=submit][name=action], button[type=submit]')
      .first()
      .click();

    await acceptConsentIfPresent(page);
  }

  await page.waitForURL("**/dashboard**", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE });

  // Baseline: the shared e2e user is Ultimate (unlimited) so tier
  // enforcement never blocks the other specs (the user already has many
  // quotes; Free/Pro would be at cap). tiers.spec flips locally then
  // restores ultimate in afterEach. The saved session cookies authenticate
  // this request.
  const tierRes = await page.request.patch("/api/subscription", {
    data: { tier: "ultimate" },
  });
  if (!tierRes.ok()) {
    throw new Error(`Failed to baseline e2e tier: ${tierRes.status()}`);
  }

  // Repeated local runs accumulate quotes; reset the monthly quota so the
  // suite never trips the free-tier limit mid-run
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceRoleKey) {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase
      .from("users")
      .update({ quotes_this_month: 0 })
      .eq("email", email);
    if (error) {
      console.warn("[e2e setup] Failed to reset quote quota:", error.message);
    }
  }
});
