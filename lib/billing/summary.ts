/**
 * Pure mappers from Stripe objects to the billing UI's summary + invoice
 * shapes. No Stripe calls — the route fetches, these translate.
 */
import type Stripe from "stripe";
import type { Tier } from "@/lib/subscription";

export interface CardSummary { brand: string; last4: string; expMonth: number; expYear: number; }

export interface BillingSummary {
  tier: Tier;
  tierLabel: string;
  price: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingDowngradeTier: Tier | null;
  pendingChangeDate: string | null;
  paymentMethod: CardSummary | null;
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  created: string;
  amountPaid: number;
  currency: string;
  status: string;
  pdfUrl: string | null;
}

export function toCardSummary(pm: Stripe.PaymentMethod | null): CardSummary | null {
  const card = pm?.card;
  if (!card) return null;
  return { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year };
}

export function toInvoiceRows(invoices: Stripe.Invoice[]): InvoiceRow[] {
  return invoices.map((inv) => ({
    id: inv.id,
    number: inv.number ?? null,
    created: new Date(inv.created * 1000).toISOString(),
    amountPaid: (inv.amount_paid ?? 0) / 100,
    currency: inv.currency,
    status: inv.status ?? "unknown",
    pdfUrl: inv.invoice_pdf ?? null,
  }));
}
