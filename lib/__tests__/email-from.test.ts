/**
 * From-header construction.
 *
 * Every one of these inputs previously produced
 * `validation_error: Invalid `from` field` from Resend, which failed the send
 * outright — and did not even retry, because sendQuoteEmailWithRetry bails
 * early on errors containing "validation".
 *
 * Nothing in the suite had ever executed the old header line: e2e runs with
 * RESEND_MOCK=1, which returns before the header is built. That is how a broken
 * `from` shipped, so these assert the built value directly.
 */

import { describe, it, expect } from "vitest";
import {
  buildFromHeader,
  encodeDisplayName,
  parseFromEnv,
} from "@/lib/email-from";

const ADDR = "noreply@sendquota.com";
/** The form Auth0 needs, which the app used to wrap again into `<...>`. */
const ENV_MAILBOX = `Quota <${ADDR}>`;

/**
 * Split a header into display name + addr-spec the way a strict parser would,
 * rejecting anything with nested or unbalanced angle brackets.
 */
function parseHeader(header: string): { display: string; address: string } | null {
  const match = header.match(/^(?:(.*)\s)?<([^<>]+)>$/);
  if (!match) {
    // A bare address is legal too.
    return /^[^\s<>@]+@[^\s<>@]+$/.test(header)
      ? { display: "", address: header }
      : null;
  }
  const [, display = "", address] = match;
  if (/[<>]/.test(display)) return null;
  return { display: display.trim(), address };
}

/** Undo quoting / RFC 2047 so we can assert the name survived intact. */
function decodeDisplay(display: string): string {
  if (!display) return "";
  if (display.startsWith("=?")) {
    return display
      .split(/\s+/)
      .map((word) => {
        const m = word.match(/^=\?UTF-8\?B\?(.*)\?=$/);
        return m ? Buffer.from(m[1], "base64").toString("utf8") : word;
      })
      .join("");
  }
  if (display.startsWith('"')) {
    return display.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return display;
}

describe("parseFromEnv", () => {
  it("takes a bare address as-is", () => {
    expect(parseFromEnv(ADDR)).toEqual({ address: ADDR });
  });

  it("pulls the address out of the mailbox form Auth0 requires", () => {
    // scripts/auth0-email-provider.mjs feeds this same env var to Auth0's
    // default_from_address, so both shapes have to work.
    expect(parseFromEnv(ENV_MAILBOX)).toEqual({ address: ADDR, brand: "Quota" });
  });

  it("unwraps a quoted brand", () => {
    expect(parseFromEnv(`"Quota Billing" <${ADDR}>`)).toEqual({
      address: ADDR,
      brand: "Quota Billing",
    });
  });

  it("ignores surrounding whitespace", () => {
    expect(parseFromEnv(`  Quota   <${ADDR}>  `)).toEqual({
      address: ADDR,
      brand: "Quota",
    });
  });
});

describe("encodeDisplayName", () => {
  it("leaves an ordinary name unquoted", () => {
    expect(encodeDisplayName("Acme Contracting")).toBe("Acme Contracting");
  });

  it("quotes a name containing a comma", () => {
    expect(encodeDisplayName("Smith, Jones & Co")).toBe('"Smith, Jones & Co"');
  });

  it("escapes embedded quotes rather than dropping them", () => {
    expect(encodeDisplayName('The "Best" Builders')).toBe(
      '"The \\"Best\\" Builders"'
    );
  });

  it("collapses CR/LF so extra headers cannot be injected", () => {
    const encoded = encodeDisplayName("Acme\r\nBcc: victim@example.com");
    expect(encoded).not.toMatch(/[\r\n]/);
  });

  it("returns empty for a name that is only whitespace", () => {
    expect(encodeDisplayName("   \r\n  ")).toBe("");
  });

  it("splits long non-ASCII names into decodable encoded-words", () => {
    const name = "Ståhl Bygg och Renovering Aktiebolag ".repeat(4).trim();
    const encoded = encodeDisplayName(name);
    expect(decodeDisplay(encoded)).toBe(name);
    for (const word of encoded.split(/\s+/)) {
      // RFC 2047 caps an encoded-word at 75 characters.
      expect(word.length).toBeLessThanOrEqual(75);
    }
  });
});

describe("buildFromHeader", () => {
  const cases: Array<{ label: string; company: string | null; env: string }> = [
    { label: "plain name", company: "Acme Contracting", env: ADDR },
    { label: "comma in name", company: "Smith, Jones & Co", env: ADDR },
    { label: "angle bracket", company: "Bob <hax@evil.com>", env: ADDR },
    { label: "double quote", company: 'The "Best" Builders', env: ADDR },
    { label: "newline", company: "Acme\r\nBcc: victim@x.com", env: ADDR },
    { label: "non-ascii", company: "Ståhl Bygg AB", env: ADDR },
    { label: "null company", company: null, env: ENV_MAILBOX },
    { label: "empty company", company: "   ", env: ENV_MAILBOX },
    { label: "env mailbox form", company: "Acme Contracting", env: ENV_MAILBOX },
  ];

  it.each(cases)("$label produces a parseable mailbox", ({ company, env }) => {
    const header = buildFromHeader(company, env);
    const parsed = parseHeader(header);

    expect(parsed, `unparseable header: ${header}`).not.toBeNull();
    expect(parsed!.address).toBe(ADDR);
    expect(header).not.toMatch(/[\r\n]/);
  });

  it("round-trips the display name rather than mangling it", () => {
    for (const name of ["Smith, Jones & Co", 'The "Best" Builders', "Ståhl Bygg AB"]) {
      const parsed = parseHeader(buildFromHeader(name, ADDR))!;
      expect(decodeDisplay(parsed.display)).toBe(name);
    }
  });

  it("does not nest brackets when the env already carries a display name", () => {
    // The original bug: `${name} <${env}>` where env was `Quota <addr>`.
    const header = buildFromHeader("Acme Contracting", ENV_MAILBOX);
    expect(header).toBe(`Acme Contracting <${ADDR}>`);
    expect(header).not.toContain("<Quota");
  });

  it("prefers the brand over an email-shaped fallback name", () => {
    // quote-pdf.ts resolves company_name || fullName || email, and all three
    // are NULL on a fresh signup — so the contractor's own address arrives here.
    expect(buildFromHeader("bob@gmail.com", ENV_MAILBOX)).toBe(`Quota <${ADDR}>`);
  });

  it("falls back to a bare address when there is no name at all", () => {
    expect(buildFromHeader(null, ADDR)).toBe(ADDR);
  });
});
