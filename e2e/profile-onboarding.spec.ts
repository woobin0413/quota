import { test, expect } from "@playwright/test";

/**
 * First-run business profile capture.
 *
 * Auth0 signup yields an email and a password and nothing else — database
 * connections never issue `given_name`/`family_name` — so a new contractor
 * lands on the dashboard with `company_name` NULL. The quote PDF falls back
 * `company_name || fullName || email`, so without this prompt their first
 * invoice goes to a client headed by a raw email address.
 *
 * The shared e2e user's company name is the thing under test, so every test
 * clears it back to NULL in afterEach — via the API, and in a hook rather than
 * a try/finally so it still runs when a test body times out. Leaving a name
 * behind would make every later run of this spec silently pass without the
 * dialog ever appearing.
 */

const clearProfile = async (page: import("@playwright/test").Page) => {
  await page.evaluate(async () => {
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: null, firstName: null, lastName: null }),
    });
    localStorage.removeItem("quota_profile_onboarding_dismissed");
  });
};

test.describe("profile onboarding", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await clearProfile(page);
  });

  test.afterEach(async ({ page }) => {
    await clearProfile(page).catch(() => {
      // Best-effort: a navigated-away page can't run the fetch. The next
      // beforeEach clears it again.
    });
  });

  test("prompts for a business name when the profile is blank", async ({ page }) => {
    await page.goto("/dashboard");

    const dialog = page.getByTestId("profile-onboarding");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("onboarding-company-name")).toBeVisible();
  });

  test("saves the name and shows it in the header without a reload", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("profile-onboarding")).toBeVisible({ timeout: 15_000 });

    const business = `Rivera Plumbing ${Date.now()}`;
    await page.getByTestId("onboarding-company-name").fill(business);
    await page.getByTestId("onboarding-first-name").fill("Jo");
    await page.getByTestId("onboarding-last-name").fill("Rivera");
    await page.getByTestId("onboarding-profile-save").click();

    await expect(page.getByTestId("profile-onboarding")).toBeHidden();
    // The header fetched the profile on mount, before this save — it updates
    // off the PROFILE_UPDATED_EVENT rather than a page load.
    await expect(page.locator("header")).toContainText(business);

    const profile = await page.evaluate(async () => {
      const r = await fetch("/api/profile");
      return (await r.json()).profile;
    });
    expect(profile.companyName).toBe(business);
    expect(profile.firstName).toBe("Jo");
    expect(profile.lastName).toBe("Rivera");
  });

  test("refuses to save an empty business name", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("profile-onboarding")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("onboarding-company-name").fill("   ");
    await page.getByTestId("onboarding-profile-save").click();

    await expect(page.getByTestId("onboarding-error")).toBeVisible();
    await expect(page.getByTestId("profile-onboarding")).toBeVisible();
  });

  test("stays dismissed for the rest of the session once skipped", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("profile-onboarding")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("onboarding-profile-skip").click();
    await expect(page.getByTestId("profile-onboarding")).toBeHidden();

    await page.reload();
    await expect(page.getByTestId("profile-onboarding")).toBeHidden();
  });

  test("does not prompt once a business name exists", async ({ page }) => {
    await page.goto("/dashboard");
    await page.evaluate(async () => {
      await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName: "Already Set Co" }),
      });
      localStorage.removeItem("quota_profile_onboarding_dismissed");
    });

    await page.goto("/dashboard");
    await expect(page.getByTestId("catalog-onboarding").or(page.locator("h1"))).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("profile-onboarding")).toBeHidden();
  });
});
