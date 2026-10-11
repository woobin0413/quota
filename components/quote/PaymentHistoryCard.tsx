"use client";

/**
 * Payment History Card
 *
 * Recorded payments with per-payment receipt sending and delete (undo).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Trash2, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/quote-calculations";
import { formatDate } from "@/lib/utils";
import type { QuotePayment } from "@/types/database";
import type { MilestoneView } from "@/lib/payment-schedule";

interface PaymentHistoryCardProps {
  quoteId: string;
  payments: QuotePayment[];
  milestones: MilestoneView[];
  recipientEmail?: string;
}

export function PaymentHistoryCard({
  quoteId,
  payments,
  milestones,
  recipientEmail,
}: PaymentHistoryCardProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const milestoneName = (id: string) =>
    milestones.find((m) => m.id === id)?.name ?? "—";

  if (payments.length === 0) return null;

  const sendReceipt = async (paymentId: string) => {
    setBusyId(paymentId);
    setError(null);
    try {
      const response = await fetch(
        `/api/quotes/${quoteId}/payments/${paymentId}/receipt`,
        { method: "POST" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to send receipt");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send receipt");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (paymentId: string) => {
    setBusyId(paymentId);
    setError(null);
    try {
      const response = await fetch(
        `/api/quotes/${quoteId}/payments/${paymentId}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to delete payment");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete payment");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="mb-8" data-testid="payment-history-card">
      <CardHeader>
        <CardTitle className="font-display uppercase tracking-wide">
          Payments Received
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-primary text-left">
                <th className="eyebrow pb-2">Date</th>
                <th className="eyebrow pb-2">Milestone</th>
                <th className="eyebrow pb-2">Method</th>
                <th className="eyebrow pb-2">Note</th>
                <th className="eyebrow pb-2 text-right">Amount</th>
                <th className="eyebrow pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="ledger-row" data-testid={`payment-row-${p.id}`}>
                  <td className="py-2">{formatDate(p.paid_at)}</td>
                  <td className="py-2">{milestoneName(p.milestone_id)}</td>
                  <td className="py-2 capitalize">{p.method ?? "—"}</td>
                  <td className="max-w-40 truncate py-2 text-muted-foreground">
                    {p.note ?? ""}
                  </td>
                  <td className="figure py-2 text-right font-medium">
                    {formatCurrency(p.amount)}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        disabled={busyId === p.id || !recipientEmail}
                        title={
                          !recipientEmail
                            ? "No client email on file"
                            : p.receipt_sent_count > 0
                              ? `Receipt sent ${p.receipt_sent_count}× — send again`
                              : "Send receipt"
                        }
                        onClick={() => sendReceipt(p.id)}
                        aria-label="Send receipt for this payment"
                        data-testid={`send-payment-receipt-${p.id}`}
                      >
                        {busyId === p.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Mail
                            className={`h-4 w-4 ${p.receipt_sent_count > 0 ? "text-green-600" : ""}`}
                            aria-hidden="true"
                          />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2 text-destructive"
                        disabled={busyId === p.id}
                        onClick={() => remove(p.id)}
                        aria-label="Delete this payment"
                        data-testid={`delete-payment-${p.id}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && (
          <p className="mt-3 text-sm text-destructive" role="alert" aria-live="polite">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
