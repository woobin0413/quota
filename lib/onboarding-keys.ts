/**
 * localStorage keys for the first-run prompts, plus the event that tells the
 * header a profile changed underneath it.
 *
 * These live in one place because they are read from three: the components that
 * set them, and `Header.handleSignOut`, which must clear every one of them.
 * The dismissals are keyed per device, not per user — a leftover flag on a
 * shared machine means the next person to sign in never sees onboarding, and in
 * the profile case that means their first invoice goes out with a raw email
 * address as the business name. A hardcoded copy that drifts from the component
 * is exactly how that regresses.
 */

/** Catalog first-run panel was skipped on this device. */
export const CATALOG_ONBOARDING_DISMISSED = "quota_catalog_onboarding_dismissed";

/** Business-profile first-run dialog was answered or skipped on this device. */
export const PROFILE_ONBOARDING_DISMISSED = "quota_profile_onboarding_dismissed";

/** Every onboarding flag to drop on sign-out. */
export const ONBOARDING_DISMISS_KEYS = [
  CATALOG_ONBOARDING_DISMISSED,
  PROFILE_ONBOARDING_DISMISSED,
] as const;

/**
 * Dispatched on `window` after the business profile is saved, so the header can
 * swap the displayed name without a reload. Detail is the new company name.
 */
export const PROFILE_UPDATED_EVENT = "quota:profile-updated";
