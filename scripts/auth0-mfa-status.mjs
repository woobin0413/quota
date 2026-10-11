#!/usr/bin/env node
/**
 * Report the tenant's MFA posture and the e2e user's last login.
 *
 * Read-only. Run it before changing the MFA policy so you know what you are
 * changing from, and after deploying scripts/auth0-actions/skip-mfa-for-e2e.js
 * to confirm the exemption is wired to the right client.
 *
 * The M2M app needs these scopes, none of which it had when this was written:
 *
 *   read:mfa_policies  read:guardian_factors  read:actions  read:logs
 *
 * read:logs it does have — the log tail is the part that actually proves
 * whether a CI login was challenged, so this still tells you something useful
 * even with the others missing. Anything unreadable is reported as such rather
 * than guessed at.
 *
 * Usage: node scripts/auth0-mfa-status.mjs
 */

import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
    }
  }
}
loadEnv();

// The Management API audience stays on the canonical tenant domain even after
// AUTH0_DOMAIN moves to the custom domain users are redirected to.
const DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID || process.env.AUTH0_CLIENT_ID;
const CLIENT_SECRET =
  process.env.AUTH0_MGMT_CLIENT_SECRET || process.env.AUTH0_CLIENT_SECRET;
const E2E_EMAIL = process.env.E2E_AUTH0_USER_EMAIL;

if (!DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing AUTH0_DOMAIN / management client id / secret in .env.local.");
  process.exit(1);
}

const API = `https://${DOMAIN}/api/v2`;

async function getToken() {
  const res = await fetch(`https://${DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      audience: `${API}/`,
    }),
  });
  if (!res.ok) {
    console.error(`Token request failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

/** GET that distinguishes "denied" from "empty" — never conflate the two. */
async function read(token, pathname) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  if (res.status === 403) return { denied: true, scope: safeScope(body) };
  if (!res.ok) return { error: `${res.status} ${body.slice(0, 120)}` };
  try {
    return { data: JSON.parse(body) };
  } catch {
    return { error: "unparseable response" };
  }
}

function safeScope(body) {
  const match = body.match(/expected any of: ([a-z_:,\s]+)/);
  return match ? match[1].trim() : "unknown scope";
}

function line(label, result, render) {
  if (result.denied) return console.log(`  ${label}: (needs ${result.scope})`);
  if (result.error) return console.log(`  ${label}: error — ${result.error}`);
  console.log(`  ${label}: ${render(result.data)}`);
}

const { access_token: token, scope = "" } = await getToken();

console.log(`Tenant ${DOMAIN}`);
console.log(`Granted scopes: ${scope.split(" ").length}\n`);

console.log("MFA configuration");
line(
  "policy",
  await read(token, "/guardian/policies"),
  (d) => (Array.isArray(d) && d.length ? d.join(", ") : "never (no policy set)")
);
line(
  "enabled factors",
  await read(token, "/guardian/factors"),
  (d) => d.filter((f) => f.enabled).map((f) => f.name).join(", ") || "none"
);
// `deployed` is not returned by this endpoint — reading it yields undefined and
// reports a live Action as a draft, which is alarming and wrong. `status` plus
// `all_changes_deployed` are the fields that actually exist.
line(
  "post-login actions",
  await read(token, "/actions/actions?triggerId=post-login"),
  (d) =>
    (d.actions ?? [])
      .map(
        (a) =>
          `${a.name} [${a.status}${a.all_changes_deployed ? "" : ", UNDEPLOYED CHANGES"}]` +
          ` secrets: ${(a.secrets ?? []).map((s) => s.name).join("/") || "none"}`
      )
      .join(", ") || "none"
);

// Being deployed is not the same as being in the flow. An Action that is built
// but unbound runs never, which for this one means MFA is enforced by nothing.
line(
  "post-login bindings",
  await read(token, "/actions/triggers/post-login/bindings"),
  (d) => (d.bindings ?? []).map((b) => b.display_name).join(", ") || "NONE — nothing runs on login"
);

console.log("\nApplications (which client a login came through decides the exemption)");
const clients = await read(token, "/clients?fields=client_id,name,app_type&include_fields=true&per_page=50");
if (clients.data) {
  for (const c of clients.data) {
    if (c.app_type === "non_interactive" || !c.app_type) continue;
    console.log(`  ${c.name.padEnd(14)} ${c.client_id}`);
  }
} else {
  line("clients", clients, () => "");
}

if (E2E_EMAIL) {
  console.log(`\ne2e user (${E2E_EMAIL})`);
  const users = await read(
    token,
    `/users?q=${encodeURIComponent(`email:"${E2E_EMAIL}"`)}&search_engine=v3`
  );
  if (users.data?.length) {
    const u = users.data[0];
    console.log(`  user_id        : ${u.user_id}`);
    console.log(`  email_verified : ${u.email_verified}`);
    console.log(`  enrolled MFA   : ${JSON.stringify(u.multifactor ?? null)}`);
    console.log(`  last_ip        : ${u.last_ip ?? "(none)"}`);
  } else {
    line("lookup", users, () => "not found");
  }
}

console.log("\nRecent MFA challenges (gd_* events prove whether a login was challenged)");
const logs = await read(token, "/logs?per_page=50&sort=date:-1");
if (logs.data) {
  const challenges = logs.data.filter((e) => String(e.type).startsWith("gd_"));
  if (!challenges.length) {
    console.log("  none in the last 50 events");
  } else {
    for (const e of challenges.slice(0, 10)) {
      console.log(`  ${e.date}  ${e.type}  ip=${e.ip}  ${(e.description ?? "").slice(0, 50)}`);
    }
  }
} else {
  line("logs", logs, () => "");
}
