import { test, expect } from "@playwright/test";

/**
 * Navigation + footer surface checks for the billing-UX / brand-polish work:
 *
 *  - The expanded user menu exposes Plan & billing, Work Catalog, and Help,
 *    but NOT Admin for a non-admin user (the e2e user is non-admin).
 *  - The redesigned public landing footer links to every legal page and no
 *    longer carries a "Sign in" link (dropped in the footer redesign).
 *
 * Legal pages' 200 + h1 are already covered by legal.spec.ts — not repeated.
 */

test.describe("user menu (authenticated)", () => {
  test("exposes billing/catalog/help, hides admin for non-admin", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.getByTestId("user-menu-trigger").click();

    await expect(page.getByTestId("menu-billing")).toBeVisible();
    await expect(page.getByTestId("menu-catalog")).toBeVisible();
    await expect(page.getByTestId("menu-help")).toBeVisible();
    // Admin item is gated on isAdmin from /api/profile; the e2e user is not
    // an admin, so it must never render.
    await expect(page.getByTestId("menu-admin")).toHaveCount(0);
  });
});

test.describe("landing footer (public)", () => {
  // Prove public access with a fresh, unauthenticated context.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("links to every legal page and drops the sign-in link", async ({
    page,
  }) => {
    await page.goto("/");
    const footer = page.getByTestId("landing-footer");
    await expect(footer).toBeVisible();

    for (const href of ["/terms", "/privacy", "/refunds", "/about"]) {
      await expect(footer.locator(`a[href="${href}"]`)).toBeVisible();
    }

    await expect(
      footer.getByRole("link", { name: /sign in/i })
    ).toHaveCount(0);
  });
});
