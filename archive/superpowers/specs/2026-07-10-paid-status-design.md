# Paid/Unpaid as the Only Quote Status

**Date:** 2026-07-10
**Status:** Approved

## Problem

Quotes carry a six-value lifecycle status (`draft/sent/viewed/accepted/rejected/expired`) plus a separate `is_paid` boolean. The lifecycle status adds no value for the contractor's actual workflow: what matters is whether the invoice was paid. Sending the invoice email is an action, not a state.

## Decision

- Payment state (**Unpaid → Paid**) is the only quote status, backed by the existing `is_paid` boolean and `payment_status_changes` audit history.
- Invoice sending becomes a status-free action. `sent_at`, `email_sent_count`, and `recipient_email` remain as send metadata only.
- The old `status` column and its lifecycle timestamps (`viewed_at`, `accepted_at`, `rejected_at`) are removed from the database.

## Database

Migration `003_remove_quote_status.sql` (+ `003_rollback.sql`, + timestamped mirror in `supabase/migrations/`):

- Drop `quotes.status` (and its CHECK constraint / any status index)
- Drop `quotes.viewed_at`, `quotes.accepted_at`, `quotes.rejected_at`
- Keep `sent_at`, `email_sent_count`, `recipient_email`, `is_paid`, `paid_at`
- `quote_activity` table and its `action` values are untouched (history preserved)
- Rollback restores the columns with the previous CHECK constraint and default `'draft'`

## API / Repositories

- Delete `updateQuoteStatus()`; `/api/send-quote` updates only send metadata on success
- Remove the expired-quote send guard (no `expired` state exists)
- `/api/quotes` GET: drop the `status` query filter
- `getQuoteStats()` returns `{ total, unpaid, paid, totalRevenue }` style counts derived from `is_paid`
- `QuoteStatus` type and all references removed from `types/database.ts`
- Payment endpoints (`/api/quotes/[id]/payment`) unchanged

## UI

- **Quote page:** badge shows `Paid` (green) / `Unpaid` (neutral/red) from `is_paid`; a "Sent 2× · last Jul 10" metadata line appears when `email_sent_count > 0`; a Mark paid/unpaid button opens the existing `PaymentStatusDialog`
- **Clients tab:** already `is_paid`-driven; remove lifecycle-status chips from quote rows
- **Dashboard quote list:** status column replaced by Paid/Unpaid badge + sent metadata
- **Send button:** behavior identical minus status transition; still disabled while sending, still updates metadata display after success

## Tests

- `quote-flow` spec: new quote badge asserts `Unpaid` (was `Draft`); post-send assertion checks the sent-metadata line (was `Sent` badge)
- `clients` spec: unchanged except any status-chip assertions
- Existing `data-testid` attributes preserved where the element survives (`quote-status-badge` now renders Paid/Unpaid)

## Out of Scope

- Paid/unpaid filtering on the quotes list
- Any change to payment recording semantics (still manual, still no processing)
