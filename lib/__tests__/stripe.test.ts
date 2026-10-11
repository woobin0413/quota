import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tierByPriceId, PRICE_BY_TIER } from "@/lib/stripe";

describe("tierByPriceId", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env.STRIPE_PRICE_PRO = "price_pro_test";
    process.env.STRIPE_PRICE_ULTIMATE = "price_ult_test";
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("maps the pro price id to pro", () => {
    expect(tierByPriceId("price_pro_test")).toBe("pro");
  });

  it("maps the ultimate price id to ultimate", () => {
    expect(tierByPriceId("price_ult_test")).toBe("ultimate");
  });

  it("returns null for an unknown price id", () => {
    expect(tierByPriceId("price_nope")).toBeNull();
  });

  it("PRICE_BY_TIER reads current env", () => {
    expect(PRICE_BY_TIER()).toEqual({
      pro: "price_pro_test",
      ultimate: "price_ult_test",
    });
  });
});

describe("getStripe", () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.resetModules();
  });

  it("throws when STRIPE_SECRET_KEY is unset", async () => {
    vi.resetModules();
    delete process.env.STRIPE_SECRET_KEY;
    const { getStripe } = await import("@/lib/stripe");
    expect(() => getStripe()).toThrow("STRIPE_SECRET_KEY is not configured");
  });

  it("returns the same instance on repeat calls", async () => {
    vi.resetModules();
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const { getStripe } = await import("@/lib/stripe");
    expect(getStripe()).toBe(getStripe());
  });
});
