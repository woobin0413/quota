import { test, expect } from "@playwright/test";

const CUSTOM_ITEM = `Custom test item ${Date.now()}`;

test.describe("work catalog", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard?tab=catalog");
    await expect(page.getByTestId("catalog-tab")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("import starter items for a trade", async ({ page }) => {
    await page.getByTestId("import-starter-button").click();
    await expect(page.getByTestId("import-starter-dialog")).toBeVisible();

    await page.getByTestId("trade-checkbox-electrical").click();
    await page.getByTestId("import-confirm-button").click();

    await expect(page.getByTestId("import-starter-dialog")).toBeHidden({
      timeout: 15_000,
    });

    // Starter electrical items now in the list
    await expect(
      page.getByTestId("work-item-Electrician labor")
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId("work-item-Outlet installation")
    ).toBeVisible();
  });

  test("add a custom work item", async ({ page }) => {
    await page.getByTestId("add-work-item-button").click();
    await expect(page.getByTestId("work-item-form")).toBeVisible();

    await page.getByTestId("work-item-name-input").fill(CUSTOM_ITEM);
    await page.getByTestId("work-item-price-input").fill("123.45");
    await page.getByTestId("work-item-save-button").click();

    const row = page.getByTestId(`work-item-${CUSTOM_ITEM}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("$123.45");
  });

  test("edit a work item price inline", async ({ page }) => {
    const row = page.getByTestId(`work-item-${CUSTOM_ITEM}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`price-${CUSTOM_ITEM}`).click();
    await page.getByTestId("edit-price-input").fill("199.99");
    await page.getByTestId("save-price-button").click();

    await expect(row).toContainText("$199.99", { timeout: 15_000 });

    // Persists after reload
    await page.reload();
    await expect(page.getByTestId(`work-item-${CUSTOM_ITEM}`)).toContainText(
      "$199.99",
      { timeout: 15_000 }
    );
  });

  test("deactivate a work item removes it from the list", async ({ page }) => {
    const row = page.getByTestId(`work-item-${CUSTOM_ITEM}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`remove-${CUSTOM_ITEM}`).click();
    await expect(row).toBeHidden({ timeout: 15_000 });

    // Still gone after reload
    await page.reload();
    await expect(page.getByTestId("catalog-tab")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`work-item-${CUSTOM_ITEM}`)).toBeHidden();
  });
});
