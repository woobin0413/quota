import { test, expect, vi, beforeEach } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { rpc } }));
import { checkRateLimit } from "@/lib/rate-limit";
beforeEach(() => rpc.mockReset());
test("uses a shared atomic counter and hashes private limiter keys", async () => {
  rpc.mockResolvedValue({ data: { allowed: true, remaining: 2, resetTime: 1000 }, error: null });
  expect((await checkRateLimit("send-quote:user-1", { maxRequests: 3 })).allowed).toBe(true);
  const first = rpc.mock.calls[0][1];
  await checkRateLimit("receipt:user-1", { maxRequests: 3 });
  expect(rpc.mock.calls[1][1].p_key).toBe(first.p_key);
  expect(first.p_key).toMatch(/^[a-f0-9]{64}$/);
  expect(first.p_key).not.toContain("user-1");
  expect(first.p_max).toBe(3);
});
test("returns rejection and fails closed when the shared database is unavailable", async () => {
  rpc.mockResolvedValue({ data: { allowed: false, remaining: 0, resetTime: 1000 }, error: null });
  expect((await checkRateLimit("billing:user-1")).allowed).toBe(false);
  rpc.mockResolvedValue({ error: { message: "private details" } });
  await expect(checkRateLimit("billing:user-1")).rejects.toThrow("Rate limit unavailable");
  await expect(checkRateLimit("billing:user-1", { maxRequests: 0 })).rejects.toThrow();
});
