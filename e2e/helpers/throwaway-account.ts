/**
 * Throwaway account helpers for the paid-signup spec.
 *
 * The purchase flow has to start from a genuinely new account: an existing
 * user already has a Stripe customer and a tier, which hides the
 * `needsPaymentMethod` branch the flow depends on. So the spec signs up for
 * real through Auth0 Universal Login, then deletes every trace afterwards —
 * Auth0 identity, Stripe customer and subscriptions, and the app's user row.
 *
 * Deleting requires an Auth0 M2M app with `read:users` + `delete:users`
 * (AUTH0_MGMT_CLIENT_ID / AUTH0_MGMT_CLIENT_SECRET — the same pair used by
 * scripts/auth0-*.mjs). Without it the spec skips rather than leaking users.
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/** Everything the spec needs before it will run. Missing any → skip. */
export function missingPurchaseEnv(): string[] {
  const required = [
    "AUTH0_MGMT_CLIENT_ID",
    "AUTH0_MGMT_CLIENT_SECRET",
    "AUTH0_DOMAIN",
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_PRO",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "CRON_SECRET",
  ];
  return required.filter((key) => !process.env[key]);
}

/**
 * Everything verify-email.spec.ts needs before it will run. Narrower than
 * missingPurchaseEnv(): that spec covers a Stripe purchase and needs Stripe +
 * cron env on top of Auth0 Management access, but the verification gate spec
 * only signs up and flips email_verified via the Management API — it never
 * touches Stripe or the cron endpoint. Gating its skip on Stripe env would
 * skip the one spec covering this branch's gate in an environment that has
 * Auth0 Management access but no Stripe test setup. Missing any → skip.
 */
export function missingVerifyEmailEnv(): string[] {
  const required = ["AUTH0_MGMT_CLIENT_ID", "AUTH0_MGMT_CLIENT_SECRET", "AUTH0_DOMAIN"];
  return required.filter((key) => !process.env[key]);
}

/** A unique address per run so reruns never collide on an existing identity. */
export function throwawayEmail(): string {
  const domain = process.env.E2E_SIGNUP_EMAIL_DOMAIN || "quota-e2e.test";
  return `e2e-purchase-${Date.now()}@${domain}`;
}

/** Auth0 requires upper, lower, digit, and symbol by default. */
export function throwawayPassword(): string {
  return `E2e!${Math.random().toString(36).slice(2, 10)}Aa1#`;
}

/**
 * Canonical tenant domain. The Management API audience stays on it even after
 * AUTH0_DOMAIN is switched to a custom domain (auth.sendquota.com) for the
 * screens end users see.
 */
const MGMT_DOMAIN = (process.env.AUTH0_MGMT_DOMAIN || process.env.AUTH0_DOMAIN)!;

async function managementToken(): Promise<string> {
  const domain = MGMT_DOMAIN;
  const res = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.AUTH0_MGMT_CLIENT_ID,
      client_secret: process.env.AUTH0_MGMT_CLIENT_SECRET,
      audience: `https://${domain}/api/v2/`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Auth0 management token failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).access_token as string;
}

/**
 * Delete the Auth0 identity. Never throws — cleanup failures must not turn a
 * green run red, but they are loud so a leaked user is noticed.
 */
export async function deleteAuth0User(email: string): Promise<void> {
  try {
    const domain = MGMT_DOMAIN;
    const token = await managementToken();
    const lookup = await fetch(
      `https://${domain}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!lookup.ok) {
      if (lookup.status === 403) {
        console.warn("[e2e cleanup] M2M app lacks read:users — user left behind:", email);
        return;
      }
      throw new Error(`users-by-email ${lookup.status}`);
    }
    const users = (await lookup.json()) as { user_id: string }[];
    for (const user of users) {
      const del = await fetch(
        `https://${domain}/api/v2/users/${encodeURIComponent(user.user_id)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!del.ok && del.status !== 204) {
        console.warn(`[e2e cleanup] delete ${user.user_id} → ${del.status}`);
      }
    }
  } catch (err) {
    console.warn("[e2e cleanup] Auth0 delete failed:", (err as Error).message);
  }
}

/**
 * Mark a throwaway signup verified.
 *
 * The app gates unverified sessions at middleware, so a freshly signed-up
 * account lands on /verify-email instead of the dashboard and the purchase flow
 * never starts. Real users click the emailed link; the suite has no mailbox, so
 * it flips the flag directly.
 *
 * Needs `update:users` on the M2M app — the same scope the resend endpoint uses
 * in production.
 *
 * Note for callers: this updates Auth0, NOT the browser's session cookie, which
 * still carries email_verified: false. The caller must re-mint the session
 * afterwards (navigate to /auth/login) exactly as a real user does.
 */
export async function verifyAuth0User(email: string): Promise<void> {
  const domain = MGMT_DOMAIN;
  const token = await managementToken();
  const lookup = await fetch(
    `https://${domain}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!lookup.ok) {
    throw new Error(`users-by-email ${lookup.status} — need read:users`);
  }
  const users = (await lookup.json()) as { user_id: string }[];
  if (users.length === 0) {
    throw new Error(`No Auth0 user for ${email}`);
  }
  for (const user of users) {
    const res = await fetch(
      `https://${domain}/api/v2/users/${encodeURIComponent(user.user_id)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email_verified: true }),
      }
    );
    if (!res.ok) {
      throw new Error(`PATCH user ${res.status} — need update:users`);
    }
  }
}

/**
 * Cancel any subscriptions and delete the Stripe customer. Test mode only —
 * refuses to run against a live key so a misconfigured env can never delete a
 * real customer.
 */
export async function deleteStripeCustomer(email: string): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return;
  if (!key.startsWith("sk_test_")) {
    console.warn("[e2e cleanup] STRIPE_SECRET_KEY is not a test key — skipping.");
    return;
  }
  try {
    const stripe = new Stripe(key);
    const customers = await stripe.customers.list({ email, limit: 10 });
    for (const customer of customers.data) {
      const subs = await stripe.subscriptions.list({ customer: customer.id, limit: 10 });
      for (const sub of subs.data) {
        await stripe.subscriptions.cancel(sub.id).catch(() => undefined);
      }
      await stripe.customers.del(customer.id).catch(() => undefined);
    }
  } catch (err) {
    console.warn("[e2e cleanup] Stripe delete failed:", (err as Error).message);
  }
}

/**
 * Put the shared e2e user back to the baseline global.setup established.
 *
 * `/api/cron/reconcile-billing` reconciles *every* billing-relevant user, not
 * just ours — and the shared user is Ultimate in the database with no Stripe
 * subscription behind it, so reconcile correctly decides it has drifted and
 * resets it to Free. That is right for production and wrong for the suite:
 * specs that run afterwards expect the Ultimate baseline. Restore it directly.
 */
export async function restoreSharedUserBaseline(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sharedEmail = process.env.E2E_AUTH0_USER_EMAIL;
  if (!url || !serviceRoleKey || !sharedEmail) return;
  try {
    const supabase = createClient(url, serviceRoleKey);
    const { error } = await supabase
      .from("users")
      .update({ subscription_tier: "ultimate", subscription_status: "active" })
      .eq("email", sharedEmail);
    if (error) console.warn("[e2e] baseline restore failed:", error.message);
  } catch (err) {
    console.warn("[e2e] baseline restore failed:", (err as Error).message);
  }
}

/** Remove the app's own row so a rerun starts from nothing. */
export async function deleteAppUser(email: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return;
  try {
    const supabase = createClient(url, serviceRoleKey);
    const { error } = await supabase.from("users").delete().eq("email", email);
    if (error) console.warn("[e2e cleanup] app user delete failed:", error.message);
  } catch (err) {
    console.warn("[e2e cleanup] app user delete failed:", (err as Error).message);
  }
}

/**
 * Fill Stripe's CardElement. It renders in a cross-origin iframe, so the
 * fields are only reachable through a frame locator.
 */
export const TEST_CARD = {
  number: "4242424242424242",
  expiry: "1234",
  cvc: "123",
  postal: "78704",
} as const;
