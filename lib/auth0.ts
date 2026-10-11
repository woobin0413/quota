/**
 * Auth0 Client
 *
 * Single Auth0 client instance for the app. Configuration comes from
 * environment variables: AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET,
 * AUTH0_SECRET, APP_BASE_URL.
 *
 * Auth routes are served by the SDK middleware:
 *   /auth/login, /auth/logout, /auth/callback, /auth/profile
 */

import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  signInReturnToPath: "/dashboard",
});
