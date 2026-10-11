import { test, expect } from "@playwright/test";
import { LOGIN_HOST, loginHostPattern } from "./helpers/auth0-host";

test.describe("authentication", () => {
  test("unauthenticated user is redirected to Auth0 login", async ({
    browser,
  }) => {
    // Fresh context without the shared storageState
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto("/dashboard");
    await page.waitForURL(loginHostPattern(), { timeout: 30_000 });
    expect(page.url()).toContain(LOGIN_HOST);

    await context.close();
  });

  test("unauthenticated API request gets 401", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const response = await context.request.get("/api/work-items");
    expect(response.status()).toBe(401);
    await context.close();
  });
});
