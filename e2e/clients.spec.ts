import { test, expect } from "@playwright/test";
import { openNewQuoteForNewClient } from "./helpers/new-quote";

/**
 * Clients tab + quote page payments flow: create a client/quote, record
 * a partial payment against the first milestone from the Payment Schedule
 * card, cover the remaining milestones to mark the quote paid, verify the
 * Clients tab badge and payment history reflect it, and check the
 * edit-schedule guard (percentages must sum to 100).
 */

const CLIENT_NAME = `Paid Client ${Date.now()}`;

test.describe("clients & payments", () => {
  test.describe.configure({ mode: "serial" });

  let quoteNumber: string;
  let quoteUrl: string;

  test("setup: create a quote for a fresh client", async ({ page }) => {
    await openNewQuoteForNewClient(page);
    await page.getByTestId("client-name-input").fill(CLIENT_NAME);

    await page.getByTestId("add-adhoc-line-button").click();
    await page.getByTestId("line-description-input").last().fill("Test work");
    await page.getByTestId("line-price-input").last().fill("100");

    await page.getByTestId("save-quote-button").click();
    await page.waitForURL(/\/quote\/(Q-\d{4}-\d+|[0-9a-f-]+)/, { timeout: 30_000 });
    quoteUrl = page.url();

    const numberText = await page
      .getByText(/Quote #Q-/)
      .first()
      .textContent();
    quoteNumber = numberText!.replace("Quote #", "").trim();
    expect(quoteNumber).toMatch(/^Q-/);
  });

  test("record a partial payment from the schedule", async ({ page }) => {
    await page.goto(quoteUrl);
    await expect(page.getByTestId("payment-schedule-card")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("record-payment-0").click();
    await page.waitForSelector('[data-testid="record-payment-dialog"]');
    await page
      .getByTestId("payment-note-input")
      .fill("deposit check #77");
    await page.getByTestId("payment-save").click();
    await expect(page.getByTestId("record-payment-dialog")).toBeHidden({
      timeout: 15_000,
    });

    await expect(page.getByTestId("quote-status-badge")).toContainText(
      "Partially Paid"
    );
    await expect(page.getByTestId("milestone-status-0")).toContainText(
      "Paid"
    );
  });

  test("covering the balance marks the quote paid", async ({ page }) => {
    await page.goto(quoteUrl);
    await expect(page.getByTestId("payment-schedule-card")).toBeVisible({
      timeout: 15_000,
    });

    // Record the remaining milestones (1..3) at their prefilled amounts
    for (const i of [1, 2, 3]) {
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
  });

  test("clients tab reflects the paid quote", async ({ page }) => {
    await page.goto("/dashboard?tab=clients");
    await expect(page.getByTestId("clients-tab")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId(`client-toggle-${CLIENT_NAME}`).click();
    await expect(page.getByTestId(`paid-badge-${quoteNumber}`)).toHaveText(
      "Paid"
    );

    await page.getByTestId(`history-${quoteNumber}`).click();
    await expect(page.getByTestId("payment-history-dialog")).toBeVisible();

    const entries = page.getByTestId("payment-history-entry");
    await expect(entries).toHaveCount(4);
    // Payments are ordered paid_at/created_at DESC — the deposit (recorded
    // first, with the note) is oldest, so it sorts last.
    await expect(entries.last()).toContainText("deposit check #77");
  });

  test("schedule guard: percentages must sum to 100", async ({ page }) => {
    // Fresh quote — the paid quote above has payments against every
    // milestone, which would also trip the "has recorded payments" guard;
    // this test wants to isolate the sum-to-100 guard specifically.
    await openNewQuoteForNewClient(page);
    await page.getByTestId("client-name-input").fill(`Schedule Guard ${Date.now()}`);
    await page.getByTestId("add-adhoc-line-button").click();
    await page.getByTestId("line-description-input").last().fill("Test work");
    await page.getByTestId("line-price-input").last().fill("100");
    await page.getByTestId("save-quote-button").click();
    await page.waitForURL(/\/quote\/(Q-\d{4}-\d+|[0-9a-f-]+)/, { timeout: 30_000 });

    await expect(page.getByTestId("payment-schedule-card")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("edit-schedule-button").click();
    await page.waitForSelector('[data-testid="edit-schedule-dialog"]');
    await page.getByTestId("milestone-pct-0").fill("50");
    await page.getByTestId("schedule-save").click();
    await expect(page.getByTestId("edit-schedule-dialog")).toContainText(
      "sum to 100"
    );
  });
});
