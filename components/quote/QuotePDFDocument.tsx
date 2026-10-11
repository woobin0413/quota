/**
 * QuotePDFDocument Component
 *
 * Formal quotation/receipt PDF using @react-pdf/renderer.
 * Single A4 page: company block left / Bill To top right, a QUOTATION
 * title band with a horizontal meta strip, full-width line items, and
 * Notes + Terms side by side. Title reads RECEIPT when the quote is paid.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";
import type { QuoteData } from "@/types/quote-data";
import { formatCurrency } from "@/lib/quote-calculations";

// =====================================================
// TYPES
// =====================================================

export interface QuotePDFDocumentProps {
  quote: QuoteData;
  companyInfo?: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  quoteNumber?: string;
  quoteDate?: Date;
  /** Quote expiry; rendered in the meta strip when provided */
  validUntil?: Date;
  /** One line per milestone, e.g. "Deposit — 10% — $697.31"; omits the section when empty */
  scheduleLines?: string[];
  /**
   * When set, the document renders as a PAYMENT RECEIPT for one recorded
   * payment (that payment + paid-to-date + balance) rather than a
   * quotation or a whole-quote receipt.
   */
  paymentReceipt?: {
    amount: number;
    paidAt: string; // YYYY-MM-DD
    method?: string | null;
    milestoneName: string;
    amountPaid: number; // total received across all payments (incl. this one)
  };
  /** Prefetched logo image; null/undefined renders the name-only header. */
  logoSrc?: Buffer | null;
  /** Free-tier "Made with Quota" footer watermark; hidden for paid tiers. */
  showBranding?: boolean;
}

// =====================================================
// STYLES
// =====================================================

const ACCENT = "#2563eb";
const INK = "#1a1a1a";
const MUTED = "#666666";
const RULE = "#e5e7eb";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    paddingBottom: 64, // clear of the absolute footer
    fontSize: 9,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
    color: INK,
  },

  // ── Header: company (left) / Bill To (right) ──
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  companyBlock: {
    maxWidth: "48%",
  },
  companyName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  logo: {
    height: 48,
    maxWidth: 180,
    objectFit: "contain",
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  companyInfo: {
    fontSize: 8,
    color: MUTED,
    lineHeight: 1.4,
  },
  billToBlock: {
    maxWidth: "44%",
    textAlign: "right",
  },
  billToLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  billToName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  billToInfo: {
    fontSize: 8,
    color: MUTED,
    lineHeight: 1.4,
  },

  // ── Title band with horizontal meta strip ──
  titleBand: {
    borderTop: `2 solid ${INK}`,
    borderBottom: `1 solid ${RULE}`,
    paddingVertical: 8,
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  docTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: ACCENT,
  },
  metaStrip: {
    flexDirection: "row",
    fontSize: 8,
    color: MUTED,
  },
  metaLabel: {
    fontFamily: "Helvetica-Bold",
    color: INK,
  },

  // ── Line Items Table ──
  table: {
    marginBottom: 10,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    padding: 5,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    borderBottom: "2 solid #d1d5db",
  },
  tableRow: {
    flexDirection: "row",
    padding: 5,
    borderBottom: `1 solid ${RULE}`,
    minHeight: 18,
    alignItems: "center",
  },
  tableRowAlt: {
    backgroundColor: "#f9fafb",
  },
  colDescription: { width: "45%", paddingRight: 8 },
  colQuantity: { width: "12%", textAlign: "right", paddingRight: 8 },
  colUnit: { width: "12%", textAlign: "center" },
  colRate: { width: "15%", textAlign: "right", paddingRight: 8 },
  colAmount: { width: "16%", textAlign: "right", fontFamily: "Helvetica-Bold" },

  // ── Totals row: terms fill the left half, totals right ──
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 20,
    marginBottom: 14,
  },
  totalsLeftCol: {
    flex: 1,
  },
  totalsSection: {
    width: "40%",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: "3 0",
    fontSize: 9,
  },
  totalLabel: { color: MUTED },
  totalValue: { fontFamily: "Helvetica-Bold", textAlign: "right" },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: "6 0",
    marginTop: 4,
    borderTop: `2 solid ${INK}`,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
  },
  grandTotalValue: { color: ACCENT, textAlign: "right" },

  // ── Notes + acceptance side by side ──
  bottomColumns: {
    flexDirection: "row",
    gap: 20,
  },
  bottomCol: {
    flex: 1,
  },
  acceptanceBox: {
    borderTop: `1 solid ${RULE}`,
    paddingTop: 8,
    fontSize: 8,
    color: MUTED,
    lineHeight: 1.6,
  },
  signatureLine: {
    fontSize: 10,
    color: INK,
    marginTop: 14,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  notesBox: {
    padding: 8,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
    fontSize: 8,
    lineHeight: 1.4,
    color: MUTED,
  },
  termsList: {
    fontSize: 8,
    lineHeight: 1.5,
    color: MUTED,
  },

  // ── Payment Schedule ──
  scheduleSection: {
    marginBottom: 14,
  },
  scheduleBox: {
    padding: 8,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
  },
  scheduleLine: {
    fontSize: 8,
    lineHeight: 1.6,
    color: MUTED,
  },

  // ── Footer ──
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    paddingTop: 8,
    borderTop: `1 solid ${RULE}`,
    fontSize: 7,
    color: "#999999",
    textAlign: "center",
  },
  footerThankYou: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: INK,
    marginBottom: 3,
  },
  footerBrand: {
    fontSize: 7,
    color: "#999999",
    marginTop: 3,
  },
});

// =====================================================
// COMPONENT
// =====================================================

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

export function QuotePDFDocument({
  quote,
  // Callers always pass the contractor's info; this fallback never names
  // the platform (client-facing documents carry the contractor's brand)
  companyInfo = { name: "Your Business" },
  quoteNumber,
  quoteDate = new Date(),
  validUntil,
  scheduleLines,
  paymentReceipt,
  logoSrc,
  showBranding = true,
}: QuotePDFDocumentProps) {
  const formattedQuoteNumber =
    quoteNumber || `Q-${quoteDate.getFullYear()}-${String(Date.now()).slice(-6)}`;

  // Three document modes sharing one layout:
  //  - payment receipt: a receipt for one recorded payment (balance may remain)
  //  - receipt: the whole quote is paid
  //  - quotation: not yet paid
  const balanceDue = paymentReceipt
    ? Math.max(quote.total - paymentReceipt.amountPaid, 0)
    : 0;
  const docTitle = paymentReceipt
    ? "PAYMENT RECEIPT"
    : quote.isPaid
      ? "RECEIPT"
      : "QUOTATION";
  // A payment receipt reads as a receipt (no acceptance box, no valid-until)
  const isReceipt = quote.isPaid || !!paymentReceipt;

  // The bottom block is pinned to the page foot only while everything
  // still fits one page; past that the spacer would push content into
  // the page break, so long quotes flow naturally onto page 2
  const fitsOnePage = quote.lineItems.length <= 16;

  const meta: Array<[string, string]> = [
    ["Nº", formattedQuoteNumber],
    ["Issued", formatDate(quoteDate)],
  ];
  if (!isReceipt && validUntil) meta.push(["Valid until", formatDate(validUntil)]);
  meta.push([
    "Status",
    paymentReceipt
      ? balanceDue > 0
        ? "Partially Paid"
        : "Paid"
      : quote.isPaid
        ? "Paid"
        : "Unpaid",
  ]);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header: company left, Bill To top right */}
        <View style={styles.headerRow}>
          <View style={styles.companyBlock}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's Image has no alt prop; this renders to PDF, not the DOM */}
            {logoSrc && <Image src={logoSrc} style={styles.logo} />}
            <Text style={styles.companyName}>{companyInfo.name}</Text>
            <View style={styles.companyInfo}>
              {companyInfo.address && <Text>{companyInfo.address}</Text>}
              {companyInfo.phone && <Text>Phone: {companyInfo.phone}</Text>}
              {companyInfo.email && <Text>Email: {companyInfo.email}</Text>}
              {companyInfo.website && <Text>Web: {companyInfo.website}</Text>}
            </View>
          </View>

          <View style={styles.billToBlock}>
            <Text style={styles.billToLabel}>Bill To</Text>
            <Text style={styles.billToName}>{quote.clientInfo.name}</Text>
            <View style={styles.billToInfo}>
              {quote.clientInfo.company && <Text>{quote.clientInfo.company}</Text>}
              {quote.clientInfo.address && <Text>{quote.clientInfo.address}</Text>}
              {quote.clientInfo.email && <Text>{quote.clientInfo.email}</Text>}
              {quote.clientInfo.phone && <Text>{quote.clientInfo.phone}</Text>}
            </View>
          </View>
        </View>

        {/* Title band + horizontal meta strip */}
        <View style={styles.titleBand}>
          <Text style={styles.docTitle}>{docTitle}</Text>
          <View style={styles.metaStrip}>
            {meta.map(([label, value], i) => (
              <Text key={label}>
                {i > 0 ? "\u2002\u00B7\u2002" : ""}
                <Text style={styles.metaLabel}>{label}</Text>
                {" "}
                {value}
              </Text>
            ))}
          </View>
        </View>

        {/* Line Items */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colDescription}>Description</Text>
            <Text style={styles.colQuantity}>Qty</Text>
            <Text style={styles.colUnit}>Unit</Text>
            <Text style={styles.colRate}>Rate</Text>
            <Text style={styles.colAmount}>Amount</Text>
          </View>

          {quote.lineItems.map((item, index) => (
            <View
              key={item.id}
              style={
                index % 2 === 1
                  ? [styles.tableRow, styles.tableRowAlt]
                  : styles.tableRow
              }
            >
              <Text style={styles.colDescription}>{item.description}</Text>
              <Text style={styles.colQuantity}>{item.quantity}</Text>
              <Text style={styles.colUnit}>{item.unit}</Text>
              <Text style={styles.colRate}>{formatCurrency(item.unitPrice)}</Text>
              <Text style={styles.colAmount}>{formatCurrency(item.total)}</Text>
            </View>
          ))}
        </View>

        {/* Payment Schedule — one line per milestone, only when provided */}
        {!!scheduleLines?.length && (
          <View style={styles.scheduleSection}>
            <Text style={styles.sectionTitle}>Payment Schedule</Text>
            <View style={styles.scheduleBox}>
              {scheduleLines.map((line, i) => (
                <Text key={i} style={styles.scheduleLine}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
        )}

        {/* Payment Received — this specific payment (payment receipts only) */}
        {paymentReceipt && (
          <View style={styles.scheduleSection}>
            <Text style={styles.sectionTitle}>Payment Received</Text>
            <View style={styles.scheduleBox}>
              <Text style={styles.scheduleLine}>
                Date: {formatDate(new Date(paymentReceipt.paidAt + "T00:00:00"))}
              </Text>
              <Text style={styles.scheduleLine}>
                For: {paymentReceipt.milestoneName}
              </Text>
              {paymentReceipt.method && (
                <Text style={styles.scheduleLine}>
                  Method: {paymentReceipt.method.charAt(0).toUpperCase() + paymentReceipt.method.slice(1)}
                </Text>
              )}
              <Text style={styles.scheduleLine}>
                Amount received: {formatCurrency(paymentReceipt.amount)}
              </Text>
            </View>
          </View>
        )}

        {/* Flexible spacer: pins totals/terms/notes to the page bottom,
            just above the footer */}
        {fitsOnePage && <View style={{ flexGrow: 1 }} />}

        {/* Terms (left) beside totals (right) — no dead space under the table */}
        <View style={styles.totalsRow}>
          <View style={styles.totalsLeftCol}>
            <Text style={styles.sectionTitle}>Terms</Text>
            <View style={styles.termsList}>
              {!isReceipt && (
                <Text>
                  • Customer will be billed after indicating acceptance of this
                  quotation
                </Text>
              )}
              {!isReceipt && <Text>• Payment is due upon completion of work</Text>}
              <Text>• Accepted forms of payment: Cash, Check</Text>
              {!isReceipt && (
                <Text>
                  • {validUntil
                    ? `This quotation is valid until ${formatDate(validUntil)}`
                    : "This quotation is valid for 30 days from the date of issue"}
                </Text>
              )}
              <Text>
                • Changes to the scope of work will be re-quoted before work
                continues
              </Text>
              {!isReceipt && (
                <Text>• Work will commence upon approval and deposit receipt</Text>
              )}
            </View>
          </View>

          <View style={styles.totalsSection}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal:</Text>
              <Text style={styles.totalValue}>{formatCurrency(quote.subtotal)}</Text>
            </View>


            {quote.discount > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  Discount {quote.isDiscountPercentage ? `(${quote.discount}%)` : ""}:
                </Text>
                <Text style={styles.totalValue}>
                  -{formatCurrency(quote.discountAmount)}
                </Text>
              </View>
            )}

            <View style={styles.grandTotalRow}>
              <Text>{quote.isPaid && !paymentReceipt ? "Total paid:" : "Total:"}</Text>
              <Text style={styles.grandTotalValue}>{formatCurrency(quote.total)}</Text>
            </View>

            {/* Payment receipts show running paid-to-date + remaining balance */}
            {paymentReceipt && (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Paid to date:</Text>
                  <Text style={styles.totalValue}>
                    {formatCurrency(paymentReceipt.amountPaid)}
                  </Text>
                </View>
                <View style={styles.grandTotalRow}>
                  <Text>Balance due:</Text>
                  <Text style={styles.grandTotalValue}>{formatCurrency(balanceDue)}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Notes (left) + customer acceptance (right, quotations only) */}
        <View style={styles.bottomColumns}>
          {quote.notes && (
            <View style={styles.bottomCol}>
              <Text style={styles.sectionTitle}>Notes</Text>
              <Text style={styles.notesBox}>{quote.notes}</Text>
            </View>
          )}

          {!isReceipt && (
            <View style={styles.bottomCol}>
              <Text style={styles.sectionTitle}>Customer Acceptance</Text>
              <View style={styles.acceptanceBox}>
                <Text>
                  To accept this quotation, sign below and return it to us — or
                  confirm by phone or email.
                </Text>
                <Text style={styles.signatureLine}>
                  x _______________________________
                </Text>
                <Text>Print name and date</Text>
              </View>
            </View>
          )}
        </View>

        {/* Footer — `fixed` repeats it on every page when a long quote wraps */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerThankYou}>Thank you for your business!</Text>
          <Text>
            For questions or concerns, please contact us at {companyInfo.phone} or{" "}
            {companyInfo.email}
          </Text>
          {showBranding && (
            <Text style={styles.footerBrand}>Made with Quota</Text>
          )}
        </View>
      </Page>
    </Document>
  );
}
