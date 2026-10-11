"use client";

/**
 * Header plan chip: always-visible tier label linking to the in-app
 * Plan & Billing page. Renders nothing until the subscription loads.
 */

import Link from "next/link";
import { useSubscription } from "@/components/subscription/use-subscription";

export function PlanChip() {
  const { sub } = useSubscription();

  if (!sub) return null;

  return (
    <Link
      href="/billing"
      className="stamp border-primary-foreground/40 text-primary-foreground/80 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      data-testid="plan-chip"
      aria-label={`Current plan: ${sub.tierLabel}. Open plan & billing.`}
    >
      {sub.tierLabel}
    </Link>
  );
}
