"use client";

/**
 * Upgrade prompt — three plan cards with the current plan marked and an
 * upgrade CTA per higher tier. All actions route to the in-app
 * `/billing` page (plan changes, card, invoices) — no Stripe-hosted
 * Checkout or Customer Portal. `reason` shows a persuasive line (e.g. the
 * limit-hit message).
 */

import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { formatDate } from "@/lib/utils";
import {
  TIERS,
  TIER_LABEL,
  TIER_PRICE,
  quoteLimitLabel,
  isTierAvailable,
  type Tier,
} from "@/lib/subscription";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier: Tier;
  reason?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
}

export function UpgradeDialog({
  open,
  onOpenChange,
  currentTier,
  reason,
  cancelAtPeriodEnd,
  currentPeriodEnd,
}: UpgradeDialogProps) {
  const router = useRouter();
  const currentIndex = TIERS.indexOf(currentTier);

  // All plan actions happen in-app on /billing.
  const goToBilling = () => {
    onOpenChange(false);
    router.push("/billing");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="upgrade-dialog">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-wide">
            Upgrade your plan
          </DialogTitle>
          <DialogDescription>
            {reason ?? "More quotes, same Quota. Upgrade any time."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          {TIERS.map((tier, i) => {
            const isCurrent = tier === currentTier;
            const isUpgrade = i > currentIndex;
            return (
              <div
                key={tier}
                className={`flex flex-col border p-4 ${
                  isCurrent ? "border-2 border-primary" : ""
                }`}
                data-testid={`plan-${tier}`}
              >
                <p className="font-display text-sm font-bold uppercase tracking-wide">
                  {TIER_LABEL[tier]}
                </p>
                <p className="mt-1">
                  <span className="figure text-2xl font-bold">
                    {TIER_PRICE[tier]}
                  </span>
                  {tier !== "free" && (
                    <span className="text-xs text-muted-foreground">/mo</span>
                  )}
                </p>
                <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-accent" aria-hidden="true" />
                  {quoteLimitLabel(tier)} quotes
                </p>
                <div className="mt-auto pt-4">
                  {isCurrent ? (
                    <>
                      {cancelAtPeriodEnd && currentPeriodEnd && (
                        <p
                          className="mb-1 text-center text-xs text-destructive"
                          data-testid="cancel-notice"
                        >
                          Changes to Free on {formatDate(currentPeriodEnd)}
                        </p>
                      )}
                      <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Current plan
                      </p>
                    </>
                  ) : isUpgrade && !isTierAvailable(tier) ? (
                    <Button
                      className="w-full"
                      variant="outline"
                      disabled
                      data-testid={`upgrade-to-${tier}`}
                    >
                      Coming soon
                    </Button>
                  ) : isUpgrade ? (
                    <Button
                      className="w-full"
                      onClick={goToBilling}
                      data-testid={`upgrade-to-${tier}`}
                    >
                      Upgrade to {TIER_LABEL[tier]}
                    </Button>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground/60">
                      Included below your plan
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={goToBilling}
          className="text-left text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          data-testid="manage-billing-link"
        >
          Manage plan &amp; billing
        </button>
      </DialogContent>
    </Dialog>
  );
}
