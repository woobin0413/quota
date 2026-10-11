/**
 * The email-verification gate decision.
 *
 * Two ways this goes wrong and neither is visible in a happy-path click-through:
 *   - fail open: a missing or undefined email_verified claim is treated as
 *     verified, and the gate silently does nothing
 *   - redirect loop: /verify-email is itself gated, so an unverified user is
 *     bounced from the page that would let them fix the problem
 */

import { describe, it, expect } from "vitest";
import {
  needsVerification,
  isVerificationExempt,
  EMAIL_NOT_VERIFIED_BODY,
  VERIFY_EMAIL_PATH,
} from "@/lib/email-verification";

describe("needsVerification", () => {
  it("gates a session whose email is not verified", () => {
    expect(needsVerification({ user: { email_verified: false } })).toBe(true);
  });

  it("lets a verified session through", () => {
    expect(needsVerification({ user: { email_verified: true } })).toBe(false);
  });

  it("fails closed when the claim is missing", () => {
    // A tenant that stops sending the claim must not silently disable the gate.
    expect(needsVerification({ user: {} })).toBe(true);
  });

  it("does not gate an absent session — that is the login redirect's job", () => {
    expect(needsVerification(null)).toBe(false);
    expect(needsVerification({})).toBe(false);
  });
});

describe("isVerificationExempt", () => {
  it("exempts the verify-email page itself", () => {
    // Otherwise the gate redirects the only page that can fix the problem.
    expect(isVerificationExempt(VERIFY_EMAIL_PATH)).toBe(true);
  });

  it("exempts the resend endpoint", () => {
    expect(isVerificationExempt("/api/auth/resend-verification")).toBe(true);
  });

  it("exempts sign-out so a gated user is never trapped", () => {
    expect(isVerificationExempt("/auth/logout")).toBe(true);
  });

  it("does not exempt the dashboard or the app's APIs", () => {
    expect(isVerificationExempt("/dashboard")).toBe(false);
    expect(isVerificationExempt("/api/quotes")).toBe(false);
  });

  it("does not exempt a path that merely starts with an exempt string", () => {
    // /verify-email-blah must not inherit the exemption.
    expect(isVerificationExempt("/verify-email-blah")).toBe(false);
  });
});

describe("EMAIL_NOT_VERIFIED_BODY", () => {
  it("matches the established API error shape", () => {
    expect(EMAIL_NOT_VERIFIED_BODY.success).toBe(false);
    expect(EMAIL_NOT_VERIFIED_BODY.code).toBe("EMAIL_NOT_VERIFIED");
    expect(typeof EMAIL_NOT_VERIFIED_BODY.message).toBe("string");
  });
});
