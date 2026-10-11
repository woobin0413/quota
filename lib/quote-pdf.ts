/**
 * Quote PDF
 *
 * Shared quote-PDF payload assembly and rendering, used by both the
 * email sender (attachment) and the PDF download route (export).
 */

import { renderToBuffer } from "@react-pdf/renderer";
import { QuotePDFDocument } from "@/components/quote/QuotePDFDocument";
import { pdfFlagsForTier } from "@/lib/billing/pdf-flags";
import type { Tier } from "@/lib/subscription";
import type { QuoteData } from "@/types/quote-data";
import type { getQuoteWithContact, getQuoteLineItems } from "@/lib/db/quotes";
import type { User } from "@/types/database";
import { logger } from "@/lib/logger";

type QuoteWithContact = NonNullable<Awaited<ReturnType<typeof getQuoteWithContact>>>;
type QuoteLineItems = Awaited<ReturnType<typeof getQuoteLineItems>>;

export interface CompanyInfo {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  /** The logged-in contractor's personal name (email signatures). */
  contractorName?: string;
  /** Public URL of the uploaded business logo (users.metadata.logoUrl). */
  logoUrl?: string | null;
}

/**
 * Assemble the QuoteData/CompanyInfo payload the PDF (and email) render
 * from a stored quote. Recipient overrides let the send flow use the
 * address typed into the send form instead of the stored contact.
 */
export function buildQuotePdfPayload(
  quote: QuoteWithContact,
  lineItems: QuoteLineItems,
  user: User,
  overrides?: { recipientEmail?: string; recipientName?: string }
): { quoteData: QuoteData; companyInfo: CompanyInfo } {
  const quoteData: QuoteData = {
    id: quote.id,
    clientInfo: {
      name: overrides?.recipientName || quote.contact?.name || "Client",
      email: overrides?.recipientEmail || quote.contact?.email || "",
      phone: quote.contact?.phone ?? undefined,
      company: quote.contact?.company ?? undefined,
      address: quote.contact?.address ?? undefined,
    },
    lineItems: lineItems.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit_of_measure ?? "ea",
      unitPrice: item.unitPrice,
      total: item.total,
    })),
    taxRate: quote.taxRate,
    discount: quote.discountAmount,
    isDiscountPercentage: false,
    notes: quote.notes ?? undefined,
    isPaid: quote.is_paid,
    subtotal: quote.subtotal,
    taxAmount: quote.taxAmount,
    discountAmount: quote.discountAmount,
    total: quote.total,
  };

  // Client-facing identity is always the contractor's — never the platform
  const companyInfo: CompanyInfo = {
    name: user.company_name || user.fullName || user.email,
    address: user.metadata?.companyAddress as string | undefined,
    phone: user.phone || (user.metadata?.companyPhone as string | undefined),
    email: user.email,
    website: user.metadata?.companyWebsite as string | undefined,
    contractorName: user.fullName || undefined,
    logoUrl: (user.metadata?.logoUrl as string | undefined) ?? null,
  };

  return { quoteData, companyInfo };
}

/**
 * Render the quote PDF to a Buffer.
 */
export interface PaymentReceiptInfo {
  amount: number;
  paidAt: string; // YYYY-MM-DD
  method?: string | null;
  milestoneName: string;
  amountPaid: number;
}

/**
 * Fetch the logo into a Buffer for @react-pdf. Any failure (bad URL,
 * timeout, deleted object) degrades to a logo-less PDF rather than
 * failing the send.
 */
async function fetchLogoBuffer(logoUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    logger.warn("Logo fetch failed; rendering PDF without logo", {
      err: error,
      logoUrl,
    });
    return null;
  }
}

export async function generateQuotePDF(
  quote: QuoteData,
  companyInfo: CompanyInfo,
  quoteNumber: string,
  quoteDate: Date,
  validUntil?: Date,
  scheduleLines?: string[],
  paymentReceipt?: PaymentReceiptInfo,
  tier: Tier = "free"
): Promise<Buffer> {
  try {
    const { showLogo, showBranding } = pdfFlagsForTier(tier);
    const logoSrc = showLogo && companyInfo.logoUrl
      ? await fetchLogoBuffer(companyInfo.logoUrl)
      : null;

    const pdfElement = QuotePDFDocument({
      quote,
      companyInfo,
      quoteNumber,
      quoteDate,
      validUntil,
      scheduleLines,
      paymentReceipt,
      logoSrc,
      showBranding,
    });

    return await renderToBuffer(pdfElement);
  } catch (error) {
    logger.error("Failed to generate PDF", {
      err: error,
      quoteNumber,
    });
    throw new Error("PDF generation failed", { cause: error });
  }
}
