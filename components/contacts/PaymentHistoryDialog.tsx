"use client";

/**
 * Payment History Dialog
 *
 * Shows the recorded payments for a quote (date/milestone/amount/method/note),
 * driven by the same data as the quote page's Payment History card.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/quote-calculations";
import { formatDate } from "@/lib/utils";
import type { QuotePayment } from "@/types/database";
import type { MilestoneView } from "@/lib/payment-schedule";

interface PaymentHistoryDialogProps {
  quoteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentHistoryDialog({
  quoteId,
  open,
  onOpenChange,
}: PaymentHistoryDialogProps) {
  const [payments, setPayments] = useState<QuotePayment[] | null>(null);
  const [milestones, setMilestones] = useState<MilestoneView[]>([]);

  useEffect(() => {
    if (!open) return;
    setPayments(null);
    setMilestones([]);
    Promise.all([
      fetch(`/api/quotes/${quoteId}/payments`).then((r) => r.json()),
      fetch(`/api/quotes/${quoteId}/milestones`).then((r) => r.json()),
    ])
      .then(([paymentsData, milestonesData]) => {
        setPayments(paymentsData.success ? paymentsData.payments : []);
        setMilestones(milestonesData.success ? milestonesData.milestones : []);
      })
      .catch(() => setPayments([]));
  }, [open, quoteId]);

  const milestoneName = (id: string) =>
    milestones.find((m) => m.id === id)?.name ?? "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="payment-history-dialog">
        <DialogHeader>
          <DialogTitle>Payment history</DialogTitle>
          <DialogDescription>
            Every payment recorded for this quote.
          </DialogDescription>
        </DialogHeader>

        {payments === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : payments.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="rounded-md border p-3"
                data-testid="payment-history-entry"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {milestoneName(payment.milestone_id)}
                  </span>
                  <span className="figure font-medium">
                    {formatCurrency(payment.amount)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatDate(payment.paid_at)}</span>
                  <span className="capitalize">{payment.method ?? "—"}</span>
                </div>
                {payment.note && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {payment.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
