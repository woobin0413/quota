import { test, expect } from "@playwright/test";

/**
 * First/last name in Profile Settings.
 *
 * Auth0 database connections never issue given_name/family_name, and custom
 * signup fields need a paid Auth0 plan, so these two columns are only ever
 * written from inside the app — the dashboard first-run panel or this form.
 * If the form silently drops them the columns stay NULL forever and nothing
 * else in the product notices, which is why persistence is asserted against
 * the API rather than the inputs.
 *
 * Clears both fields afterwards in a hook, not a try/finally, so a timed-out
 * body still restores the shared e2e user.
 */

async function openProfileSettings(page: import("@playwright/test").Page) {
  await page.goto("/dashboard");
  await page.getByTestId("user-menu-trigger").click();
  await page.getByTestId("menu-profile-settings").click();
  await expect(page.getByTestId("profile-settings-dialog")).toBeVisible();
}

const clearName = async (page: import("@playwright/test").Page) => {
  await page.evaluate(async () => {
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: null, lastName: null }),
    });
  });
};

test.describe("profile name", () => {
  test.afterEach(async ({ page }) => {
    await clearName(page).catch(() => {
      // Best-effort: a navigated-away page can't run the fetch.
    });
  });

  test("saves first and last name and reloads them on reopen", async ({ page }) => {
    await openProfileSettings(page);

    const first = `Jo${Date.now() % 100000}`;
    await page.getByTestId("profile-first-name").fill(first);
    await page.getByTestId("profile-last-name").fill("Rivera");
    await page.getByTestId("profile-save").click();
    // The span is always in the DOM; only its text appears once the PATCH
    // resolves, so this is what separates "clicked" from "saved".
    await expect(page.getByTestId("profile-saved")).toContainText("Saved");

    const profile = await page.evaluate(async () => {
      const r = await fetch("/api/profile");
      return (await r.json()).profile;
    });
    expect(profile.firstName).toBe(first);
    expect(profile.lastName).toBe("Rivera");

    // Reopening refetches, so this proves the GET returns them too.
    await page.reload();
    await openProfileSettings(page);
    await expect(page.getByTestId("profile-first-name")).toHaveValue(first);
    await expect(page.getByTestId("profile-last-name")).toHaveValue("Rivera");
  });

  test("clearing a name stores null rather than an empty string", async ({ page }) => {
    await openProfileSettings(page);
    await page.getByTestId("profile-first-name").fill("Temporary");
    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("profile-saved")).toContainText("Saved");

    await page.reload();
    await openProfileSettings(page);
    await page.getByTestId("profile-first-name").fill("");
    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("profile-saved")).toContainText("Saved");

    const profile = await page.evaluate(async () => {
      const r = await fetch("/api/profile");
      return (await r.json()).profile;
    });
    // Empty string would make the header and PDF render a blank name instead
    // of falling back to the company name or email.
    expect(profile.firstName).toBeNull();
  });
});
