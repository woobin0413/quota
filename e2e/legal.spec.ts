import { test, expect } from "@playwright/test";

test.describe("legal pages (public)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [path, heading] of [
    ["/terms", "Terms of Service"],
    ["/privacy", "Privacy Policy"],
    ["/refunds", "Refund Policy"],
    // About uses an editorial hero headline (redesign), not a "About Quota" title.
    ["/about", "Billing software that's simpler than the work it bills."],
  ] as const) {
    test(`${path} renders without auth`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    });
  }
});

test.describe("admin gate", () => {
  test("non-admin user gets 404", async ({ page }) => {
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
  });
});
