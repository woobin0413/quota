import { describe, it, expect } from "vitest";
import { toCardSummary, toInvoiceRows } from "@/lib/billing/summary";

describe("toCardSummary", () => {
  it("maps a card payment method", () => {
    const pm = { card: { brand: "visa", last4: "4242", exp_month: 8, exp_year: 2027 } } as never;
    expect(toCardSummary(pm)).toEqual({ brand: "visa", last4: "4242", expMonth: 8, expYear: 2027 });
  });
  it("returns null when no card", () => {
    expect(toCardSummary(null)).toBeNull();
    expect(toCardSummary({ card: null } as never)).toBeNull();
  });
});

describe("toInvoiceRows", () => {
  it("maps invoices to rows with ISO date + major-unit amount", () => {
    const rows = toInvoiceRows([
      { id: "in_1", number: "A-1", created: 1_700_000_000, amount_paid: 1500, currency: "usd", status: "paid", invoice_pdf: "https://x/pdf" } as never,
    ]);
    expect(rows).toEqual([
      { id: "in_1", number: "A-1", created: new Date(1_700_000_000 * 1000).toISOString(), amountPaid: 15, currency: "usd", status: "paid", pdfUrl: "https://x/pdf" },
    ]);
  });
  it("tolerates missing number/pdf", () => {
    const [row] = toInvoiceRows([{ id: "in_2", number: null, created: 1, amount_paid: 0, currency: "usd", status: "open", invoice_pdf: null } as never]);
    expect(row.number).toBeNull();
    expect(row.pdfUrl).toBeNull();
  });
});
