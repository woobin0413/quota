/**
 * Quote Detail Page
 *
 * Displays a single quote with all details.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getQuoteWithContact,
  getQuoteWithContactByNumber,
  getQuoteLineItems,
} from "@/lib/db/quotes";
import { ensureDefaultSchedule, getPayments } from "@/lib/db/payments";
import { deriveMilestoneViews } from "@/lib/payment-schedule";
import { requireUser } from "@/lib/auth";
import { formatCurrency } from "@/lib/quote-calculations";
import { formatDate } from "@/lib/utils";
import { buildQuotePdfPayload } from "@/lib/quote-pdf";
import { buildDefaultEmailContent } from "@/lib/email-content";
import { InternalNotesCard } from "@/components/quote/InternalNotesCard";
import { SendQuoteButton } from "@/components/quote/SendQuoteButton";
import { QuoteActionsMenu } from "@/components/quote/QuoteActionsMenu";
import { PaymentScheduleCard } from "@/components/quote/PaymentScheduleCard";
import { PaymentHistoryCard } from "@/components/quote/PaymentHistoryCard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Calendar,
  FileText,
  MapPin,
} from "lucide-react";

interface QuotePageProps {
  params: Promise<{ id: string }>;
}

// UUID v4 pattern — params that don't match are treated as a quote number.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QuotePage(props: QuotePageProps) {
  const params = await props.params;
  const user = await requireUser();
  const quote = UUID_RE.test(params.id)
    ? await getQuoteWithContact(params.id, user.id)
    : await getQuoteWithContactByNumber(params.id, user.id);

  if (!quote) {
    notFound();
  }

  const lineItems = await getQuoteLineItems(quote.id, user.id);
  const [milestones, payments] = await Promise.all([
    ensureDefaultSchedule(quote.id, user.id),
    getPayments(quote.id, user.id),
  ]);
  const milestoneViews = deriveMilestoneViews(milestones, payments, quote.total);

  // Email prefill derives from the same authoritative payload the PDF
  // renders from, so email figures always match the attachment
  const { quoteData, companyInfo } = buildQuotePdfPayload(quote, lineItems, user);
  const emailDefaults = buildDefaultEmailContent(
    quoteData,
    companyInfo,
    quote.quote_number
  );

  return (
    <div className="container mx-auto max-w-4xl p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`stamp ${quote.is_paid ? "stamp-paid" : "stamp-unpaid"}`}
            data-testid="quote-status-badge"
          >
            {quote.is_paid
              ? "Paid"
              : quote.amount_paid > 0
                ? `Partially Paid · ${formatCurrency(Math.max(quote.total - quote.amount_paid, 0))} due`
                : "Unpaid"}
          </span>
          <QuoteActionsMenu quoteId={quote.id} />
          <SendQuoteButton
            quoteId={quote.id}
            isPaid={quote.is_paid}
            defaultEmail={quote.recipient_email ?? quote.contact?.email ?? ""}
            defaultName={quote.contact?.name ?? ""}
            defaultSubject={emailDefaults.subject}
            defaultMessage={emailDefaults.message}
            attachmentSummary={`${quote.quote_number}.pdf · ${lineItems.length} ${lineItems.length === 1 ? "item" : "items"} · Total ${formatCurrency(quote.total)}`}
          />
        </div>
      </div>

      {/* Quote Info */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{quote.project_name}</CardTitle>
              <CardDescription className="mt-1">
                Quote #<span className="figure">{quote.quote_number}</span>
              </CardDescription>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="font-medium">{formatDate(quote.created_at)}</p>
              {(quote.email_sent_count ?? 0) > 0 && quote.sent_at && (
                <p
                  className="mt-1 text-sm text-muted-foreground"
                  data-testid="sent-meta"
                >
                  Quote sent {quote.email_sent_count}× · last{" "}
                  {formatDate(quote.sent_at)}
                </p>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Client Info */}
            <div>
              <h3 className="mb-3 font-semibold">Client Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span>{quote.contact?.name || "No name"}</span>
                </div>
                {quote.contact?.company && (
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span>{quote.contact.company}</span>
                  </div>
                )}
                {quote.contact?.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{quote.contact.email}</span>
                  </div>
                )}
                {quote.contact?.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{quote.contact.phone}</span>
                  </div>
                )}
                {(quote.contact?.address ||
                  quote.contact?.city ||
                  quote.contact?.state ||
                  quote.contact?.zip_code) && (
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>
                      {quote.contact?.address && (
                        <>
                          {quote.contact.address}
                          <br />
                        </>
                      )}
                      {[quote.contact?.city, quote.contact?.state]
                        .filter(Boolean)
                        .join(", ")}
                      {quote.contact?.zip_code
                        ? ` ${quote.contact.zip_code}`
                        : ""}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Quote Details */}
            <div>
              <h3 className="mb-3 font-semibold">Quote Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>Created: {formatDate(quote.created_at)}</span>
                </div>
                {quote.valid_until && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>Valid until: {formatDate(quote.valid_until)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Line Items — the quote sheet */}
      <Card className="relative mb-8">
        {quote.is_paid && (
          <span
            className="stamp stamp-paid stamp-large absolute -top-4 right-6 bg-card/90"
            data-testid="quote-paid-badge"
          >
            Paid
          </span>
        )}
        <CardHeader>
          <CardTitle className="font-display uppercase tracking-wide">
            Line Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-primary text-left">
                  <th className="eyebrow pb-2">Description</th>
                  <th className="eyebrow pb-2 text-right">Qty</th>
                  <th className="eyebrow pb-2 text-right">Unit Price</th>
                  <th className="eyebrow pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item) => (
                  <tr key={item.id} className="ledger-row">
                    <td className="py-3">
                      <p className="font-medium">{item.description}</p>
                      {item.unit_of_measure && (
                        <p className="text-sm text-muted-foreground">
                          per {item.unit_of_measure}
                        </p>
                      )}
                    </td>
                    <td className="figure py-3 text-right">{item.quantity}</td>
                    <td className="figure py-3 text-right">
                      {formatCurrency(item.unitPrice)}
                    </td>
                    <td className="figure py-3 text-right font-medium">
                      {formatCurrency(item.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="figure">{formatCurrency(quote.subtotal)}</span>
              </div>
              {quote.discountAmount > 0 && (
                <div className="flex justify-between text-sm text-success">
                  <span>Discount</span>
                  <span className="figure">
                    -{formatCurrency(quote.discountAmount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t-2 border-primary pt-2 text-lg font-bold">
                <span className="font-display uppercase tracking-wide">
                  Total
                </span>
                <span className="figure">{formatCurrency(quote.total)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <PaymentScheduleCard
        quoteId={quote.id}
        milestones={milestoneViews}
        total={quote.total}
        amountPaid={quote.amount_paid}
      />
      <PaymentHistoryCard
        quoteId={quote.id}
        payments={payments}
        milestones={milestoneViews}
        recipientEmail={quote.recipient_email ?? quote.contact?.email ?? undefined}
      />

      {/* Internal Notes — private, editable, never on the client PDF */}
      <InternalNotesCard
        quoteId={quote.id}
        internalNotes={quote.internal_notes}
      />
    </div>
  );
}
