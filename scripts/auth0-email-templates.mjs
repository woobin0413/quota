#!/usr/bin/env node
/**
 * Write Auth0's verification and password-reset email templates.
 *
 * Why this exists: Auth0's stock templates are unbranded, link-only, and carry
 * no postal address. Gmail scores that combination as phishing — a From domain
 * with no reputation sending a bare "click here" link is the exact shape of a
 * credential-harvesting mail. These templates carry the wordmark, show the
 * destination URL as readable text next to the button, and end with a postal
 * address and a reply-to human, which is what CAN-SPAM asks for and what the
 * filters look for.
 *
 * Auth0 email templates are HTML-only. The Management API exposes a single
 * `body` field, so there is no way to attach a text/plain alternative here.
 * The compensation is a simple, well-formed HTML body whose link is visible as
 * text rather than buried in a button.
 *
 * Requires on the M2M app: create:email_templates update:email_templates
 *   read:email_templates
 *
 * Env: AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET,
 *      AUTH0_MGMT_DOMAIN || AUTH0_DOMAIN,
 *      QUOTA_POSTAL_ADDRESS   — required; the physical address in the footer
 *      QUOTA_SUPPORT_EMAIL    — optional; defaults to support@sendquota.com
 *      AUTH0_LOGO_URL         — optional; defaults to https://sendquota.com/logo
 *
 * Usage: node scripts/auth0-email-templates.mjs [--dry]
 */

const DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET;
const POSTAL = process.env.QUOTA_POSTAL_ADDRESS;
// Auth0 rejects a template create without `from`, even though the provider
// already carries a default_from_address. Reuse the provider's value so the two
// can't drift — a template From on an unverified domain silently tanks delivery.
const FROM = process.env.RESEND_FROM_EMAIL;
const SUPPORT = process.env.QUOTA_SUPPORT_EMAIL || "support@sendquota.com";
const LOGO = process.env.AUTH0_LOGO_URL || "https://sendquota.com/logo";
const DRY = process.argv.includes("--dry");

const API = `https://${DOMAIN}/api/v2`;

for (const [name, value] of Object.entries({
  AUTH0_MGMT_DOMAIN_or_AUTH0_DOMAIN: DOMAIN,
  AUTH0_MGMT_CLIENT_ID: CLIENT_ID,
  AUTH0_MGMT_CLIENT_SECRET: CLIENT_SECRET,
  RESEND_FROM_EMAIL: FROM,
})) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(2);
  }
}

// A footer with no postal address is a CAN-SPAM violation and a documented spam
// signal. Refuse rather than ship a template that looks compliant but isn't.
if (!POSTAL) {
  console.error(
    "Missing QUOTA_POSTAL_ADDRESS.\n" +
      "Every commercial email needs a physical mailing address in the footer.\n" +
      'Example: QUOTA_POSTAL_ADDRESS="Quota, 123 Main St, Austin, TX 78701"'
  );
  process.exit(2);
}

const NAVY = "#1B2A41";
const INK = "#2E3947";
const MUTED = "#5C697A";
const GOLD = "#E9A620";
const GOLD_INK = "#112037";
const CREAM = "#F9F8F6";
const BORDER = "#D5DAE2";

const FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * `role="presentation"` on every layout table keeps screen readers from
 * announcing them as data tables. Tables (not flexbox) because Outlook's Word
 * rendering engine ignores modern CSS layout.
 */
function layout({ title, preheader, heading, intro, cta, url, expiry, ignore }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0; padding:0; background:${CREAM}; font-family:${FONT}; color:${INK};">
    <span style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px; background:#FFFFFF; border:1px solid ${BORDER};">
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <img src="${LOGO}" alt="Quota" width="160" height="40" style="display:block; border:0; width:160px; height:auto;" />
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <h1 style="margin:0; font-size:22px; line-height:1.3; font-weight:600; color:${NAVY};">${heading}</h1>
                <p style="margin:16px 0 0 0; font-size:15px; line-height:1.6; color:${INK};">${intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background:${GOLD};">
                      <a href="{{ url }}" style="display:inline-block; padding:13px 26px; font-size:15px; font-weight:600; color:${GOLD_INK}; text-decoration:none;">${cta}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <p style="margin:0; font-size:13px; line-height:1.6; color:${MUTED};">
                  Or paste this address into your browser:
                </p>
                <p style="margin:6px 0 0 0; font-size:13px; line-height:1.6; word-break:break-all;">
                  <a href="{{ url }}" style="color:${NAVY};">{{ url }}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0; font-size:13px; line-height:1.6; color:${MUTED};">
                  ${expiry} ${ignore}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="border-top:1px solid ${BORDER}; padding-top:20px;">
                    <p style="margin:0; font-size:12px; line-height:1.6; color:${MUTED};">
                      Questions? Reply to this email or write to
                      <a href="mailto:${SUPPORT}" style="color:${NAVY};">${SUPPORT}</a>.
                    </p>
                    <p style="margin:10px 0 0 0; font-size:12px; line-height:1.6; color:${MUTED};">
                      ${POSTAL}
                    </p>
                  </td></tr>
                </table>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0; font-size:12px; color:${MUTED}; max-width:520px;">
            ${url}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const TEMPLATES = [
  {
    template: "verify_email",
    subject: "Confirm your email address for Quota",
    // Auth0's default is 5 days. Long enough that a contractor who signs up on a
    // job site and opens mail that evening still lands on a live link.
    urlLifetimeInSeconds: 432000,
    body: layout({
      title: "Confirm your email address",
      preheader: "One click to finish setting up your Quota account.",
      heading: "Confirm your email address",
      intro:
        "You're almost set up. Confirm this address so you can start building quotes and sending them to your clients.",
      cta: "Confirm email address",
      expiry: "This link works for 5 days.",
      ignore: "If you didn't create a Quota account, you can ignore this email.",
      url: "You received this because someone entered this address when signing up for Quota.",
    }),
  },
  {
    template: "reset_email",
    subject: "Reset your Quota password",
    urlLifetimeInSeconds: 432000,
    body: layout({
      title: "Reset your Quota password",
      preheader: "Choose a new password for your Quota account.",
      heading: "Reset your password",
      intro: "Use the button below to choose a new password for your Quota account.",
      cta: "Choose a new password",
      expiry: "This link works for 5 days.",
      ignore:
        "If you didn't ask to reset your password, you can ignore this email and your current password stays active.",
      url: "You received this because a password reset was requested for this address.",
    }),
  },
];

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

async function main() {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  for (const t of TEMPLATES) {
    // The template either exists (PATCH) or it doesn't (POST). Auth0 has no
    // upsert, and POSTing over an existing template is a 409.
    const existing = await fetch(`${API}/email-templates/${t.template}`, { headers });
    const exists = existing.status === 200;

    const payload = { ...t, from: FROM, enabled: true, syntax: "liquid" };

    if (DRY) {
      console.log(
        `${t.template}: would ${exists ? "PATCH" : "POST"} — subject "${t.subject}", ` +
          `${t.body.length} chars of HTML`
      );
      continue;
    }

    const res = await fetch(
      exists ? `${API}/email-templates/${t.template}` : `${API}/email-templates`,
      {
        method: exists ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(exists ? payload : { ...payload, template: t.template }),
      }
    );

    if (!res.ok) {
      console.error(`✗ ${t.template}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`✓ ${t.template} ${exists ? "updated" : "created"} and enabled`);
  }

  if (!DRY && !process.exitCode) {
    console.log(
      "\nSend yourself one and check it in Gmail (Show original):\n" +
        "  SPF/DKIM/DMARC all PASS, DKIM domain sendquota.com,\n" +
        "  and the button pointing at https://auth.sendquota.com/u/..."
    );
  }
}

main();
