"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TIER_PRICE } from "@/lib/subscription";
import { formatDate } from "@/lib/utils";
import type { BillingSummary } from "@/lib/billing/summary";

export function PlanSection({
  summary,
  onChangePlan,
  onChanged,
}: {
  summary: BillingSummary;
  onChangePlan: () => void;
  onChanged: (over: Partial<BillingSummary>) => void;
}) {
  const [busy, setBusy] = useState<"cancel" | "reactivate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReactivate, setConfirmReactivate] = useState(false);

  const isPaid = summary.tier !== "free";
  // BUG FIX: key the cancelling state on cancelAtPeriodEnd alone. Previously
  // this also required currentPeriodEnd !== null, so a null period end fell
  // back to the paid branch and showed Cancel again with no Reactivate.
  const isCancelling = summary.cancelAtPeriodEnd;
  const periodEnd = summary.currentPeriodEnd
    ? formatDate(summary.currentPeriodEnd)
    : "";

  const post = async (path: string, over: Partial<BillingSummary>, kind: "cancel" | "reactivate") => {
    setBusy(kind);
    setError(null);
    setConfirmCancel(false);
    setConfirmReactivate(false);
    try {
      const res = await fetch(path, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Something went wrong");
      onChanged(over);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border-2 border-border bg-card p-4 sm:p-6" data-testid="plan-section">
      <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em]">Plan</h2>
      <div className="mt-1.5 h-0.5 w-10 bg-accent" aria-hidden="true" />

      <p className="mt-4 text-lg font-medium">
        {summary.tierLabel}
        <span className="text-muted-foreground"> · </span>
        <span className="figure">{TIER_PRICE[summary.tier]}</span>
        {isPaid && <span className="text-muted-foreground">/mo</span>}
      </p>

      {isCancelling ? (
        <p className="mt-1 text-sm font-medium text-destructive" data-testid="cancel-notice">
          Changes to Free on {periodEnd} — {summary.tierLabel} access until then
        </p>
      ) : summary.pendingDowngradeTier ? (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="downgrade-notice">
          Changes to {summary.pendingDowngradeTier} on {summary.pendingChangeDate ? formatDate(summary.pendingChangeDate) : ""}
        </p>
      ) : isPaid && summary.currentPeriodEnd ? (
        <p className="mt-1 text-sm text-muted-foreground">Renews {periodEnd}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={onChangePlan} disabled={busy !== null} data-testid="change-plan">
          {isPaid ? "Change plan" : "Choose a plan"}
        </Button>
        {isCancelling ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmReactivate(true)}
            disabled={busy !== null}
            data-testid="reactivate"
          >
            {busy === "reactivate" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Reactivate
          </Button>
        ) : isPaid ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmCancel(true)}
            disabled={busy !== null}
            data-testid="cancel-subscription"
          >
            Cancel subscription
          </Button>
        ) : null}
      </div>

      {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent className="sm:max-w-md" data-testid="cancel-confirm-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display uppercase tracking-wide">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
              Cancel subscription?
            </DialogTitle>
            <DialogDescription>
              Your {summary.tierLabel} plan stays active until{" "}
              <span className="font-medium text-foreground">{periodEnd}</span>. After
              that you drop to the Free plan (3 quotes/month, no email invoicing).
              You can reactivate any time before then.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmCancel(false)}
              disabled={busy !== null}
              data-testid="cancel-confirm-dismiss"
            >
              Keep {summary.tierLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => post("/api/billing/cancel", { cancelAtPeriodEnd: true }, "cancel")}
              disabled={busy !== null}
              data-testid="cancel-confirm-accept"
            >
              {busy === "cancel" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Yes, cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReactivate} onOpenChange={setConfirmReactivate}>
        <DialogContent className="sm:max-w-md" data-testid="reactivate-confirm-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display uppercase tracking-wide">
              <RotateCcw className="h-5 w-5 text-accent" aria-hidden="true" />
              Reactivate subscription?
            </DialogTitle>
            <DialogDescription>
              Your {summary.tierLabel} plan will keep renewing
              {periodEnd ? (
                <>
                  {" "}— next on{" "}
                  <span className="font-medium text-foreground">{periodEnd}</span>
                </>
              ) : null}
              {" "}instead of dropping to Free. Billing continues as normal.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmReactivate(false)}
              disabled={busy !== null}
              data-testid="reactivate-confirm-dismiss"
            >
              Never mind
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => post("/api/billing/reactivate", { cancelAtPeriodEnd: false }, "reactivate")}
              disabled={busy !== null}
              data-testid="reactivate-confirm-accept"
            >
              {busy === "reactivate" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Yes, reactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
