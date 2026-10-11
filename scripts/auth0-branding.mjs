#!/usr/bin/env node
/**
 * Rebrand the Auth0 Universal Login screens from "SIP Portal / Supplier
 * Information Portal" to Quota.
 *
 * The SIP wording is Auth0 TENANT config (prompt custom text + possibly the
 * application name), not in the app repo. This script overwrites it via the
 * Auth0 Management API.
 *
 * PREREQUISITE — the Management API must accept a client_credentials token
 * from the client you use here. The regular Web App client is NOT authorized
 * by default. Do ONE of:
 *   A) Auth0 Dashboard → Applications → APIs → Auth0 Management API →
 *      Machine to Machine Applications → authorize your app and grant scopes:
 *        update:prompts read:prompts  (required)
 *        update:clients read:clients  (only if AUTH0_SET_CLIENT_NAME=1)
 *   B) Create a dedicated M2M app for the Management API with those scopes and
 *      put its id/secret in AUTH0_MGMT_CLIENT_ID / AUTH0_MGMT_CLIENT_SECRET.
 *
 * Reads .env.local (AUTH0_DOMAIN, and mgmt creds — falls back to
 * AUTH0_CLIENT_ID/SECRET if the dedicated mgmt vars are unset).
 *
 * Run:  node scripts/auth0-branding.mjs
 * Dry:  node scripts/auth0-branding.mjs --dry     (print payloads, no writes)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DRY = process.argv.includes("--dry");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- tiny .env.local loader (no dependency) ---
function loadEnv() {
  try {
    const raw = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env.local — rely on real env */
  }
}
loadEnv();

// Canonical tenant domain — branding/prompt writes go through the Management
// API, whose audience never moves to a custom domain. See AUTH0_MGMT_DOMAIN.
const DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID || process.env.AUTH0_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET || process.env.AUTH0_CLIENT_SECRET;
// The app users actually log in through (whose name shows on the widget) —
// NOT the M2M client that mints the token. Rename targets this one.
const LOGIN_CLIENT_ID = process.env.AUTH0_LOGIN_CLIENT_ID || process.env.AUTH0_CLIENT_ID;
const SET_CLIENT_NAME = process.env.AUTH0_SET_CLIENT_NAME === "1";
// Push the Universal Login visual theme (colors/borders/layout). Needs the
// M2M app to have read:branding + update:branding scopes. On by default.
const SET_THEME = process.env.AUTH0_SET_THEME !== "0";
// Public HTTPS URL to the Quota wordmark shown on the widget. Defaults to the
// app's own /logo route (rendered by next/og), which is why that route is in
// middleware's PUBLIC_ROUTES — Auth0 fetches it server-side with no session.
//
// A localhost APP_BASE_URL is useless here: Auth0 renders the login screen on
// its own servers and cannot reach your laptop. Fall back to empty and warn
// rather than writing a URL that silently yields a broken image.
const APP_URL = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const LOGO_URL =
  process.env.AUTH0_LOGO_URL ||
  (APP_URL.startsWith("https://") ? `${APP_URL}/logo` : "");
const LANG = process.env.AUTH0_TEXT_LANG || "en";

if (!DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing AUTH0_DOMAIN / client id / secret. Check .env.local.");
  process.exit(1);
}

const API = `https://${DOMAIN}/api/v2`;

// --- Quota copy for each Universal Login prompt screen ---
// Keys are the standard custom-text keys per screen. Anything set here wins
// over whatever "SIP Portal" text the tenant currently shows.
const PROMPT_TEXT = {
  login: {
    login: {
      pageTitle: "Sign in to Quota",
      title: "Welcome back",
      description: "Sign in to Quota to build and send quotes.",
      buttonText: "Continue",
    },
  },
  "login-id": {
    "login-id": {
      pageTitle: "Sign in to Quota",
      title: "Welcome back",
      description: "Sign in to Quota to build and send quotes.",
      buttonText: "Continue",
    },
  },
  "login-password": {
    "login-password": {
      pageTitle: "Sign in to Quota",
      title: "Enter your password",
      description: "Sign in to Quota to build and send quotes.",
      buttonText: "Continue",
    },
  },
  signup: {
    signup: {
      pageTitle: "Create your Quota account",
      title: "Create your account",
      description: "Start quoting in minutes with Quota.",
      buttonText: "Create account",
    },
  },
  "signup-id": {
    "signup-id": {
      pageTitle: "Create your Quota account",
      title: "Create your account",
      description: "Start quoting in minutes with Quota.",
      buttonText: "Continue",
    },
  },
  "signup-password": {
    "signup-password": {
      pageTitle: "Create your Quota account",
      title: "Choose a password",
      description: "Start quoting in minutes with Quota.",
      buttonText: "Create account",
    },
  },
};

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
    console.error(`\nCould not get a Management API token: ${data.error} — ${data.error_description}`);
    console.error("→ The client is not authorized for the Management API. See the header of this file (option A or B).");
    process.exit(2);
  }
  return data.access_token;
}

async function putPromptText(token, prompt, body) {
  const url = `${API}/prompts/${prompt}/custom-text/${LANG}`;
  if (DRY) {
    console.log(`DRY PUT ${url}\n${JSON.stringify(body, null, 2)}`);
    return;
  }
  const res = await fetch(url, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`  ✗ ${prompt}: ${res.status} ${t.slice(0, 200)}`);
    return false;
  }
  console.log(`  ✓ ${prompt} custom text updated`);
  return true;
}

/**
 * Print the custom-text keys the tenant actually accepts for a prompt.
 *
 * Auth0's key set varies by Universal Login version, and a PUT with an
 * unrecognized key returns 200 while changing nothing — so guessing a key name
 * produces a green run and an unchanged login screen. Always read first.
 */
async function showPromptText(token, prompt) {
  const url = `${API}/prompts/${prompt}/custom-text/${LANG}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  if (!res.ok) {
    console.error(`  ✗ ${prompt}: ${res.status} ${body.slice(0, 200)}`);
    return;
  }
  console.log(`\n--- ${prompt} ---`);
  console.log(body === "{}" ? "(no custom text set)" : JSON.stringify(JSON.parse(body), null, 2));
}

async function setClientName(token) {
  const url = `${API}/clients/${LOGIN_CLIENT_ID}`;
  if (DRY) {
    console.log(`DRY PATCH ${url}  { name: "Quota" }`);
    return;
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Quota" }),
  });
  console.log(res.ok ? `  ✓ application name → "Quota"` : `  ✗ client name: ${res.status} ${await res.text()}`);
}

// --- Quota Universal Login theme (New UL) ---
// Brutalist "estimate paper": navy + gold on cream, hard edges. Hex values
// derived from app/globals.css light-mode tokens.
const QUOTA_THEME = {
  displayName: "Quota",
  colors: {
    primary_button: "#E9A620", // accent gold
    primary_button_label: "#112037", // dark navy — high contrast on gold
    header: "#1B2A41", // navy titles
    body_text: "#2E3947",
    widget_background: "#FFFFFF",
    widget_border: "#D5DAE2",
    input_background: "#FFFFFF",
    input_border: "#D5DAE2",
    input_filled_text: "#2E3947",
    input_labels_placeholders: "#5C697A",
    links_normal: "#1B2A41",
    links_focused_components: "#E9A620",
    base_focus_color: "#E9A620",
    base_hover_color: "#C98D18",
    icons: "#5C697A",
    error: "#C3432C",
    success: "#178A4E",
    secondary_button_border: "#D5DAE2",
    secondary_button_label: "#2E3947",
    captcha_widget_theme: "auto",
  },
  borders: {
    // Auth0 requires radius >= 1; the "sharp" style is what actually squares
    // the corners for the brutalist look, so 1 is effectively hard-edged.
    button_border_radius: 1,
    button_border_weight: 1,
    buttons_style: "sharp",
    input_border_radius: 1,
    input_border_weight: 1,
    inputs_style: "sharp",
    show_widget_shadow: true,
    widget_border_weight: 2,
    widget_corner_radius: 1,
  },
  page_background: {
    background_color: "#F9F8F6", // cream
    background_image_url: "",
    page_layout: "center",
  },
  widget: {
    header_text_alignment: "center",
    logo_height: 52,
    logo_position: "center",
    logo_url: LOGO_URL,
    social_buttons_layout: "bottom",
  },
};

// Deep-merge our overrides onto whatever Auth0 returns for the default theme,
// so required fields we don't touch (fonts, etc.) are preserved.
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(base?.[k] ?? {}, v) : v;
  }
  return out;
}

// Keep only override keys that already exist in `base` (recursively). Auth0's
// theme schema rejects unknown color/border keys, and it varies by tenant, so
// we never send a key the tenant's default theme doesn't already have.
function pruneToBase(base, over) {
  const out = {};
  for (const [k, v] of Object.entries(over)) {
    if (base == null || !(k in base)) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? pruneToBase(base[k], v) : v;
  }
  return out;
}

async function pushTheme(token) {
  if (DRY) {
    console.log(`DRY theme push:\n${JSON.stringify(QUOTA_THEME, null, 2)}`);
    return;
  }
  // Find the existing default theme (usually present).
  const getRes = await fetch(`${API}/branding/themes/default`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (getRes.status === 401 || getRes.status === 403) {
    console.error(`  ✗ theme: ${getRes.status} — M2M app is missing branding scopes. Add read:branding + update:branding and re-run.`);
    return false;
  }
  let method, url, body;
  if (getRes.ok) {
    const existing = await getRes.json();
    url = `${API}/branding/themes/${existing.themeId}`;
    method = "PATCH";
    body = merge(existing, pruneToBase(existing, QUOTA_THEME));
    delete body.themeId; // not accepted in the body
  } else {
    // No default theme yet — create one.
    url = `${API}/branding/themes`;
    method = "POST";
    body = QUOTA_THEME;
  }
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(res.ok ? `  ✓ Universal Login theme applied (navy/gold, hard edges)` : `  ✗ theme: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.ok;
}

/**
 * The base branding record (`/api/v2/branding`) is NOT the same thing as the
 * New Universal Login theme above. This one holds the logo, the font, and the
 * fallback colors, and it is what Classic Universal Login and the hosted
 * password-reset / verification pages render from. Skipping it is why the
 * tenant can still show a stock icon and Google blue while the New UL theme
 * looks correct.
 */
async function pushBranding(token) {
  const payload = {
    colors: {
      // Navy rather than the accent gold: this record also drives Classic UL,
      // whose button label is white — gold on white fails contrast. New UL
      // takes its gold buttons from the theme above.
      primary: "#1B2A41",
      page_background: "#F9F8F6",
    },
    font: { url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
    ...(LOGO_URL ? { logo_url: LOGO_URL } : {}),
  };
  if (DRY) {
    console.log(`DRY branding push:\n${JSON.stringify(payload, null, 2)}`);
    return true;
  }
  const res = await fetch(`${API}/branding`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status === 401 || res.status === 403) {
    console.error("  ✗ branding: missing read:branding + update:branding on the M2M app.");
    return false;
  }
  console.log(res.ok ? "  ✓ base branding applied (logo, Inter, navy/cream)" : `  ✗ branding: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.ok;
}

(async () => {
  console.log(`Auth0 rebrand → Quota  (tenant ${DOMAIN}, lang ${LANG})${DRY ? "  [DRY RUN]" : ""}`);
  if (!LOGO_URL) {
    console.warn(
      "! No logo URL. Set AUTH0_LOGO_URL=https://sendquota.com/logo, or run with a\n" +
        "  https APP_BASE_URL. Auth0 renders the login page on its own servers, so a\n" +
        "  localhost URL would show a broken image."
    );
  }
  const token = DRY ? "dry" : await getToken();
  if (process.argv.includes("--show")) {
    console.log("Current Universal Login prompt text:");
    for (const prompt of Object.keys(PROMPT_TEXT)) {
      await showPromptText(token, prompt);
    }
    return;
  }
  console.log("Updating Universal Login prompt text:");
  for (const [prompt, body] of Object.entries(PROMPT_TEXT)) {
    await putPromptText(token, prompt, body);
  }
  if (SET_THEME) {
    console.log("Applying Universal Login theme:");
    await pushTheme(token);
    console.log("Applying base branding (logo/font/colors):");
    await pushBranding(token);
  }
  if (SET_CLIENT_NAME) {
    console.log("Updating application name:");
    await setClientName(token);
  }
  console.log(
    "\nDone. Confirm by opening /auth/login (and /auth/login?screen_hint=signup) —\n" +
      "Universal Login is now the only auth screen, so this is what customers see."
  );
})();
