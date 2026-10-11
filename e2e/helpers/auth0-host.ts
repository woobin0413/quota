/**
 * The host that serves Universal Login.
 *
 * Specs used to match the redirect target against a literal `auth0.com`. That
 * breaks the moment a custom domain is configured: users are sent to
 * `auth.sendquota.com`, which contains no "auth0.com" at all, so
 * `waitForURL(/auth0\.com/)` sits on the login form until it times out — a
 * 30-second failure that looks like broken credentials rather than a bad match.
 *
 * Read `AUTH0_DOMAIN` instead, which is the domain users are actually
 * redirected to. Deliberately *not* `AUTH0_MGMT_DOMAIN`: that one stays pinned
 * to the canonical tenant domain because the Management API audience never
 * moves to the custom domain.
 */

import type { Page } from "@playwright/test";

/** Domain serving Universal Login; falls back to the vendor suffix. */
export const LOGIN_HOST = process.env.AUTH0_DOMAIN ?? "auth0.com";

/** `LOGIN_HOST` as a regex, for `page.waitForURL`. */
export const loginHostPattern = (): RegExp =>
  new RegExp(LOGIN_HOST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

/**
 * Click through Auth0's "Authorize App" screen when it appears.
 *
 * Localhost clients are not first-party, so Auth0 asks for consent on *every*
 * authorization — not just the first. Any flow that returns to `/auth/login`
 * after signup (re-minting the session once `email_verified` flips) meets it a
 * second time, which is easy to miss because the first one is handled right
 * after the signup form.
 *
 * Races the consent button against actually landing on `settledUrl` rather than
 * waiting a fixed slice. A fixed wait has to be short enough not to tax the
 * common no-consent path, and on a slow runner that is too short for the screen
 * to appear at all — the click then silently no-ops and the caller blocks on a
 * navigation that will never happen. Racing lets the timeout be generous
 * without costing anything when there is no consent screen.
 */
export async function acceptConsentIfPresent(
  page: Page,
  opts: { timeout?: number; settledUrl?: string } = {}
): Promise<void> {
  const { timeout = 20_000, settledUrl = "**/dashboard**" } = opts;
  const button = page
    .locator('button[value=accept], button:has-text("Accept")')
    .first();

  const outcome = await Promise.race([
    button.waitFor({ state: "visible", timeout }).then(() => "consent" as const),
    page.waitForURL(settledUrl, { timeout }).then(() => "settled" as const),
  ]).catch(() => "none" as const);

  if (outcome === "consent") {
    await button.click().catch(() => undefined);
  }
}
