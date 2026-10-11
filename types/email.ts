/**
 * Email Types & Validation
 *
 * TypeScript types and Zod schemas for email-related functionality.
 */

import { z } from "zod";

// =====================================================
// EMAIL STATUS
// =====================================================

export const EMAIL_STATUS = {
  QUEUED: "queued",
  SENT: "sent",
  DELIVERED: "delivered",
  FAILED: "failed",
  BOUNCED: "bounced",
} as const;

export type EmailStatus = (typeof EMAIL_STATUS)[keyof typeof EMAIL_STATUS];

// =====================================================
// EMAIL ACTIVITY
// =====================================================

export interface EmailActivity {
  id: string;
  quoteId: string;
  userId: string;
  recipientEmail: string;
  recipientName: string;
  emailId: string; // Resend email ID
  status: EmailStatus;
  sentAt: Date;
  deliveredAt?: Date;
  openedAt?: Date;
  clickedAt?: Date;
  failureReason?: string;
  metadata?: Record<string, unknown>;
}

export const emailActivitySchema = z.object({
  id: z.string().uuid(),
  quoteId: z.string().uuid(),
  userId: z.string().uuid(),
  recipientEmail: z.string().email(),
  recipientName: z.string().min(1).max(255),
  emailId: z.string(),
  status: z.enum([
    EMAIL_STATUS.QUEUED,
    EMAIL_STATUS.SENT,
    EMAIL_STATUS.DELIVERED,
    EMAIL_STATUS.FAILED,
    EMAIL_STATUS.BOUNCED,
  ]),
  sentAt: z.date(),
  deliveredAt: z.date().optional(),
  openedAt: z.date().optional(),
  clickedAt: z.date().optional(),
  failureReason: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// =====================================================
// SEND QUOTE EMAIL REQUEST
// =====================================================

export interface SendQuoteEmailRequest {
  quoteId: string;
  recipientEmail: string;
  recipientName: string;
  quoteViewUrl?: string;
  contractorName?: string;
  replyTo?: string;
  tags?: string[];
}

export const sendQuoteEmailRequestSchema = z.object({
  quoteId: z.string().uuid("Invalid quote ID format"),
  recipientEmail: z
    .string()
    .email("Invalid email address")
    .max(255, "Email address too long"),
  recipientName: z
    .string()
    .min(1, "Recipient name is required")
    .max(255, "Recipient name too long"),
  // No quoteViewUrl here, deliberately. It renders as the CTA button href in a
  // message sent from a DKIM-signed @sendquota.com address, so accepting a
  // caller-supplied destination hands out a domain-aligned phishing email.
  // Escaping does not help — the payload is the link target, not markup.
  // Derive it server-side from the quote id if a public quote-view page is ever
  // built. See app/api/send-quote/route.ts for the full rationale.
  contractorName: z.string().max(255).optional(),
  replyTo: z.string().email("Invalid reply-to email").optional(),
  tags: z.array(z.string()).max(10, "Too many tags").optional(),
});

// =====================================================
// SEND EMAIL RESPONSE
// =====================================================

export interface SendEmailSuccessResponse {
  success: true;
  emailId: string;
  sentAt: Date;
  deliveryStatus: "sent";
  message: string;
}

export interface SendEmailErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: Array<{ path: string; message: string }>;
  retryAfter?: number;
}

export type SendEmailResponse = SendEmailSuccessResponse | SendEmailErrorResponse;

// =====================================================
// EMAIL TEMPLATE DATA
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
}

export const quoteEmailDataSchema = z.object({
  recipientName: z.string().min(1),
  recipientEmail: z.string().email(),
  quoteNumber: z.string().min(1),
  quoteTotal: z.number().nonnegative(),
  companyName: z.string().min(1),
  companyEmail: z.string().email(),
  companyPhone: z.string(),
  quoteViewUrl: z.string().url().optional(),
  contractorName: z.string().optional(),
  lineItemCount: z.number().int().positive(),
  taxAmount: z.number().nonnegative().optional(),
  subtotal: z.number().nonnegative(),
});

// =====================================================
// COMPANY INFO
// =====================================================

export interface CompanyInfo {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logoUrl?: string | null;
}

export const companyInfoSchema = z.object({
  name: z.string().min(1, "Company name is required").max(255),
  address: z.string().max(500).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email("Invalid email").max(255).optional(),
  website: z.string().url("Invalid website URL").max(255).optional(),
  logoUrl: z.string().url("Invalid logo URL").max(500).nullable().optional(),
});

// =====================================================
// EMAIL VALIDATION
// =====================================================

/**
 * Email format validation regex
 * More permissive than RFC 5322 but good enough for practical use
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate email address format
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") {
    return false;
  }

  // Basic format check
  if (!EMAIL_REGEX.test(email)) {
    return false;
  }

  // Length checks
  if (email.length > 255) {
    return false;
  }

  const [localPart, domain] = email.split("@");

  if (!localPart || !domain) {
    return false;
  }

  if (localPart.length > 64) {
    return false;
  }

  if (domain.length > 253) {
    return false;
  }

  return true;
}

/**
 * Sanitize email address
 */
export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validate email domain (basic check)
 */
export function hasValidDomain(email: string): boolean {
  const domain = email.split("@")[1];
  if (!domain) return false;

  // Check for at least one dot
  if (!domain.includes(".")) return false;

  // Check domain parts
  const parts = domain.split(".");
  if (parts.some((part) => part.length === 0)) return false;

  return true;
}

/**
 * Check if email is from a disposable email provider
 * (Add more domains as needed)
 */
const DISPOSABLE_DOMAINS = new Set([
  "tempmail.com",
  "throwaway.email",
  "guerrillamail.com",
  "10minutemail.com",
  "mailinator.com",
  "maildrop.cc",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? DISPOSABLE_DOMAINS.has(domain) : false;
}

// =====================================================
// EMAIL BATCH OPERATIONS
// =====================================================

export interface BatchSendRequest {
  emails: SendQuoteEmailRequest[];
  rateLimitDelay?: number; // ms between sends
}

export const batchSendRequestSchema = z.object({
  emails: z
    .array(sendQuoteEmailRequestSchema)
    .min(1, "At least one email required")
    .max(100, "Maximum 100 emails per batch"),
  rateLimitDelay: z.number().int().min(100).max(10000).optional(),
});

export interface BatchSendResponse {
  success: boolean;
  results: Array<{
    quoteId: string;
    recipientEmail: string;
    success: boolean;
    emailId?: string;
    error?: string;
  }>;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

// =====================================================
// EMAIL ACTIVITY FILTERS
// =====================================================

export interface EmailActivityFilters {
  status?: EmailStatus;
  quoteId?: string;
  recipientEmail?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export const emailActivityFiltersSchema = z.object({
  status: z
    .enum([
      EMAIL_STATUS.QUEUED,
      EMAIL_STATUS.SENT,
      EMAIL_STATUS.DELIVERED,
      EMAIL_STATUS.FAILED,
      EMAIL_STATUS.BOUNCED,
    ])
    .optional(),
  quoteId: z.string().uuid().optional(),
  recipientEmail: z.string().email().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

// =====================================================
// EMAIL STATISTICS
// =====================================================

export interface EmailStatistics {
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  bounced: number;
  opened: number;
  clicked: number;
  deliveryRate: number; // percentage
  openRate: number; // percentage
  clickRate: number; // percentage
}

// =====================================================
// TYPE GUARDS
// =====================================================

export function isEmailActivity(value: unknown): value is EmailActivity {
  return emailActivitySchema.safeParse(value).success;
}

export function isSendQuoteEmailRequest(
  value: unknown
): value is SendQuoteEmailRequest {
  return sendQuoteEmailRequestSchema.safeParse(value).success;
}

export function isCompanyInfo(value: unknown): value is CompanyInfo {
  return companyInfoSchema.safeParse(value).success;
}

// =====================================================
// ERROR CODES
// =====================================================

export const EMAIL_ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_EMAIL: "INVALID_EMAIL",
  QUOTE_NOT_FOUND: "QUOTE_NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  INVALID_QUOTE_STATUS: "INVALID_QUOTE_STATUS",
  EMAIL_SEND_FAILED: "EMAIL_SEND_FAILED",
  PDF_GENERATION_FAILED: "PDF_GENERATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type EmailErrorCode =
  (typeof EMAIL_ERROR_CODES)[keyof typeof EMAIL_ERROR_CODES];

// =====================================================
// CUSTOM ERRORS
// =====================================================

export class EmailValidationError extends Error {
  constructor(
    message: string,
    public code: EmailErrorCode = EMAIL_ERROR_CODES.VALIDATION_ERROR,
    public details?: unknown
  ) {
    super(message);
    this.name = "EmailValidationError";
  }
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    public code: EmailErrorCode = EMAIL_ERROR_CODES.EMAIL_SEND_FAILED,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

// =====================================================
// WEBHOOK TYPES
// =====================================================

export type ResendEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.complained"
  | "email.bounced"
  | "email.opened"
  | "email.clicked";

export interface ResendWebhookPayload {
  type: ResendEventType;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    delivered_at?: string;
    opened_at?: string;
    clicked_at?: string;
    bounce_type?: "hard" | "soft";
    bounce_reason?: string;
    complaint_type?: string;
    delay_reason?: string;
  };
}

export const resendWebhookPayloadSchema = z.object({
  type: z.enum([
    "email.sent",
    "email.delivered",
    "email.delivery_delayed",
    "email.complained",
    "email.bounced",
    "email.opened",
    "email.clicked",
  ]),
  created_at: z.string(),
  data: z.object({
    email_id: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    subject: z.string(),
    created_at: z.string(),
    delivered_at: z.string().optional(),
    opened_at: z.string().optional(),
    clicked_at: z.string().optional(),
    bounce_type: z.enum(["hard", "soft"]).optional(),
    bounce_reason: z.string().optional(),
    complaint_type: z.string().optional(),
    delay_reason: z.string().optional(),
  }),
});
