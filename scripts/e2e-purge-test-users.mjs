#!/usr/bin/env node
/**
 * Delete Auth0 identities left behind by e2e/billing-purchase.spec.ts.
 *
 * The spec signs up a throwaway account and deletes it in afterAll, but that
 * delete needs `read:users` + `delete:users` on the M2M app. Without those
 * scopes the spec still passes and prints a warning, and the identity stays in
 * the tenant. This purges any that accumulated.
 *
 * Grant the scopes first:
 *   Auth0 Dashboard → Applications → APIs → Auth0 Management API
 *     → Machine to Machine Applications → (your M2M app) → expand
 *     → enable read:users and delete:users → Update
 *
 * Usage:
 *   node scripts/e2e-purge-test-users.mjs           # list only
 *   node scripts/e2e-purge-test-users.mjs --delete  # actually delete
 *
 * Sweeps `e2e-purchase-*` by default. Widen with repeatable flags:
 *   --prefix=quota-test-  --email=someone@example.test
 *
 * The shared e2e login, the @sip-demo.local demo tenant, and any address at a
 * real mail provider are refused regardless of the flags, so a mistyped prefix
 * cannot remove a customer.
 */

import fs from "node:fs";

const APPLY = process.argv.includes("--delete");

/** Prefixes to sweep. Override with one or more --prefix=… flags. */
const DEFAULT_PREFIXES = ["e2e-purchase-"];
const prefixes = process.argv
  .filter((a) => a.startsWith("--prefix="))
  .map((a) => a.slice("--prefix=".length))
  .filter(Boolean);
const PREFIXES = prefixes.length > 0 ? prefixes : DEFAULT_PREFIXES;

/** Exact addresses to remove alongside the prefix sweep: --email=… */
const EMAILS = process.argv
  .filter((a) => a.startsWith("--email="))
  .map((a) => a.slice("--email=".length).toLowerCase())
  .filter(Boolean);

/**
 * Never deletable, whatever the flags say.
 *  - the shared e2e user every spec authenticates as
 *  - a different product's demo tenant that shares this Auth0 domain
 *  - any real mailbox: throwaway test users never have a deliverable address
 */
const PROTECTED = (email) =>
  email === "e2e-test@sitequote.test" ||
  email.endsWith("@sip-demo.local") ||
  /@(gmail|googlemail|outlook|hotmail|yahoo|icloud|proton(mail)?)\./i.test(email);

function loadEnv(file = ".env.local") {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    if (!process.env[key]) process.env[key] = line.slice(i + 1).trim();
  }
}

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

loadEnv();

// Canonical tenant domain — the Management API audience never moves to a
// custom domain. See AUTH0_MGMT_DOMAIN in .env.example.
const DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET;

if (!DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
  die("Missing AUTH0_DOMAIN / AUTH0_MGMT_CLIENT_ID / AUTH0_MGMT_CLIENT_SECRET in .env.local");
}

const tokenRes = await fetch(`https://${DOMAIN}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    audience: `https://${DOMAIN}/api/v2/`,
  }),
});
if (!tokenRes.ok) die(`Token request failed: ${tokenRes.status} ${await tokenRes.text()}`);
const { access_token: token } = await tokenRes.json();

// Page through every user and filter locally. A Lucene `q=` search looks
// tidier but silently matches nothing when the syntax is slightly off, and a
// cleanup tool that reports "all clean" because its query was malformed is
// worse than one that does no searching at all.
const all = [];
for (let page = 0; page < 20; page++) {
  const listRes = await fetch(
    `https://${DOMAIN}/api/v2/users?per_page=100&page=${page}&fields=email,user_id&include_fields=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (listRes.status === 403) {
    die("403 — the M2M app is missing `read:users`. Grant read:users + delete:users and re-run.");
  }
  if (!listRes.ok) die(`User list failed: ${listRes.status} ${await listRes.text()}`);
  const batch = await listRes.json();
  if (!Array.isArray(batch) || batch.length === 0) break;
  all.push(...batch);
  if (batch.length < 100) break;
}

console.log(
  `Scanned ${all.length} tenant user(s) for ${PREFIXES.map((p) => `"${p}*"`).join(", ")}` +
    (EMAILS.length ? ` and ${EMAILS.length} exact address(es)` : "")
);

const matched = all.filter((u) => {
  const email = (u.email ?? "").toLowerCase();
  if (!email) return false;
  return PREFIXES.some((p) => email.startsWith(p)) || EMAILS.includes(email);
});

const shielded = matched.filter((u) => PROTECTED((u.email ?? "").toLowerCase()));
for (const u of shielded) console.log(`  · skipping protected account ${u.email}`);

const targets = matched.filter((u) => !PROTECTED((u.email ?? "").toLowerCase()));

if (targets.length === 0) {
  console.log("✓ No matching test users.");
  process.exit(0);
}

console.log(`Found ${targets.length} deletable test user(s):`);
for (const u of targets) console.log(`  ${u.email}  ${u.user_id}`);

if (!APPLY) {
  console.log("\nDry run. Re-run with --delete to remove them.");
  process.exit(0);
}

let deleted = 0;
for (const user of targets) {
  const res = await fetch(`https://${DOMAIN}/api/v2/users/${encodeURIComponent(user.user_id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok || res.status === 204) {
    deleted++;
    console.log(`  ✓ deleted ${user.email}`);
  } else if (res.status === 403) {
    die("403 — the M2M app is missing `delete:users`.");
  } else {
    console.error(`  ✗ ${user.email} → ${res.status}`);
  }
}
console.log(`\nDeleted ${deleted}/${targets.length}.`);
