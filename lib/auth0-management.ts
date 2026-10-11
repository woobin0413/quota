/**
 * Auth0 Management API — server side.
 *
 * Until now the Management API was only used by scripts/ and the e2e helpers.
 * The verification resend needs it at runtime, which makes
 * AUTH0_MGMT_CLIENT_ID / AUTH0_MGMT_CLIENT_SECRET a production dependency with
 * `update:users` scope.
 *
 * The domain follows the same rule as scripts/auth0-*.mjs and the e2e helper:
 * the Management API audience stays on the canonical tenant domain even after
 * AUTH0_DOMAIN moves to a custom domain for the screens users see.
 */

const MGMT_DOMAIN = process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN;

async function managementToken(): Promise<string> {
  const res = await fetch(`https://${MGMT_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.AUTH0_MGMT_CLIENT_ID,
      client_secret: process.env.AUTH0_MGMT_CLIENT_SECRET,
      audience: `https://${MGMT_DOMAIN}/api/v2/`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Management token failed: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

/**
 * Ask Auth0 to re-send its verification email.
 * `auth0UserId` is the Auth0 subject (users.auth0_user_id), not our row id.
 */
export async function sendVerificationEmail(auth0UserId: string): Promise<void> {
  const token = await managementToken();
  const res = await fetch(`https://${MGMT_DOMAIN}/api/v2/jobs/verification-email`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: auth0UserId }),
  });
  if (!res.ok) {
    throw new Error(`verification-email job failed: ${res.status} ${await res.text()}`);
  }
}
