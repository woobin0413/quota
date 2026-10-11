/**
 * Auth0 access-token verification for non-browser clients.
 *
 * The web app authenticates with an Auth0 session cookie, which the native
 * iOS/Android app cannot hold. Those clients send an Auth0 access token as a
 * bearer credential instead. @auth0/nextjs-auth0 is a cookie-session SDK and
 * does not verify bearer tokens, so verification is ours.
 *
 * No Next.js and no database imports: this module is pulled into the Edge
 * middleware bundle as well as into route handlers.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Access tokens issued for a custom API carry only OIDC-registered claims —
 * not `email` or `email_verified`. The post-login Action in
 * scripts/auth0-actions/add-api-claims.js adds these two, namespaced because
 * Auth0 silently drops non-namespaced custom claims.
 */
export const EMAIL_CLAIM = "https://sendquota.com/email";
export const EMAIL_VERIFIED_CLAIM = "https://sendquota.com/email_verified";

export type BearerClaims = {
  sub: string;
  email: string;
  emailVerified: boolean;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Cached across invocations: the key set is fetched once, then rotated by jose. */
function getJwks(domain: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
  }
  return jwks;
}

/** Test seam — drops the cached key set so env changes take effect. */
export function resetJwksCache(): void {
  jwks = null;
}

/**
 * Pull the credential out of an `Authorization` header value.
 *
 * Returns null for anything that is not exactly one bearer token, so a
 * malformed header is treated as "no credential" rather than as a broken one.
 */
export function extractBearerToken(
  headerValue: string | null | undefined
): string | null {
  if (!headerValue) return null;
  const parts = headerValue.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.length > 0 ? token : null;
}

/**
 * Verify an Auth0 access token.
 *
 * @returns the claims the app acts on, or null for any token that fails
 *          verification. Fails closed on missing configuration: without an
 *          audience, jwtVerify would accept a token minted for any other API
 *          in the tenant.
 */
export async function verifyBearerToken(
  token: string
): Promise<BearerClaims | null> {
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;
  if (!domain || !audience) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(domain), {
      issuer: `https://${domain}/`,
      audience,
      // Pinned to the resource server's configured signing_alg. Without it,
      // verification accepts whatever algorithm the key set resolves, so a key
      // set that ever offered something weaker would be honored.
      algorithms: ["RS256"],
    });

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }

    return {
      sub: payload.sub,
      email: typeof payload[EMAIL_CLAIM] === "string" ? (payload[EMAIL_CLAIM] as string) : "",
      // Strict equality, not truthiness: the string "false" is truthy.
      emailVerified: payload[EMAIL_VERIFIED_CLAIM] === true,
    };
  } catch {
    // Expired, wrong audience, wrong issuer, bad signature, malformed — all of
    // them mean the same thing to a caller, and distinguishing them in a
    // response would help an attacker probe.
    return null;
  }
}
