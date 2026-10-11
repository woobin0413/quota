# Email System Documentation

Complete guide to the Quota email sending system with Resend API integration.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Setup](#setup)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Usage Examples](#usage-examples)
- [Webhook Integration](#webhook-integration)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [Testing](#testing)

---

## Overview

> **Current-state notes:** email invoicing is a **Pro+** benefit — both `/api/send-quote` and the payment-receipt send (`/api/quotes/[id]/payments/[paymentId]/receipt`) return 403 `EMAIL_REQUIRES_PRO` for free users. There are two outbound email kinds beyond quotes: **payment receipts** and **cancellation confirmations** (`lib/billing/cancellation-email.ts`, sent by the Stripe webhook). Production sends from the verified domain **`sendquota.com`**. Quote/receipt emails contain **no sales-tax line** (tax was removed app-wide).

The email system provides a robust, production-ready solution for sending quote emails with PDF attachments using the Resend API. It includes:

- Professional HTML and plain text email templates
- Automatic PDF generation from quote data
- Retry logic with exponential backoff
- Rate limiting (10 emails/minute per user)
- Webhook handling for delivery tracking
- Comprehensive error handling and validation

## Features

### ✅ Core Functionality

- **Send Quote Emails**: Professional branded emails with PDF attachments
- **Email Templates**: Responsive HTML with plain text fallback
- **PDF Attachments**: Automatically generated from quote data
- **Delivery Tracking**: Webhook integration for status updates
- **Activity Logging**: Track sent, delivered, opened, clicked events
- **Batch Sending**: Send multiple quotes with rate limiting

### 🛡️ Security & Reliability

- **Authentication**: Auth0 integration for user verification
- **Ownership Validation**: Users can only send their own quotes
- **Rate Limiting**: Prevents abuse (10 emails/min per user)
- **Webhook Verification**: HMAC signature validation
- **Email Validation**: Format checking and sanitization
- **Retry Logic**: Automatic retries with exponential backoff

### 📊 Tracking & Analytics

- **Email Status**: Queued, sent, delivered, failed, bounced
- **Open Tracking**: Know when recipients open emails
- **Click Tracking**: Track CTA button clicks
- **Failure Reasons**: Detailed error information
- **Activity History**: Complete audit trail

## Setup

### 1. Install Dependencies

Already included in package.json:

```json
{
  "dependencies": {
    "resend": "^3.2.0",
    "@react-pdf/renderer": "^4.0.0"
  }
}
```

### 2. Environment Variables

Add to `.env.local`:

```bash
# Resend API
RESEND_API_KEY=re_your_api_key_here

# Webhook (optional, for delivery tracking)
RESEND_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# App URL (for quote view links)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Get Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Go to API Keys section
3. Create a new API key
4. Copy and add to `.env.local`

### 4. Configure Webhook (Optional)

For delivery tracking:

1. Go to Resend Dashboard → Settings → Webhooks
2. Add webhook URL: `https://your-domain.com/api/webhooks/resend`
3. Select events:
   - `email.sent`
   - `email.delivered`
   - `email.bounced`
   - `email.complained`
   - `email.opened`
   - `email.clicked`
4. Copy signing secret and add to `.env.local`

## Architecture

### File Structure

```
lib/
├── email-templates.ts       # HTML/text email templates
├── email-sender.ts          # Resend API wrapper
├── email-examples.ts        # Usage examples
└── EMAIL_SYSTEM.md          # This file

types/
└── email.ts                 # TypeScript types & validation

app/api/
├── send-quote/
│   └── route.ts            # Main API endpoint
└── webhooks/
    └── resend/
        └── route.ts        # Webhook handler
```

### Data Flow

```
Client Component
    ↓
POST /api/send-quote
    ↓
Authentication & Validation
    ↓
Fetch Quote from Database
    ↓
Generate PDF (QuotePDFDocument)
    ↓
Send Email (Resend API)
    ↓
Return Response
    ↓
Resend sends email
    ↓
Webhook receives status updates
    ↓
Update email activity in database
```

## API Reference

### POST /api/send-quote

Send a quote via email with PDF attachment.

**Authentication**: Required (Auth0)

**Rate Limit**: 10 requests/minute per user

**Request Body**:

```typescript
{
  quoteId: string;           // UUID of the quote
  recipientEmail: string;    // Email address
  recipientName: string;     // Recipient name
  quoteViewUrl?: string;     // Optional view URL
  contractorName?: string;   // Optional sender name
  replyTo?: string;          // Optional reply-to email
  tags?: string[];           // Optional tags
}
```

**Success Response** (200):

```typescript
{
  success: true;
  emailId: string;           // Resend email ID
  sentAt: Date;              // Timestamp
  deliveryStatus: "sent";
  message: string;
}
```

**Error Response**:

```typescript
{
  success: false;
  error: string;
  code: string;              // Error code
  details?: Array<{          // Validation errors
    path: string;
    message: string;
  }>;
  retryAfter?: number;       // For rate limit errors
}
```

**Error Codes**:

- `UNAUTHORIZED`: Not authenticated
- `USER_NOT_FOUND`: User doesn't exist
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `VALIDATION_ERROR`: Invalid request data
- `INVALID_EMAIL`: Malformed email address
- `QUOTE_NOT_FOUND`: Quote doesn't exist
- `FORBIDDEN`: User doesn't own the quote
- `INVALID_QUOTE_STATUS`: Quote is cancelled
- `EMAIL_SEND_FAILED`: Resend API error
- `INTERNAL_ERROR`: Server error

### POST /api/webhooks/resend

Receives delivery status updates from Resend.

**Authentication**: Webhook signature verification

**Events**:

- `email.sent`: Email accepted by mail server
- `email.delivered`: Email delivered to inbox
- `email.bounced`: Email bounced (hard/soft)
- `email.complained`: Marked as spam
- `email.opened`: Recipient opened email
- `email.clicked`: Recipient clicked link

## Usage Examples

### Basic Client-Side Usage

```typescript
import type { SendQuoteEmailRequest } from "@/types/email";

async function sendQuote(
  quoteId: string,
  recipientEmail: string,
  recipientName: string
) {
  const response = await fetch("/api/send-quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteId,
      recipientEmail,
      recipientName,
    } satisfies SendQuoteEmailRequest),
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error);
  }

  return data.emailId;
}
```

### React Hook

```typescript
function useSendQuote() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendQuote = async (request: SendQuoteEmailRequest) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/send-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error);
        return false;
      }

      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { sendQuote, loading, error };
}
```

### Server-Side Direct Usage

```typescript
import { sendQuoteEmailWithRetry } from "@/lib/email-sender";

async function sendQuoteFromServer(quote: QuoteData) {
  const result = await sendQuoteEmailWithRetry({
    quote,
    recipientEmail: "client@example.com",
    recipientName: "John Doe",
    companyInfo: {
      name: "My Company",
      email: "hello@mycompany.com",
      phone: "(555) 123-4567",
    },
    quoteNumber: quote.quoteNumber,
    quoteDate: new Date(),
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.emailId;
}
```

For more examples, see `lib/email-examples.ts`.

## Webhook Integration

### Setup

1. Configure webhook URL in Resend dashboard
2. Add webhook secret to environment variables
3. Webhook handler automatically updates email status

### Event Flow

```
Email Sent
    ↓
Resend processes delivery
    ↓
Webhook POST to /api/webhooks/resend
    ↓
Verify signature
    ↓
Parse event
    ↓
Update email status in database
    ↓
Return 200 OK
```

### Webhook Payload Example

```json
{
  "type": "email.delivered",
  "created_at": "2025-01-19T12:00:00Z",
  "data": {
    "email_id": "abc123",
    "from": "hello@mycompany.com",
    "to": ["client@example.com"],
    "subject": "Quote #Q-2025-001 from My Company",
    "created_at": "2025-01-19T11:55:00Z",
    "delivered_at": "2025-01-19T12:00:00Z"
  }
}
```

## Error Handling

### Client-Side Error Handling

```typescript
try {
  const response = await fetch("/api/send-quote", { ... });
  const data = await response.json();

  if (!data.success) {
    switch (data.code) {
      case "RATE_LIMIT_EXCEEDED":
        alert(`Try again in ${data.retryAfter} seconds`);
        break;
      case "INVALID_EMAIL":
        alert("Please check the email address");
        break;
      case "FORBIDDEN":
        alert("Permission denied");
        break;
      default:
        alert(data.error);
    }
    return;
  }

  // Success!
} catch (error) {
  // Network error
  alert("Connection error. Please try again.");
}
```

### Server-Side Error Handling

The email sender includes automatic retry logic:

```typescript
// Retries up to 3 times with exponential backoff
const result = await sendQuoteEmailWithRetry(options, 3);

// Errors are categorized as retryable or not
// - Rate limits: Retryable
// - Invalid email: Not retryable
// - Network errors: Retryable
```

## Rate Limiting

### Per-User Limits

- **10 emails per minute** per authenticated user
- In-memory tracking (use Redis/Upstash in production)
- Automatic cleanup of expired entries

### Rate Limit Headers

Response includes rate limit information:

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1705670400000
```

### Handling Rate Limits

```typescript
if (response.status === 429) {
  const data = await response.json();
  const retryAfter = data.retryAfter; // seconds

  // Wait and retry
  await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
}
```

## Testing

### Test Email Sending (Development)

```typescript
// Use Resend test mode
const testResult = await sendQuoteEmail({
  quote: mockQuote,
  recipientEmail: "test@example.com",
  recipientName: "Test User",
  companyInfo: {
    name: "Test Company",
    email: "test@testcompany.com",
  },
  quoteNumber: "TEST-001",
});
```

### Test Webhook Locally

Use ngrok to expose local server:

```bash
# Terminal 1: Start Next.js
npm run dev

# Terminal 2: Start ngrok
ngrok http 3000

# Use ngrok URL in Resend webhook configuration
# https://abc123.ngrok.io/api/webhooks/resend
```

### Manual Testing Checklist

- [ ] Send email to valid address
- [ ] Send email to invalid address
- [ ] Test rate limiting (send 11+ emails quickly)
- [ ] Test with cancelled quote
- [ ] Test with quote owned by different user
- [ ] Test webhook signature verification
- [ ] Test delivery tracking (open, click)
- [ ] Test error handling

## Email Templates

### Customization

Email templates are in `lib/email-templates.ts`. Customize:

- **Company branding**: Colors, logo, header
- **Email content**: Text, formatting, sections
- **CTA button**: Text, styling, URL
- **Footer**: Contact info, legal text

### Preview Templates

Generate HTML locally to preview:

```typescript
import { generateQuoteEmailHTML } from "@/lib/email-templates";

const html = generateQuoteEmailHTML({
  recipientName: "John Doe",
  quoteNumber: "Q-2025-001",
  quoteTotal: 5000,
  companyName: "My Company",
  // ... other fields
});

// Save to file or render in browser
```

## Production Checklist

Before deploying to production:

- [ ] Add `RESEND_API_KEY` to production environment
- [ ] Configure webhook URL with production domain
- [ ] Add `RESEND_WEBHOOK_SECRET` to production environment
- [ ] Implement Redis-based rate limiting (replace in-memory)
- [ ] Add database tables for email activity logging
- [ ] Set up monitoring for email failures
- [ ] Configure SPF/DKIM records for your domain
- [ ] Test with real email addresses
- [ ] Set up error alerting (Sentry, etc.)
- [ ] Review and customize email templates
- [ ] Test webhook delivery in production
- [ ] Monitor rate limits and adjust if needed

## Troubleshooting

### Emails Not Sending

1. Check `RESEND_API_KEY` is set correctly
2. Verify Resend account is active
3. Check API quota/limits in Resend dashboard
4. Review server logs for errors
5. Test with Resend API directly

### Webhooks Not Working

1. Verify webhook URL is accessible
2. Check `RESEND_WEBHOOK_SECRET` matches dashboard
3. Review webhook logs in Resend dashboard
4. Test signature verification
5. Check server logs for webhook errors

### Rate Limit Issues

1. Increase limit if legitimate use case
2. Implement Redis-based tracking for accuracy
3. Add queue system for batch sending
4. Monitor abuse patterns

## Support

For issues or questions:

- Check [Resend documentation](https://resend.com/docs)
- Review email examples in `lib/email-examples.ts`
- Check server logs for detailed errors
- Test with simple requests first

## License

Part of Quota - See main project LICENSE
