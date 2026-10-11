import { test, expect } from "@playwright/test";

// Landing page is public — no storageState needed, but the saved auth
// state doesn't hurt; use a fresh context to prove public access.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("landing page", () => {
  test("signed-out header shows Sign up + Sign in, no Dashboard", async ({ page }) => {
    await page.goto("/");
    // Both CTAs go straight to Universal Login — there is no in-app email
    // form in front of it, so `screen_hint=signup` is what distinguishes them.
    await expect(page.getByTestId("nav-signup")).toBeVisible();
    await expect(page.getByTestId("nav-signup")).toHaveAttribute(
      "href",
      "/auth/login?screen_hint=signup&returnTo=%2Fdashboard"
    );
    await expect(page.getByTestId("nav-signin")).toBeVisible();
    await expect(page.getByTestId("nav-signin")).toHaveAttribute(
      "href",
      "/auth/login?returnTo=%2Fdashboard"
    );
    await expect(page.getByTestId("nav-dashboard")).toHaveCount(0);
  });

  test("renders all sections", async ({ page }) => {
    await page.goto("/");
    for (const id of [
      "landing-hero", "landing-voice", "landing-features",
      "landing-pricing", "landing-proof", "landing-faq", "landing-footer",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test("language toggle swaps hero copy", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Price the job.");
    await page.getByTestId("lang-toggle").getByRole("button", { name: "ES" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cotiza el trabajo.");
    // persists across reload
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cotiza el trabajo.");
  });

  test("?lang=es forces Spanish", async ({ page }) => {
    await page.goto("/?lang=es");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cotiza el trabajo.");
  });

  test("waitlist happy path", async ({ page }) => {
    await page.goto("/");
    const email = `wl-e2e-${Date.now()}@example.com`;
    await page.getByTestId("waitlist-email").fill(email);
    await page.getByTestId("waitlist-submit").click();
    await expect(page.getByTestId("waitlist-success")).toBeVisible();
  });

  test("waitlist rejects invalid email client-side", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("waitlist-email").fill("not-an-email");
    await page.getByTestId("waitlist-submit").click();
    // Scoped to the voice section: Next.js's route announcer also has
    // role="alert", which trips Playwright strict mode page-wide.
    await expect(page.getByTestId("landing-voice").getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("waitlist-success")).toHaveCount(0);
  });

  test("voice teaser says it is a phone feature", async ({ page }) => {
    await page.goto("/");
    // The teaser is the first place anyone hears about voice, and it sits
    // above a waitlist form. Someone signing up from a laptop should already
    // know the answer to "where does this run" before they hand over an email.
    await expect(page.getByTestId("landing-voice")).toContainText(
      "phones and tablets"
    );
  });

  test("pricing anchor navigates", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /see pricing/i }).click();
    await expect(page).toHaveURL(/#pricing/);
    await expect(page.getByTestId("landing-pricing")).toBeInViewport();
  });

  test("pricing: Pro lists payment receipts; Ultimate is coming soon (disabled)", async ({ page }) => {
    await page.goto("/#pricing");
    const pricing = page.getByTestId("landing-pricing");
    await expect(pricing).toContainText("Payment receipts");
    // "on your phone" is load-bearing, not decoration: voice is gated to
    // phones and tablets (lib/voice/device.ts), so a bullet that promised it
    // flatly would be selling a desktop feature that does not exist.
    await expect(pricing).toContainText(
      "Voice-to-invoice on your phone — coming soon"
    );
    const ultimateCta = page.getByTestId("pricing-cta-ultimate");
    await expect(ultimateCta).toBeVisible();
    await expect(ultimateCta).toBeDisabled();
    await expect(ultimateCta).toHaveText("Coming soon");
  });

  test("og image endpoint serves a png", async ({ page }) => {
    const res = await page.request.get("/og");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });

  test("hero stamp is visible with reduced motion", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");
    // exact: true — the hero also contains "Get paid." copy that would
    // otherwise trip Playwright strict mode.
    await expect(
      page.getByTestId("landing-hero").getByText("Paid", { exact: true })
    ).toBeVisible();
    await ctx.close();
  });
});
