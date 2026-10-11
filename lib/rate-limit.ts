import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
export interface RateLimitResult { allowed: boolean; remaining: number; resetTime: number; }
/** Shared atomic budget; database failures fail closed rather than granting requests. */
export async function checkRateLimit(key: string, { windowMs = 60_000, maxRequests = 10 } = {}): Promise<RateLimitResult> {
  if (!Number.isInteger(windowMs) || !Number.isInteger(maxRequests) || windowMs < 1 || windowMs > 86_400_000 || maxRequests < 1) throw new Error("Invalid rate limit");
  const budgetKey = key.replace(/^(send-quote|receipt):/, "email:");
  const { data, error } = await supabaseAdmin.rpc("consume_request_budget", {
    p_key: createHash("sha256").update(budgetKey).digest("hex"), p_max: maxRequests, p_window_ms: windowMs,
  });
  if (error || typeof data?.allowed !== "boolean" || !Number.isFinite(data?.remaining) || !Number.isFinite(data?.resetTime)) throw new Error("Rate limit unavailable");
  return data;
}
