import { test, expect } from "@playwright/test";

/**
 * Business logo upload/remove flow in Profile Settings: upload a PNG via
 * the hidden file input, verify the preview + persistence across dialog
 * reopen + the API-reported logoUrl, then remove it (leaves the e2e
 * user's profile clean). Second test checks client-side type validation.
 *
 * Note: GET /api/profile nests the payload as { success, profile: {...} },
 * so assertions read `.profile.logoUrl`.
 */

// 1x1 transparent PNG
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function openProfileSettings(page: import("@playwright/test").Page) {
  await page.goto("/dashboard");
  await page.getByTestId("user-menu-trigger").click();
  await page.getByTestId("menu-profile-settings").click();
  await expect(page.getByTestId("profile-settings-dialog")).toBeVisible();
}

test.describe("business logo", () => {
  test("upload shows preview and persists; remove clears it", async ({ page }) => {
    await openProfileSettings(page);

    // Upload
    await page.getByTestId("logo-file-input").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: PNG_1PX,
    });
    await expect(page.getByTestId("logo-preview").locator("img")).toBeVisible();

    // Persists across dialog reopen
    await page.keyboard.press("Escape");
    await openProfileSettings(page);
    await expect(page.getByTestId("logo-preview").locator("img")).toBeVisible();

    // API reflects it
    const body = await (await page.request.get("/api/profile")).json();
    expect(body.profile.logoUrl).toContain("/logos/");

    // Remove
    await page.getByTestId("logo-remove-button").click();
    await expect(page.getByTestId("logo-preview").locator("img")).toHaveCount(0);
    const after = await (await page.request.get("/api/profile")).json();
    expect(after.profile.logoUrl).toBeNull();
  });

  test("rejects a non-image file client-side", async ({ page }) => {
    await openProfileSettings(page);
    await page.getByTestId("logo-file-input").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await expect(page.getByTestId("logo-error")).toContainText("PNG or JPG");
  });
});
