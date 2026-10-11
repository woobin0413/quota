/**
 * Tier matrix — the single contract test for "what does each plan get".
 *
 * Every tier-gated capability is declared once in EXPECTED, then each helper
 * is asserted against it. Moving a benefit between plans, repricing a cap, or
 * adding a tier fails here with a readable diff instead of leaking silently
 * through the components and routes that read these helpers.
 *
 * Email invoicing and payment receipts are enforced inside their routes, not
 * by a shared helper, so they are covered by the route gate specs:
 * send-quote-gate.test.ts and receipt-gate.test.ts. The `canEmail` column
 * below records the intended policy so the grid stays readable in one place.
 */

import { describe, it, expect } from "vitest";
import {
  QUOTE_LIMIT,
  TIERS,
  TIER_LABEL,
  TIER_PRICE,
  isTierAvailable,
  nextAvailableTier,
  nextTier,
  quoteLimitLabel,
  resolveTier,
  type Tier,
} from "../subscription";
import { pdfFlagsForTier } from "../billing/pdf-flags";

interface TierContract {
  label: string;
  price: string;
  /** Quotes per calendar month; Infinity = unlimited. */
  quoteLimit: number;
  quoteLimitLabel: string;
  /** Sellable today — false while a headline feature is unfinished. */
  purchasable: boolean;
  /** Next rung on the ladder, ignoring availability. */
  nextTier: Tier | null;
  /** Next rung a user can actually buy; null = no upgrade path exists. */
  nextAvailableTier: Tier | null;
  /** Contractor's logo on generated PDFs. */
  pdfLogo: boolean;
  /** "Made with Quota" line on generated PDFs. */
  pdfWatermark: boolean;
  /** Email the invoice / a payment receipt — see route gate specs. */
  canEmail: boolean;
}

const EXPECTED: Record<Tier, TierContract> = {
  free: {
    label: "Free",
    price: "$0",
    quoteLimit: 3,
    quoteLimitLabel: "3",
    purchasable: true,
    nextTier: "pro",
    nextAvailableTier: "pro",
    pdfLogo: false,
    pdfWatermark: true,
    canEmail: false,
  },
  pro: {
    label: "Pro",
    price: "$15",
    quoteLimit: 15,
    quoteLimitLabel: "15",
    purchasable: true,
    nextTier: "ultimate",
    // Ultimate is gated as "coming soon", so Pro is the top of the sellable
    // ladder — every upgrade CTA must be hidden rather than dead-ended.
    nextAvailableTier: null,
    pdfLogo: true,
    pdfWatermark: false,
    canEmail: true,
  },
  ultimate: {
    label: "Ultimate",
    price: "$29",
    quoteLimit: Infinity,
    quoteLimitLabel: "Unlimited",
    purchasable: false,
    nextTier: null,
    nextAvailableTier: null,
    pdfLogo: true,
    pdfWatermark: false,
    canEmail: true,
  },
};

describe("tier matrix", () => {
  it("covers every tier the app ships, in ladder order", () => {
    expect(TIERS).toEqual(["free", "pro", "ultimate"]);
    expect(Object.keys(EXPECTED).sort()).toEqual([...TIERS].sort());
  });

  describe.each(TIERS)("%s", (tier) => {
    const want = EXPECTED[tier];

    it("label and price", () => {
      expect(TIER_LABEL[tier]).toBe(want.label);
      expect(TIER_PRICE[tier]).toBe(want.price);
    });

    it("monthly quote cap", () => {
      expect(QUOTE_LIMIT[tier]).toBe(want.quoteLimit);
      expect(quoteLimitLabel(tier)).toBe(want.quoteLimitLabel);
    });

    it("purchasability", () => {
      expect(isTierAvailable(tier)).toBe(want.purchasable);
    });

    it("upgrade ladder", () => {
      expect(nextTier(tier)).toBe(want.nextTier);
      expect(nextAvailableTier(tier)).toBe(want.nextAvailableTier);
    });

    it("pdf appearance", () => {
      expect(pdfFlagsForTier(tier)).toEqual({
        showLogo: want.pdfLogo,
        showBranding: want.pdfWatermark,
      });
    });
  });

  // Invariants that must hold no matter how the grid is edited.
  it("never routes an upgrade CTA at an unpurchasable tier", () => {
    for (const tier of TIERS) {
      const target = nextAvailableTier(tier);
      if (target !== null) expect(isTierAvailable(target)).toBe(true);
    }
  });

  it("raises the cap on every step up the ladder", () => {
    for (const tier of TIERS) {
      const target = nextTier(tier);
      if (target !== null) {
        expect(QUOTE_LIMIT[target]).toBeGreaterThan(QUOTE_LIMIT[tier]);
      }
    }
  });

  it("shows the watermark only where the logo is withheld", () => {
    for (const tier of TIERS) {
      const { showLogo, showBranding } = pdfFlagsForTier(tier);
      expect(showLogo).toBe(!showBranding);
    }
  });

  // Everything above reads a Tier. resolveTier is what guarantees one: the
  // column is a nullable VARCHAR typed as Tier on the way out, so nothing in
  // the type system rules out a value this grid says nothing about.
  describe("resolveTier", () => {
    it("passes known tiers through", () => {
      for (const tier of TIERS) expect(resolveTier(tier)).toBe(tier);
    });

    it.each([null, undefined, "", "enterprise", "PRO", 0, {}])(
      "falls back to free for %o",
      (stored) => {
        expect(resolveTier(stored)).toBe("free");
      }
    );

    it("never yields a tier that would skip metering", () => {
      for (const stored of [null, undefined, "enterprise", "PRO"]) {
        expect(Number.isFinite(QUOTE_LIMIT[resolveTier(stored)])).toBe(true);
      }
    });
  });

  it("keeps paid tiers free of the watermark", () => {
    for (const tier of TIERS) {
      if (TIER_PRICE[tier] !== "$0") {
        expect(pdfFlagsForTier(tier).showBranding).toBe(false);
      }
    }
  });
});
