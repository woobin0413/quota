import { describe, it, expect } from "vitest";
import { pdfFlagsForTier } from "@/lib/billing/pdf-flags";

describe("pdfFlagsForTier", () => {
  it("free: watermark on, logo off", () => {
    expect(pdfFlagsForTier("free")).toEqual({ showLogo: false, showBranding: true });
  });
  it("pro: logo on, no watermark", () => {
    expect(pdfFlagsForTier("pro")).toEqual({ showLogo: true, showBranding: false });
  });
  it("ultimate: logo on, no watermark", () => {
    expect(pdfFlagsForTier("ultimate")).toEqual({ showLogo: true, showBranding: false });
  });
});
