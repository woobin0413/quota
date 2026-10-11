/**
 * Tests for POST /api/webhooks/resend — signature verification.
 *
 * This route was previously written against a bare hex HMAC of the body, read
 * from a `resend-signature` header. Resend does not sign that way: it delivers
 * through Svix, which sends `svix-id` / `svix-timestamp` / `svix-signature` and
 * signs `${id}.${timestamp}.${body}`. The result was a route that rejected
 * every genuine webhook with 401 while looking perfectly healthy in code
 * review — delivery, bounce, and spam-complaint events were silently dropped.
 *
 * So these tests sign with the real `svix` SDK rather than a stub. A mocked
 * verifier would have passed against the broken implementation too.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Webhook } from "svix";

const updateEmailStatus = vi.fn();
vi.mock("@/lib/email-sender", () => ({
  updateEmailStatus: (...a: unknown[]) => updateEmailStatus(...a),
}));

const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({ headers: () => mockHeaders() }));

import { POST } from "@/app/api/webhooks/resend/route";

/** A whsec_ secret in the format Svix expects (base64 body). */
const SECRET = "whsec_" + Buffer.from("quota-test-signing-key-0123456789").toString("base64");

const PAYLOAD = {
  type: "email.delivered",
  created_at: "2026-07-25T12:00:00.000Z",
  data: {
    email_id: "e1b7f3a0-0000-4000-8000-000000000001",
    from: "quotes@sendquota.com",
    to: ["client@example.com"],
    subject: "Invoice Q-2026-001",
    created_at: "2026-07-25T12:00:00.000Z",
    delivered_at: "2026-07-25T12:00:05.000Z",
  },
};

/** Build a request the way Svix actually signs one. */
function signedRequest(body: string, secret = SECRET, at = new Date()) {
  const id = "msg_2abcDEF";
  const sig = new Webhook(secret).sign(id, at, body);
  mockHeaders.mockReturnValue(
    new Headers({
      "svix-id": id,
      "svix-timestamp": Math.floor(at.getTime() / 1000).toString(),
      "svix-signature": sig,
    })
  );
  return { text: async () => body } as unknown as Parameters<typeof POST>[0];
}

function unsignedRequest(body: string, headerOverrides: Record<string, string> = {}) {
  mockHeaders.mockReturnValue(new Headers(headerOverrides));
  return { text: async () => body } as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/webhooks/resend — signature verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  it("accepts a genuine Svix-signed delivery event", async () => {
    const body = JSON.stringify(PAYLOAD);
    const res = await POST(signedRequest(body));

    expect(res.status).toBe(200);
    expect(updateEmailStatus).toHaveBeenCalledWith(
      PAYLOAD.data.email_id,
      "delivered",
      expect.objectContaining({ deliveredAt: new Date(PAYLOAD.data.delivered_at) })
    );
  });

  it("fails closed when the secret is not configured", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const res = await POST(unsignedRequest(JSON.stringify(PAYLOAD)));

    expect(res.status).toBe(500);
    expect(updateEmailStatus).not.toHaveBeenCalled();
  });

  it("rejects a request with no svix headers at all", async () => {
    const res = await POST(unsignedRequest(JSON.stringify(PAYLOAD)));

    expect(res.status).toBe(401);
    expect(updateEmailStatus).not.toHaveBeenCalled();
  });

  it("rejects the old bare-HMAC scheme this route used to accept", async () => {
    const body = JSON.stringify(PAYLOAD);
    const { createHmac } = await import("node:crypto");
    const legacy = createHmac("sha256", SECRET).update(body).digest("hex");

    const res = await POST(unsignedRequest(body, { "resend-signature": legacy }));

    expect(res.status).toBe(401);
    expect(updateEmailStatus).not.toHaveBeenCalled();
  });

  it("rejects a body altered after signing", async () => {
    const req = signedRequest(JSON.stringify(PAYLOAD));
    // Same signature, different bytes — what a tampering proxy would produce.
    const tampered = {
      text: async () => JSON.stringify({ ...PAYLOAD, type: "email.bounced" }),
    } as unknown as Parameters<typeof POST>[0];
    void req;

    const res = await POST(tampered);

    expect(res.status).toBe(401);
    expect(updateEmailStatus).not.toHaveBeenCalled();
  });

  it("rejects a correctly signed payload from the wrong secret", async () => {
    const other = "whsec_" + Buffer.from("a-different-signing-key-987654321").toString("base64");
    const res = await POST(signedRequest(JSON.stringify(PAYLOAD), other));

    expect(res.status).toBe(401);
    expect(updateEmailStatus).not.toHaveBeenCalled();
  });

  it("rejects a replayed request outside the timestamp window", async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000); // 1h old
    const res = await POST(signedRequest(JSON.stringify(PAYLOAD), SECRET, stale));

    expect(res.status).toBe(401);
    expect(updateEmailStatus).not.toHaveBeenCalled();
  });

  // Svix parses inside verify(), so a non-JSON body never reaches a handler —
  // it is rejected as unverified, which is the stricter of the two answers.
  it("rejects a signed but unparseable body", async () => {
    const res = await POST(signedRequest("not json at all"));

    expect(res.status).toBe(401);
    expect(updateEmailStatus).not.toHaveBeenCalled();
  });

  it("returns 400 when a verified payload is missing the fields handlers need", async () => {
    const res = await POST(signedRequest(JSON.stringify({ type: "email.delivered" })));

    expect(res.status).toBe(400);
    expect(updateEmailStatus).not.toHaveBeenCalled();
  });
});
