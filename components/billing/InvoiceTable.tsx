"use client";

import type { InvoiceRow } from "@/lib/billing/summary";
import { formatDate } from "@/lib/utils";

export function InvoiceTable({ invoices }: { invoices: InvoiceRow[] }) {
  return (
    <section className="border-2 border-border bg-card p-4 sm:p-6" data-testid="invoice-table">
      <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em]">Invoices</h2>
      <div className="mt-1.5 h-0.5 w-10 bg-accent" aria-hidden="true" />

      {invoices.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="invoice-empty">No invoices yet.</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2">Date</th><th className="py-2">Amount</th><th className="py-2">Status</th><th className="py-2 text-right">PDF</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b last:border-0">
                <td className="py-2">{formatDate(inv.created)}</td>
                <td className="py-2 figure">{inv.currency.toUpperCase()} {inv.amountPaid.toFixed(2)}</td>
                <td className="py-2 capitalize">{inv.status}</td>
                <td className="py-2 text-right">
                  {inv.pdfUrl ? (
                    <a href={inv.pdfUrl} className="text-accent underline-offset-4 hover:underline" target="_blank" rel="noopener noreferrer">PDF</a>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
