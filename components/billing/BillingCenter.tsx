"use client";

import { Loader2 } from "lucide-react";
import { useBilling } from "@/components/billing/use-billing";
import { PlanSection } from "@/components/billing/PlanSection";
import { useState } from "react";
import { ChangePlanDialog } from "@/components/billing/ChangePlanDialog";
import { PaymentMethodSection } from "@/components/billing/PaymentMethodSection";
import { InvoiceTable } from "@/components/billing/InvoiceTable";

export function BillingCenter() {
  const { summary, invoices, loading, error, refresh, patchSummary } = useBilling();
  const [planOpen, setPlanOpen] = useState(false);

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground" aria-live="polite">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Loading billing…
      </div>
    );
  }
  if (error && !summary) {
    return <p className="py-20 text-center text-sm text-destructive" role="alert">{error}</p>;
  }
  if (!summary) return null;

  return (
    <div className="max-w-3xl space-y-6" data-testid="billing-center">
      <PlanSection summary={summary} onChangePlan={() => setPlanOpen(true)} onChanged={patchSummary} />
      <PaymentMethodSection summary={summary} onSaved={() => void refresh()} />
      <InvoiceTable invoices={invoices} />
      <ChangePlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        summary={summary}
        onDone={() => void refresh()}
      />
    </div>
  );
}
