/**
 * Profile Validation
 *
 * Shared phone/website validation for the business profile.
 * Used by both the ProfileForm (client) and /api/profile (server).
 */

/**
 * The company name becomes the display name of the `From:` header on every
 * quote and receipt, so a newline in it can inject extra headers. The header
 * builder encodes defensively too (lib/email-from.ts), but rejecting at the
 * write boundary keeps the value from ever reaching the database.
 */
export const NO_NEWLINES_ERROR = "Remove line breaks from the company name.";

export function hasNoNewlines(value: string): boolean {
  return !/[\r\n]/.test(value);
}

/**
 * Phone check: digits with common separators (spaces, dashes, dots,
 * parentheses). US numbers require exactly 10 digits; a leading +
 * (international) allows 11–15.
 * Examples: "(555) 123-4567", "+1 408 555 0134", "555.123.4567"
 */
export function isValidPhone(value: string): boolean {
  if (!/^\+?[\d\s().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  if (value.trimStart().startsWith("+")) {
    return digits.length >= 11 && digits.length <= 15;
  }
  return digits.length === 10;
}

/**
 * Website check: scheme optional (http:// or https://), requires a
 * dotted hostname with a 2+ letter TLD, optional path/query.
 * Examples: "bobsplumbing.com", "www.acme.co/services", "https://acme.com"
 */
export function isValidWebsite(value: string): boolean {
  return /^(https?:\/\/)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d{1,5})?(\/\S*)?$/i.test(
    value
  );
}

/**
 * Format a US phone number as the user types:
 * "123" → "(123", "123123" → "(123) 123", "1231231234" → "(123) 123-1234".
 * Leaves input untouched when it starts with "+" (international) or has
 * more than 10 digits.
 */
export function formatPhoneInput(value: string): string {
  if (value.trimStart().startsWith("+")) return value;

  const digits = value.replace(/\D/g, "");
  if (digits.length > 10) return value;

  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export const PHONE_ERROR = "Enter a 10-digit phone number, e.g. (555) 123-4567";
export const WEBSITE_ERROR = "Enter a valid website, e.g. bobsplumbing.com";
