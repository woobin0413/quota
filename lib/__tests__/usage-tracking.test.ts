import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const upsert = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/lib/db/core", () => ({
  supabaseAdmin: { from: () => ({ upsert: (...a: unknown[]) => upsert(...a) }) },
}));

import { recordUsage, __clearUsageCacheForTests } from "@/lib/usage-tracking";

describe("recordUsage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T10:00:00Z"));
    upsert.mockClear();
    __clearUsageCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes once per user/ip/ua/day", async () => {
    recordUsage("u1", "1.2.3.4", "Safari");
    recordUsage("u1", "1.2.3.4", "Safari");
    recordUsage("u1", "1.2.3.4", "Safari");
    await vi.runAllTimersAsync();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("distinct ip or ua writes separately", async () => {
    recordUsage("u1", "1.2.3.4", "Safari");
    recordUsage("u1", "5.6.7.8", "Safari");
    recordUsage("u1", "1.2.3.4", "Chrome");
    await vi.runAllTimersAsync();
    expect(upsert).toHaveBeenCalledTimes(3);
  });

  it("new day writes again", async () => {
    recordUsage("u1", "1.2.3.4", "Safari");
    await vi.runAllTimersAsync();
    vi.setSystemTime(new Date("2026-07-19T10:00:00Z"));
    recordUsage("u1", "1.2.3.4", "Safari");
    await vi.runAllTimersAsync();
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("swallows DB errors", async () => {
    upsert.mockRejectedValueOnce(new Error("boom"));
    expect(() => recordUsage("u1", "1.2.3.4", "Safari")).not.toThrow();
    await vi.runAllTimersAsync();
  });
});
