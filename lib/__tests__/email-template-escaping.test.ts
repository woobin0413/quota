// lib/__tests__/email-template-escaping.test.ts
//
// These emails go out over a DKIM-signed, SPF-aligned, DMARC-monitored domain.
// Anything a caller can inject into the HTML is delivered with this project's
// sending reputation attached to it, so every interpolation is escaped and every
// URL is scheme-checked. See docs/api/v1.md and the CLAUDE.md deliverability
// notes for why that reputation is expensive to lose.
import { describe, it, expect } from "vitest";
import {
  generateQuoteEmailHTML,
  generateCancellationEmailHTML,
} from "@/lib/email-templates";

const BREAKOUT = `" style="x" onload="alert(1)`;
const TAG = `<img src=x onerror=alert(1)>`;

function baseData() {
  return {
    recipientName: "Sam Rivera",
    recipientEmail: "sam@example.com",
    quoteNumber: "Q-2026-001",
    quoteTotal: 1000,
    companyName: "Rivera Plumbing",
    companyEmail: "billing@rivera.example",
    companyPhone: "+1 555 0100",
    lineItemCount: 2,
    subtotal: 1000,
  };
}

/**
 * Assert no LIVE markup was injected.
 *
 * Deliberately not a substring check for `onerror=` or `javascript:`: correctly
 * escaped output still contains those as inert text (`&lt;img src=x
 * onerror=…&gt;`), so a naive substring assertion fails on a fix that works.
 * What matters is whether a real tag or a real executable attribute exists.
 */
function assertNoInjection(html: string) {
  expect(html).not.toContain(TAG);
  expect(html).not.toContain(BREAKOUT);
  expect(html).not.toMatch(/<img[^>]*on\w+\s*=/i);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/(href|src)\s*=\s*"(javascript|data|vbscript):/i);
}

describe("generateQuoteEmailHTML — HTML injection", () => {
  it.each([
    "recipientName",
    "companyName",
    "companyEmail",
    "companyPhone",
    "quoteNumber",
    "contractorName",
    "headerLabel",
  ])("escapes a tag injected through %s", (field) => {
    const html = generateQuoteEmailHTML({ ...baseData(), [field]: TAG } as never);
    assertNoInjection(html);
    // Proof the value was rendered at all, just neutralised.
    expect(html).toContain("&lt;img");
  });

  it.each(["recipientName", "companyName", "contractorName", "quoteNumber"])(
    "escapes an attribute breakout through %s",
    (field) => {
      const html = generateQuoteEmailHTML({
        ...baseData(),
        [field]: BREAKOUT,
      } as never);
      assertNoInjection(html);
    }
  );

  it("still renders the ordinary values it was given", () => {
    const html = generateQuoteEmailHTML(baseData() as never);
    expect(html).toContain("Sam Rivera");
    expect(html).toContain("Rivera Plumbing");
    expect(html).toContain("Q-2026-001");
    assertNoInjection(html);
  });
});

describe("generateQuoteEmailHTML — URL handling", () => {
  it("renders the CTA for an ordinary https url", () => {
    const html = generateQuoteEmailHTML({
      ...baseData(),
      quoteViewUrl: "https://sendquota.com/quote/abc",
    } as never);
    expect(html).toContain("View Full Quote");
    expect(html).toContain("https://sendquota.com/quote/abc");
  });

  // Escaping alone does not save this one: `javascript:` survives entity
  // encoding intact, so the scheme has to be checked separately.
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["vbscript:", "vbscript:msgbox(1)"],
  ])("drops the CTA for a %s url", (_label, url) => {
    const html = generateQuoteEmailHTML({
      ...baseData(),
      quoteViewUrl: url,
    } as never);
    assertNoInjection(html);
    expect(html).not.toContain("View Full Quote");
    // Falls back to the no-link copy rather than rendering a dead button.
    expect(html).toContain("attached as a PDF");
  });

  it("escapes an attribute breakout attempted through the url", () => {
    const html = generateQuoteEmailHTML({
      ...baseData(),
      quoteViewUrl: `https://ok.example/"><img src=x onerror=alert(1)><a href="`,
    } as never);
    assertNoInjection(html);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/svg+xml,<svg onload=alert(1)>"],
  ])("drops the logo image for a %s url", (_label, url) => {
    const html = generateQuoteEmailHTML({
      ...baseData(),
      companyLogoUrl: url,
    } as never);
    assertNoInjection(html);
    // Matched by pattern, not by literal prefix: a literal `<img src=` check
    // silently stops testing anything the moment the tag's attribute order
    // changes, while still passing.
    expect(html).not.toMatch(/<img[^>]*src=/i);
  });

  it("renders an ordinary https logo url", () => {
    const html = generateQuoteEmailHTML({
      ...baseData(),
      companyLogoUrl: "https://cdn.example/logo.png",
    } as never);
    expect(html).toContain("https://cdn.example/logo.png");
  });
});

// The cancellation email ships over the same DKIM-signed domain as the quote
// email and was missed by the first hardening pass. Every value it renders is
// server-derived today, so these cases guard an invariant rather than fix a
// live hole — which is precisely when they are cheapest to add.
describe("generateCancellationEmailHTML — HTML injection", () => {
  const cancelBase = {
    recipientName: "Sam Rivera",
    planLabel: "Pro",
    accessUntil: "March 1, 2026",
    billingUrl: "https://sendquota.com/billing",
  };

  it.each(["recipientName", "planLabel", "accessUntil"])(
    "escapes a tag injected through %s",
    (field) => {
      const html = generateCancellationEmailHTML({
        ...cancelBase,
        [field]: TAG,
      } as never);
      assertNoInjection(html);
      expect(html).toContain("&lt;img");
    }
  );

  it("escapes an attribute breakout through recipientName", () => {
    const html = generateCancellationEmailHTML({
      ...cancelBase,
      recipientName: BREAKOUT,
    } as never);
    assertNoInjection(html);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
  ])("drops the reactivate button for a %s billingUrl", (_label, url) => {
    const html = generateCancellationEmailHTML({
      ...cancelBase,
      billingUrl: url,
    } as never);
    assertNoInjection(html);
    expect(html).not.toContain("Reactivate my plan");
    // Falls back to the no-link copy rather than rendering a dead button.
    expect(html).toContain("from Plan &amp; Billing");
  });

  it("renders the reactivate button for an ordinary https url", () => {
    const html = generateCancellationEmailHTML(cancelBase as never);
    expect(html).toContain("Reactivate my plan");
    expect(html).toContain("https://sendquota.com/billing");
    assertNoInjection(html);
  });
});
