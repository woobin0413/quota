"use client";

/**
 * Dashboard quota badge: "{Tier} · N quotes left" (or "Unlimited quotes")
 * plus an upgrade entry point. Renders nothing until loaded / on failure.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UpgradeDialog } from "@/components/subscription/UpgradeDialog";
import { useSubscription } from "@/components/subscription/use-subscription";
import { nextAvailableTier, QUOTA_RESET_NOTE } from "@/lib/subscription";

export function QuotaBadge() {
  const { sub } = useSubscription();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!sub) return null;

  const zero = sub.quotesRemaining === 0;
  const remainingLabel =
    sub.quotesRemaining === null
      ? "Unlimited quotes"
      : zero
        ? "No quotes left this month"
        : `${sub.quotesRemaining} quote${sub.quotesRemaining === 1 ? "" : "s"} left`;
  // Only offer an upgrade we can actually sell — Pro has nothing above it
  // while Ultimate is "coming soon", so it gets the reset note instead.
  const canUpgrade = nextAvailableTier(sub.tier) !== null;

  return (
    <div className="flex items-center gap-3" data-testid="quota-badge">
      <span className="eyebrow">
        {sub.tierLabel} ·{" "}
        <span
          className={zero ? "text-destructive" : undefined}
          data-testid="quota-remaining"
        >
          {remainingLabel}
        </span>
      </span>
      {zero && !canUpgrade && (
        <span className="text-xs text-muted-foreground" data-testid="quota-reset-note">
          {QUOTA_RESET_NOTE}
        </span>
      )}
      {canUpgrade && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
          data-testid="quota-upgrade"
        >
          Upgrade
        </Button>
      )}
      <UpgradeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentTier={sub.tier}
        cancelAtPeriodEnd={sub.cancelAtPeriodEnd}
        currentPeriodEnd={sub.currentPeriodEnd}
      />
    </div>
  );
}
