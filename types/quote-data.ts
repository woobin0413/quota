/**
 * QuoteData — the shape the PDF and email renderers consume
 * (`lib/quote-pdf.ts` builds it; `QuotePDFDocument`, `email-sender`,
 * `email-content` render it). Extracted here from the former
 * `useQuoteEditor` hook, which was removed with the unused QuoteEditor.
 *
 * Note: `taxRate`/`taxAmount` are retained for payload compatibility but are
 * always 0 — sales tax was removed app-wide.
 */
import type { LineItem } from "@/lib/quote-calculations";

export interface QuoteClientInfo {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
}

export interface QuoteData {
  id?: string;
  clientInfo: QuoteClientInfo;
  lineItems: LineItem[];
  taxRate: number;
  discount: number;
  isDiscountPercentage: boolean;
  notes?: string;
  isPaid: boolean;
  // Calculated fields
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
}
