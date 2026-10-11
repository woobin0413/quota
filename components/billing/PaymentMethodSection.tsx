"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PaymentMethodForm } from "@/components/billing/PaymentMethodForm";
import type { BillingSummary } from "@/lib/billing/summary";

export function PaymentMethodSection({
  summary,
  onSaved,
}: {
  summary: BillingSummary;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const pm = summary.paymentMethod;

  return (
    <section className="border-2 border-border bg-card p-4 sm:p-6" data-testid="payment-method-section">
      <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em]">Payment method</h2>
      <div className="mt-1.5 h-0.5 w-10 bg-accent" aria-hidden="true" />

      {editing ? (
        <div className="mt-4">
          <PaymentMethodForm
            onSaved={() => { setEditing(false); onSaved(); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm" data-testid="pm-display">
            {pm ? (
              <>
                <span className="uppercase">{pm.brand}</span> •••• {pm.last4}
                <span className="text-muted-foreground"> · exp {String(pm.expMonth).padStart(2, "0")}/{pm.expYear}</span>
              </>
            ) : (
              <span className="text-muted-foreground">No card on file</span>
            )}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="update-card">
            {pm ? "Update card" : "Add card"}
          </Button>
        </div>
      )}
    </section>
  );
}
