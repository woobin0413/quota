"use client";

/**
 * Client hook for the current user's plan + quote usage.
 * Each surface fetches independently (route is cheap; avoids client
 * cache invalidation). `sub` is null while loading or on any failure —
 * consumers render nothing in that case.
 */

import { useEffect, useState } from "react";
import type { Tier } from "@/lib/subscription";

export interface Subscription {
  tier: Tier;
  tierLabel: string;
  quotesUsed: number;
  quoteLimit: number | null;
  quotesRemaining: number | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

export function useSubscription(): { sub: Subscription | null } {
  const [sub, setSub] = useState<Subscription | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.success) {
          setSub({
            tier: d.tier,
            tierLabel: d.tierLabel,
            quotesUsed: d.quotesUsed,
            quoteLimit: d.quoteLimit,
            quotesRemaining: d.quotesRemaining,
            cancelAtPeriodEnd: d.cancelAtPeriodEnd ?? false,
            currentPeriodEnd: d.currentPeriodEnd ?? null,
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return { sub };
}
