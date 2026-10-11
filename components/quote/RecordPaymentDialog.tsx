"use client";

/**
 * Record Payment Dialog
 *
 * Records a payment against one milestone. Amount prefills with the
 * milestone remainder but is editable (partial payments allowed).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/quote-calculations";
import type { MilestoneView } from "@/lib/payment-schedule";

const METHODS = ["cash", "check", "zelle", "other"] as const;

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  milestone: MilestoneView | null;
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  quoteId,
  milestone,
}: RecordPaymentDialogProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [method, setMethod] = useState<string>("check");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && milestone) {
      const remainder = Math.max(milestone.amount - milestone.paidAmount, 0);
      setAmount(remainder.toFixed(2));
      setPaidAt(new Date().toISOString().slice(0, 10));
      setMethod("check");
      setNote("");
      setError(null);
    }
  }, [open, milestone]);

  const save = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotes/${quoteId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          milestoneId: milestone!.id,
          amount: value,
          paidAt,
          method,
          note: note.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to record payment");
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  if (!milestone) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="record-payment-dialog">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            {milestone.name} — {formatCurrency(milestone.amount)} planned,{" "}
            {formatCurrency(milestone.paidAmount)} received so far.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="payment-amount">Amount</Label>
            <Input
              id="payment-amount"
              type="number"
              inputMode="decimal"
              min={0.01}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="payment-amount-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment-date">Date received</Label>
            <Input
              id="payment-date"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              data-testid="payment-date-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment-method">Method</Label>
            <select
              id="payment-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              data-testid="payment-method-select"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment-note">Note (optional)</Label>
            <Input
              id="payment-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Check #1042"
              maxLength={500}
              data-testid="payment-note-input"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert" aria-live="polite">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} data-testid="payment-save">
            {saving ? "Recording…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
