/**
 * Usage tracking for account-sharing signals. Fire-and-forget: records
 * one row per (user, ip, user-agent, day) in usage_sessions. An in-memory
 * dedupe cache keeps this to ~1 upsert per new combo per day per process.
 * Never blocks or fails a request.
 */

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db/core";
import { logger } from "@/lib/logger";

const seen = new Set<string>();
let seenDay = "";

/** Test hook — clears the dedupe cache. */
export function __clearUsageCacheForTests(): void {
  seen.clear();
  seenDay = "";
}

export function recordUsage(userId: string, ip: string, userAgent: string): void {
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== seenDay) {
      seen.clear();
      seenDay = day;
    }

    const uaHash = crypto.createHash("md5").update(userAgent).digest("hex");
    const key = `${userId}|${ip}|${uaHash}|${day}`;
    if (seen.has(key)) return;
    seen.add(key);

    const now = new Date().toISOString();
    void (async () => {
      try {
        const { error } = await supabaseAdmin
          .from("usage_sessions")
          .upsert(
            { user_id: userId, ip, ua_hash: uaHash, day, first_seen: now, last_seen: now },
            { onConflict: "user_id,ip,ua_hash,day", ignoreDuplicates: false }
          );
        if (error) {
          logger.warn("usage tracking write failed", { err: error.message });
        }
      } catch (err) {
        logger.warn("usage tracking write failed", { err });
      }
    })();
  } catch (err) {
    logger.warn("usage tracking failed", { err });
  }
}
