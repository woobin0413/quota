import { test, expect } from "@playwright/test";
import { openNewQuoteForNewClient } from "./helpers/new-quote";

/**
 * Tier limits: a Free user already over the cap is blocked at save with the
 * upgrade dialog. The dialog's upgrade buttons route to the in-app /billing
 * page (no Stripe-hosted Checkout), which would navigate away and abandon
 * the draft — so tests assert the dialog UI renders, then flip the tier via
 * the dev PATCH (ALLOW_DEV_TIER_SWITCH=1 in playwright.config.ts) to unblock
 * saves without leaving the quote builder.
 *
 * This spec mutates the shared e2e user's tier. It restores ultimate in
 * afterEach so other specs (and reruns) start unblocked — the same baseline
 * global.setup applies.
 */

test.afterEach(async ({ request }) => {
  await request.patch("/api/subscription", { data: { tier: "ultimate" } });
});

test.describe("tier limits", () => {
  test("free user at the cap is blocked and can upgrade to unblock", async ({
    page,
    request,
  }) => {
    // The e2e user already has >3 quotes, so Free (limit 3) is at cap.
    const patchRes = await request.patch("/api/subscription", {
      data: { tier: "free" },
    });
    expect(patchRes.ok()).toBeTruthy();

    // Build a minimal quote (selectors mirror quote-flow.spec.ts)
    await openNewQuoteForNewClient(page);
    await page
      .getByTestId("client-name-input")
      .fill(`Tier Test ${Date.now()}`);

    await page.getByTestId("add-adhoc-line-button").click();
    await page.getByTestId("line-description-input").last().fill("Test work");
    await page.getByTestId("line-price-input").last().fill("100");

    // Save → blocked: expect the upgrade dialog, not a redirect to the quote
    await page.getByTestId("save-quote-button").click();
    await expect(page.getByTestId("upgrade-dialog")).toBeVisible();
    await expect(page).toHaveURL(/\/new-quote/);

    // UI smoke: the dialog renders the plan cards and the upgrade button.
    // Clicking it routes to the in-app /billing page, which would abandon the
    // draft — so we don't click; we close the dialog and flip the tier via the
    // dev PATCH.
    await expect(page.getByTestId("plan-free")).toBeVisible();
    await expect(page.getByTestId("plan-pro")).toBeVisible();
    await expect(page.getByTestId("plan-ultimate")).toBeVisible();
    // Ultimate isn't purchasable while it has no headline feature: its CTA
    // is a disabled "Coming soon" button, while Pro stays a live upgrade.
    await expect(page.getByTestId("upgrade-to-pro")).toBeEnabled();
    await expect(page.getByTestId("upgrade-to-ultimate")).toBeVisible();
    await expect(page.getByTestId("upgrade-to-ultimate")).toBeDisabled();
    await expect(page.getByTestId("upgrade-to-ultimate")).toHaveText("Coming soon");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("upgrade-dialog")).toBeHidden();

    const upgradeRes = await request.patch("/api/subscription", {
      data: { tier: "ultimate" },
    });
    expect(upgradeRes.ok()).toBeTruthy();

    // Save again → now succeeds (redirects to the quote page)
    await page.getByTestId("save-quote-button").click();
    await page.waitForURL(/\/quote\/(Q-\d{4}-\d+|[0-9a-f-]+)/, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("quote-status-badge")).toBeVisible();
  });

  test("free tier: Send opens upgrade prompt, offers Download PDF, does not email", async ({
    page,
    request,
  }) => {
    // The e2e user is over the Free monthly cap, so build the quote as a paid
    // tier first, then flip to Free to exercise the send gate on its page.
    const upRes = await request.patch("/api/subscription", {
      data: { tier: "ultimate" },
    });
    expect(upRes.ok()).toBeTruthy();

    await openNewQuoteForNewClient(page);
    await page
      .getByTestId("client-name-input")
      .fill(`Free Send Test ${Date.now()}`);
    await page.getByTestId("add-adhoc-line-button").click();
    await page.getByTestId("line-description-input").last().fill("Test work");
    await page.getByTestId("line-price-input").last().fill("100");

    await page.getByTestId("save-quote-button").click();
    await page.waitForURL(/\/quote\/(Q-\d{4}-\d+|[0-9a-f-]+)/, {
      timeout: 30_000,
    });
    const quoteUrl = page.url();

    // Now drop to Free and reload the quote page so the client-side
    // subscription hook reports the free tier.
    const freeRes = await request.patch("/api/subscription", {
      data: { tier: "free" },
    });
    expect(freeRes.ok()).toBeTruthy();
    await page.goto(quoteUrl);
    await expect(page.getByTestId("send-quote-button")).toBeVisible({
      timeout: 15_000,
    });

    // Fail loudly if the UI ever hits the email endpoint for a free user.
    let emailed = false;
    await page.route("**/api/send-quote", (r) => {
      emailed = true;
      return r.abort();
    });

    await page.getByTestId("send-quote-button").click();
    await expect(page.getByTestId("upgrade-dialog")).toBeVisible();

    // A free user whose email is gated must still be able to get the PDF.
    // That route is the Actions menu — the dialog has to close first, since
    // it is modal and the menu's items are not rendered until it opens.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("upgrade-dialog")).toBeHidden();
    await page.getByTestId("quote-actions-trigger").click();
    await expect(page.getByTestId("download-pdf")).toBeVisible();

    expect(emailed).toBe(false);
  });

  test("subscription API reports usage", async ({ request }) => {
    const patchRes = await request.patch("/api/subscription", {
      data: { tier: "pro" },
    });
    expect(patchRes.ok()).toBeTruthy();

    const res = await request.get("/api/subscription");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.tier).toBe("pro");
    expect(body.quoteLimit).toBe(15);
    expect(typeof body.quotesUsed).toBe("number");
    expect(body.tierLabel).toBe("Pro");
    expect(body.quotesRemaining).toBe(Math.max(0, 15 - body.quotesUsed));
  });

  test("plan visibility surfaces show tier and remaining", async ({ page, request }) => {
    await request.patch("/api/subscription", { data: { tier: "free" } });

    // Dashboard: badge shows tier + zero-remaining state (e2e user is over the cap)
    await page.goto("/dashboard");
    await expect(page.getByTestId("quota-badge")).toContainText("Free");
    await expect(page.getByTestId("quota-remaining")).toHaveText("No quotes left this month");

    // Header chip visible on any authenticated page
    await expect(page.getByTestId("plan-chip")).toHaveText("Free");

    // New Quote banner appears at 0 remaining
    await page.goto("/new-quote");
    await expect(page.getByTestId("quota-banner")).toBeVisible();
    await expect(page.getByTestId("quota-banner")).toContainText("used all 3 quotes");
  });

  test("New Quote controls disable at the monthly cap and re-enable after upgrade", async ({
    page,
    request,
  }) => {
    // Free + e2e user over the cap → zero remaining → controls disabled.
    await request.patch("/api/subscription", { data: { tier: "free" } });
    await page.goto("/dashboard");

    const hint = "No quotes left this month — upgrade your plan to create more.";

    // Dashboard button: a real disabled <button> (not a link), with the hint.
    const button = page.getByTestId("new-quote-button").first();
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("title", hint);

    // Header nav: rendered as a disabled span, not a link.
    const nav = page.getByTestId("new-quote-nav");
    await expect(nav).toHaveAttribute("aria-disabled", "true");
    await expect(nav).toHaveAttribute("title", hint);
    await expect(nav).toHaveJSProperty("tagName", "SPAN");

    // Upgrade → unlimited → controls become live links again.
    await request.patch("/api/subscription", { data: { tier: "ultimate" } });
    await page.goto("/dashboard");

    const enabledButton = page.getByTestId("new-quote-button").first();
    await expect(enabledButton).toBeEnabled();
    await expect(enabledButton).toHaveJSProperty("tagName", "A");
    await expect(page.getByTestId("new-quote-nav")).toHaveJSProperty(
      "tagName",
      "A"
    );
  });
});
