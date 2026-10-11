# Split Payments — Design

**Date:** 2026-07-12
**Status:** Approved

## Context

Contractors rarely collect one payment. Typical job: 10% deposit, 30% before
construction, 30% during the work, 30% on completion. Today Quota tracks a
binary paid/unpaid toggle (`quotes.is_paid` + `payment_status_changes` audit
log). This feature replaces the toggle with a per-quote payment schedule
(milestones) plus recorded payments against those milestones, with derived
payment status and per-payment receipts.

## Decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Scope | Planned schedule AND recorded payments |
| Coupling | Strict — every payment targets one milestone |
| Amounts | Editable; milestone stays open until covered; multiple partial payments per milestone allowed |
| Schedule definition | Editable per quote; default 10/30/30/30; percentages must sum to 100 |
| Paid status | Derived from balance: Unpaid / Partially Paid / Paid. Manual toggle removed |
| Receipts | Per payment, showing that payment + running balance + schedule progress |

## 1. Schema — migration `004_split_payments.sql` (+ rollback, mirrored to `supabase/migrations/`)

### New table `payment_milestones`

- `id` UUID PK, `quote_id` FK → quotes (CASCADE), `user_id` FK → users
- `name` VARCHAR(255) NOT NULL
- `percentage` DECIMAL(5,2) NOT NULL CHECK (> 0 AND <= 100)
- `sort_order` INTEGER NOT NULL
- `created_at` / `updated_at`

Milestone **amounts are derived at read time**: `round(total × percentage / 100, 2)`,
with the **last milestone absorbing the rounding remainder** so milestone
amounts always sum exactly to the quote total. No amount column.

### New table `quote_payments`

- `id` UUID PK, `quote_id` FK → quotes (CASCADE), `milestone_id` FK → payment_milestones (RESTRICT), `user_id` FK
- `amount` DECIMAL(10,2) NOT NULL CHECK (> 0)
- `paid_at` DATE NOT NULL DEFAULT CURRENT_DATE
- `method` VARCHAR(20) (cash | check | zelle | other) NULL
- `note` TEXT NULL
- `receipt_sent_at` TIMESTAMPTZ NULL, `receipt_sent_count` INTEGER NOT NULL DEFAULT 0
- `created_at`

### `quotes` changes

- Add `amount_paid` DECIMAL(10,2) NOT NULL DEFAULT 0 (cache)
- DB trigger on `quote_payments` (INSERT/UPDATE/DELETE) recomputes
  `amount_paid = SUM(payments)`, `is_paid = amount_paid >= total`,
  `paid_at` (set when crossing to paid, cleared when dropping below).
  Same pattern as `calculate_quote_totals`. Every existing consumer of
  `is_paid` (stats, contact revenue trigger, badges) keeps working.

### Retired

- `payment_status_changes`: no longer written. Table remains (historic data readable).
- `setQuotePaid()` repository function and `PATCH /api/quotes/[id]/payment` removed.
- `quotes.receipt_sent_at` / `receipt_sent_count`: superseded by per-payment
  receipt tracking; columns remain but UI reads `quote_payments` instead.
- Schedule PUT is a diff (update/insert/delete by id), not delete-recreate —
  the `milestone_id` RESTRICT FK plus payment guards make delete-recreate impossible
  once payments exist.

## 2. Defaults and lifecycle

- **New quotes**: creation inserts the default schedule —
  Deposit 10 / Before construction starts 30 / During the work 30 / On completion 30.
- **Existing quotes**: lazily backfilled with the default schedule on first
  quote-page load (idempotent server-side check: no milestones → insert defaults).
- **Total changes after payments** (tax edit, line items): milestone amounts are
  percentages of the current total, so they move automatically; balance
  recomputes; overpayment clamps status to Paid.

### Schedule edit guards

- Percentages must sum to exactly 100.
- A milestone's new amount (pct × total) may not drop below what has already
  been paid against it.
- A milestone with payments cannot be deleted.

## 3. API

| Route | Method | Purpose |
|---|---|---|
| `/api/quotes/[id]/milestones` | GET, PUT | Read / replace the schedule (Zod: names non-empty, sum=100, guards above) |
| `/api/quotes/[id]/payments` | GET, POST | List / record payment `{ milestoneId, amount, paidAt?, method?, note? }` |
| `/api/quotes/[id]/payments/[pid]` | DELETE | Remove a mistaken payment (trigger recomputes) |
| `/api/quotes/[id]/payments/[pid]/receipt` | POST | Send per-payment receipt email (reuses receipt email/PDF flow with payment context) |

All routes: `getCurrentUser()` guard → Zod → user-scoped repository call
(existing pattern). New repository module `lib/db/payments.ts` for milestones +
payments; quote-scoped queries all filter by `user_id`.

## 4. UI (quote detail page)

- **Payment Schedule card**: row per milestone — name, %, derived amount,
  paid-so-far, status chip (unpaid / partial / paid), Record payment button.
  Edit schedule dialog: name + % rows, add/remove, live sum indicator, guard
  errors inline.
- **Record payment dialog**: amount prefilled with milestone remainder
  (editable), date (default today), method select, optional note.
- **Payment history table**: date, milestone, amount, method, note, receipt
  status, Send receipt action, delete.
- **Status badge**: `Unpaid` / `Partially Paid · $X remaining` / `Paid`.
- `QuoteActionsMenu`: mark-paid/unpaid entries removed. `SendReceiptButton`
  becomes per-payment (in history rows).
- **Quote PDF**: payment schedule printed as a payment-terms section.
- **Receipt PDF/email**: this payment + payments to date + remaining balance.
- **Clients tab**: `PaymentStatusDialog` removed; `PaymentHistoryDialog` reads
  `quote_payments`. Payments are recorded on the quote page only.

## 5. Error handling

- Recording payment on nonexistent/foreign milestone → 404.
- Amount ≤ 0 → 400 (Zod).
- Schedule PUT violating guards → 422 with per-row reasons.
- Receipt send failures surface Resend errors (existing path).

## 6. Testing

- **Unit-style** (tsx scripts): milestone rounding (sum equals total incl.
  odd totals), guard logic, status derivation.
- **Trigger**: psql checks — insert/delete payments, assert `amount_paid`,
  `is_paid`, `paid_at`.
- **e2e**: record partial payment → badge shows Partially Paid; cover total →
  Paid + receipt send (mocked); schedule edit validation.
- **Breakage to fix**: `e2e/clients.spec` (paid-toggle + note + history) reworked
  to the payments flow; any spec touching `quote-status-badge` re-asserted.
- Seed data updated: seeded paid quote gets a milestone schedule + payments
  rows consistent with the trigger-derived totals.
