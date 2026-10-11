import { describe, it, expect } from "vitest";
import {
  sniffImageType,
  validateLogoUpload,
  MAX_LOGO_BYTES,
} from "../logo-validation";

// Minimal real headers
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
  Buffer.from("VP8 "),
]);
const SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
const GIF = Buffer.from("GIF89a......");

describe("sniffImageType", () => {
  it("detects png", () => expect(sniffImageType(PNG)).toBe("png"));
  it("detects jpeg", () => expect(sniffImageType(JPEG)).toBe("jpeg"));
  // WebP is rejected on purpose: @react-pdf v4 cannot render it,
  // which would silently drop the logo from generated PDFs.
  it("rejects webp", () => expect(sniffImageType(WEBP)).toBeNull());
  it("rejects svg", () => expect(sniffImageType(SVG)).toBeNull());
  it("rejects gif", () => expect(sniffImageType(GIF)).toBeNull());
  it("rejects empty", () => expect(sniffImageType(Buffer.alloc(0))).toBeNull());
  it("rejects short buffer", () =>
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull());
});

describe("validateLogoUpload", () => {
  it("accepts a valid png", () => {
    const r = validateLogoUpload(PNG);
    expect(r).toEqual({
      ok: true,
      type: "png",
      ext: "png",
      contentType: "image/png",
    });
  });
  it("maps jpeg → .jpg", () => {
    const r = validateLogoUpload(JPEG);
    expect(r.ok && r.ext).toBe("jpg");
  });
  it("rejects oversize", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]);
    const r = validateLogoUpload(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/2 MB/);
  });
  it("rejects svg with type message", () => {
    const r = validateLogoUpload(SVG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/PNG or JPG/);
  });
  it("rejects webp with type message", () => {
    const r = validateLogoUpload(WEBP);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/PNG or JPG/);
  });
});
