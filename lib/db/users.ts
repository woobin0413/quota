/**
 * User Repository
 *
 * Database operations for user management using Supabase.
 * Users are synced with Auth0 authentication.
 *
 * @module lib/db/users
 */

import { supabaseAdmin } from "./core";
import type {
  UserRow,
  CreateUserInput,
  UpdateUserInput,
  User,
  QuotaInfo,
  SubscriptionTier,
} from "@/types/database";
import { NotFoundError, ValidationError, QuotaExceededError } from "@/types/database";
import { startOfMonthUTC } from "@/lib/billing/month";

// =====================================================
// TYPE TRANSFORMERS
// =====================================================

/**
 * Transform database row to User object
 */
function transformUser(row: UserRow): User {
  return {
    ...row,
    fullName: [row.first_name, row.last_name]
      .filter(Boolean)
      .join(" ") || row.email,
  };
}

// =====================================================
// QUERY FUNCTIONS
// =====================================================

/**
 * Get user by Auth0 user ID (the `sub` claim)
 */
export async function getUserByAuth0Id(
  auth0UserId: string
): Promise<User | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("auth0_user_id", auth0UserId)
    .is("deleted_at", null)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows found
    throw error;
  }

  return data ? transformUser(data as UserRow) : null;
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", userId)
    .is("deleted_at", null)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return data ? transformUser(data as UserRow) : null;
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("email", email)
    .is("deleted_at", null)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return data ? transformUser(data as UserRow) : null;
}

/**
 * Create a new user from Auth0 data
 */
export async function createUser(data: CreateUserInput): Promise<User> {
  if (!data.auth0UserId || !data.email) {
    throw new ValidationError("auth0UserId and email are required", "auth0UserId");
  }

  const { data: row, error } = await supabaseAdmin
    .from("users")
    .insert({
      auth0_user_id: data.auth0UserId,
      email: data.email,
      first_name: data.firstName ?? null,
      last_name: data.lastName ?? null,
      company_name: data.companyName ?? null,
      phone: data.phone ?? null,
      avatar_url: data.avatarUrl ?? null,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return transformUser(row as UserRow);
}

/**
 * Update user information
 */
export async function updateUser(
  userId: string,
  data: UpdateUserInput
): Promise<User> {
  const updateData: Record<string, unknown> = {};

  if (data.firstName !== undefined) updateData.first_name = data.firstName;
  if (data.lastName !== undefined) updateData.last_name = data.lastName;
  if (data.companyName !== undefined) updateData.company_name = data.companyName;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.avatarUrl !== undefined) updateData.avatar_url = data.avatarUrl;
  if (data.settings !== undefined) updateData.settings = data.settings;
  if (data.metadata !== undefined) updateData.metadata = data.metadata;

  const { data: row, error } = await supabaseAdmin
    .from("users")
    .update(updateData)
    .eq("id", userId)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new NotFoundError("User not found", "User", userId);
    }
    throw error;
  }

  return transformUser(row as UserRow);
}

export interface UpdateUserProfileInput {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  companyAddress?: string | null;
  companyWebsite?: string | null;
}

/**
 * Update the user's business profile (used in quote emails/PDFs).
 * Address/website live in the metadata JSONB; merged so other keys survive.
 */
export async function updateUserProfile(
  userId: string,
  data: UpdateUserProfileInput
): Promise<User> {
  const updateData: Record<string, unknown> = {};

  // Auth0 database connections never issue given_name/family_name — only social
  // ones do — so for email/password signups these columns stay NULL unless the
  // user tells us here. See ProfileOnboarding.
  if (data.firstName !== undefined) updateData.first_name = data.firstName;
  if (data.lastName !== undefined) updateData.last_name = data.lastName;
  if (data.companyName !== undefined) updateData.company_name = data.companyName;
  if (data.phone !== undefined) updateData.phone = data.phone;

  if (data.companyAddress !== undefined || data.companyWebsite !== undefined) {
    const { data: current, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("metadata")
      .eq("id", userId)
      .is("deleted_at", null)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        throw new NotFoundError("User not found", "User", userId);
      }
      throw fetchError;
    }

    const metadata = { ...(current?.metadata ?? {}) };
    if (data.companyAddress !== undefined) metadata.companyAddress = data.companyAddress;
    if (data.companyWebsite !== undefined) metadata.companyWebsite = data.companyWebsite;
    updateData.metadata = metadata;
  }

  const { data: row, error } = await supabaseAdmin
    .from("users")
    .update(updateData)
    .eq("id", userId)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new NotFoundError("User not found", "User", userId);
    }
    throw error;
  }

  return transformUser(row as UserRow);
}

/**
 * Set or clear the business-logo URL in the metadata JSONB.
 * Merged so companyAddress/companyWebsite survive; null removes the key.
 */
export async function updateUserLogoUrl(
  userId: string,
  logoUrl: string | null
): Promise<void> {
  const { data: current, error: fetchError } = await supabaseAdmin
    .from("users")
    .select("metadata")
    .eq("id", userId)
    .is("deleted_at", null)
    .single();

  if (fetchError) {
    if (fetchError.code === "PGRST116") {
      throw new NotFoundError("User not found", "User", userId);
    }
    throw fetchError;
  }

  const metadata = { ...(current?.metadata ?? {}) };
  if (logoUrl === null) {
    delete metadata.logoUrl;
  } else {
    metadata.logoUrl = logoUrl;
  }

  const { error } = await supabaseAdmin
    .from("users")
    .update({ metadata })
    .eq("id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}

/**
 * Update user's last login timestamp
 */
export async function updateLastLogin(userId: string): Promise<void> {
  await supabaseAdmin
    .from("users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", userId);
}

/**
 * Soft delete a user
 */
export async function deleteUser(userId: string): Promise<void> {
  await supabaseAdmin
    .from("users")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", userId);
}

// =====================================================
// QUOTA MANAGEMENT
// =====================================================

/**
 * Get user's quota information
 */
export async function getQuotaInfo(userId: string): Promise<QuotaInfo> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("quotes_this_month, monthly_quote_limit")
    .eq("id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new NotFoundError("User not found", "User", userId);
    }
    throw error;
  }

  const used = data.quotes_this_month;
  const limit = data.monthly_quote_limit;
  const remaining = Math.max(0, limit - used);
  const percentage = limit > 0 ? (used / limit) * 100 : 0;

  return {
    used,
    limit,
    remaining,
    percentage,
    canCreateQuote: used < limit,
  };
}

/**
 * Check if user can create a quote (has quota remaining)
 */
export async function checkQuotaLimit(userId: string): Promise<boolean> {
  const quota = await getQuotaInfo(userId);

  if (!quota.canCreateQuote) {
    throw new QuotaExceededError(
      `Monthly quote limit of ${quota.limit} has been reached. Used: ${quota.used}`,
      quota.used,
      quota.limit
    );
  }

  return true;
}

/**
 * Increment user's quote usage counter
 */
export async function updateQuotaUsage(
  userId: string,
  increment = 1
): Promise<void> {
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("quotes_this_month")
    .eq("id", userId)
    .single();

  if (user) {
    await supabaseAdmin
      .from("users")
      .update({ quotes_this_month: user.quotes_this_month + increment })
      .eq("id", userId);
  }
}

/**
 * Reset user's monthly quote counter
 */
export async function resetQuotaUsage(userId: string): Promise<void> {
  await supabaseAdmin
    .from("users")
    .update({ quotes_this_month: 0 })
    .eq("id", userId);
}

/**
 * Reset all users' monthly quote counters
 */
export async function resetAllQuotaUsage(): Promise<void> {
  await supabaseAdmin.rpc("reset_monthly_quote_counts");
}

// =====================================================
// SUBSCRIPTION MANAGEMENT
// =====================================================

/**
 * Set a user's subscription tier. Self-serve for now (no billing);
 * the quote limit is derived from the tier at enforcement time, so no
 * per-user limit column is written.
 */
export async function updateSubscription(
  userId: string,
  tier: SubscriptionTier
): Promise<User> {
  const { data: row, error } = await supabaseAdmin
    .from("users")
    .update({ subscription_tier: tier })
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new NotFoundError("User not found", "User", userId);
    }
    throw error;
  }

  return transformUser(row as UserRow);
}

/**
 * Set tier + subscription status (and optional cancellation state) from
 * billing (Stripe webhook / reconciliation). The ONLY intended production
 * writers of paid tiers derive their data from live Stripe state.
 */
export async function setTierFromBilling(
  userId: string,
  tier: SubscriptionTier,
  status: string,
  billing?: { cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }
): Promise<void> {
  const update: Record<string, unknown> = {
    subscription_tier: tier,
    subscription_status: status,
  };
  if (billing) {
    update.cancel_at_period_end = billing.cancelAtPeriodEnd;
    update.current_period_end = billing.currentPeriodEnd;
  }

  const { error } = await supabaseAdmin
    .from("users")
    .update(update)
    .eq("id", userId);

  if (error) {
    throw error;
  }
}

/**
 * Link user to Stripe customer
 */
export async function linkStripeCustomer(
  userId: string,
  stripeCustomerId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("users")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", userId);

  if (error) {
    throw error;
  }
}

/**
 * Get user by Stripe customer ID
 */
export async function getUserByStripeCustomerId(
  stripeCustomerId: string
): Promise<User | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("stripe_customer_id", stripeCustomerId)
    .is("deleted_at", null)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return data ? transformUser(data as UserRow) : null;
}

/**
 * Users relevant to billing reconciliation: anyone with a Stripe customer
 * or a non-free tier (covers drift in both directions).
 */
export async function getBillingRelevantUsers(): Promise<User[]> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .or("stripe_customer_id.not.is.null,subscription_tier.neq.free")
    .is("deleted_at", null);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => transformUser(row as UserRow));
}

// =====================================================
// ANALYTICS
// =====================================================

/**
 * Get user statistics
 */
export async function getUserStats(userId: string): Promise<{
  totalQuotes: number;
  totalContacts: number;
  totalRevenue: number;
  quotesThisMonth: number;
}> {
  // Get user data
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("quotes_this_month")
    .eq("id", userId)
    .single();

  if (userError) {
    if (userError.code === "PGRST116") {
      throw new NotFoundError("User not found", "User", userId);
    }
    throw userError;
  }

  // Get quote count
  const { count: totalQuotes } = await supabaseAdmin
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);

  // Get contact count
  const { count: totalContacts } = await supabaseAdmin
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);

  // Get total revenue from accepted quotes
  const { data: revenueData } = await supabaseAdmin
    .from("quotes")
    .select("total")
    .eq("user_id", userId)
    .eq("status", "accepted")
    .is("deleted_at", null);

  const totalRevenue = revenueData?.reduce((sum, q) => sum + (parseFloat(q.total) || 0), 0) || 0;

  return {
    totalQuotes: totalQuotes || 0,
    totalContacts: totalContacts || 0,
    totalRevenue,
    quotesThisMonth: user.quotes_this_month,
  };
}

/**
 * Count a user's existing (non-deleted) quotes — the live basis for
 * lifetime tier limits.
 */
export async function countUserQuotes(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
  return count ?? 0;
}

/** Quotes the user created since the first of the current UTC month. */
export async function countUserQuotesThisMonth(userId: string): Promise<number> {
  const since = startOfMonthUTC(new Date()).toISOString();
  const { count, error } = await supabaseAdmin
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("created_at", since);

  if (error) throw error;
  return count ?? 0;
}
