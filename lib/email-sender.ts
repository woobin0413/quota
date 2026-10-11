/**
 * Email Sender
 *
 * Wrapper for Resend API with error handling, retry logic,
 * and email activity logging.
 */

import { Resend } from "resend";
import { buildFromHeader } from "@/lib/email-from";
import { generateQuotePDF, type PaymentReceiptInfo } from "@/lib/quote-pdf";
import type { Tier } from "@/lib/subscription";
import {
  generateQuoteEmailHTML,
  generateQuoteEmailText,
  generateQuoteEmailSubject,
  generateCancellationEmailHTML,
  generateCancellationEmailText,
  generateCancellationEmailSubject,
  type QuoteEmailData,
  type CancellationEmailData,
} from "./email-templates";
import type { QuoteData } from "@/types/quote-data";
import { logger } from "@/lib/logger";

// =====================================================
// TYPES
// =====================================================

export interface SendQuoteEmailOptions {
  quote: QuoteData;
  recipientEmail: string;
  recipientName: string;
  companyInfo: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    logoUrl?: string | null;
  };
  quoteNumber: string;
  quoteDate?: Date;
  /** Quote expiry; shown in the PDF meta strip and terms */
  validUntil?: Date;
  quoteViewUrl?: string;
  contractorName?: string;
  replyTo?: string;
  tags?: string[];
  /** Contractor-edited subject; falls back to the generated one. */
  customSubject?: string;
  /** Contractor-edited message; replaces the default intro copy. */
  customMessage?: string;
  /** Header tagline, e.g. "Payment Receipt"; defaults to quote branding. */
  headerLabel?: string;
  /** Payment schedule lines rendered in the attached PDF, e.g. "Deposit — 10% — $697.31". */
  scheduleLines?: string[];
  /** When set, the attached PDF renders as a PAYMENT RECEIPT for this payment. */
  paymentReceipt?: PaymentReceiptInfo;
  /** Sender's subscription tier — gates the PDF logo (Pro+) and watermark (Free). */
  tier?: Tier;
}

export interface SendEmailResult {
  success: boolean;
  emailId?: string;
  error?: string;
  sentAt?: Date;
}

// =====================================================
// RESEND CLIENT
// =====================================================

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }

    resendClient = new Resend(apiKey);
  }

  return resendClient;
}

// =====================================================
// SEND QUOTE EMAIL
// =====================================================

/**
 * Send a quote via email with PDF attachment
 */
export async function sendQuoteEmail(
  options: SendQuoteEmailOptions
): Promise<SendEmailResult> {
  const {
    quote,
    recipientEmail,
    recipientName,
    companyInfo,
    quoteNumber,
    quoteDate = new Date(),
    quoteViewUrl,
    contractorName,
    replyTo,
    tags = [],
  } = options;

  // Test/dev bypass — used by e2e tests to avoid real sends
  if (process.env.RESEND_MOCK === "1") {
    console.log(
      `[EMAIL] RESEND_MOCK=1 — skipping real send of quote ${quoteNumber} to ${recipientEmail}`
    );
    return {
      success: true,
      emailId: `mock-${Date.now()}`,
      sentAt: new Date(),
    };
  }

  try {
    const resend = getResendClient();

    // Generate PDF attachment
    const pdfBuffer = await generateQuotePDF(
      quote,
      companyInfo,
      quoteNumber,
      quoteDate,
      options.validUntil,
      options.scheduleLines,
      options.paymentReceipt,
      options.tier ?? "free"
    );

    // Prepare email data
    const emailData: QuoteEmailData = {
      recipientName,
      recipientEmail,
      quoteNumber,
      quoteTotal: quote.total,
      companyName: companyInfo.name,
      companyEmail: companyInfo.email || "",
      companyPhone: companyInfo.phone || "",
      companyLogoUrl: companyInfo.logoUrl || undefined,
      quoteViewUrl,
      contractorName,
      lineItemCount: quote.lineItems.length,
      taxAmount: quote.taxAmount > 0 ? quote.taxAmount : undefined,
      subtotal: quote.subtotal,
      customMessage: options.customMessage,
      headerLabel: options.headerLabel,
    };

    // Generate email content
    const htmlContent = generateQuoteEmailHTML(emailData);
    const textContent = generateQuoteEmailText(emailData);
    const subject =
      options.customSubject?.trim() ||
      generateQuoteEmailSubject(quoteNumber, companyInfo.name);

    // Send email with Resend
    // RESEND_FROM_EMAIL must be on a Resend-verified domain; the
    // onboarding@resend.dev fallback only delivers to the Resend account owner
    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

    // Test redirect: without a verified domain, Resend only delivers to the
    // account owner. RESEND_TEST_REDIRECT routes every send to that address
    // and tags the subject with the real recipient. Leave unset in prod.
    const testRedirect = process.env.RESEND_TEST_REDIRECT?.trim();
    const toAddress = testRedirect || recipientEmail;
    const finalSubject = testRedirect
      ? `[TEST → ${recipientEmail}] ${subject}`
      : subject;

    const result = await resend.emails.send({
      from: buildFromHeader(companyInfo.name, fromEmail),
      to: toAddress,
      reply_to: replyTo || companyInfo.email,
      subject: finalSubject,
      html: htmlContent,
      text: textContent,
      attachments: [
        {
          filename: `quote-${quoteNumber}.pdf`,
          content: pdfBuffer,
        },
      ],
      tags: [
        { name: "type", value: "quote" },
        { name: "quote_number", value: quoteNumber },
        // Resend requires unique tag names — index them so multiple
        // custom tags don't collide on name: "custom"
        ...tags.map((tag, i) => ({ name: `custom_${i}`, value: tag })),
      ],
    });

    // Resend returns errors in the result instead of throwing
    if (result.error) {
      logger.error("Resend send failed", {
        err: result.error,
        quoteNumber,
        recipientEmail,
      });
      return {
        success: false,
        error: `${result.error.name}: ${result.error.message}`,
      };
    }

    return {
      success: true,
      emailId: result.data?.id,
      sentAt: new Date(),
    };
  } catch (error) {
    logger.error("Failed to send quote email", {
      err: error,
      quoteNumber,
      recipientEmail,
    });

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return {
      success: false,
      error: errorMessage,
    };
  }
}

// =====================================================
// SEND CANCELLATION EMAIL
// =====================================================

/**
 * Confirm to the user that their subscription is scheduled to cancel. No PDF,
 * no DB writes — fire-and-forget from the cancel / downgrade-to-free routes.
 * Honors RESEND_MOCK (dev/e2e) and RESEND_TEST_REDIRECT.
 */
export async function sendCancellationEmail(opts: {
  recipientEmail: string;
  data: CancellationEmailData;
}): Promise<SendEmailResult> {
  const { recipientEmail, data } = opts;

  if (process.env.RESEND_MOCK === "1") {
    console.log(
      `[EMAIL] RESEND_MOCK=1 — skipping cancellation email to ${recipientEmail}`
    );
    return { success: true, emailId: `mock-${Date.now()}`, sentAt: new Date() };
  }

  try {
    const resend = getResendClient();
    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    const testRedirect = process.env.RESEND_TEST_REDIRECT?.trim();
    const subject = generateCancellationEmailSubject();

    const result = await resend.emails.send({
      from: buildFromHeader("Quota", fromEmail),
      to: testRedirect || recipientEmail,
      subject: testRedirect ? `[TEST → ${recipientEmail}] ${subject}` : subject,
      html: generateCancellationEmailHTML(data),
      text: generateCancellationEmailText(data),
      tags: [{ name: "type", value: "cancellation" }],
    });

    if (result.error) {
      logger.error("Cancellation email failed", { err: result.error, recipientEmail });
      return { success: false, error: `${result.error.name}: ${result.error.message}` };
    }
    return { success: true, emailId: result.data?.id, sentAt: new Date() };
  } catch (error) {
    logger.error("Failed to send cancellation email", { err: error, recipientEmail });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =====================================================
// EMAIL VALIDATION
// =====================================================

/**
 * Validate email address format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Sanitize email address
 */
export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// =====================================================
// RETRY LOGIC
// =====================================================

/**
 * Send email with retry logic
 */
export async function sendQuoteEmailWithRetry(
  options: SendQuoteEmailOptions,
  maxRetries: number = 3
): Promise<SendEmailResult> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await sendQuoteEmail(options);

    if (result.success) {
      return result;
    }

    lastError = result.error;

    // Don't retry on validation errors
    if (lastError?.includes("Invalid email") || lastError?.includes("validation")) {
      return result;
    }

    // Wait before retrying (exponential backoff)
    if (attempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return {
    success: false,
    error: lastError || "Failed after multiple attempts",
  };
}

// =====================================================
// BATCH SENDING
// =====================================================

/**
 * Send multiple quotes (with rate limiting)
 */
export async function sendQuoteEmailBatch(
  emails: SendQuoteEmailOptions[],
  rateLimitDelay: number = 1000
): Promise<SendEmailResult[]> {
  const results: SendEmailResult[] = [];

  for (let i = 0; i < emails.length; i++) {
    const result = await sendQuoteEmail(emails[i]);
    results.push(result);

    // Rate limit: wait between sends
    if (i < emails.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, rateLimitDelay));
    }
  }

  return results;
}

// =====================================================
// EMAIL ACTIVITY LOGGING
// =====================================================

export interface EmailActivity {
  id: string;
  quoteId: string;
  userId: string;
  recipientEmail: string;
  emailId: string; // Resend ID
  status: "queued" | "sent" | "delivered" | "failed" | "bounced";
  sentAt: Date;
  deliveredAt?: Date;
  failureReason?: string;
  openedAt?: Date;
  clickedAt?: Date;
}

/**
 * Log email activity to database
 * TODO: Implement database integration
 */
export async function logEmailActivity(
  activity: Omit<EmailActivity, "id">
): Promise<void> {
  // TODO: Store in database
  // await db.query('INSERT INTO email_activity ...');

  console.log("Email activity logged:", {
    quoteId: activity.quoteId,
    status: activity.status,
    recipientEmail: activity.recipientEmail,
  });
}

/**
 * Update email delivery status
 */
export async function updateEmailStatus(
  emailId: string,
  status: EmailActivity["status"],
  metadata?: {
    deliveredAt?: Date;
    failureReason?: string;
    openedAt?: Date;
    clickedAt?: Date;
  }
): Promise<void> {
  // TODO: Update in database
  // await db.query('UPDATE email_activity SET status = $1 WHERE email_id = $2', [status, emailId]);

  console.log("Email status updated:", {
    emailId,
    status,
    ...metadata,
  });
}

// =====================================================
// ERROR TYPES
// =====================================================

export class EmailSendError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

/**
 * Create appropriate error from Resend API error
 */
export function handleEmailError(error: any): EmailSendError {
  const message = error?.message || "Unknown error";

  // Rate limit error
  if (message.includes("rate limit") || message.includes("429")) {
    return new EmailSendError(
      "Rate limit exceeded. Please try again later.",
      "RATE_LIMIT",
      true
    );
  }

  // Invalid email
  if (message.includes("Invalid email") || message.includes("validation")) {
    return new EmailSendError(
      "Invalid email address format.",
      "INVALID_EMAIL",
      false
    );
  }

  // API key error
  if (message.includes("API key") || message.includes("authentication")) {
    return new EmailSendError(
      "Email service authentication failed.",
      "AUTH_ERROR",
      false
    );
  }

  // Network error
  if (message.includes("network") || message.includes("timeout")) {
    return new EmailSendError(
      "Network error. Please try again.",
      "NETWORK_ERROR",
      true
    );
  }

  // Generic error
  return new EmailSendError(
    "Failed to send email. Please try again.",
    "SEND_ERROR",
    true
  );
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

/**
 * Check if email was sent successfully
 */
export function isEmailSent(result: SendEmailResult): boolean {
  return result.success && !!result.emailId;
}

/**
 * Extract Resend email ID from result
 */
export function getEmailId(result: SendEmailResult): string | null {
  return result.emailId || null;
}

/**
 * Format email result for logging
 */
export function formatEmailResult(result: SendEmailResult): string {
  if (result.success) {
    return `Email sent successfully (ID: ${result.emailId})`;
  }
  return `Email failed: ${result.error}`;
}
