import { test, expect } from "@playwright/test";
import { openNewQuoteForNewClient } from "./helpers/new-quote";

/**
 * Critical journey: build a quote from catalog items, save it,
 * send it to the client (mocked Resend), verify send metadata is
 * recorded, and record payments against the schedule to mark it paid.
 */

const CLIENT_NAME = `E2E Client ${Date.now()}`;
const CLIENT_EMAIL = `e2e-client-${Date.now()}@example.com`;

test.describe("quote flow", () => {
  test.describe.configure({ mode: "serial" });

  test("create quote from catalog + ad-hoc line, totals correct", async ({
    page,
  }) => {
    // Ensure the electrical starter items exist (idempotent import)
    await page.goto("/dashboard?tab=catalog");
    await expect(page.getByTestId("catalog-tab")).toBeVisible({
      timeout: 15_000,
    });
    const hasItems = await page
      .getByTestId("work-item-Electrician labor")
      .isVisible()
      .catch(() => false);
    if (!hasItems) {
      await page.getByTestId("import-starter-button").click();
      await page.getByTestId("trade-checkbox-electrical").click();
      await page.getByTestId("import-confirm-button").click();
      await expect(page.getByTestId("import-starter-dialog")).toBeHidden({
        timeout: 15_000,
      });
    }

    // Build the quote
    await openNewQuoteForNewClient(page);
    await page.getByTestId("client-name-input").fill(CLIENT_NAME);
    await page.getByTestId("client-email-input").fill(CLIENT_EMAIL);
    await page.getByTestId("project-name-input").fill("E2E Test Project");

    // Add two catalog items
    await page.getByTestId("picker-add-Electrician labor").click();
    await page.getByTestId("picker-add-Outlet installation").click();

    // Adjust quantity of first line: 2 hours of labor @ $100 = $200
    const quantityInputs = page.getByTestId("line-quantity-input");
    await quantityInputs.first().fill("2");

    // Add an ad-hoc line: 1 x $50
    await page.getByTestId("add-adhoc-line-button").click();
    const descriptions = page.getByTestId("line-description-input");
    await descriptions.last().fill("Misc supplies");
    const prices = page.getByTestId("line-price-input");
    await prices.last().fill("50");

    // Totals: 2*100 + 1*150 + 1*50 = 400 (no tax — total == subtotal)
    await expect(page.getByTestId("subtotal")).toHaveText("$400.00");
    await expect(page.getByTestId("quote-total")).toHaveText("$400.00");

    // Save → redirected to quote page
    await page.getByTestId("save-quote-button").click();
    await page.waitForURL(/\/quote\/(Q-\d{4}-\d+|[0-9a-f-]+)/, { timeout: 30_000 });

    await expect(page.getByTestId("quote-status-badge")).toHaveText("Unpaid");
    await expect(page.getByText("E2E Test Project")).toBeVisible();
    await expect(page.getByText("$400.00").first()).toBeVisible();
  });

  test("send quote via email (mocked) records send metadata", async ({
    page,
    request,
  }) => {
    // Email invoicing is Pro+; a Free user gets 403 EMAIL_REQUIRES_PRO on
    // /api/send-quote. Ensure the shared e2e user is on a paid tier before
    // sending (tiers.spec may have left it Free from an earlier run).
    const tierRes = await request.patch("/api/subscription", {
      data: { tier: "ultimate" },
    });
    expect(tierRes.ok()).toBeTruthy();

    // Find the quote created above via the Clients tab
    await page.goto("/dashboard?tab=clients");
    await expect(page.getByTestId("clients-tab")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId(`client-toggle-${CLIENT_NAME}`).click();

    // Open the quote
    const quoteRow = page.locator('[data-testid^="quote-row-"]').first();
    await expect(quoteRow).toBeVisible();
    await quoteRow.getByRole("link").click();
    await page.waitForURL(/\/quote\/(Q-\d{4}-\d+|[0-9a-f-]+)/);

    // Send (Resend mocked via RESEND_MOCK=1)
    await page.getByTestId("send-quote-button").click();
    await expect(page.getByTestId("send-quote-dialog")).toBeVisible();
    await expect(page.getByTestId("send-email-input")).toHaveValue(
      CLIENT_EMAIL
    );
    await page.getByTestId("send-confirm-button").click();

    await expect(page.getByTestId("send-quote-dialog")).toBeHidden({
      timeout: 30_000,
    });
    // Sending records metadata; the status badge stays payment-based
    await expect(page.getByTestId("sent-meta")).toContainText("Quote sent 1×", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("quote-status-badge")).toHaveText("Unpaid");

    // Record payments against every milestone in the default schedule to
    // cover the full balance — the quote was sent, so a recipient email is
    // on file and each payment's receipt can be sent from the payment
    // history card.
    await expect(page.getByTestId("payment-schedule-card")).toBeVisible({
      timeout: 15_000,
    });
    for (const i of [0, 1, 2, 3]) {
      await page.getByTestId(`record-payment-${i}`).click();
      await page.waitForSelector('[data-testid="record-payment-dialog"]');
      await page.getByTestId("payment-save").click();
      await page.waitForSelector('[data-testid="record-payment-dialog"]', {
        state: "detached",
      });
    }

    await expect(page.getByTestId("quote-status-badge")).toHaveText("Paid", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("balance-due")).toHaveText("$0.00");

    // Send a receipt for one recorded payment (mocked Resend). The
    // recipient email is on file (set when the quote was sent above), so
    // the receipt button is enabled; a sent receipt turns its icon green
    // and updates the tooltip — assert via the title attribute.
    await expect(page.getByTestId("payment-history-card")).toBeVisible();
    const receiptButton = page
      .locator('[data-testid^="send-payment-receipt-"]')
      .first();
    await receiptButton.click();
    await expect(receiptButton).toHaveAttribute(
      "title",
      /Receipt sent 1×/,
      { timeout: 15_000 }
    );
  });
});
