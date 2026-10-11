// Create a production Regular Web Application in Auth0 via the Management API.
// Uses the existing M2M creds (AUTH0_MGMT_CLIENT_ID/SECRET). Requires the M2M
// app to have the `create:clients` scope on the Management API.
//
// The new app's client_secret is written to .auth0-prod.local.json (gitignored)
// — NOT printed — so it never lands in a terminal transcript. Copy it into
// Vercel's Production env from that file, then delete the file.
//
// Run: node scripts/auth0-create-prod-app.mjs
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

// Management API always speaks to the CANONICAL tenant domain, never a custom
// one: the audience stays https://<tenant>.<region>.auth0.com/api/v2/ even
// after AUTH0_DOMAIN is switched to auth.sendquota.com for end users.
const DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET;
const API = `https://${DOMAIN}/api/v2`;

const die = (msg) => { console.error(msg); process.exit(1); };
if (!DOMAIN || !CLIENT_ID || !CLIENT_SECRET) die("Missing AUTH0_DOMAIN / MGMT creds in .env.local");

// 1. Management API token
const tokRes = await fetch(`https://${DOMAIN}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    audience: `${API}/`,
  }),
});
const tok = await tokRes.json();
if (!tok.access_token) die(`Token request failed: ${JSON.stringify(tok)}`);

// 2. Create the prod Regular Web App
const createRes = await fetch(`${API}/clients`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tok.access_token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    name: "Quota Prod",
    app_type: "regular_web",
    description: "Production web app for Quota (created via Management API)",
    oidc_conformant: true,
    grant_types: ["authorization_code", "refresh_token"],
    // Placeholder URLs — update to the real prod domain in Step 7.
    callbacks: ["https://REPLACE_WITH_PROD_DOMAIN/auth/callback"],
    allowed_logout_urls: ["https://REPLACE_WITH_PROD_DOMAIN"],
    token_endpoint_auth_method: "client_secret_post",
  }),
});
const app = await createRes.json();
if (createRes.status === 403) {
  die(
    "403 insufficient scope — the M2M app lacks `create:clients`.\n" +
    "Grant it: Auth0 Dashboard → Applications → APIs → Auth0 Management API →\n" +
    "Machine to Machine Applications → your M2M app → enable `create:clients` → Update.\n" +
    "Then re-run. (Or create the app manually — see the fallback steps.)"
  );
}
if (!app.client_id) die(`Create failed (HTTP ${createRes.status}): ${JSON.stringify(app)}`);

// 3. Persist secret locally (gitignored), print only non-secret info
const out = {
  name: app.name,
  client_id: app.client_id,
  client_secret: app.client_secret,
  domain: DOMAIN,
  note: "Copy client_id/secret into Vercel Production env, then delete this file.",
};
fs.writeFileSync(".auth0-prod.local.json", JSON.stringify(out, null, 2));

console.log("Created Auth0 prod app:");
console.log("  name:      ", app.name);
console.log("  client_id: ", app.client_id);
console.log("  domain:    ", DOMAIN);
console.log("  secret ->   .auth0-prod.local.json  (gitignored; copy to Vercel, then delete)");
console.log("\nNext: update callbacks/logout to the real prod domain in Step 7.");
