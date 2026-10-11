// e2e/billing.spec.ts
import { test, expect } from "@playwright/test";

/**
 * Billing routes are rate limited per user (10 requests / 60s). Every /billing
 * load spends four of them, because the dev server runs React in StrictMode and
 * use-billing's summary + invoices fetches each fire twice. Two page loads in a
 * minute is therefore the practical ceiling, and exceeding it surfaces as a
 * "Too many requests" banner where the plan section should be — a 429 wearing a
 * UI bug's clothing. Assert through the API wherever a page load isn't the
 * thing under test.
 */
test.describe("billing center (authenticated)", () => {
  // The shared user is baselined to Ultimate by global.setup. Anything that
  // changes tier restores it here rather than inline: an afterEach still runs
  // when the test body times out, and leaving the user on Free would push every
  // later spec into the quota cap.
  test.afterEach(async ({ request }) => {
    await request.patch("/api/subscription", { data: { tier: "ultimate" } });
  });

  test("renders plan, payment method, and invoices sections", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByTestId("billing-center")).toBeVisible();
    await expect(page.getByTestId("plan-section")).toBeVisible();
    await expect(page.getByTestId("payment-method-section")).toBeVisible();
    await expect(page.getByTestId("invoice-table")).toBeVisible();
  });

  /**
   * Ultimate is priced and listed but not for sale while it has no headline
   * feature, and a disabled button is only half the guarantee — a stale page
   * or a direct POST must not be able to start a $29/mo subscription. The other
   * half is that someone already on Ultimate keeps it.
   *
   * The dialog is inspected once, as the Ultimate subscriber; the refusal is
   * checked through the API to stay inside the rate-limit budget. A free user's
   * disabled "Coming soon" button is covered by billing-purchase.spec, on a
   * genuinely new account, and by landing.spec on the pricing page.
   */
  test("Ultimate: refused as an upgrade, retained by existing subscribers", async ({
    page,
    request,
  }) => {
    await page.goto("/billing");
    await page.getByTestId("change-plan").click();
    await expect(page.getByTestId("change-plan-dialog")).toBeVisible();
    await expect(page.getByTestId("change-plan-dialog")).toContainText("Change plan");
    await expect(page.getByTestId("plan-option-ultimate")).toBeVisible();
    await expect(page.getByTestId("choose-ultimate")).toContainText("Current");

    // Asking for the tier you already hold is a no-op, not a refusal.
    const noop = await page.request.post("/api/billing/change-plan", {
      data: { targetTier: "ultimate" },
    });
    expect(noop.status()).toBe(200);
    expect((await noop.json()).applied).toBe("noop");

    // From any lower tier the same request is an upgrade, and must be refused.
    await request.patch("/api/subscription", { data: { tier: "free" } });
    const refused = await page.request.post("/api/billing/change-plan", {
      data: { targetTier: "ultimate" },
    });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).code).toBe("TIER_UNAVAILABLE");
  });
});
