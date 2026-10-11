// lib/auth/__tests__/bearer.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// The real createRemoteJWKSet would fetch the tenant over the network. Swap it
// for a resolver that hands back the local test public key; everything else in
// jose (signing, verification, claim checks) stays real so the test exercises
// the actual verification path.
const keys = vi.hoisted(() => ({ current: null as unknown as CryptoKeyPair }));
// A second key pair on a different algorithm, standing in for a key set that
// offers something weaker than the RS256 the resource server is configured for.
const altKeys = vi.hoisted(() => ({ current: null as unknown as CryptoKeyPair }));
// A second RS256 pair the resolver never hands out, standing in for a token
// signed by someone who is not the tenant.
const wrongKeys = vi.hoisted(() => ({ current: null as unknown as CryptoKeyPair }));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    // Key resolution is by header alg, the way a real JWKS resolver picks a
    // key — so the ES256 case fails on the pinned algorithm, not on a key the
    // resolver could not supply.
    createRemoteJWKSet: () => async (header: { alg?: string }) =>
      header.alg === "ES256" ? altKeys.current.publicKey : keys.current.publicKey,
  };
});

import { SignJWT, generateKeyPair } from "jose";
import {
  extractBearerToken,
  verifyBearerToken,
  resetJwksCache,
  EMAIL_CLAIM,
  EMAIL_VERIFIED_CLAIM,
} from "@/lib/auth/bearer";

const DOMAIN = "auth.sendquota.test";
const AUDIENCE = "https://api.sendquota.test";

beforeAll(async () => {
  keys.current = (await generateKeyPair("RS256")) as CryptoKeyPair;
  altKeys.current = (await generateKeyPair("ES256")) as CryptoKeyPair;
  wrongKeys.current = (await generateKeyPair("RS256")) as CryptoKeyPair;
});

beforeEach(() => {
  process.env.AUTH0_DOMAIN = DOMAIN;
  process.env.AUTH0_AUDIENCE = AUDIENCE;
  resetJwksCache();
});

async function signToken(
  payload: Record<string, unknown> = {},
  opts: { issuer?: string; audience?: string; expiresIn?: string; sub?: string | null } = {}
) {
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? `https://${DOMAIN}/`)
    .setAudience(opts.audience ?? AUDIENCE)
    .setExpirationTime(opts.expiresIn ?? "5m");
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? "auth0|abc123");
  return jwt.sign(keys.current.privateKey);
}

describe("extractBearerToken", () => {
  it.each([
    ["null header", null, null],
    ["empty header", "", null],
    ["wrong scheme", "Basic abc123", null],
    ["scheme with no token", "Bearer", null],
    ["scheme with blank token", "Bearer   ", null],
    ["plain token", "Bearer abc123", "abc123"],
    ["lowercase scheme", "bearer abc123", "abc123"],
    ["surrounding whitespace", "  Bearer abc123  ", "abc123"],
  ])("%s", (_label, input, expected) => {
    expect(extractBearerToken(input)).toBe(expected);
  });
});

describe("verifyBearerToken", () => {
  it("returns claims for a valid token", async () => {
    const token = await signToken({
      [EMAIL_CLAIM]: "sam@example.com",
      [EMAIL_VERIFIED_CLAIM]: true,
    });
    expect(await verifyBearerToken(token)).toEqual({
      sub: "auth0|abc123",
      email: "sam@example.com",
      emailVerified: true,
    });
  });

  // The claims are added by an Auth0 Action. If that Action is disabled or
  // fails, the token still verifies — so the absence of the claim must read as
  // "unverified", never as "verified". Same fail-closed rule as
  // needsVerification() in lib/email-verification.ts.
  it("treats a missing email_verified claim as unverified", async () => {
    const token = await signToken({ [EMAIL_CLAIM]: "sam@example.com" });
    expect(await verifyBearerToken(token)).toEqual({
      sub: "auth0|abc123",
      email: "sam@example.com",
      emailVerified: false,
    });
  });

  it("treats a non-boolean email_verified claim as unverified", async () => {
    const token = await signToken({ [EMAIL_VERIFIED_CLAIM]: "true" });
    expect((await verifyBearerToken(token))?.emailVerified).toBe(false);
  });

  it("returns an empty email when the claim is missing", async () => {
    const token = await signToken({ [EMAIL_VERIFIED_CLAIM]: true });
    expect((await verifyBearerToken(token))?.email).toBe("");
  });

  it.each([
    ["a token for another audience", { audience: "https://api.someone-else.test" }],
    ["a token from another issuer", { issuer: "https://evil.example.com/" }],
    ["an expired token", { expiresIn: "-1s" }],
    ["a token with no subject", { sub: null }],
  ])("rejects %s", async (_label, opts) => {
    const token = await signToken({ [EMAIL_VERIFIED_CLAIM]: true }, opts);
    expect(await verifyBearerToken(token)).toBeNull();
  });

  // Every claim on this token is valid — right issuer, right audience, not
  // expired, has a sub, RS256 — and it is signed with a well-formed RS256 key.
  // The only thing wrong is that the key is not the one the JWKS hands back, so
  // the signature check is the sole reason this can be rejected. Without it, an
  // implementation that decoded the token and checked claims by hand would pass
  // every other case in this file.
  it("rejects a token signed with a key the JWKS does not hand out", async () => {
    const token = await new SignJWT({ [EMAIL_VERIFIED_CLAIM]: true })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt()
      .setIssuer(`https://${DOMAIN}/`)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .setSubject("auth0|abc123")
      .sign(wrongKeys.current.privateKey);
    expect(await verifyBearerToken(token)).toBeNull();
  });

  // The Auth0 resource server signs with RS256. Pinning the algorithm means a
  // key set that ever offered something weaker cannot be used to mint an
  // acceptable token — the header's alg is refused before the key is resolved.
  it("rejects a token signed with an algorithm other than RS256", async () => {
    const token = await new SignJWT({ [EMAIL_VERIFIED_CLAIM]: true })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuedAt()
      .setIssuer(`https://${DOMAIN}/`)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .setSubject("auth0|abc123")
      .sign(altKeys.current.privateKey);
    expect(await verifyBearerToken(token)).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await verifyBearerToken("not-a-jwt")).toBeNull();
  });

  // Without an audience configured, jwtVerify would accept a token minted for
  // any API in the tenant. Refusing to run is the only safe response.
  it("rejects every token when AUTH0_AUDIENCE is unset", async () => {
    const token = await signToken({ [EMAIL_VERIFIED_CLAIM]: true });
    delete process.env.AUTH0_AUDIENCE;
    resetJwksCache();
    expect(await verifyBearerToken(token)).toBeNull();
  });

  it("rejects every token when AUTH0_DOMAIN is unset", async () => {
    const token = await signToken({ [EMAIL_VERIFIED_CLAIM]: true });
    delete process.env.AUTH0_DOMAIN;
    resetJwksCache();
    expect(await verifyBearerToken(token)).toBeNull();
  });
});
