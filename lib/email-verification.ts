/**
 * Email-verification gate.
 *
 * Auth0 does not block login on an unverified email — it only sets the
 * `email_verified` claim. Enforcement is ours.
 *
 * The decision lives here rather than inline in middleware for two reasons: it
 * is testable without Edge-runtime plumbing, and 26 files call getCurrentUser()
 * or requireUser(), so a per-route gate would be 26 chances to forget one.
 * middleware.ts is the single enforcement point; requireUser() is a backstop.
 */

export const VERIFY_EMAIL_PATH = "/verify-email";

/**
 * Paths reachable with an unverified session.
 *
 * Without the first two, the gate redirects the very page that would let the
 * user fix the problem. Without the third, a gated user cannot sign out.
 */
const EXEMPT_PATHS = [
  VERIFY_EMAIL_PATH,
  "/api/auth/resend-verification",
  "/auth/logout",
];

export const EMAIL_NOT_VERIFIED_BODY = {
  success: false,
  code: "EMAIL_NOT_VERIFIED",
  message: "Confirm your email address to finish setting up your account.",
} as const;

/**
 * Should this session be held at the gate?
 *
 * Fails CLOSED: a missing claim counts as unverified. An absent session is not
 * this function's problem — the login redirect handles that, and returning true
 * here would send anonymous visitors to /verify-email instead of to login.
 */
export function needsVerification(
  session: { user?: { email_verified?: boolean } } | null | undefined
): boolean {
  if (!session?.user) return false;
  return session.user.email_verified !== true;
}

/** Exact match or slash boundary only, so /verify-email-blah is still gated. */
export function isVerificationExempt(pathname: string): boolean {
  return EXEMPT_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + "/")
  );
}
