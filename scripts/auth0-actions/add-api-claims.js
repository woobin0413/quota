/**
 * Auth0 post-login Action — add profile claims to the mobile API access token.
 *
 * Paste into Auth0 Dashboard → Actions → Library → Build Custom (Login / Post
 * Login), then drag it into the Login flow.
 *
 * Access tokens minted for a custom API carry only OIDC-registered claims, so
 * lib/auth/bearer.ts would see no email and no verification state. Claims must
 * be namespaced — Auth0 silently drops custom claims that are not URIs.
 *
 * Keep the namespace in sync with EMAIL_CLAIM / EMAIL_VERIFIED_CLAIM in
 * lib/auth/bearer.ts. The verifier fails closed, so a mismatch does not open a
 * hole — it locks every mobile user out at the verification gate instead.
 */
exports.onExecutePostLogin = async (event, api) => {
  const NAMESPACE = "https://sendquota.com/";

  // Only tokens for the mobile API need these; the web app reads the session.
  if (
    !event.resource_server ||
    event.resource_server.identifier !== "https://api.sendquota.com"
  ) {
    return;
  }

  // Optional chaining because a post-login Action that throws breaks every
  // login in the tenant, not just mobile ones. `event.user` being absent here
  // is practically unreachable, but that blast radius is not worth the risk.
  api.accessToken.setCustomClaim(`${NAMESPACE}email`, event.user?.email);
  api.accessToken.setCustomClaim(
    `${NAMESPACE}email_verified`,
    event.user?.email_verified === true
  );
};
