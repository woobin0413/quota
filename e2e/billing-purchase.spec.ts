/**
 * Paid signup → card → Pro, end to end against Stripe test mode.
 *
 * Covers the one journey no other spec touches: a brand-new person signs up,
 * lands on Free with no card, enters a test card, and is authorized onto Pro.
 * It runs as its own account because an established user already has a Stripe
 * customer and a tier, which skips the `needsPaymentMethod` branch entirely.
 *
 * Ultimate is deliberately not covered: it is gated as "coming soon", the
 * change-plan route rejects it with 400 TIER_UNAVAILABLE, and every CTA for it
 * is disabled. billing.spec.ts asserts that refusal. When `ultimate` leaves
 * UNAVAILABLE_TIERS, this spec is the template for covering its purchase.
 *
 * Requires a real Auth0 signup and real Stripe test-mode calls, so it skips
 * unless every credential is present (see missingPurchaseEnv). Everything it
 * creates is torn down in afterAll.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { acceptConsentIfPresent, loginHostPattern } from "./helpers/auth0-host";
import {
  TEST_CARD,
  deleteAppUser,
  deleteAuth0User,
  deleteStripeCustomer,
  missingPurchaseEnv,
  restoreSharedUserBaseline,
  throwawayEmail,
  throwawayPassword,
  verifyAuth0User,
} from "./helpers/throwaway-account";

const missing = missingPurchaseEnv();

test.describe.configure({ mode: "serial" });

const email = throwawayEmail();
const password = throwawayPassword();

test.describe("paid signup: new account buys Pro with a test card", () => {
  test.skip(
    missing.length > 0,
    `Needs ${missing.join(", ")} — see e2e/helpers/throwaway-account.ts`
  );

  // The steps are one continuous session, so they share a context rather than
  // taking a fresh one per test — and it starts empty, never the shared
  // storageState, which is an already-provisioned Ultimate user.
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ storageState: undefined });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
    await restoreSharedUserBaseline();
    // Order matters: cancel billing before the identity disappears.
    await deleteStripeCustomer(email);
    await deleteAuth0User(email);
    await deleteAppUser(email);
  });

  test("signs up through Auth0 and lands on the dashboard", async () => {
    // Straight to Universal Login's signup screen — the landing CTA links
    // here directly, there is no in-app email form in between.
    await page.goto("/auth/login?screen_hint=signup&returnTo=%2Fdashboard");
    await page.waitForURL(loginHostPattern(), { timeout: 30_000 });

    await page.fill("input#email, input[name=email], input#username", email);
    await page.fill("input#password, input[name=password]", password);
    await page
      .locator("button[type=submit][name=action], button[type=submit]")
      .first()
      .click();

    await acceptConsentIfPresent(page);

    // The gate sends a fresh signup to /verify-email. Flip the flag in Auth0,
    // then re-mint the session — the cookie still says unverified, exactly as it
    // would for a real user who just clicked the link in their email.
    await verifyAuth0User(email);
    await page.goto("/auth/login?returnTo=%2Fdashboard");
    // Second trip through Universal Login — consent is asked again.
    await acceptConsentIfPresent(page);
    await page.waitForURL("**/dashboard**", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("starts on Free with no card on file", async () => {
    await page.goto("/billing");
    await expect(page.getByTestId("billing-center")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("plan-section")).toContainText("Free");

    const sub = await page.request.get("/api/subscription").then((r) => r.json());
    expect(sub.tier).toBe("free");
  });

  test("entering a test card authorizes the Pro upgrade", async () => {
    await page.goto("/billing");
    await expect(page.getByTestId("billing-center")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("change-plan").click();
    await expect(page.getByTestId("change-plan-dialog")).toBeVisible();

    // Ultimate must not be purchasable from this dialog.
    await expect(page.getByTestId("choose-ultimate")).toBeDisabled();

    await page.getByTestId("choose-pro").click();
    await expect(page.getByTestId("change-plan-confirm")).toBeVisible();
    await page.getByTestId("change-plan-confirm-accept").click();

    // No card yet, so the route answers needsPaymentMethod and the dialog
    // swaps in the Stripe Elements form.
    await expect(page.getByTestId("card-form")).toBeVisible({ timeout: 20_000 });

    const card = page
      .frameLocator('iframe[title="Secure card payment input frame"], iframe[name^="__privateStripeFrame"]')
      .first();
    await card.locator('[name="cardnumber"]').fill(TEST_CARD.number);
    await card.locator('[name="exp-date"]').fill(TEST_CARD.expiry);
    await card.locator('[name="cvc"]').fill(TEST_CARD.cvc);
    await card.locator('[name="postal"]').fill(TEST_CARD.postal);

    // Saving the card retries the plan change automatically, so the dialog
    // closing is the signal that Stripe accepted both.
    await page.getByTestId("card-save").click();
    await expect(page.getByTestId("change-plan-dialog")).toBeHidden({ timeout: 45_000 });

    await expect(page.getByTestId("pm-display")).toContainText("4242", { timeout: 20_000 });
  });

  test("the subscription is live in Stripe and reflected in the app", async () => {
    // The Stripe webhook is the sole writer of subscription_tier, and no
    // `stripe listen` runs in a test environment — so pull the same truth the
    // nightly job does instead of waiting on an event that will not arrive.
    const reconcile = await page.request.post("/api/cron/reconcile-billing", {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(reconcile.ok()).toBeTruthy();

    // Reconcile is global: it also resets the shared e2e user (Ultimate in the
    // DB, no Stripe subscription behind it) to Free, which would break every
    // spec that runs after this one. Put the baseline back immediately.
    await restoreSharedUserBaseline();

    await expect
      .poll(
        async () => (await page.request.get("/api/subscription").then((r) => r.json())).tier,
        { timeout: 30_000, message: "tier never became pro" }
      )
      .toBe("pro");

    await page.goto("/billing");
    await expect(page.getByTestId("plan-section")).toContainText("Pro", { timeout: 20_000 });

    const sub = await page.request.get("/api/subscription").then((r) => r.json());
    expect(sub.quoteLimit).toBe(15);
  });

  test("Ultimate stays unpurchasable even by direct request", async () => {
    const res = await page.request.post("/api/billing/change-plan", {
      data: { targetTier: "ultimate" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("TIER_UNAVAILABLE");

    // The refusal must not have disturbed the plan they paid for.
    const sub = await page.request.get("/api/subscription").then((r) => r.json());
    expect(sub.tier).toBe("pro");
  });
});
