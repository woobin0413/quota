"use client";

import { useState } from "react";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { getStripeBrowser } from "@/lib/stripe-browser";

function CardForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      const intentRes = await fetch("/api/billing/setup-intent", { method: "POST" }).then((r) => r.json());
      if (!intentRes.success || !intentRes.clientSecret) throw new Error(intentRes.message || "Could not start card setup");

      const { error: confirmError, setupIntent } = await stripe.confirmCardSetup(intentRes.clientSecret, {
        payment_method: { card },
      });
      if (confirmError) throw new Error(confirmError.message || "Card was declined");
      if (!setupIntent) throw new Error("Card setup did not complete");

      const saveRes = await fetch("/api/billing/payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupIntentId: setupIntent.id }),
      }).then((r) => r.json());
      if (!saveRes.success) throw new Error(saveRes.message || "Could not save card");

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="card-form">
      <div className="rounded-md border-2 border-border bg-background px-3 py-3">
        <CardElement options={{ hidePostalCode: false }} />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!stripe || busy} data-testid="card-save">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Save card
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function PaymentMethodForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  return (
    <Elements stripe={getStripeBrowser()}>
      <CardForm onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  );
}
