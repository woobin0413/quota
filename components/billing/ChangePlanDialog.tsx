"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { TIERS, TIER_LABEL, TIER_PRICE, isTierAvailable, type Tier } from "@/lib/subscription";
import { PaymentMethodForm } from "@/components/billing/PaymentMethodForm";
import { formatDate } from "@/lib/utils";
import type { BillingSummary } from "@/lib/billing/summary";

export function ChangePlanDialog({
  open,
  onOpenChange,
  summary,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  summary: BillingSummary;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsCard, setNeedsCard] = useState<Tier | null>(null);
  const [confirmTier, setConfirmTier] = useState<Tier | null>(null);

  // Plain-language description of what confirming a given change does.
  const changeSummary = (target: Tier): string => {
    const isUpgrade = TIERS.indexOf(target) > TIERS.indexOf(summary.tier);
    const until = summary.currentPeriodEnd
      ? ` until ${formatDate(summary.currentPeriodEnd)}`
      : " until your next renewal";
    if (isUpgrade) {
      return `You'll switch to ${TIER_LABEL[target]} now for ${TIER_PRICE[target]}/mo, with a prorated charge today.`;
    }
    if (target === "free") {
      return `You'll keep ${TIER_LABEL[summary.tier]}${until}, then move to Free — 3 quotes/month, no email invoicing.`;
    }
    return `You'll keep ${TIER_LABEL[summary.tier]}${until}, then switch to ${TIER_LABEL[target]} (${TIER_PRICE[target]}/mo).`;
  };

  const choose = async (target: Tier) => {
    setBusy(target);
    setError(null);
    try {
      const res = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTier: target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not change plan");
      if (data.needsPaymentMethod) {
        setNeedsCard(target); // collect a card, then retry
        return;
      }
      setConfirmTier(null);
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change plan");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="change-plan-dialog">
        <DialogHeader>
          <DialogTitle>Change plan</DialogTitle>
          <DialogDescription>
            Upgrades apply now (prorated). Downgrades take effect at your next renewal.
          </DialogDescription>
        </DialogHeader>

        {needsCard ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Add a card to start your {TIER_LABEL[needsCard]} plan.</p>
            <PaymentMethodForm
              onSaved={() => { const t = needsCard; setNeedsCard(null); void choose(t); }}
              onCancel={() => setNeedsCard(null)}
            />
          </div>
        ) : confirmTier ? (
          <div className="space-y-4" data-testid="change-plan-confirm">
            <p className="text-sm text-muted-foreground">{changeSummary(confirmTier)}</p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => setConfirmTier(null)}
                data-testid="change-plan-confirm-back"
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy !== null}
                onClick={() => void choose(confirmTier)}
                data-testid="change-plan-confirm-accept"
              >
                {busy === confirmTier && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Confirm change
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {TIERS.map((t) => {
              const isCurrent = t === summary.tier;
              // Not-yet-shipped tiers (Ultimate) can't be selected, unless the
              // user is already on it (keep it visible as their current plan).
              const unavailable = !isTierAvailable(t) && !isCurrent;
              return (
                <div key={t} className="flex items-center justify-between border-2 border-border p-3" data-testid={`plan-option-${t}`}>
                  <div>
                    <p className="font-medium">{TIER_LABEL[t]}</p>
                    <p className="text-sm text-muted-foreground figure">{TIER_PRICE[t]}{t !== "free" && "/mo"}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={isCurrent || unavailable ? "outline" : "default"}
                    disabled={isCurrent || unavailable || busy !== null}
                    onClick={() => setConfirmTier(t)}
                    data-testid={`choose-${t}`}
                  >
                    {isCurrent ? "Current" : unavailable ? "Coming soon" : "Select"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
