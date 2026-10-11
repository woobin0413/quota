/**
 * Mobile bearer path — the only test that exercises it end to end.
 *
 * Everything else that touches bearer tokens mocks the JWKS, and the rest of the
 * suite authenticates by cookie. This spec runs the real chain: Auth0 mints a
 * user access token for the mobile API, the app fetches the tenant JWKS, and the
 * token is verified for real.
 *
 * Two things it proves that nothing else does:
 *
 *  1. The post-login Action actually fires and injects the namespaced claims.
 *     A client-credentials token cannot show this — post-login Actions do not
 *     run for machine-to-machine exchanges, which is why a smoke test with one
 *     sees `undefined` for both claims and still 403s "correctly".
 *
 *  2. The claims survive a REFRESH exchange. Access tokens live one hour and
 *     refresh tokens thirty days, so nearly every token the API ever sees comes
 *     from a refresh rather than a login. If the Action did not re-run there,
 *     every mobile session would 403 at exactly the one-hour mark — an
 *     intermittent auth bug that would be very hard to trace back to config.
 *
 * Uses the WEB client with an `audience` rather than the native client: the
 * Action keys on `event.resource_server.identifier`, not on the client, so the
 * claims path is identical, and this avoids the native client's
 * `com.sendquota.app://` callback, which a browser cannot follow. PKCE is used
 * anyway so the exchange mirrors the native one as closely as a confidential
 * client allows.
 */

import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { acceptConsentIfPresent, LOGIN_HOST } from "./helpers/auth0-host";

const DOMAIN = process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET;
const AUDIENCE = process.env.AUTH0_AUDIENCE;
const EMAIL = process.env.E2E_AUTH0_USER_EMAIL;
const PASSWORD = process.env.E2E_AUTH0_USER_PASSWORD;
const APP = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const EMAIL_CLAIM = "https://sendquota.com/email";
const EMAIL_VERIFIED_CLAIM = "https://sendquota.com/email_verified";

const base64url = (b: Buffer) => b.toString("base64url");

function decodeClaims(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
}

async function exchange(body: Record<string, string>) {
  const res = await fetch(`https://${DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`token exchange ${res.status}: ${JSON.stringify(json)}`);
  }
  return json as { access_token: string; refresh_token?: string };
}

test.describe("mobile bearer path (real Auth0 token)", () => {
  test.skip(
    !DOMAIN || !CLIENT_ID || !CLIENT_SECRET || !AUDIENCE || !EMAIL || !PASSWORD,
    "needs AUTH0_DOMAIN, AUTH0_CLIENT_ID/SECRET, AUTH0_AUDIENCE and E2E_AUTH0_USER_EMAIL/PASSWORD"
  );

  test("claims are injected at login, survive refresh, and authorize the API", async ({
    page,
  }) => {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const redirectUri = `${APP}/auth/callback`;

    // Stop the Auth0 SDK route from consuming the code and redirecting away —
    // without this the callback URL is gone before it can be read.
    await page.route("**/auth/callback*", (route) =>
      route.fulfill({ status: 200, body: "intercepted" })
    );

    const authorize = new URL(`https://${DOMAIN}/authorize`);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", CLIENT_ID!);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("audience", AUDIENCE!);
    // offline_access is what makes Auth0 issue the refresh token this test needs.
    authorize.searchParams.set("scope", "openid profile email offline_access");
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("state", base64url(randomBytes(16)));

    await page.goto(authorize.toString());

    // A live Auth0 SSO cookie (the suite's saved storageState carries one) skips
    // the login form entirely and lands straight on consent, so the form is
    // conditional on actually being rendered — not merely on being on the
    // Auth0 host.
    const loginFormVisible = await page
      .locator("input#username, input[name=username]")
      .isVisible()
      .catch(() => false);

    if (page.url().includes(LOGIN_HOST) && loginFormVisible) {
      await page.fill("input#username, input[name=username]", EMAIL!);
      const passwordVisible = await page
        .locator("input#password, input[name=password]")
        .isVisible()
        .catch(() => false);
      if (!passwordVisible) {
        await page
          .locator("button[type=submit][name=action], button[type=submit]")
          .first()
          .click();
      }
      await page.fill("input#password, input[name=password]", PASSWORD!);
      await page
        .locator("button[type=submit][name=action], button[type=submit]")
        .first()
        .click();
    }

    // Auth0 shows "Authorize App" here even though the API sets
    // skip_consent_for_verifiable_first_party_clients: a localhost callback is
    // not a *verifiable* first-party origin. The helper's default settledUrl is
    // /dashboard, which this flow never reaches — the callback is the settle
    // point, and passing the wrong one makes this hang for the full timeout.
    await acceptConsentIfPresent(page, { settledUrl: "**/auth/callback*" });

    await page.waitForURL(/\/auth\/callback\?.*code=/, { timeout: 30_000 });
    const code = new URL(page.url()).searchParams.get("code");
    expect(code, "authorization code in the callback URL").toBeTruthy();

    // ---- Login exchange -------------------------------------------------
    const first = await exchange({
      grant_type: "authorization_code",
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      code: code!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });

    expect(first.refresh_token, "offline_access must yield a refresh token").toBeTruthy();

    const loginClaims = decodeClaims(first.access_token);
    expect(loginClaims.iss).toBe(`https://${DOMAIN}/`);
    expect(
      Array.isArray(loginClaims.aud) ? loginClaims.aud : [loginClaims.aud]
    ).toContain(AUDIENCE);
    // The Action fired. Without it both of these are undefined and every mobile
    // user is held at the 403 gate forever.
    expect(loginClaims[EMAIL_CLAIM], "namespaced email claim").toBe(EMAIL);
    expect(loginClaims[EMAIL_VERIFIED_CLAIM], "namespaced email_verified claim").toBe(
      true
    );

    const loginRes = await fetch(`${APP}/api/v1/me`, {
      headers: { Authorization: `Bearer ${first.access_token}` },
    });
    // Read the body once — passing `await res.text()` as the expect message and
    // then calling res.json() drains the stream and throws on the second read.
    const loginBody = await loginRes.text();
    expect(loginRes.status, loginBody).toBe(200);
    const me = JSON.parse(loginBody);
    expect(me.success).toBe(true);
    expect(me.user.email).toBe(EMAIL);
    expect(me.subscription).toHaveProperty("tier");
    expect(me.subscription).toHaveProperty("quotesUsed");

    // ---- Refresh exchange (the actual point of this spec) ----------------
    const refreshed = await exchange({
      grant_type: "refresh_token",
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: first.refresh_token!,
    });

    const refreshedClaims = decodeClaims(refreshed.access_token);
    expect(
      refreshedClaims[EMAIL_CLAIM],
      "email claim must survive the refresh exchange — if it does not, every mobile session 403s one hour after login"
    ).toBe(EMAIL);
    expect(
      refreshedClaims[EMAIL_VERIFIED_CLAIM],
      "email_verified claim must survive the refresh exchange"
    ).toBe(true);

    const refreshedRes = await fetch(`${APP}/api/v1/me`, {
      headers: { Authorization: `Bearer ${refreshed.access_token}` },
    });
    expect(refreshedRes.status, await refreshedRes.text()).toBe(200);
  });
});
