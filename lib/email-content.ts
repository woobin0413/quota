/**
 * Email Content
 *
 * Deterministic default subject/message for the send-quote email and the
 * pre-send validation gate. Both work off the same authoritative payload
 * the PDF renders from (lib/quote-pdf.ts), so email figures can never
 * drift from the attachment.
 */

import { formatCurrency } from "./quote-calculations";
import type { QuoteData } from "@/types/quote-data";
import type { CompanyInfo } from "./quote-pdf";

export interface EmailContent {
  subject: string;
  message: string;
}

export interface EmailValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Default subject + editable message for a quote email.
 * Branding rule: the contractor's business name only — the platform name
 * never appears in client-facing copy.
 */
export function buildDefaultEmailContent(
  quote: QuoteData,
  companyInfo: CompanyInfo,
  quoteNumber: string
): EmailContent {
  const firstName = quote.clientInfo.name.split(" ")[0] || "there";
  const itemCount = quote.lineItems.length;
  const items = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;

  // This email is sent from a no-reply address — direct questions to the
  // contractor's phone/email, never "reply to this email"
  const contactHint = [
    companyInfo.phone ? `call us at ${companyInfo.phone}` : null,
    companyInfo.email ? `email us at ${companyInfo.email}` : null,
  ]
    .filter(Boolean)
    .join(" or ");

  const lines = [
    `Hi ${firstName},`,
    "",
    `Thanks for the opportunity to quote your project. Quotation ${quoteNumber} is attached as a PDF with the full breakdown (${items}, total ${formatCurrency(quote.total)}).`,
    "",
    contactHint
      ? `If anything needs adjusting or you have questions about the scope, ${contactHint}.`
      : `If anything needs adjusting or you have questions about the scope, contact us using the details below.`,
    "",
    ...signatureLines(companyInfo),
  ];

  return {
    subject: `Quote ${quoteNumber} from ${companyInfo.name}`,
    message: lines.join("\n"),
  };
}

/**
 * Signature: the logged-in contractor's personal name, their business
 * name (when different), and phone. Never the platform name.
 */
function signatureLines(companyInfo: CompanyInfo): string[] {
  const lines: string[] = [];
  if (companyInfo.contractorName) lines.push(companyInfo.contractorName);
  if (companyInfo.name && companyInfo.name !== companyInfo.contractorName) {
    lines.push(companyInfo.name);
  }
  if (companyInfo.phone) lines.push(companyInfo.phone);
  return lines;
}

/**
 * Default subject + message for a payment receipt (paid invoice).
 * Sent after the contractor records payment; the attached PDF renders
 * with the Paid status.
 */
export function buildReceiptEmailContent(
  quote: QuoteData,
  companyInfo: CompanyInfo,
  quoteNumber: string,
  paidAt?: Date
): EmailContent {
  const firstName = quote.clientInfo.name.split(" ")[0] || "there";
  const paidDate = (paidAt ?? new Date()).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const lines = [
    `Hi ${firstName},`,
    "",
    `We've received your payment of ${formatCurrency(quote.total)} for quote ${quoteNumber} on ${paidDate}. A receipt is attached as a PDF for your records.`,
    "",
    `Thanks for your business — we appreciate it.`,
    "",
    ...signatureLines(companyInfo),
  ];

  return {
    subject: `Receipt for ${quoteNumber} from ${companyInfo.name}`,
    message: lines.join("\n"),
  };
}

/**
 * Receipt copy for ONE recorded payment: the payment, the running total
 * received, and the remaining balance.
 */
export function buildPaymentReceiptEmailContent(
  quote: QuoteData,
  companyInfo: CompanyInfo,
  quoteNumber: string,
  payment: { amount: number; paidAt: string; milestoneName: string },
  amountPaid: number
): EmailContent {
  const firstName = quote.clientInfo.name.split(" ")[0] || "there";
  const paidDate = new Date(payment.paidAt + "T00:00:00").toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" }
  );
  const balance = Math.max(quote.total - amountPaid, 0);

  const balanceLine =
    balance <= 0
      ? `That completes payment in full — thanks for your business.`
      : `Received to date: ${formatCurrency(amountPaid)} of ${formatCurrency(quote.total)}. Remaining balance: ${formatCurrency(balance)}.`;

  const lines = [
    `Hi ${firstName},`,
    "",
    `We've received your payment of ${formatCurrency(payment.amount)} (${payment.milestoneName}) for quote ${quoteNumber} on ${paidDate}. A receipt is attached as a PDF for your records.`,
    "",
    balanceLine,
    "",
    ...signatureLines(companyInfo),
  ];

  return {
    subject: `Payment receipt — ${quoteNumber} from ${companyInfo.name}`,
    message: lines.join("\n"),
  };
}

// Markers that indicate seed/e2e data leaked into client-facing copy
const TEST_DATA_PATTERN = /\b(e2e|test project|lorem ipsum|example\.com)\b/i;

/**
 * Pre-send gate. Blocks the send when figures do not reconcile with the
 * authoritative payload or test data is present — the code equivalent of
 * a DATA_ERROR refusal.
 */
export function validateQuoteEmail(
  quote: QuoteData,
  subject: string,
  message: string,
  options?: {
    /** Skip the test-data marker check (e2e runs against mocked sends
        with fixture names like "E2E Client"). Figure reconciliation
        always runs. */
    allowTestData?: boolean;
  }
): EmailValidationResult {
  const errors: string[] = [];
  const cents = (n: number) => Math.round(n * 100);

  // ±1¢ tolerance on both checks — float accumulation over many line
  // items must not trip the gate
  const itemSum = quote.lineItems.reduce((sum, item) => sum + item.total, 0);
  if (Math.abs(cents(itemSum) - cents(quote.subtotal)) > 1) {
    errors.push(
      `Line items sum to ${formatCurrency(itemSum)} but the quote subtotal is ${formatCurrency(quote.subtotal)}`
    );
  }

  // Clamped at 0 to match the DB trigger (GREATEST(..., 0)) so an
  // over-subtotal discount doesn't produce an unfixable DATA_ERROR
  const expectedTotal = Math.max(
    0,
    quote.subtotal + quote.taxAmount - quote.discountAmount
  );
  if (Math.abs(cents(expectedTotal) - cents(quote.total)) > 1) {
    errors.push(
      `Subtotal + tax − discount is ${formatCurrency(expectedTotal)} but the quote total is ${formatCurrency(quote.total)}`
    );
  }

  if (!subject.trim()) {
    errors.push("Subject is empty");
  }

  if (!options?.allowTestData) {
    for (const [field, text] of [
      ["subject", subject],
      ["message", message],
    ] as const) {
      const match = text.match(TEST_DATA_PATTERN);
      if (match) {
        errors.push(`Remove test data ("${match[0]}") from the ${field} before sending`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
