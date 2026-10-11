/** Repository boundaries for the transaction-backed quote/schedule RPCs. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/db/core", () => ({
  supabaseAdmin: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { createQuoteAtomic } from "@/lib/db/quotes";
import { ensureDefaultSchedule, replaceSchedule } from "@/lib/db/payments";

const milestoneRow = {
  id: "11111111-1111-4111-8111-111111111111",
  quote_id: "22222222-2222-4222-8222-222222222222",
  user_id: "33333333-3333-4333-8333-333333333333",
  name: "Deposit",
  percentage: "100",
  sort_order: 0,
  created_at: new Date(),
  updated_at: new Date(),
};

beforeEach(() => vi.clearAllMocks());

describe("atomic write repositories", () => {
  it("creates a quote through one RPC and preserves the selected client id", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          quote_id: "q1",
          quote_number: "Q-2026-001",
          quota_exceeded: false,
          resolved_tier: "free",
          quote_limit: 3,
        },
      ],
      error: null,
    });

    const result = await createQuoteAtomic("u1", {
      clientId: "c1",
      clientInfo: { name: "Client", email: "client@example.com" },
      projectName: "Project",
      discountAmount: 0,
      lineItems: [{ description: "Work", quantity: 1, unitPrice: 10 }],
    });

    expect(result.kind).toBe("created");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "create_quote_atomic",
      expect.objectContaining({ p_user_id: "u1", p_client_id: "c1" })
    );
  });

  it("initializes a default schedule through one RPC", async () => {
    rpc.mockResolvedValue({ data: [milestoneRow], error: null });

    const result = await ensureDefaultSchedule(
      milestoneRow.quote_id,
      milestoneRow.user_id
    );

    expect(result).toEqual([
      expect.objectContaining({ id: milestoneRow.id, percentage: 100 }),
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("ensure_default_payment_schedule", {
      p_quote_id: milestoneRow.quote_id,
      p_user_id: milestoneRow.user_id,
    });
  });

  it("replaces a schedule through one RPC", async () => {
    rpc.mockResolvedValue({ data: [milestoneRow], error: null });

    await replaceSchedule(milestoneRow.quote_id, milestoneRow.user_id, [
      { id: milestoneRow.id, name: "Deposit", percentage: 100, sortOrder: 0 },
    ]);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "replace_payment_schedule_atomic",
      expect.objectContaining({
        p_quote_id: milestoneRow.quote_id,
        p_user_id: milestoneRow.user_id,
      })
    );
  });

  it("surfaces an RPC error instead of returning partial success", async () => {
    const failure = { message: "transaction rolled back" };
    rpc.mockResolvedValue({ data: null, error: failure });

    await expect(
      replaceSchedule("q1", "u1", [
        { name: "Only", percentage: 100, sortOrder: 0 },
      ])
    ).rejects.toBe(failure);
  });
});
