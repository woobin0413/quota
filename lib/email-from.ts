/**
 * Building a legal `From:` header.
 *
 * Two things kept producing headers Resend rejects with
 * `validation_error: Invalid `from` field`:
 *
 * 1. `RESEND_FROM_EMAIL` has two consumers with different expectations. This
 *    app wrapped it as `${name} <${env}>`, while
 *    `scripts/auth0-email-provider.mjs` feeds the same variable to Auth0's
 *    `default_from_address`, which wants the `Name <addr>` form. Set for Auth0,
 *    the app produced nested angle brackets. `parseFromEnv` accepts either form
 *    so neither consumer has to change.
 *
 * 2. The display name is contractor-controlled text. `lib/quote-pdf.ts` resolves
 *    it `company_name || fullName || email`, and all three are NULL on a fresh
 *    signup — so the fallback lands on the user's own email address, whose `@`
 *    is illegal in an unquoted RFC 5322 phrase. Ordinary names break it too:
 *    "Smith, Jones & Co" splits the header into two addresses.
 *
 * Characters are encoded, never stripped, so a contractor's real name still
 * renders. CR/LF is the one exception — it has no legitimate use in a header
 * value and allows injecting extra headers, so it is collapsed to a space.
 */

/**
 * RFC 5322 `atext` plus space and dot — the characters a display name may carry
 * without being quoted. Anything outside this set forces a quoted-string.
 */
const ATEXT_PHRASE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~ .-]+$/;

/** Base64 chars per encoded-word. A multiple of 4 keeps each word self-contained. */
const B64_PER_WORD = 60;

export interface ParsedFrom {
  /** The bare addr-spec, e.g. `noreply@sendquota.com`. */
  address: string;
  /** Display name the env supplied, if it used the `Name <addr>` form. */
  brand?: string;
}

/**
 * Split `RESEND_FROM_EMAIL` into its address and optional brand.
 * Accepts `addr@example.com`, `Name <addr@example.com>` and
 * `"Name" <addr@example.com>`.
 */
export function parseFromEnv(raw: string): ParsedFrom {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*?)\s*<([^<>]+)>$/);
  if (!match) return { address: trimmed };

  const brand = match[1].trim().replace(/^"(.*)"$/, "$1").trim();
  return { address: match[2].trim(), brand: brand || undefined };
}

/** RFC 2047 encoded-words, split on character boundaries so nothing is mangled. */
function encodeWords(text: string): string {
  const encoder = new TextEncoder();
  const bytesPerWord = (B64_PER_WORD / 4) * 3;
  const words: string[] = [];
  let buffer: number[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const b64 = Buffer.from(Uint8Array.from(buffer)).toString("base64");
    words.push(`=?UTF-8?B?${b64}?=`);
    buffer = [];
  };

  // Iterating the string yields whole code points, so a multi-byte character
  // is never split across two encoded-words.
  for (const char of text) {
    const bytes = Array.from(encoder.encode(char));
    if (buffer.length + bytes.length > bytesPerWord) flush();
    buffer.push(...bytes);
  }
  flush();

  return words.join(" ");
}

/**
 * Render arbitrary text as a legal display name: bare when it is already a
 * valid phrase, quoted when it holds specials like `,` `<` `"`, and RFC 2047
 * encoded when it is non-ASCII.
 *
 * Returns "" for input that is empty once CR/LF and surrounding space are gone,
 * which callers treat as "send a bare address".
 */
export function encodeDisplayName(name: string): string {
  const clean = name.replace(/[\r\n]+/g, " ").trim();
  if (!clean) return "";

  // Non-ASCII (and any control character that survived) needs encoded-words.
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(clean)) return encodeWords(clean);

  if (ATEXT_PHRASE.test(clean)) return clean;

  return `"${clean.replace(/([\\"])/g, "\\$1")}"`;
}

/**
 * Build the `From:` header from the contractor's business name and the
 * configured sending address.
 *
 * An email-shaped display name is rejected in favour of the brand: the
 * `company_name || fullName || email` fallback in lib/quote-pdf.ts means a
 * contractor who has not set a business name would otherwise send
 * `bob@gmail.com <noreply@sendquota.com>`, which spam filters read as a spoof
 * even once it is syntactically legal.
 */
export function buildFromHeader(
  companyName: string | null | undefined,
  rawFrom: string
): string {
  const { address, brand } = parseFromEnv(rawFrom);
  const candidate = (companyName ?? "").replace(/[\r\n]+/g, " ").trim();
  const usable = candidate && !candidate.includes("@") ? candidate : brand ?? "";

  const display = encodeDisplayName(usable);
  return display ? `${display} <${address}>` : address;
}
