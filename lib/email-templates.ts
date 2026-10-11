/**
 * Email Templates
 *
 * Professional HTML and plain text email templates for sending quotes.
 */

import { formatCurrency } from "./quote-calculations";

// =====================================================
// TYPES
// =====================================================

export interface QuoteEmailData {
  recipientName: string;
  recipientEmail: string;
  quoteNumber: string;
  quoteTotal: number;
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  quoteViewUrl?: string;
  contractorName?: string;
  lineItemCount: number;
  taxAmount?: number;
  subtotal: number;
  /** Contractor-edited message; replaces the default greeting/intro copy.
      Figures blocks always render from the authoritative data. */
  customMessage?: string;
  /** Header tagline under the business name, e.g. "Payment Receipt". */
  headerLabel?: string;
  /** Public logo URL; header <img> renders only when present. */
  companyLogoUrl?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escape a URL for an `href`/`src`, or return null if its scheme is not http(s).
 *
 * The scheme check is not redundant with escaping: `javascript:alert(1)` and
 * `data:text/html,…` contain no characters escapeHtml touches, so they survive
 * entity-encoding completely intact and stay executable in the clients that
 * honour them. Escaping stops attribute breakout; only the scheme allowlist
 * stops the payload.
 *
 * Callers must treat null as "render no link at all" rather than emitting an
 * empty href — a dead button is worse copy than the PDF-attached fallback.
 */
function safeHttpUrl(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return escapeHtml(parsed.toString());
}

/** Render a plain-text message as HTML paragraphs. */
function messageToHtml(message: string): string {
  return message
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin: 0 0 16px 0; color: #4b5563; font-size: 16px; line-height: 1.6;">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`
    )
    .join("\n              ");
}

// =====================================================
// HTML EMAIL TEMPLATE
// =====================================================

export function generateQuoteEmailHTML(data: QuoteEmailData): string {
  const {
    recipientName,
    quoteNumber,
    quoteTotal,
    companyName,
    companyEmail,
    companyPhone,
    quoteViewUrl,
    contractorName,
    lineItemCount,
    subtotal,
  } = data;

  // Receipts reuse this template with copy adjusted — no "quote" language
  const isReceipt = data.headerLabel === "Payment Receipt";

  // Escaped once here rather than at each interpolation: this template
  // interpolates the same values in several places, and one missed call site is
  // a phishing email sent over a DKIM-signed domain. Every raw value below is
  // caller- or profile-controlled.
  const eCompanyName = escapeHtml(companyName);
  const eRecipientName = escapeHtml(recipientName);
  const eQuoteNumber = escapeHtml(quoteNumber);
  const eCompanyEmail = escapeHtml(companyEmail);
  const eCompanyPhone = escapeHtml(companyPhone);
  const eContractorName = contractorName ? escapeHtml(contractorName) : "";
  const eHeaderLabel = escapeHtml(data.headerLabel ?? "Professional Quote");
  const viewUrl = safeHttpUrl(quoteViewUrl);
  const logoUrl = safeHttpUrl(data.companyLogoUrl);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${isReceipt ? "Receipt" : "Quote"} ${eQuoteNumber}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f3f4f6; padding: 20px 0;">
    <tr>
      <td align="center">

        <!-- Main Container -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); padding: 40px 30px; text-align: center;">
              ${
                logoUrl
                  ? `<img src="${logoUrl}" alt="${eCompanyName}" height="40" style="display: block; margin: 0 auto 12px auto; height: 40px; max-width: 220px;" />`
                  : ""
              }
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                ${eCompanyName}
              </h1>
              <p style="margin: 8px 0 0 0; color: #e0e7ff; font-size: 14px;">
                ${eHeaderLabel}
              </p>
            </td>
          </tr>

          <!-- Greeting / contractor message -->
          <tr>
            <td style="padding: 40px 30px 30px 30px;">
              ${
                data.customMessage
                  ? messageToHtml(data.customMessage)
                  : `<h2 style="margin: 0 0 16px 0; color: #111827; font-size: 22px; font-weight: 600;">
                Hi ${eRecipientName},
              </h2>
              <p style="margin: 0 0 20px 0; color: #4b5563; font-size: 16px; line-height: 1.6;">
                ${eContractorName ? `${eContractorName} from ` : ''}${eCompanyName} has prepared a quote for you.
                Please review the details below.
              </p>`
              }
            </td>
          </tr>

          <!-- Quote Summary Card -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden;">

                <!-- Quote Number Header -->
                <tr>
                  <td style="padding: 20px; background-color: #f3f4f6; border-bottom: 2px solid #e5e7eb;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                          Quote Number
                        </td>
                        <td align="right" style="color: #111827; font-size: 14px; font-weight: 700;">
                          ${eQuoteNumber}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Quote Details -->
                <tr>
                  <td style="padding: 24px 20px;">

                    <!-- Subtotal -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 12px;">
                      <tr>
                        <td style="color: #6b7280; font-size: 14px; padding: 4px 0;">
                          Subtotal (${lineItemCount} ${lineItemCount === 1 ? 'item' : 'items'}):
                        </td>
                        <td align="right" style="color: #111827; font-size: 14px; font-weight: 600; padding: 4px 0;">
                          ${formatCurrency(subtotal)}
                        </td>
                      </tr>
                    </table>


                    <!-- Divider -->
                    <div style="height: 1px; background-color: #e5e7eb; margin: 16px 0;"></div>

                    <!-- Total -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="color: #111827; font-size: 18px; font-weight: 700; padding: 4px 0;">
                          ${isReceipt ? "Total paid:" : "Total:"}
                        </td>
                        <td align="right" style="color: #2563eb; font-size: 24px; font-weight: 700; padding: 4px 0;">
                          ${formatCurrency(quoteTotal)}
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 30px 40px 30px; text-align: center;">
              ${viewUrl ? `
              <a href="${viewUrl}" target="_blank" style="display: inline-block; padding: 16px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2); transition: background-color 0.2s;">
                View Full Quote
              </a>
              <p style="margin: 16px 0 0 0; color: #6b7280; font-size: 14px;">
                Or download the attached PDF
              </p>
              ` : `
              <p style="margin: 0; color: #4b5563; font-size: 15px;">
                📎 Your ${isReceipt ? "receipt" : "complete quote"} is attached as a PDF
              </p>
              `}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 30px;">
              <div style="height: 1px; background-color: #e5e7eb;"></div>
            </td>
          </tr>

          <!-- Footer Message -->
          <tr>
            <td style="padding: 30px 30px 20px 30px;">
              <p style="margin: 0 0 12px 0; color: #4b5563; font-size: 15px; line-height: 1.6;">
                If you have any questions about this ${isReceipt ? "receipt" : "quote or would like to discuss the details"},
                please don't hesitate to reach out.
              </p>
              <p style="margin: 0; color: #4b5563; font-size: 15px; line-height: 1.6;">
                ${isReceipt ? "Thank you for your business!" : "We look forward to working with you!"}
              </p>
            </td>
          </tr>

          <!-- Contact Info -->
          <tr>
            <td style="padding: 20px 30px 40px 30px; background-color: #f9fafb;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding-bottom: 12px;">
                    <p style="margin: 0; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                      Contact Information
                    </p>
                  </td>
                </tr>
                <tr>
                  <td>
                    <p style="margin: 0 0 6px 0; color: #111827; font-size: 14px;">
                      📧 <a href="mailto:${eCompanyEmail}" style="color: #2563eb; text-decoration: none;">${eCompanyEmail}</a>
                    </p>
                    <p style="margin: 0; color: #111827; font-size: 14px;">
                      📞 <a href="tel:${eCompanyPhone}" style="color: #2563eb; text-decoration: none;">${eCompanyPhone}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; background-color: #f3f4f6; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px;">
                This ${isReceipt ? "receipt" : "quote"} was generated by ${eCompanyName}
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 11px;">
                © ${new Date().getFullYear()} ${eCompanyName}. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- End Main Container -->

      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// =====================================================
// PLAIN TEXT EMAIL TEMPLATE
// =====================================================

export function generateQuoteEmailText(data: QuoteEmailData): string {
  const {
    recipientName,
    quoteNumber,
    quoteTotal,
    companyName,
    companyEmail,
    companyPhone,
    quoteViewUrl,
    contractorName,
    lineItemCount,
    subtotal,
  } = data;

  // Receipts reuse this template with copy adjusted — no "quote" language
  const isReceipt = data.headerLabel === "Payment Receipt";

  const intro =
    data.customMessage?.trim() ||
    `Hi ${recipientName},

${contractorName ? `${contractorName} from ` : ''}${companyName} has prepared a quote for you.`;

  return `
${intro}

--------------------------------------------------
${isReceipt ? "PAYMENT SUMMARY" : "QUOTE SUMMARY"}
--------------------------------------------------

Quote Number: ${quoteNumber}

Subtotal (${lineItemCount} ${lineItemCount === 1 ? 'item' : 'items'}): ${formatCurrency(subtotal)}
--------------------------------------------------
${isReceipt ? "Total paid" : "Total"}: ${formatCurrency(quoteTotal)}
--------------------------------------------------

${quoteViewUrl ? `View the full quote online:\n${quoteViewUrl}\n\n` : ''}Your ${isReceipt ? "receipt" : "complete quote"} is attached as a PDF.

If you have any questions about this ${isReceipt ? "receipt" : "quote or would like to discuss the details"}, please don't hesitate to reach out.

${isReceipt ? "Thank you for your business!" : "We look forward to working with you!"}

--------------------------------------------------
CONTACT INFORMATION
--------------------------------------------------

Email: ${companyEmail}
Phone: ${companyPhone}

--------------------------------------------------

This ${isReceipt ? "receipt" : "quote"} was generated by ${companyName}
© ${new Date().getFullYear()} ${companyName}. All rights reserved.
  `.trim();
}

// =====================================================
// SUBJECT LINE GENERATOR
// =====================================================

export function generateQuoteEmailSubject(
  quoteNumber: string,
  companyName: string
): string {
  return `Quote #${quoteNumber} from ${companyName}`;
}

// =====================================================
// DELIVERY NOTIFICATION TEMPLATES
// =====================================================

/**
 * Email sent to contractor when quote is delivered successfully
 */
export function generateDeliveryNotificationHTML(data: {
  quoteNumber: string;
  recipientName: string;
  recipientEmail: string;
}): string {
  const { quoteNumber, recipientName, recipientEmail } = data;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="font-family: Arial, sans-serif; background-color: #f3f4f6; padding: 20px;">
  <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="font-size: 48px;">✅</span>
    </div>
    <h2 style="color: #10b981; text-align: center; margin: 0 0 20px 0;">
      Quote Delivered Successfully
    </h2>
    <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">
      Your quote <strong>#${quoteNumber}</strong> has been successfully delivered to:
    </p>
    <div style="background-color: #f9fafb; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <p style="margin: 0; color: #111827; font-size: 15px;">
        <strong>${recipientName}</strong><br>
        ${recipientEmail}
      </p>
    </div>
    <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 20px 0 0 0;">
      The recipient will be able to view and download the quote.
    </p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Email sent to contractor when delivery fails
 */
export function generateDeliveryFailureHTML(data: {
  quoteNumber: string;
  recipientEmail: string;
  errorMessage: string;
}): string {
  const { quoteNumber, recipientEmail, errorMessage } = data;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="font-family: Arial, sans-serif; background-color: #f3f4f6; padding: 20px;">
  <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="font-size: 48px;">❌</span>
    </div>
    <h2 style="color: #ef4444; text-align: center; margin: 0 0 20px 0;">
      Quote Delivery Failed
    </h2>
    <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">
      We were unable to deliver quote <strong>#${quoteNumber}</strong> to:
    </p>
    <div style="background-color: #fef2f2; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ef4444;">
      <p style="margin: 0 0 8px 0; color: #111827; font-size: 15px;">
        <strong>${recipientEmail}</strong>
      </p>
      <p style="margin: 0; color: #7f1d1d; font-size: 13px;">
        Error: ${errorMessage}
      </p>
    </div>
    <p style="color: #6b7280; font-size: 14px; margin: 20px 0 0 0;">
      Please verify the email address and try again. If the problem persists, contact support.
    </p>
  </div>
</body>
</html>
  `.trim();
}

// =====================================================
// CANCELLATION CONFIRMATION
// =====================================================

export interface CancellationEmailData {
  recipientName: string;
  /** Human label of the plan being cancelled, e.g. "Ultimate". */
  planLabel: string;
  /** Formatted date access continues until, e.g. "August 20, 2026". Omit if unknown. */
  accessUntil?: string;
  /** Link back to the billing page to reactivate. */
  billingUrl?: string;
}

export function generateCancellationEmailSubject(): string {
  return "Your Quota plan is set to cancel";
}

export function generateCancellationEmailText(data: CancellationEmailData): string {
  const until = data.accessUntil
    ? `You'll keep ${data.planLabel} access until ${data.accessUntil}, then move to the Free plan (3 quotes/month).`
    : `You'll keep ${data.planLabel} access until the end of your current billing period, then move to the Free plan (3 quotes/month).`;
  return [
    `Hi ${data.recipientName},`,
    "",
    "Your Quota subscription is scheduled to cancel — you won't be charged again.",
    until,
    "",
    "Changed your mind? You can reactivate any time before then from Plan & Billing.",
    data.billingUrl ? data.billingUrl : "",
    "",
    "— Quota",
  ]
    .filter(Boolean)
    .join("\n");
}

export function generateCancellationEmailHTML(data: CancellationEmailData): string {
  // Same treatment as generateQuoteEmailHTML: this goes out over the same
  // DKIM-signed domain, so nothing reaches the markup unescaped and no href is
  // rendered for a scheme we did not allow. Every value here is server-derived
  // today, which is exactly why it is worth pinning down now — the next person
  // to pass a user-supplied billingUrl or display name should not have to
  // notice this was safe only by accident.
  const eRecipientName = escapeHtml(data.recipientName);
  const ePlanLabel = escapeHtml(data.planLabel);
  const eAccessUntil = data.accessUntil ? escapeHtml(data.accessUntil) : "";
  const billingUrl = safeHttpUrl(data.billingUrl);

  const until = eAccessUntil
    ? `You'll keep <strong>${ePlanLabel}</strong> access until <strong>${eAccessUntil}</strong>, then move to the Free plan (3 quotes/month).`
    : `You'll keep <strong>${ePlanLabel}</strong> access until the end of your current billing period, then move to the Free plan (3 quotes/month).`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin: 0; padding: 0; background-color: #f9f8f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 24px;">
    <div style="background-color: #1b2a41; padding: 16px 24px;">
      <span style="color: #f9f8f6; font-size: 18px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">Quota</span>
    </div>
    <div style="background-color: #ffffff; border: 2px solid #d5dae2; border-top: none; padding: 28px 24px;">
      <h1 style="margin: 0 0 16px 0; color: #1b2a41; font-size: 20px;">Your plan is set to cancel</h1>
      <p style="color: #2e3947; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Hi ${eRecipientName},</p>
      <p style="color: #2e3947; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">
        Your Quota subscription is scheduled to cancel — <strong>you won't be charged again</strong>. ${until}
      </p>
      ${
        billingUrl
          ? `<p style="margin: 24px 0 0 0;"><a href="${billingUrl}" style="display: inline-block; background-color: #e9a620; color: #112037; font-weight: 700; text-decoration: none; padding: 12px 20px;">Reactivate my plan</a></p>
      <p style="color: #5c697a; font-size: 13px; margin: 12px 0 0 0;">Changed your mind? You can reactivate any time before then.</p>`
          : `<p style="color: #5c697a; font-size: 13px; margin: 12px 0 0 0;">Changed your mind? You can reactivate any time before then from Plan &amp; Billing.</p>`
      }
    </div>
  </div>
</body>
</html>
  `.trim();
}
