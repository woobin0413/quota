#!/usr/bin/env node
/**
 * Point Auth0's email provider at Resend over SMTP.
 *
 * Why this exists: with no provider configured, Auth0 sends verification and
 * password-reset mail through its own built-in test service, which is
 * rate-limited and delivers ONLY to the tenant owner's address. Real signups
 * silently receive nothing, and no application change can fix it.
 *
 * Resend is already the app's sender for quotes, and its domain is verified, so
 * SMTP here means one consistent From address and no new DNS work.
 *
 * Requires on the M2M app: read:email_provider create:email_provider
 *   update:email_provider
 *
 * Not `read:emails`/`update:emails` — those scope names do not exist and 403
 * with insufficient_scope. Creating the first provider is a POST, so `create:`
 * is required; `update:` alone only covers changing one that already exists.
 *
 * Setting the provider does NOT make Auth0 email links use the custom domain.
 * That is the `enable_custom_domain_in_emails` tenant flag — see CLAUDE.md.
 *
 * Env: AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET,
 *      AUTH0_MGMT_DOMAIN || AUTH0_DOMAIN, RESEND_API_KEY, RESEND_FROM_EMAIL
 *
 * Usage: node scripts/auth0-email-provider.mjs [--dry]
 */

const DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM_EMAIL;
const DRY = process.argv.includes("--dry");

const API = `https://${DOMAIN}/api/v2`;

for (const [name, value] of Object.entries({
  AUTH0_MGMT_DOMAIN_or_AUTH0_DOMAIN: DOMAIN,
  AUTH0_MGMT_CLIENT_ID: CLIENT_ID,
  AUTH0_MGMT_CLIENT_SECRET: CLIENT_SECRET,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL: FROM,
})) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(2);
  }
}

if (FROM.endsWith("@resend.dev")) {
  console.error(
    `RESEND_FROM_EMAIL is ${FROM} — Resend's shared sandbox domain.\n` +
      "Auth0 mail must come from your verified domain or it will not deliver."
  );
  process.exit(2);
}

async function getToken() {
  const res = await fetch(`https://${DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      audience: `${API}/`,
      grant_type: "client_credentials",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.error(`Management API token failed: ${data.error} — ${data.error_description}`);
    process.exit(2);
  }
  return data.access_token;
}

// Resend's SMTP bridge: the username is the literal string "resend" and the
// password is the API key. Port 465 is implicit TLS.
const provider = {
  name: "smtp",
  enabled: true,
  default_from_address: FROM,
  credentials: {
    smtp_host: "smtp.resend.com",
    smtp_port: 465,
    smtp_user: "resend",
    smtp_pass: RESEND_API_KEY,
  },
};

async function main() {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const existing = await fetch(`${API}/emails/provider`, { headers });

  let hasProvider;
  if (existing.status === 200) {
    const data = await existing.json();
    console.log(`Existing provider: ${data.name} — will PATCH`);
    hasProvider = true;
  } else if (existing.status === 404) {
    console.log("No provider configured — will POST");
    hasProvider = false;
  } else {
    const body = await existing.text();
    console.error(`✗ ${existing.status} ${body.slice(0, 300)}`);
    if (existing.status === 401 || existing.status === 403) {
      console.error("  Hint: the M2M app likely lacks read:emails scope");
    }
    process.exit(1);
  }

  if (DRY) {
    console.log("\n--dry, not writing:");
    console.log(JSON.stringify({ ...provider, credentials: { ...provider.credentials, smtp_pass: "***" } }, null, 2));
    return;
  }

  const res = await fetch(`${API}/emails/provider`, {
    method: hasProvider ? "PATCH" : "POST",
    headers,
    body: JSON.stringify(provider),
  });
  if (!res.ok) {
    console.error(`✗ ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`✓ Auth0 email provider set to Resend SMTP, from ${FROM}`);
  console.log(
    "\nNext, in the Auth0 Dashboard: Branding → Email Templates →\n" +
      "  Verification Email (using Link) → toggle Status to Enabled.\n" +
      "The provider alone does not enable the template."
  );
}

main();
