import { test, expect } from "@playwright/test";

test.describe("smoke", () => {
  // The dashboard tab bar was removed: DashboardTabs renders a view by `?tab=`
  // and Clients / Work Catalog are reached from the top nav instead.
  test("dashboard renders with the top nav destinations", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();

    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Clients" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Work Catalog" })).toBeVisible();
    await expect(page.getByTestId("new-quote-nav")).toBeVisible();
  });

  test("top nav reaches the clients and catalog views", async ({ page }) => {
    await page.goto("/dashboard?tab=clients");
    await expect(page.getByTestId("clients-tab")).toBeVisible();

    await page.goto("/dashboard?tab=catalog");
    await expect(page.getByTestId("catalog-tab")).toBeVisible();
  });
});
