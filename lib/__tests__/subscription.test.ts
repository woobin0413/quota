import { describe, it, expect } from "vitest";
import {
  QUOTE_LIMIT, TIER_LABEL, TIER_PRICE, TIERS, UNAVAILABLE_TIERS,
  nextTier, nextAvailableTier, noQuotesLeftTitle, quoteLimitLabel,
} from "../subscription";

describe("QUOTE_LIMIT", () => {
  it("free is 3", () => expect(QUOTE_LIMIT.free).toBe(3));
  it("pro is 15", () => expect(QUOTE_LIMIT.pro).toBe(15));
  it("ultimate is unlimited", () => expect(QUOTE_LIMIT.ultimate).toBe(Infinity));
});

describe("nextTier ladder", () => {
  it("free → pro", () => expect(nextTier("free")).toBe("pro"));
  it("pro → ultimate", () => expect(nextTier("pro")).toBe("ultimate"));
  it("ultimate → null (top)", () => expect(nextTier("ultimate")).toBeNull());
});

describe("nextAvailableTier (skips coming-soon tiers)", () => {
  it("free → pro", () => expect(nextAvailableTier("free")).toBe("pro"));
  it("pro → null while ultimate is unavailable", () => {
    expect(UNAVAILABLE_TIERS).toContain("ultimate");
    expect(nextAvailableTier("pro")).toBeNull();
  });
  it("ultimate → null (top)", () => expect(nextAvailableTier("ultimate")).toBeNull());
  it("never returns an unavailable tier", () =>
    expect(TIERS.map(nextAvailableTier).filter(Boolean))
      .not.toContain(UNAVAILABLE_TIERS[0]));
});

describe("noQuotesLeftTitle", () => {
  it("free hints at an upgrade", () =>
    expect(noQuotesLeftTitle("free")).toBe(
      "No quotes left this month — upgrade your plan to create more."
    ));
  it("pro hints at the reset (nothing to buy)", () =>
    expect(noQuotesLeftTitle("pro")).toBe(
      "No quotes left this month — your quota resets on the 1st of next month."
    ));
});

describe("quoteLimitLabel", () => {
  it("finite → number string", () => expect(quoteLimitLabel("free")).toBe("3"));
  it("infinite → Unlimited", () => expect(quoteLimitLabel("ultimate")).toBe("Unlimited"));
});

describe("metadata tables", () => {
  it("labels", () => expect([TIER_LABEL.free, TIER_LABEL.pro, TIER_LABEL.ultimate]).toEqual(["Free","Pro","Ultimate"]));
  it("prices", () => expect([TIER_PRICE.free, TIER_PRICE.pro, TIER_PRICE.ultimate]).toEqual(["$0","$15","$29"]));
  it("order", () => expect(TIERS).toEqual(["free","pro","ultimate"]));
});
