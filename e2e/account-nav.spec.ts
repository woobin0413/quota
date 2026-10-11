// e2e/account-nav.spec.ts
import { test, expect } from "@playwright/test";

test.describe("account nav (authenticated)", () => {
  test("Plan & Billing navigates to the /billing page", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("menu-billing").click();
    await page.waitForURL(/\/billing$/);
    await expect(page.getByTestId("billing-center")).toBeVisible();
    await expect(page.getByTestId("plan-section")).toBeVisible();
  });

  test("Profile Settings no longer contains the billing panel", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("menu-profile-settings").click();

    const dialog = page.getByTestId("profile-settings-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Profile Settings");
    await expect(dialog.getByTestId("billing-panel")).toHaveCount(0);
  });

  test("Help/About shows a Dashboard link when signed in", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByTestId("legal-dashboard-link")).toBeVisible();
    await expect(page.getByTestId("legal-dashboard-link")).toHaveAttribute("href", "/dashboard");
  });

  test("landing header hides Sign up when signed in, shows Dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();
    await expect(page.getByTestId("nav-signup")).toHaveCount(0);
    await expect(page.getByTestId("nav-signin")).toHaveCount(0);
  });
});
