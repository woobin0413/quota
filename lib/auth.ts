/**
 * Auth Helpers
 *
 * Bridges Auth0 identity to database users. Server-side only.
 *
 * Two credentials resolve to the same User: the browser's Auth0 session cookie,
 * and an Auth0 access token sent as a bearer by the native app. Because every
 * authed route handler reads identity through getCurrentUser(), supporting the
 * second credential here is what makes the whole API reachable from mobile —
 * no route file knows which one was used.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getOrCreateUser } from "@/lib/db/sync-user";
import { recordUsage } from "@/lib/usage-tracking";
import { needsVerification, VERIFY_EMAIL_PATH } from "@/lib/email-verification";
import { extractBearerToken, verifyBearerToken } from "@/lib/auth/bearer";
import type { User } from "@/types/database";

type Identity = {
  auth0UserId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

/** headers() throws outside a request scope; treat that as "no header". */
async function readHeader(name: string): Promise<string | null> {
  try {
    return (await headers()).get(name);
  } catch {
    return null;
  }
}

/**
 * Resolve the caller's Auth0 identity from whichever credential is present.
 *
 * A bearer token wins outright: a request that presents one is asserting it as
 * the identity, so an invalid token denies rather than falling back to a
 * cookie. Otherwise the effective user would depend on which credential
 * happened to verify.
 */
async function resolveIdentity(): Promise<Identity | null> {
  const token = extractBearerToken(await readHeader("authorization"));
  if (token) {
    const claims = await verifyBearerToken(token);
    if (!claims) return null;
    // Database connections never issue given_name/family_name, and the access
    // token carries no profile beyond what the Action adds — same as web
    // signup, so ProfileOnboarding prompts for the business name either way.
    return { auth0UserId: claims.sub, email: claims.email };
  }

  const session = await auth0.getSession();
  if (!session?.user?.sub) return null;

  return {
    auth0UserId: session.user.sub,
    email: session.user.email ?? "",
    firstName: session.user.given_name,
    lastName: session.user.family_name,
    avatarUrl: session.user.picture,
  };
}

/**
 * Get the current database user for the active credential.
 * Auto-provisions the user row on first login.
 *
 * @returns The user, or null when there is no valid credential
 */
export async function getCurrentUser(): Promise<User | null> {
  const identity = await resolveIdentity();
  if (!identity) return null;

  const user = await getOrCreateUser(identity);

  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    recordUsage(user.id, ip, h.get("user-agent") ?? "unknown");
  } catch {
    // headers() unavailable in some contexts — tracking is best-effort
  }

  return user;
}

/**
 * Like getCurrentUser() but redirects to login when unauthenticated.
 * For use in Server Components / pages.
 */
export async function requireUser(): Promise<User> {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  // Backstop only — middleware is the primary gate. This covers any future
  // route that slips outside the middleware matcher.
  if (needsVerification(session)) {
    redirect(VERIFY_EMAIL_PATH);
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login");
  }
  return user;
}
