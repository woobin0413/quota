#!/usr/bin/env node
/**
 * Provision the Auth0 objects the native app needs.
 *
 *   node scripts/auth0-mobile-api.mjs --dry
 *   node scripts/auth0-mobile-api.mjs
 *
 * Creates (idempotently):
 *   1. a Resource Server (API) — its identifier is AUTH0_AUDIENCE, and it is
 *      what makes access tokens verifiable JWTs instead of opaque strings
 *   2. a Native application using Authorization Code + PKCE — its client id is
 *      AUTH0_MOBILE_CLIENT_ID, consumed by the mobile repo
 *
 * The claims Action is NOT created here: Actions are versioned, deployed, and
 * bound to a flow through three separate API calls, and getting that wrong
 * silently breaks every login. Paste scripts/auth0-actions/add-api-claims.js in
 * by hand — same convention as skip-mfa-for-e2e.js.
 *
 * M2M scopes required: create:resource_servers, read:resource_servers,
 * update:resource_servers, create:clients, read:clients, update:clients.
 * The update: scopes are not optional — a re-run PATCHes the token lifetimes
 * and the refresh-token rotation policy onto objects that already exist.
 *
 * That PATCH REPLACES `callbacks` and `allowed_logout_urls` wholesale — it does
 * not merge. A second scheme added by hand in the dashboard (a dev build, a
 * universal link, a simulator redirect) is silently dropped on the next run.
 * Add extra URLs to `nativeApp` below, not in the dashboard.
 *
 * Reads .env.local for the Management API credentials, like the other
 * scripts/auth0-*.mjs; real environment variables win over the file.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- tiny .env.local loader (no dependency) ---
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const raw = readFileSync(join(root, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    // Trailing `#` comments must be stripped, because the values documented in
    // .env.example carry them and Next.js's dotenv strips them when it reads
    // this same file. Without this the script and the app disagree about one
    // file, and `AUTH0_AUDIENCE` becomes the identifier PLUS its own comment —
    // which this script would happily create as a resource server and report as
    // success. A quoted value keeps its `#` (postal addresses have "Suite #4"),
    // which is also what dotenv does.
    //
    // `\s*#`, not `\s+#`: dotenv's `[^#\r\n]+` stops at the FIRST `#` whether or
    // not whitespace precedes it. Requiring whitespace would turn a commented-out
    // `AUTH0_AUDIENCE=   # set this` into the literal value "# set this", which is
    // non-empty and so beats the `|| "https://api.sendquota.com"` fallback below —
    // and gets POSTed as a resource-server identifier.
    let val = m[2];
    const quoted = val.match(/^(["'])([\s\S]*?)\1/);
    val = quoted ? quoted[2] : val.replace(/\s*#.*$/, "").trim();
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
} catch {
  /* no .env.local — rely on real env */
}

const DRY = process.argv.includes("--dry");

const AUDIENCE = process.env.AUTH0_AUDIENCE || "https://api.sendquota.com";
const MGMT_DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET;
const MOBILE_SCHEME = process.env.AUTH0_MOBILE_SCHEME || "com.sendquota.app";

if (!MGMT_DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Missing AUTH0_MGMT_DOMAIN/AUTH0_DOMAIN, AUTH0_MGMT_CLIENT_ID or AUTH0_MGMT_CLIENT_SECRET"
  );
  process.exit(1);
}

async function token() {
  const res = await fetch(`https://${MGMT_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      audience: `https://${MGMT_DOMAIN}/api/v2/`,
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function api(tok, path, init = {}) {
  const res = await fetch(`https://${MGMT_DOMAIN}/api/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const resourceServer = {
  name: "Quota Mobile API",
  identifier: AUDIENCE,
  signing_alg: "RS256",
  // One hour. Access tokens are verified offline against JWKS, so there is no
  // revocation path — the lifetime IS the exposure window for a token lifted
  // off a device or a debug proxy. Short-lived access token plus a rotating
  // refresh token is what makes revocation possible at all.
  token_lifetime: 3600,
  // Required for the tenant to issue refresh tokens for this audience. Without
  // it, requesting the `offline_access` scope silently returns none, and the
  // app is stuck re-running the full login every hour.
  allow_offline_access: true,
  skip_consent_for_verifiable_first_party_clients: true,
};

const nativeApp = {
  name: "Quota Mobile",
  app_type: "native",
  // PKCE. A native binary cannot hold a client secret — it ships to the device.
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  callbacks: [`${MOBILE_SCHEME}://callback`],
  allowed_logout_urls: [`${MOBILE_SCHEME}://callback`],
  oidc_conformant: true,
  refresh_token: {
    // Rotating, not reusable. Each refresh returns a new token and invalidates
    // the old one, which buys two things a static refresh token cannot:
    // revocation, and automatic reuse detection — replaying a spent token makes
    // Auth0 revoke the entire family, cutting off a thief and the real device
    // together. That is the signal you want on a stolen-credential event.
    rotation_type: "rotating",
    expiration_type: "expiring",
    // Absolute ceiling: 30 days. A device untouched longer than that re-logs in.
    token_lifetime: 2592000,
    // Idle ceiling: 15 days without use and the token dies, so an abandoned or
    // resold phone stops being a live credential.
    idle_token_lifetime: 1296000,
    infinite_token_lifetime: false,
    infinite_idle_token_lifetime: false,
    // Grace window for a rotation whose response was lost to a dropped
    // connection. Without it, a contractor in a basement with one bar gets
    // logged out by a network blip; too wide and a stolen token has a usable
    // replay window. 30s is Auth0's documented default for this reason.
    leeway: 30,
  },
};

const tok = await token();

// Existing objects are PATCHed rather than skipped: the token lifetimes and the
// refresh-token rotation policy are the security-relevant part, and a run that
// silently left an old 24h lifetime in place would report success while leaving
// the tenant misconfigured.
const existingApis = await api(tok, "/resource-servers?per_page=100");
const foundApi = existingApis.find((r) => r.identifier === AUDIENCE);
if (DRY) {
  console.log(
    `[dry] would ${foundApi ? "update" : "create"} resource server:`,
    JSON.stringify(resourceServer, null, 2)
  );
} else if (foundApi) {
  // identifier is immutable; PATCHing it 400s.
  const { identifier, ...patch } = resourceServer;
  await api(tok, `/resource-servers/${foundApi.id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  console.log(`Updated API ${AUDIENCE} (id ${foundApi.id})`);
} else {
  const created = await api(tok, "/resource-servers", {
    method: "POST",
    body: JSON.stringify(resourceServer),
  });
  console.log(`Created API ${created.identifier} (id ${created.id})`);
}

const clients = await api(tok, "/clients?per_page=100&fields=client_id,name,app_type&include_fields=true");
const foundApp = clients.find((c) => c.name === nativeApp.name);
// Matching is by name, so a pre-existing client that merely shares the name has
// to stop the run. app_type is immutable and therefore stripped from the PATCH
// below, so pushing this body onto a regular web app would apply the PKCE and
// refresh-rotation settings to something that stays a web app — and then print
// "Updated native app", reporting success over a misconfigured tenant.
if (foundApp && foundApp.app_type !== "native") {
  console.error(
    `Refusing to touch the client named "${nativeApp.name}" (client_id ${foundApp.client_id}): ` +
      `expected app_type "native", found "${foundApp.app_type}".`
  );
  console.error(
    "Rename that client in the dashboard, or point this script at a different name."
  );
  process.exit(1);
}
if (DRY) {
  console.log(
    `[dry] would ${foundApp ? "update" : "create"} native app:`,
    JSON.stringify(nativeApp, null, 2)
  );
} else if (foundApp) {
  // app_type is immutable on an existing client.
  const { app_type, ...patch } = nativeApp;
  await api(tok, `/clients/${foundApp.client_id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  console.log(`Updated native app (client_id ${foundApp.client_id})`);
} else {
  const created = await api(tok, "/clients", {
    method: "POST",
    body: JSON.stringify(nativeApp),
  });
  console.log(`Created native app (client_id ${created.client_id})`);
}

console.log("");
console.log("Next, by hand:");
console.log("  1. Paste scripts/auth0-actions/add-api-claims.js into");
console.log("     Actions → Library → Build Custom (Login / Post Login), deploy it,");
console.log("     and drag it into the Login flow.");
console.log(`  2. Set AUTH0_AUDIENCE=${AUDIENCE} in .env.local and in Vercel.`);
console.log("  3. Set AUTH0_MOBILE_CLIENT_ID in the mobile repo (not this one).");
console.log("  4. The app must request the `offline_access` scope alongside");
console.log("     `openid profile email`, or it gets no refresh token and has to");
console.log("     re-run the full login every hour.");
