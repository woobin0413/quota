/**
 * Auth0 post-login Action — let the e2e test account log in from CI.
 *
 * PASTE THIS INTO THE AUTH0 DASHBOARD. It is version-controlled here because
 * Actions are tenant config, not deployable repo code — same situation as
 * scripts/auth0-branding.mjs. Nothing imports this file.
 *
 * ## The problem it solves
 *
 * CI logs in as the shared e2e user through real Universal Login. Every GitHub
 * runner has a different IP, so Auth0 treats each run as an unrecognised
 * location and issues an emailed one-time code:
 *
 *   gd_send_email_verification  Guardian - Email verification sent  ip=57.151.143.178
 *   fn                          To: e2e-test@sitequote.test
 *
 * That address is on a `.test` domain, which by RFC 2606 can never receive
 * mail. No runner can ever answer the challenge, so the whole Playwright suite
 * is unrunnable in CI.
 *
 * ## Why this is safe
 *
 * The tenant has two applications. Production logins go through **Quota Prod**
 * (https://sendquota.com/auth/callback); local and CI go through **Quota**
 * (http://localhost:3000/auth/callback). The exemption below requires BOTH the
 * e2e address AND the non-prod client_id, so these credentials cannot skip MFA
 * against production even if they leak.
 *
 * It fails closed: if either secret is unset, or anything about the match is
 * off, the normal policy applies.
 *
 * ## Setup
 *
 * 1. Actions → Library → Build Custom → "Skip MFA for e2e" → Login / post-login
 * 2. Paste this file's contents.
 * 3. Add two Action **Secrets** (the key icon in the editor sidebar):
 *      E2E_USER_EMAIL   e2e-test@sitequote.test
 *      DEV_CLIENT_ID    <client_id of the "Quota" app — NOT "Quota Prod">
 *    Find it under Applications → Quota → Settings → Client ID. A client_id is
 *    public (it appears in every authorize URL), so it is not a credential —
 *    it lives in a Secret only so this file stays tenant-agnostic.
 * 4. Deploy.
 * 5. Drag the Action into the Login flow and Apply.
 * 6. ONLY THEN change Security → Multi-factor Auth policy to "Never".
 *
 * Step 6 last matters. Between flipping the policy and deploying the Action,
 * nobody gets MFA at all. Deploying first means the Action is already enforcing
 * before the built-in policy stands down.
 *
 * To confirm afterwards: `node scripts/auth0-mfa-status.mjs`, and check the
 * tenant log shows no gd_send_email_verification for the e2e user on a CI run.
 *
 * ## Reverting
 *
 * Set the MFA policy back to Adaptive/Always and remove the Action from the
 * flow. CI then goes back to skipping Playwright, which is the state the
 * workflow already handles — ci.yml gates the whole job on the
 * E2E_AUTH0_USER_EMAIL secret being present.
 */

exports.onExecutePostLogin = async (event, api) => {
  const e2eEmail = event.secrets.E2E_USER_EMAIL;
  const devClientId = event.secrets.DEV_CLIENT_ID;

  // Fail closed: a missing secret must never widen the exemption.
  const exemptionConfigured = Boolean(e2eEmail) && Boolean(devClientId);

  const isE2ELogin =
    exemptionConfigured &&
    event.user.email === e2eEmail &&
    // A real user could in principle register this address on another
    // connection; requiring a verified email keeps the exemption on the
    // account we actually provisioned.
    event.user.email_verified === true &&
    event.client.client_id === devClientId;

  if (isE2ELogin) {
    // No challenge. This account exists only for automated tests and its
    // domain cannot receive the code Auth0 would send.
    return;
  }

  // Everyone else keeps risk-based MFA. `riskAssessment` is populated when
  // Adaptive MFA is available; when it is absent we challenge rather than
  // assume the login is safe.
  const confidence = event.authentication?.riskAssessment?.confidence;
  const looksRisky = confidence !== "high";

  if (looksRisky) {
    api.multifactor.enable("any", { allowRememberBrowser: true });
  }
};
