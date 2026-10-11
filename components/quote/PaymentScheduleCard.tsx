"use client";

/**
 * Payment Schedule Card
 *
 * The planned split with per-milestone progress and Record payment entry
 * points. Amounts derive from the quote total — figures always match.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil } from "lucide-react";
import { formatCurrency } from "@/lib/quote-calculations";
import { EditScheduleDialog } from "@/components/quote/EditScheduleDialog";
import { RecordPaymentDialog } from "@/components/quote/RecordPaymentDialog";
import type { MilestoneView } from "@/lib/payment-schedule";

const STATUS_LABEL: Record<MilestoneView["status"], string> = {
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
};

interface PaymentScheduleCardProps {
  quoteId: string;
  milestones: MilestoneView[];
  total: number;
  amountPaid: number;
}

export function PaymentScheduleCard({
  quoteId,
  milestones,
  total,
  amountPaid,
}: PaymentScheduleCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [recording, setRecording] = useState<MilestoneView | null>(null);

  const remaining = Math.max(total - amountPaid, 0);

  return (
    <Card className="mb-8" data-testid="payment-schedule-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="font-display uppercase tracking-wide">
          Payment Schedule
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditOpen(true)}
          data-testid="edit-schedule-button"
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Edit Schedule
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {milestones.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0"
              data-testid={`milestone-row-${m.sortOrder}`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{m.name}</p>
                <p className="text-sm text-muted-foreground">
                  {m.percentage}% · <span className="figure">{formatCurrency(m.amount)}</span>
                  {m.paidAmount > 0 && m.status !== "paid" && (
                    <> · {formatCurrency(m.paidAmount)} received</>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`stamp ${m.status === "paid" ? "stamp-paid" : "stamp-unpaid"}`}
                  data-testid={`milestone-status-${m.sortOrder}`}
                >
                  {STATUS_LABEL[m.status]}
                </span>
                {m.status !== "paid" && (
                  <Button
                    size="sm"
                    onClick={() => setRecording(m)}
                    data-testid={`record-payment-${m.sortOrder}`}
                  >
                    Record Payment
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end border-t-2 border-primary pt-3 text-sm">
          <div className="w-64 space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Received</span>
              <span className="figure">{formatCurrency(amountPaid)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span className="font-display uppercase tracking-wide">Balance Due</span>
              <span className="figure" data-testid="balance-due">
                {formatCurrency(remaining)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>

      <EditScheduleDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        quoteId={quoteId}
        milestones={milestones}
      />
      <RecordPaymentDialog
        open={recording !== null}
        onOpenChange={(open) => !open && setRecording(null)}
        quoteId={quoteId}
        milestone={recording}
      />
    </Card>
  );
}
