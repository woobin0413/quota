/**
 * GET/PATCH /api/profile
 *
 * The business name this route stores is what prints on every client-facing
 * quote and invoice (lib/quote-pdf.ts falls back
 * `company_name || fullName || email`), so a profile that silently fails to
 * save means a contractor emails an invoice headed by their raw address.
 *
 * first/last name matter here for a non-obvious reason: Auth0 database
 * connections never issue `given_name`/`family_name`, so for email/password
 * signups this route is the only writer those columns ever get.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const updateUserProfile = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/db/users", () => ({
  updateUserProfile: (...a: unknown[]) => updateUserProfile(...a),
}));
vi.mock("@/lib/admin", () => ({ isAdminEmail: () => false }));

import { GET, PATCH } from "@/app/api/profile/route";

const userRow = {
  id: "u1",
  email: "jo@example.com",
  first_name: null,
  last_name: null,
  company_name: null,
  phone: null,
  metadata: {},
};

const patchReq = (body: unknown) =>
  ({
    json: async () => body,
    headers: new Headers({ "content-type": "application/json" }),
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue(userRow);
});

describe("GET /api/profile", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });

  it("exposes the name fields the first-run dialog prefills from", async () => {
    getCurrentUser.mockResolvedValue({
      ...userRow,
      first_name: "Jo",
      last_name: "Rivera",
      company_name: "Rivera Plumbing",
    });

    const { profile } = await (await GET()).json();

    expect(profile.firstName).toBe("Jo");
    expect(profile.lastName).toBe("Rivera");
    expect(profile.companyName).toBe("Rivera Plumbing");
  });

  it("reports a blank profile as null, which is what triggers onboarding", async () => {
    const { profile } = await (await GET()).json();

    // ProfileOnboarding opens on a falsy companyName — if this ever came back
    // as "" or undefined the dialog would still open, but the header would
    // render an empty business name instead of falling back to the email.
    expect(profile.companyName).toBeNull();
    expect(profile.firstName).toBeNull();
  });
});

describe("PATCH /api/profile", () => {
  it("401 when unauthenticated, without touching the DB", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await PATCH(patchReq({ companyName: "Rivera Plumbing" }));

    expect(res.status).toBe(401);
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it("persists the onboarding payload", async () => {
    updateUserProfile.mockResolvedValue({
      ...userRow,
      first_name: "Jo",
      last_name: "Rivera",
      company_name: "Rivera Plumbing",
    });

    const res = await PATCH(
      patchReq({ firstName: "Jo", lastName: "Rivera", companyName: "Rivera Plumbing" })
    );

    expect(res.status).toBe(200);
    expect(updateUserProfile).toHaveBeenCalledWith("u1", {
      firstName: "Jo",
      lastName: "Rivera",
      companyName: "Rivera Plumbing",
    });
    expect((await res.json()).profile.companyName).toBe("Rivera Plumbing");
  });

  it("accepts a null name — both are optional in the dialog", async () => {
    updateUserProfile.mockResolvedValue({ ...userRow, company_name: "Solo Trades" });

    const res = await PATCH(
      patchReq({ firstName: null, lastName: null, companyName: "Solo Trades" })
    );

    expect(res.status).toBe(200);
    expect(updateUserProfile).toHaveBeenCalledWith("u1", {
      firstName: null,
      lastName: null,
      companyName: "Solo Trades",
    });
  });

  it("rejects a name past the column width instead of letting Postgres truncate", async () => {
    const res = await PATCH(patchReq({ firstName: "x".repeat(101) }));

    // VALIDATION_ERROR is 422 here; 400 is reserved for unparseable JSON.
    expect(res.status).toBe(422);
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it("scopes the write to the session user, never a client-supplied id", async () => {
    updateUserProfile.mockResolvedValue({ ...userRow, company_name: "Rivera" });

    await PATCH(patchReq({ id: "someone-else", companyName: "Rivera" }));

    expect(updateUserProfile).toHaveBeenCalledWith("u1", { companyName: "Rivera" });
  });
});
