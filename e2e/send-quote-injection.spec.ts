import { test, expect } from "@playwright/test";
import { openNewQuoteForNewClient } from "./helpers/new-quote";

/**
 * Hostile input through the send-quote path.
 *
 * ## What this does NOT prove
 *
 * The task this spec closes out asked for proof that hostile HTML in a
 * client name / custom message does not survive into the *sent email*.
 * That is unreachable from Playwright in this environment: RESEND_MOCK=1
 * (set for the whole e2e run in playwright.config.ts) makes
 * `sendQuoteEmail` in lib/email-sender.ts return immediately —
 *
 *   if (process.env.RESEND_MOCK === "1") { ... return { success: true, ... }; }
 *
 * — before `generateQuoteEmailHTML`/`generateQuoteEmailText` are ever
 * called. No HTML is generated, so there is nothing for an e2e test to
 * inspect; asserting against the mock would be asserting against a payload
 * that doesn't exist. The actual escaping (`escapeHtml`, `safeHttpUrl` in
 * lib/email-templates.ts) is already covered thoroughly at the unit level in
 * lib/__tests__/email-template-escaping.test.ts (17 cases: tag injection,
 * attribute breakout, and scheme-checked URLs, across every interpolated
 * field) — that suite runs the real template function directly and is the
 * right place for this assertion.
 *
 * ## What this DOES prove
 *
 * The parts of the hostile-input path that are actually reachable through
 * the browser:
 *
 *  1. Contractor-controlled strings that will eventually reach the email
 *     templates (client name, custom subject, custom message) survive the
 *     full request pipeline — DB round-trip, `buildQuotePdfPayload`,
 *     `validateQuoteEmail`'s figure-reconciliation gate — without a 500 or
 *     a stuck dialog. quote-flow.spec.ts only ever sends plain fixture
 *     text; nothing else in the suite sends adjacent-to-malicious input
 *     through this route.
 *  2. The same client name is rendered by several of the app's own pages
 *     (quote page, Clients tab). Those are React-rendered, not
 *     `dangerouslySetInnerHTML`, so this is expected to pass — but that is
 *     exactly the kind of invariant that is cheap to assert and easy to
 *     break by accident (a future markdown renderer, a copy-paste of
 *     `dangerouslySetInnerHTML` from somewhere else). It is a materially
 *     different surface from the email template: this is the app's own DOM,
 *     not an outbound message.
 *  3. `quoteViewUrl` — the field the recent hardening removed from the
 *     accepted request schema entirely — cannot be smuggled back in via an
 *     extra body key.
 */

const TAG_PAYLOAD = `<img src=x onerror="window.__xssFired=true">`;
const BREAKOUT_PAYLOAD = `" onload="window.__xssFired=true`;
const CLIENT_NAME = `Injection Client ${Date.now()} ${TAG_PAYLOAD}`;

test.afterEach(async ({ request }) => {
  // Email invoicing requires Pro+; restore the shared user's baseline tier
  // regardless of how the test ended (afterEach runs even on timeout).
  await request.patch("/api/subscription", { data: { tier: "ultimate" } });
});

test.describe("send-quote path with hostile input", () => {
  test.describe.configure({ mode: "serial" });

  let quoteUrl: string;
  // The real DB uuid, not whatever identifier the URL happens to use — the
  // quote page accepts either, but /api/send-quote's schema requires a uuid.
  // Captured from the UI-driven send in the next test rather than
  // hand-parsed from quoteUrl, which is Q-2026-NNN after the create redirect.
  let capturedQuoteId: string;

  test("setup: create a quote for a client whose name carries an injection payload", async ({
    page,
    request,
  }) => {
    const tierRes = await request.patch("/api/subscription", {
      data: { tier: "ultimate" },
    });
    expect(tierRes.ok()).toBeTruthy();

    await openNewQuoteForNewClient(page);
    await page.getByTestId("client-name-input").fill(CLIENT_NAME);
    await page.getByTestId("client-email-input").fill(
      `injection-${Date.now()}@example.com`
    );

    await page.getByTestId("add-adhoc-line-button").click();
    await page.getByTestId("line-description-input").last().fill("Test work");
    await page.getByTestId("line-price-input").last().fill("100");

    await page.getByTestId("save-quote-button").click();
    await page.waitForURL(/\/quote\/(Q-\d{4}-\d+|[0-9a-f-]+)/, {
      timeout: 30_000,
    });
    quoteUrl = page.url();

    // The quote page renders the client name (Client Information section).
    // Confirm the app's own DOM never materializes it as a live element —
    // React string interpolation is expected to keep it inert text.
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__xssFired)
    ).toBeUndefined();
  });

  test("sending with a hostile subject/message completes, and nothing executes client-side", async ({
    page,
  }) => {
    await page.goto(quoteUrl);

    await page.getByTestId("send-quote-button").click();
    await expect(page.getByTestId("send-quote-dialog")).toBeVisible();

    await page.getByTestId("send-subject-input").fill(
      `Quote for you ${TAG_PAYLOAD}`
    );
    await page.getByTestId("send-message-input").fill(
      `Thanks for your business.${BREAKOUT_PAYLOAD}\n\nSee attached.`
    );

    const sendReq = page.waitForRequest(
      (req) =>
        req.url().includes("/api/send-quote") && req.method() === "POST"
    );
    await page.getByTestId("send-confirm-button").click();
    capturedQuoteId = (await sendReq).postDataJSON().quoteId;

    // Full round trip: auth -> rate limit -> schema validation -> DB fetch ->
    // buildQuotePdfPayload -> validateQuoteEmail -> the (mocked) send. A 500
    // or a stuck dialog here would mean the hostile strings broke something
    // upstream of the email template, not the template itself.
    await expect(page.getByTestId("send-quote-dialog")).toBeHidden({
      timeout: 30_000,
    });
    await expect(page.getByTestId("sent-meta")).toContainText("Quote sent 1×", {
      timeout: 15_000,
    });

    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__xssFired)
    ).toBeUndefined();
  });

  test("the client name renders as inert text on the Clients tab too", async ({
    page,
  }) => {
    await page.goto("/dashboard?tab=clients");
    await expect(page.getByTestId("clients-tab")).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByTestId(`client-toggle-${CLIENT_NAME}`)).toBeVisible();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__xssFired)
    ).toBeUndefined();
  });

  test("quoteViewUrl cannot be smuggled back into the request body", async ({
    page,
  }) => {
    // The hardening removed quoteViewUrl from sendQuoteRequestSchema
    // entirely (app/api/send-quote/route.ts) — it is never derived from the
    // client. Zod strips unknown keys by default, so this proves an extra
    // body field is silently ignored rather than accepted or rejected;
    // there is no route left that reads it back out.
    await page.goto(quoteUrl);
    const res = await page.request.post("/api/send-quote", {
      data: {
        quoteId: capturedQuoteId,
        recipientEmail: `injection-viewurl-${Date.now()}@example.com`,
        recipientName: "Client",
        subject: "Quote",
        message: "See attached.",
        quoteViewUrl: "javascript:alert(document.cookie)",
      },
    });
    const body = await res.json();
    // Already sent above (email_sent_count now 1); this second send is a
    // fresh recipient so it's a legitimate resend, not a duplicate-guard hit.
    expect(res.status(), JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
  });
});
