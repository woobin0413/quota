# Split Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary paid/unpaid toggle with a per-quote milestone schedule (default 10/30/30/30) plus payments recorded against milestones; paid status derives from balance; receipts send per payment.

**Architecture:** Two new tables (`payment_milestones`, `quote_payments`) with a DB trigger keeping `quotes.amount_paid`/`is_paid`/`paid_at` in sync (mirrors the existing totals-trigger pattern, so all current `is_paid` consumers keep working). Milestone amounts are derived at read time from percentages — last milestone absorbs rounding. Pure derivation/guard logic lives in `lib/payment-schedule.ts`; DB access in `lib/db/payments.ts`; thin Zod-guarded API routes; server quote page assembles props for client components.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (service-role client `supabaseAdmin`), Zod, shadcn/ui, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-12-split-payments-design.md`

## Global Constraints

- Every DB query scoped by `user_id`; never trust client ownership.
- Migration + rollback in `db/migrations/`, timestamped copy in `supabase/migrations/`.
- Zod validation on all API input; route pattern: `getCurrentUser()` → Zod → repo call.
- Interactive components carry stable `data-testid` attributes.
- Client-facing copy uses the contractor's business name, never the platform name.
- No unit-test framework in repo: pure-logic tests are `npx tsx` scripts run ad hoc; DB behavior verified via `psql`; flows via Playwright e2e.
- `npm run type-check` and `npm run lint` must pass before any commit.
- Local DB: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`. Dev auth storage: `e2e/.auth/user.json`. Seeded quote ids `20000000-…-0001..0004`.
- Verify only quote total > 0 counts as payable: `is_paid = amount_paid >= total AND total > 0`.

---

### Task 1: Migration 004 — tables, trigger, totals-trigger update

**Files:**
- Create: `db/migrations/004_split_payments.sql`
- Create: `db/migrations/004_rollback.sql`
- Create: `supabase/migrations/20260712000000_split_payments.sql` (exact copy of 004)

**Interfaces:**
- Produces: tables `payment_milestones(id, quote_id, user_id, name, percentage, sort_order, created_at, updated_at)`, `quote_payments(id, quote_id, milestone_id, user_id, amount, paid_at, method, note, receipt_sent_at, receipt_sent_count, created_at)`; column `quotes.amount_paid`; trigger `trigger_recalc_payment_state`; updated `calculate_quote_totals()` that also refreshes payment state when totals change.

- [ ] **Step 1: Write `db/migrations/004_split_payments.sql`**

```sql
-- 004: Split payments
--
-- Milestone schedule per quote + payments recorded against milestones.
-- quotes.is_paid becomes derived: amount_paid >= total. Trigger keeps the
-- cache in sync (same pattern as calculate_quote_totals).

BEGIN;

-- ---------------------------------------------------------------
-- payment_milestones
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_milestones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  percentage DECIMAL(5,2) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_percentage CHECK (percentage > 0 AND percentage <= 100)
);

COMMENT ON TABLE payment_milestones IS
  'Planned payment split per quote; amounts derived from percentage of quote total at read time';

CREATE INDEX IF NOT EXISTS idx_payment_milestones_quote
  ON payment_milestones(quote_id, sort_order);

CREATE TRIGGER update_payment_milestones_updated_at
  BEFORE UPDATE ON payment_milestones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------
-- quote_payments
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS quote_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES payment_milestones(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  method VARCHAR(20),
  note TEXT,
  receipt_sent_at TIMESTAMPTZ,
  receipt_sent_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT positive_amount CHECK (amount > 0),
  CONSTRAINT valid_method CHECK (method IS NULL OR method IN ('cash','check','zelle','other'))
);

COMMENT ON TABLE quote_payments IS
  'Payments recorded against schedule milestones; payments happen outside the system';

CREATE INDEX IF NOT EXISTS idx_quote_payments_quote
  ON quote_payments(quote_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_payments_milestone
  ON quote_payments(milestone_id);

-- ---------------------------------------------------------------
-- quotes.amount_paid cache + derived paid state
-- ---------------------------------------------------------------

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN quotes.amount_paid IS
  'Cache of SUM(quote_payments.amount); maintained by trigger_recalc_payment_state';

CREATE OR REPLACE FUNCTION recalc_quote_payment_state()
RETURNS TRIGGER AS $$
DECLARE
  v_quote_id UUID;
  v_paid DECIMAL(10,2);
BEGIN
  v_quote_id := COALESCE(NEW.quote_id, OLD.quote_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM quote_payments WHERE quote_id = v_quote_id;

  UPDATE quotes SET
    amount_paid = v_paid,
    is_paid = (v_paid >= total AND total > 0),
    paid_at = CASE
      WHEN (v_paid >= total AND total > 0) THEN COALESCE(paid_at, NOW())
      ELSE NULL
    END
  WHERE id = v_quote_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_recalc_payment_state
  AFTER INSERT OR UPDATE OR DELETE ON quote_payments
  FOR EACH ROW EXECUTE FUNCTION recalc_quote_payment_state();

-- ---------------------------------------------------------------
-- Totals trigger also refreshes payment state: a tax/line-item change
-- moves total, which can flip is_paid in either direction
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION calculate_quote_totals()
RETURNS TRIGGER AS $$
DECLARE
  quote_subtotal DECIMAL(10, 2);
  quote_tax DECIMAL(10, 2);
  quote_total DECIMAL(10, 2);
  v_paid DECIMAL(10, 2);
BEGIN
  SELECT COALESCE(SUM(total), 0)
  INTO quote_subtotal
  FROM quote_line_items
  WHERE quote_id = NEW.quote_id;

  SELECT tax_rate, discount_amount
  INTO quote_tax, quote_total
  FROM quotes
  WHERE id = NEW.quote_id;

  quote_tax := (quote_subtotal * quote_tax / 100);
  quote_total := GREATEST(quote_subtotal + quote_tax - COALESCE(quote_total, 0), 0);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM quote_payments WHERE quote_id = NEW.quote_id;

  UPDATE quotes
  SET
    subtotal = quote_subtotal,
    tax_amount = quote_tax,
    total = quote_total,
    amount_paid = v_paid,
    is_paid = (v_paid >= quote_total AND quote_total > 0),
    paid_at = CASE
      WHEN (v_paid >= quote_total AND quote_total > 0) THEN COALESCE(paid_at, NOW())
      ELSE NULL
    END
  WHERE id = NEW.quote_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
```

- [ ] **Step 2: Write `db/migrations/004_rollback.sql`**

```sql
-- Rollback 004: drop split-payment tables and derived cache.
-- WARNING: recorded payments and schedules are NOT recoverable.

BEGIN;

DROP TRIGGER IF EXISTS trigger_recalc_payment_state ON quote_payments;
DROP FUNCTION IF EXISTS recalc_quote_payment_state();

DROP TABLE IF EXISTS quote_payments;
DROP TABLE IF EXISTS payment_milestones;

ALTER TABLE quotes DROP COLUMN IF EXISTS amount_paid;

-- Restore the pre-004 totals trigger body (from 001, GREATEST clamp kept)
CREATE OR REPLACE FUNCTION calculate_quote_totals()
RETURNS TRIGGER AS $$
DECLARE
  quote_subtotal DECIMAL(10, 2);
  quote_tax DECIMAL(10, 2);
  quote_total DECIMAL(10, 2);
BEGIN
  SELECT COALESCE(SUM(total), 0)
  INTO quote_subtotal
  FROM quote_line_items
  WHERE quote_id = NEW.quote_id;

  SELECT tax_rate, discount_amount
  INTO quote_tax, quote_total
  FROM quotes
  WHERE id = NEW.quote_id;

  quote_tax := (quote_subtotal * quote_tax / 100);
  quote_total := GREATEST(quote_subtotal + quote_tax - COALESCE(quote_total, 0), 0);

  UPDATE quotes
  SET subtotal = quote_subtotal, tax_amount = quote_tax, total = quote_total
  WHERE id = NEW.quote_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
```

- [ ] **Step 3: Mirror to supabase and apply**

```bash
cp db/migrations/004_split_payments.sql supabase/migrations/20260712000000_split_payments.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f db/migrations/004_split_payments.sql
```

Expected: `COMMIT` with no errors.

- [ ] **Step 4: Verify trigger behavior via psql (the failing/passing test for this task)**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
-- fixture: milestone on seeded unpaid quote Q-2026-901 (total 6973.09ish)
INSERT INTO payment_milestones (id, quote_id, user_id, name, percentage, sort_order)
VALUES ('90000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'Deposit', 10, 0);

-- partial payment → amount_paid set, is_paid false
INSERT INTO quote_payments (quote_id, milestone_id, user_id, amount, method)
VALUES ('20000000-0000-0000-0000-000000000001',
        '90000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001', 100.00, 'check');
SELECT amount_paid = 100.00 AND is_paid = FALSE AS partial_ok
FROM quotes WHERE id = '20000000-0000-0000-0000-000000000001';

-- cover the full total → is_paid true, paid_at set
INSERT INTO quote_payments (quote_id, milestone_id, user_id, amount)
SELECT '20000000-0000-0000-0000-000000000001',
       '90000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000001',
       total - 100.00
FROM quotes WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT is_paid = TRUE AND paid_at IS NOT NULL AS paid_ok
FROM quotes WHERE id = '20000000-0000-0000-0000-000000000001';

-- delete a payment → drops back to partial
DELETE FROM quote_payments
WHERE quote_id = '20000000-0000-0000-0000-000000000001' AND amount = 100.00;
SELECT is_paid = FALSE AND paid_at IS NULL AS unpaid_again_ok
FROM quotes WHERE id = '20000000-0000-0000-0000-000000000001';

-- milestone with payments cannot be deleted (RESTRICT)
DO $$
BEGIN
  DELETE FROM payment_milestones WHERE id = '90000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'RESTRICT did not fire';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'restrict_ok';
END $$;
ROLLBACK;
SQL
```

Expected output includes `partial_ok = t`, `paid_ok = t`, `unpaid_again_ok = t`, `NOTICE: restrict_ok`, ends `ROLLBACK`.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/004_split_payments.sql db/migrations/004_rollback.sql supabase/migrations/20260712000000_split_payments.sql
git commit -m "feat(db): payment milestones, quote payments, derived paid state"
```

---

### Task 2: Types + pure schedule logic (`lib/payment-schedule.ts`)

**Files:**
- Modify: `types/database.ts` (add row + domain types; add `amount_paid` to `QuoteRow`/`Quote`)
- Create: `lib/payment-schedule.ts`
- Test: `scripts/check-payment-schedule.ts` (tsx script, committed)

**Interfaces:**
- Produces:
  - Types: `PaymentMilestoneRow`, `PaymentMilestone`, `QuotePaymentRow`, `QuotePayment`, `MilestoneInput { id?: string; name: string; percentage: number; sortOrder: number }`, `MilestoneView` (see code).
  - `DEFAULT_SCHEDULE: { name: string; percentage: number }[]` — 10/30/30/30.
  - `computeMilestoneAmounts(total: number, percentages: number[]): number[]` — 2-dp amounts, last absorbs remainder, sums exactly to total.
  - `deriveMilestoneViews(milestones: PaymentMilestone[], payments: QuotePayment[], total: number): MilestoneView[]`.
  - `validateSchedule(input: MilestoneInput[], current: MilestoneView[]): string[]` — empty array = valid.

- [ ] **Step 1: Add types to `types/database.ts`** (near the existing `PaymentStatusChange` types)

```typescript
// =====================================================
// SPLIT PAYMENTS (payment_milestones / quote_payments)
// =====================================================

export interface PaymentMilestoneRow {
  id: string;
  quote_id: string;
  user_id: string;
  name: string;
  percentage: number | string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentMilestone {
  id: string;
  quote_id: string;
  user_id: string;
  name: string;
  percentage: number;
  sort_order: number;
}

export type PaymentMethod = "cash" | "check" | "zelle" | "other";

export interface QuotePaymentRow {
  id: string;
  quote_id: string;
  milestone_id: string;
  user_id: string;
  amount: number | string;
  paid_at: string;
  method: PaymentMethod | null;
  note: string | null;
  receipt_sent_at: Date | null;
  receipt_sent_count: number;
  created_at: Date;
}

export interface QuotePayment {
  id: string;
  quote_id: string;
  milestone_id: string;
  user_id: string;
  amount: number;
  paid_at: string; // ISO date (yyyy-mm-dd)
  method: PaymentMethod | null;
  note: string | null;
  receipt_sent_at: Date | null;
  receipt_sent_count: number;
  created_at: Date;
}
```

Also add `amount_paid: number;` to the `Quote` interface and `amount_paid: number | string;` to `QuoteRow` (both already carry `is_paid`/`paid_at` around `types/database.ts:94` and `:151`).

- [ ] **Step 2: Write `lib/payment-schedule.ts`**

```typescript
/**
 * Payment Schedule
 *
 * Pure logic for milestone schedules: default split, derived amounts
 * (percent of quote total, last milestone absorbs rounding), per-milestone
 * status from recorded payments, and schedule-edit guards.
 */

import type { PaymentMilestone, QuotePayment } from "@/types/database";

export interface MilestoneInput {
  id?: string; // present = update existing row; absent = create
  name: string;
  percentage: number;
  sortOrder: number;
}

export interface MilestoneView {
  id: string;
  name: string;
  percentage: number;
  sortOrder: number;
  amount: number; // derived share of the quote total
  paidAmount: number; // sum of payments against this milestone
  status: "unpaid" | "partial" | "paid";
}

/** Standard trades split: deposit, pre-construction, during, completion. */
export const DEFAULT_SCHEDULE: { name: string; percentage: number }[] = [
  { name: "Deposit", percentage: 10 },
  { name: "Before construction starts", percentage: 30 },
  { name: "During the work", percentage: 30 },
  { name: "On completion", percentage: 30 },
];

const toCents = (n: number) => Math.round(n * 100);

/**
 * Split `total` by `percentages`. Each amount rounds to cents; the last
 * milestone absorbs the rounding remainder so amounts sum exactly to total.
 */
export function computeMilestoneAmounts(
  total: number,
  percentages: number[]
): number[] {
  if (percentages.length === 0) return [];
  const totalCents = toCents(total);
  const cents = percentages.map((pct) => Math.round((totalCents * pct) / 100));
  const allocated = cents.slice(0, -1).reduce((sum, c) => sum + c, 0);
  cents[cents.length - 1] = totalCents - allocated;
  return cents.map((c) => c / 100);
}

/**
 * Join milestones with their payments and the quote total into view rows
 * (ordered by sort_order). ±1¢ tolerance when deciding "paid".
 */
export function deriveMilestoneViews(
  milestones: PaymentMilestone[],
  payments: QuotePayment[],
  total: number
): MilestoneView[] {
  const ordered = [...milestones].sort((a, b) => a.sort_order - b.sort_order);
  const amounts = computeMilestoneAmounts(
    total,
    ordered.map((m) => m.percentage)
  );

  return ordered.map((m, i) => {
    const paidAmount = payments
      .filter((p) => p.milestone_id === m.id)
      .reduce((sum, p) => sum + p.amount, 0);
    const amount = amounts[i];
    const status: MilestoneView["status"] =
      toCents(paidAmount) <= 0
        ? "unpaid"
        : toCents(paidAmount) >= toCents(amount) - 1
          ? "paid"
          : "partial";
    return {
      id: m.id,
      name: m.name,
      percentage: m.percentage,
      sortOrder: m.sort_order,
      amount,
      paidAmount,
      status,
    };
  });
}

/**
 * Guards for replacing a schedule. `current` is the existing derived view
 * (payments included). Returns human-readable errors; empty = valid.
 */
export function validateSchedule(
  input: MilestoneInput[],
  current: MilestoneView[]
): string[] {
  const errors: string[] = [];

  if (input.length === 0) {
    errors.push("Schedule needs at least one milestone");
    return errors;
  }

  input.forEach((m, i) => {
    if (!m.name.trim()) errors.push(`Milestone ${i + 1} needs a name`);
    if (!(m.percentage > 0 && m.percentage <= 100)) {
      errors.push(`Milestone ${i + 1}: percentage must be between 0 and 100`);
    }
  });

  const sum = input.reduce((s, m) => s + m.percentage, 0);
  if (Math.abs(sum - 100) > 0.001) {
    errors.push(`Percentages must sum to 100 (currently ${sum})`);
  }

  const currentById = new Map(current.map((m) => [m.id, m]));
  const keptIds = new Set(input.filter((m) => m.id).map((m) => m.id as string));

  // A milestone with payments cannot be deleted
  for (const m of current) {
    if (m.paidAmount > 0 && !keptIds.has(m.id)) {
      errors.push(`"${m.name}" has recorded payments and cannot be removed`);
    }
  }

  // Quote total = sum of current milestone amounts. This is EXACT
  // (computeMilestoneAmounts guarantees amounts sum to the true total);
  // back-solving from one rounded row's amount/pct drifts by cents.
  const total = current.reduce((sum, m) => sum + m.amount, 0);
  const newAmounts = computeMilestoneAmounts(
    total,
    input.map((m) => m.percentage)
  );

  // A kept milestone's new amount may not drop below what's already paid
  input.forEach((m, i) => {
    if (!m.id) return;
    const existing = currentById.get(m.id);
    if (existing && toCents(newAmounts[i]) < toCents(existing.paidAmount) - 1) {
      errors.push(
        `"${m.name}": new amount is below the amount already paid against it`
      );
    }
  });

  return errors;
}
```

- [ ] **Step 3: Write `scripts/check-payment-schedule.ts`**

```typescript
/**
 * Ad-hoc checks for lib/payment-schedule (no test framework in repo).
 * Run: npx tsx scripts/check-payment-schedule.ts
 */
import {
  computeMilestoneAmounts,
  deriveMilestoneViews,
  validateSchedule,
  DEFAULT_SCHEDULE,
} from "../lib/payment-schedule";
import type { PaymentMilestone, QuotePayment } from "../types/database";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    failures++;
    console.error("FAIL:", name);
  }
}

// rounding: 10/30/30/30 of an awkward total sums exactly
{
  const amounts = computeMilestoneAmounts(6973.09, [10, 30, 30, 30]);
  const sum = amounts.reduce((s, a) => s + Math.round(a * 100), 0);
  check("amounts sum to total", sum === 697309);
  check("deposit is 10%", amounts[0] === 697.31);
}

// last milestone absorbs remainder on a 3-way split
{
  const amounts = computeMilestoneAmounts(100, [33.33, 33.33, 33.34]);
  const sum = amounts.reduce((s, a) => s + Math.round(a * 100), 0);
  check("3-way split sums to 100.00", sum === 10000);
}

const mk = (id: string, pct: number, sort: number): PaymentMilestone => ({
  id,
  quote_id: "q1",
  user_id: "u1",
  name: id,
  percentage: pct,
  sort_order: sort,
});
const pay = (milestoneId: string, amount: number): QuotePayment => ({
  id: `p-${milestoneId}-${amount}`,
  quote_id: "q1",
  milestone_id: milestoneId,
  user_id: "u1",
  amount,
  paid_at: "2026-07-12",
  method: null,
  note: null,
  receipt_sent_at: null,
  receipt_sent_count: 0,
  created_at: new Date(),
});

// status derivation: unpaid / partial / paid (±1¢)
{
  const ms = [mk("a", 10, 0), mk("b", 90, 1)];
  const views = deriveMilestoneViews(ms, [pay("a", 50), pay("b", 900)], 1000);
  check("partial milestone", views[0].status === "partial");
  check("paid milestone", views[1].status === "paid");
  const none = deriveMilestoneViews(ms, [], 1000);
  check("unpaid milestone", none[0].status === "unpaid");
}

// guards
{
  const ms = [mk("a", 10, 0), mk("b", 90, 1)];
  const views = deriveMilestoneViews(ms, [pay("a", 100)], 1000);

  check(
    "sum must be 100",
    validateSchedule(
      [{ id: "a", name: "a", percentage: 50, sortOrder: 0 }],
      views
    ).some((e) => e.includes("sum to 100"))
  );

  check(
    "cannot remove paid milestone",
    validateSchedule(
      [{ id: "b", name: "b", percentage: 100, sortOrder: 0 }],
      views
    ).some((e) => e.includes("cannot be removed"))
  );

  check(
    "cannot shrink below paid amount",
    validateSchedule(
      [
        { id: "a", name: "a", percentage: 5, sortOrder: 0 },
        { id: "b", name: "b", percentage: 95, sortOrder: 1 },
      ],
      views
    ).some((e) => e.includes("below the amount already paid"))
  );

  check(
    "valid edit passes",
    validateSchedule(
      [
        { id: "a", name: "Deposit", percentage: 20, sortOrder: 0 },
        { id: "b", name: "Rest", percentage: 80, sortOrder: 1 },
      ],
      views
    ).length === 0
  );
}

check("default schedule sums to 100",
  DEFAULT_SCHEDULE.reduce((s, m) => s + m.percentage, 0) === 100);

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("ALL PASS");
```

- [ ] **Step 4: Run the check script — expect it to fail before the lib exists, pass after**

```bash
npx tsx scripts/check-payment-schedule.ts
```

Expected: `ALL PASS`. Then:

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add types/database.ts lib/payment-schedule.ts scripts/check-payment-schedule.ts
git commit -m "feat(payments): schedule types and pure milestone logic"
```

---

### Task 3: Repository `lib/db/payments.ts`

**Files:**
- Create: `lib/db/payments.ts`
- Modify: `lib/db/index.ts` (re-export, follow the existing barrel pattern)

**Interfaces:**
- Consumes: `supabaseAdmin` from `lib/db/core`, types from Task 2, `DEFAULT_SCHEDULE` and `MilestoneInput` from `lib/payment-schedule`.
- Produces:
  - `getMilestones(quoteId: string, userId: string): Promise<PaymentMilestone[]>`
  - `ensureDefaultSchedule(quoteId: string, userId: string): Promise<PaymentMilestone[]>` — idempotent lazy backfill
  - `replaceSchedule(quoteId: string, userId: string, input: MilestoneInput[]): Promise<PaymentMilestone[]>` — diff (update kept ids, insert new, delete missing)
  - `getPayments(quoteId: string, userId: string): Promise<QuotePayment[]>`
  - `recordPayment(quoteId: string, userId: string, input: { milestoneId: string; amount: number; paidAt?: string; method?: PaymentMethod; note?: string }): Promise<QuotePayment>`
  - `deletePayment(quoteId: string, userId: string, paymentId: string): Promise<void>`
  - `markPaymentReceiptSent(paymentId: string, userId: string): Promise<void>`

- [ ] **Step 1: Write `lib/db/payments.ts`**

```typescript
/**
 * Payments Repository
 *
 * Milestone schedules and recorded payments. quotes.amount_paid/is_paid
 * are maintained by DB trigger — never written here.
 *
 * @module lib/db/payments
 */

import { supabaseAdmin } from "./core";
import { DEFAULT_SCHEDULE, type MilestoneInput } from "@/lib/payment-schedule";
import { NotFoundError } from "@/types/database";
import type {
  PaymentMilestone,
  PaymentMilestoneRow,
  PaymentMethod,
  QuotePayment,
  QuotePaymentRow,
} from "@/types/database";

function transformMilestone(row: PaymentMilestoneRow): PaymentMilestone {
  return {
    id: row.id,
    quote_id: row.quote_id,
    user_id: row.user_id,
    name: row.name,
    percentage: parseFloat(row.percentage?.toString() || "0"),
    sort_order: row.sort_order,
  };
}

function transformPayment(row: QuotePaymentRow): QuotePayment {
  return {
    ...row,
    amount: parseFloat(row.amount?.toString() || "0"),
  };
}

export async function getMilestones(
  quoteId: string,
  userId: string
): Promise<PaymentMilestone[]> {
  const { data, error } = await supabaseAdmin
    .from("payment_milestones")
    .select("*")
    .eq("quote_id", quoteId)
    .eq("user_id", userId)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data as PaymentMilestoneRow[]).map(transformMilestone);
}

/**
 * Lazy backfill: quotes created before split payments get the default
 * 10/30/30/30 schedule on first read. Idempotent.
 */
export async function ensureDefaultSchedule(
  quoteId: string,
  userId: string
): Promise<PaymentMilestone[]> {
  const existing = await getMilestones(quoteId, userId);
  if (existing.length > 0) return existing;

  const { data, error } = await supabaseAdmin
    .from("payment_milestones")
    .insert(
      DEFAULT_SCHEDULE.map((m, i) => ({
        quote_id: quoteId,
        user_id: userId,
        name: m.name,
        percentage: m.percentage,
        sort_order: i,
      }))
    )
    .select();

  if (error) throw error;
  return (data as PaymentMilestoneRow[]).map(transformMilestone);
}

/**
 * Replace the schedule as a diff: update rows whose id is kept, insert
 * rows without id, delete rows no longer present. Guards (sum=100, paid
 * milestones kept, amounts not below paid) are validated by the caller
 * with validateSchedule() BEFORE calling this.
 */
export async function replaceSchedule(
  quoteId: string,
  userId: string,
  input: MilestoneInput[]
): Promise<PaymentMilestone[]> {
  const existing = await getMilestones(quoteId, userId);
  const keptIds = new Set(input.filter((m) => m.id).map((m) => m.id as string));

  const toDelete = existing.filter((m) => !keptIds.has(m.id)).map((m) => m.id);
  if (toDelete.length > 0) {
    const { error } = await supabaseAdmin
      .from("payment_milestones")
      .delete()
      .in("id", toDelete)
      .eq("quote_id", quoteId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  for (const m of input) {
    if (m.id) {
      const { error } = await supabaseAdmin
        .from("payment_milestones")
        .update({ name: m.name, percentage: m.percentage, sort_order: m.sortOrder })
        .eq("id", m.id)
        .eq("quote_id", quoteId)
        .eq("user_id", userId);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from("payment_milestones").insert({
        quote_id: quoteId,
        user_id: userId,
        name: m.name,
        percentage: m.percentage,
        sort_order: m.sortOrder,
      });
      if (error) throw error;
    }
  }

  return getMilestones(quoteId, userId);
}

export async function getPayments(
  quoteId: string,
  userId: string
): Promise<QuotePayment[]> {
  const { data, error } = await supabaseAdmin
    .from("quote_payments")
    .select("*")
    .eq("quote_id", quoteId)
    .eq("user_id", userId)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as QuotePaymentRow[]).map(transformPayment);
}

export async function recordPayment(
  quoteId: string,
  userId: string,
  input: {
    milestoneId: string;
    amount: number;
    paidAt?: string;
    method?: PaymentMethod;
    note?: string;
  }
): Promise<QuotePayment> {
  // Milestone must belong to this quote and user
  const { data: milestone } = await supabaseAdmin
    .from("payment_milestones")
    .select("id")
    .eq("id", input.milestoneId)
    .eq("quote_id", quoteId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!milestone) {
    throw new NotFoundError("Milestone not found", "PaymentMilestone", input.milestoneId);
  }

  const { data, error } = await supabaseAdmin
    .from("quote_payments")
    .insert({
      quote_id: quoteId,
      milestone_id: input.milestoneId,
      user_id: userId,
      amount: input.amount,
      paid_at: input.paidAt ?? new Date().toISOString().slice(0, 10),
      method: input.method ?? null,
      note: input.note ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return transformPayment(data as QuotePaymentRow);
}

export async function deletePayment(
  quoteId: string,
  userId: string,
  paymentId: string
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("quote_payments")
    .delete()
    .eq("id", paymentId)
    .eq("quote_id", quoteId)
    .eq("user_id", userId)
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new NotFoundError("Payment not found", "QuotePayment", paymentId);
  }
}

export async function markPaymentReceiptSent(
  paymentId: string,
  userId: string
): Promise<void> {
  const { data: current, error: fetchError } = await supabaseAdmin
    .from("quote_payments")
    .select("receipt_sent_count")
    .eq("id", paymentId)
    .eq("user_id", userId)
    .single();

  if (fetchError) throw fetchError;

  const { error } = await supabaseAdmin
    .from("quote_payments")
    .update({
      receipt_sent_at: new Date().toISOString(),
      receipt_sent_count: (current?.receipt_sent_count ?? 0) + 1,
    })
    .eq("id", paymentId)
    .eq("user_id", userId);

  if (error) throw error;
}
```

- [ ] **Step 2: Re-export in `lib/db/index.ts`** — open the file, follow its existing pattern (named re-exports per module), add:

```typescript
export * from "./payments";
```

- [ ] **Step 3: Verify** — `npm run type-check` clean. Smoke the repo against the live DB:

```bash
npx tsx -e "
import { ensureDefaultSchedule, getMilestones } from './lib/db/payments';
(async () => {
  const ms = await ensureDefaultSchedule('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
  console.log('milestones:', ms.length, ms.map(m => m.percentage).join('/'));
  const again = await ensureDefaultSchedule('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
  console.log('idempotent:', again.length === 4);
})();
"
```

Expected: `milestones: 4 10/30/30/30`, `idempotent: true`. (Needs `.env.local` loaded — if the script can't see SUPABASE env vars, prefix with `npx dotenv -e .env.local --` or export them.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/payments.ts lib/db/index.ts
git commit -m "feat(payments): milestones/payments repository"
```

---

### Task 4: API routes — milestones and payments

**Files:**
- Create: `app/api/quotes/[id]/milestones/route.ts`
- Create: `app/api/quotes/[id]/payments/route.ts`
- Create: `app/api/quotes/[id]/payments/[paymentId]/route.ts`

**Interfaces:**
- Consumes: Task 3 repo functions; `getQuote` from `lib/db/quotes`; `deriveMilestoneViews`, `validateSchedule` from `lib/payment-schedule`; `parseJsonBody` from `lib/api-validation`; `getCurrentUser` from `lib/auth`.
- Produces:
  - `GET /api/quotes/[id]/milestones` → `{ success, milestones: MilestoneView[] }`
  - `PUT /api/quotes/[id]/milestones` body `{ milestones: MilestoneInput[] }` → 200 `{ success, milestones: MilestoneView[] }` or 422 `{ success:false, code:"SCHEDULE_INVALID", details:[{path:"schedule",message}] }`
  - `GET /api/quotes/[id]/payments` → `{ success, payments: QuotePayment[] }`
  - `POST /api/quotes/[id]/payments` body `{ milestoneId, amount, paidAt?, method?, note? }` → `{ success, payment }`
  - `DELETE /api/quotes/[id]/payments/[paymentId]` → `{ success }`

- [ ] **Step 1: Write `app/api/quotes/[id]/milestones/route.ts`**

```typescript
/**
 * Milestones Route
 *
 * GET /api/quotes/[id]/milestones - Derived schedule (amounts, paid, status)
 * PUT /api/quotes/[id]/milestones - Replace the schedule (guarded)
 *
 * @module api/quotes/milestones
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { getQuote } from "@/lib/db/quotes";
import {
  ensureDefaultSchedule,
  replaceSchedule,
  getPayments,
} from "@/lib/db/payments";
import { deriveMilestoneViews, validateSchedule } from "@/lib/payment-schedule";

const putSchema = z.object({
  milestones: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(255),
        percentage: z.number().gt(0).max(100),
        sortOrder: z.number().int().min(0),
      })
    )
    .min(1)
    .max(20),
});

async function loadViews(quoteId: string, userId: string) {
  const quote = await getQuote(quoteId, userId);
  if (!quote) return null;
  const [milestones, payments] = await Promise.all([
    ensureDefaultSchedule(quoteId, userId),
    getPayments(quoteId, userId),
  ]);
  return { quote, milestones, payments };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const loaded = await loadViews(params.id, user.id);
    if (!loaded) {
      return NextResponse.json(
        { success: false, message: "Quote not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      milestones: deriveMilestoneViews(
        loaded.milestones,
        loaded.payments,
        loaded.quote.total
      ),
    });
  } catch (error) {
    console.error("[API] Milestones load error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to load schedule", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const parsed = await parseJsonBody(request, putSchema);
    if (parsed.response) return parsed.response;

    const loaded = await loadViews(params.id, user.id);
    if (!loaded) {
      return NextResponse.json(
        { success: false, message: "Quote not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const currentViews = deriveMilestoneViews(
      loaded.milestones,
      loaded.payments,
      loaded.quote.total
    );
    const errors = validateSchedule(parsed.data.milestones, currentViews);
    if (errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Schedule is invalid",
          code: "SCHEDULE_INVALID",
          details: errors.map((message) => ({ path: "schedule", message })),
        },
        { status: 422 }
      );
    }

    const updated = await replaceSchedule(params.id, user.id, parsed.data.milestones);
    return NextResponse.json({
      success: true,
      milestones: deriveMilestoneViews(updated, loaded.payments, loaded.quote.total),
    });
  } catch (error) {
    console.error("[API] Milestones update error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to update schedule", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Write `app/api/quotes/[id]/payments/route.ts`**

```typescript
/**
 * Payments Route
 *
 * GET  /api/quotes/[id]/payments - Recorded payments (newest first)
 * POST /api/quotes/[id]/payments - Record a payment against a milestone
 *
 * @module api/quotes/payments
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { getQuote } from "@/lib/db/quotes";
import { getPayments, recordPayment } from "@/lib/db/payments";
import { NotFoundError } from "@/types/database";

const postSchema = z.object({
  milestoneId: z.string().uuid(),
  amount: z.number().gt(0).max(99999999),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  method: z.enum(["cash", "check", "zelle", "other"]).optional(),
  note: z.string().max(500).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const quote = await getQuote(params.id, user.id);
    if (!quote) {
      return NextResponse.json(
        { success: false, message: "Quote not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      payments: await getPayments(params.id, user.id),
    });
  } catch (error) {
    console.error("[API] Payments load error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to load payments", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const parsed = await parseJsonBody(request, postSchema);
    if (parsed.response) return parsed.response;

    const quote = await getQuote(params.id, user.id);
    if (!quote) {
      return NextResponse.json(
        { success: false, message: "Quote not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const payment = await recordPayment(params.id, user.id, parsed.data);
    return NextResponse.json({ success: true, payment }, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    console.error("[API] Payment record error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to record payment", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Write `app/api/quotes/[id]/payments/[paymentId]/route.ts`**

```typescript
/**
 * Payment Route
 *
 * DELETE /api/quotes/[id]/payments/[paymentId] - Remove a mistaken payment.
 * The DB trigger recomputes amount_paid/is_paid.
 *
 * @module api/quotes/payments/payment
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deletePayment } from "@/lib/db/payments";
import { NotFoundError } from "@/types/database";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; paymentId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    await deletePayment(params.id, user.id, params.paymentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    console.error("[API] Payment delete error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to delete payment", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Verify against dev server** (server running via `npm run dev`; auth from `e2e/.auth/user.json`)

```bash
npx tsx -e "
import { chromium } from '@playwright/test';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ storageState: 'e2e/.auth/user.json' });
  const base = 'http://localhost:3000/api/quotes/20000000-0000-0000-0000-000000000002';

  const ms = await (await p.request.get(base + '/milestones')).json();
  console.log('milestones:', ms.milestones.length, ms.milestones[0].status);

  const bad = await p.request.put(base + '/milestones', { data: { milestones: [
    { name: 'Only', percentage: 50, sortOrder: 0 } ] } });
  console.log('bad schedule status:', bad.status());

  const rec = await p.request.post(base + '/payments', { data: {
    milestoneId: ms.milestones[0].id, amount: 100.00, method: 'check', note: 'plan-verify' } });
  const recJson = await rec.json();
  console.log('record:', rec.status(), recJson.payment?.amount);

  const del = await p.request.delete(base + '/payments/' + recJson.payment.id);
  console.log('delete:', del.status());
  await b.close();
})();
"
```

Expected: `milestones: 4 unpaid`, `bad schedule status: 422`, `record: 201 100`, `delete: 200`. Then `npm run type-check` + `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add "app/api/quotes/[id]/milestones" "app/api/quotes/[id]/payments"
git commit -m "feat(api): milestone schedule and payment recording routes"
```

---

### Task 5: Default schedule on quote creation

**Files:**
- Modify: `app/api/quotes/route.ts` (POST handler — after `createQuote` succeeds)

**Interfaces:**
- Consumes: `ensureDefaultSchedule` (Task 3).
- Produces: every new quote has the 10/30/30/30 schedule immediately.

- [ ] **Step 1: Locate the POST handler in `app/api/quotes/route.ts`.** After the quote (and its line items) are created and before the success response, add:

```typescript
    // Every quote carries a payment schedule from birth (default split);
    // older quotes are backfilled lazily by ensureDefaultSchedule on read
    await ensureDefaultSchedule(quote.id, user.id);
```

with import `import { ensureDefaultSchedule } from "@/lib/db/payments";`. Match the surrounding variable name for the created quote (read the file first — it may be `quote`, `created`, etc.).

- [ ] **Step 2: Verify** — create a quote through the UI or POST /api/quotes with an existing contact, then:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
 "SELECT q.quote_number, COUNT(m.id) FROM quotes q JOIN payment_milestones m ON m.quote_id=q.id GROUP BY 1 ORDER BY 1 DESC LIMIT 3;"
```

Expected: newest quote shows 4 milestones. `npm run type-check` clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/quotes/route.ts
git commit -m "feat(quotes): default payment schedule on creation"
```

---

### Task 6: Quote page UI — schedule card, record payment, history

**Files:**
- Create: `components/quote/PaymentScheduleCard.tsx`
- Create: `components/quote/EditScheduleDialog.tsx`
- Create: `components/quote/RecordPaymentDialog.tsx`
- Create: `components/quote/PaymentHistoryCard.tsx`
- Modify: `app/quote/[id]/page.tsx`

**Interfaces:**
- Consumes: `MilestoneView` (Task 2), routes (Task 4), `formatCurrency` from `lib/quote-calculations`, `formatDate` from `lib/utils`, shadcn `Dialog`/`Button`/`Input`/`Label`, `QuotePayment` type.
- Produces (props):
  - `PaymentScheduleCard { quoteId: string; milestones: MilestoneView[]; total: number; amountPaid: number }`
  - `EditScheduleDialog { open; onOpenChange; quoteId: string; milestones: MilestoneView[]; total: number }`
  - `RecordPaymentDialog { open; onOpenChange; quoteId: string; milestone: MilestoneView | null }`
  - `PaymentHistoryCard { quoteId: string; payments: QuotePayment[]; milestones: MilestoneView[]; recipientEmail?: string }`
- All dialogs `router.refresh()` on success. Every interactive element carries a `data-testid` (listed in code).

- [ ] **Step 1: Write `components/quote/RecordPaymentDialog.tsx`**

```tsx
"use client";

/**
 * Record Payment Dialog
 *
 * Records a payment against one milestone. Amount prefills with the
 * milestone remainder but is editable (partial payments allowed).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/quote-calculations";
import type { MilestoneView } from "@/lib/payment-schedule";

const METHODS = ["cash", "check", "zelle", "other"] as const;

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  milestone: MilestoneView | null;
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  quoteId,
  milestone,
}: RecordPaymentDialogProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [method, setMethod] = useState<string>("check");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && milestone) {
      const remainder = Math.max(milestone.amount - milestone.paidAmount, 0);
      setAmount(remainder.toFixed(2));
      setPaidAt(new Date().toISOString().slice(0, 10));
      setMethod("check");
      setNote("");
      setError(null);
    }
  }, [open, milestone]);

  const save = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotes/${quoteId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          milestoneId: milestone!.id,
          amount: value,
          paidAt,
          method,
          note: note.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to record payment");
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  if (!milestone) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="record-payment-dialog">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            {milestone.name} — {formatCurrency(milestone.amount)} planned,{" "}
            {formatCurrency(milestone.paidAmount)} received so far.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="payment-amount">Amount</Label>
            <Input
              id="payment-amount"
              type="number"
              inputMode="decimal"
              min={0.01}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="payment-amount-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment-date">Date received</Label>
            <Input
              id="payment-date"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              data-testid="payment-date-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment-method">Method</Label>
            <select
              id="payment-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              data-testid="payment-method-select"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment-note">Note (optional)</Label>
            <Input
              id="payment-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Check #1042"
              maxLength={500}
              data-testid="payment-note-input"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert" aria-live="polite">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} data-testid="payment-save">
            {saving ? "Recording…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write `components/quote/EditScheduleDialog.tsx`**

```tsx
"use client";

/**
 * Edit Schedule Dialog
 *
 * Edits milestone names/percentages. Live sum indicator; server re-validates
 * (sum=100, paid milestones kept, amounts not below paid).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import type { MilestoneView } from "@/lib/payment-schedule";

interface Row {
  id?: string;
  name: string;
  percentage: string; // string while editing
  paidAmount: number;
}

interface EditScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  milestones: MilestoneView[];
}

export function EditScheduleDialog({
  open,
  onOpenChange,
  quoteId,
  milestones,
}: EditScheduleDialogProps) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setRows(
        milestones.map((m) => ({
          id: m.id,
          name: m.name,
          percentage: String(m.percentage),
          paidAmount: m.paidAmount,
        }))
      );
      setErrors([]);
    }
  }, [open, milestones]);

  const sum = rows.reduce((s, r) => s + (Number(r.percentage) || 0), 0);

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const response = await fetch(`/api/quotes/${quoteId}/milestones`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          milestones: rows.map((r, i) => ({
            id: r.id,
            name: r.name.trim(),
            percentage: Number(r.percentage),
            sortOrder: i,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setErrors(
          data.details?.map((d: { message: string }) => d.message) ?? [
            data.message || "Failed to save schedule",
          ]
        );
        return;
      }
      onOpenChange(false);
      router.refresh();
    } catch {
      setErrors(["Failed to save schedule"]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="edit-schedule-dialog">
        <DialogHeader>
          <DialogTitle>Payment Schedule</DialogTitle>
          <DialogDescription>
            Percentages must add up to 100. Milestones with payments can't be
            removed or shrunk below what's been paid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {rows.map((row, i) => (
            <div key={row.id ?? `new-${i}`} className="flex items-center gap-2">
              <Input
                value={row.name}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                }
                placeholder="Milestone name"
                className="flex-1"
                data-testid={`milestone-name-${i}`}
              />
              <Input
                type="number"
                inputMode="decimal"
                min={0.01}
                max={100}
                step={0.01}
                value={row.percentage}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r, j) => (j === i ? { ...r, percentage: e.target.value } : r))
                  )
                }
                className="w-24 text-right"
                aria-label={`Milestone ${i + 1} percentage`}
                data-testid={`milestone-pct-${i}`}
              />
              <span className="text-sm text-muted-foreground">%</span>
              <Button
                variant="ghost"
                size="sm"
                className="px-2"
                disabled={row.paidAmount > 0}
                title={row.paidAmount > 0 ? "Has payments — cannot remove" : "Remove"}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                aria-label={`Remove milestone ${i + 1}`}
                data-testid={`milestone-remove-${i}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}

          <div className="flex items-center justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((rs) => [...rs, { name: "", percentage: "", paidAmount: 0 }])
              }
              data-testid="milestone-add"
            >
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Add milestone
            </Button>
            <span
              className={`text-sm ${Math.abs(sum - 100) < 0.001 ? "text-muted-foreground" : "text-destructive"}`}
              data-testid="schedule-sum"
            >
              Total: {sum}%
            </span>
          </div>
        </div>

        {errors.length > 0 && (
          <ul className="space-y-1 text-sm text-destructive" role="alert">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} data-testid="schedule-save">
            {saving ? "Saving…" : "Save Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Write `components/quote/PaymentScheduleCard.tsx`**

```tsx
"use client";

/**
 * Payment Schedule Card
 *
 * The planned split with per-milestone progress and Record payment entry
 * points. Amounts derive from the quote total — figures always match.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil } from "lucide-react";
import { formatCurrency } from "@/lib/quote-calculations";
import { EditScheduleDialog } from "@/components/quote/EditScheduleDialog";
import { RecordPaymentDialog } from "@/components/quote/RecordPaymentDialog";
import type { MilestoneView } from "@/lib/payment-schedule";

const STATUS_LABEL: Record<MilestoneView["status"], string> = {
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
};

interface PaymentScheduleCardProps {
  quoteId: string;
  milestones: MilestoneView[];
  total: number;
  amountPaid: number;
}

export function PaymentScheduleCard({
  quoteId,
  milestones,
  total,
  amountPaid,
}: PaymentScheduleCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [recording, setRecording] = useState<MilestoneView | null>(null);

  const remaining = Math.max(total - amountPaid, 0);

  return (
    <Card className="mb-8" data-testid="payment-schedule-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="font-display uppercase tracking-wide">
          Payment Schedule
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditOpen(true)}
          data-testid="edit-schedule-button"
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Edit Schedule
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {milestones.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0"
              data-testid={`milestone-row-${m.sortOrder}`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{m.name}</p>
                <p className="text-sm text-muted-foreground">
                  {m.percentage}% · <span className="figure">{formatCurrency(m.amount)}</span>
                  {m.paidAmount > 0 && m.status !== "paid" && (
                    <> · {formatCurrency(m.paidAmount)} received</>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`stamp ${m.status === "paid" ? "stamp-paid" : "stamp-unpaid"}`}
                  data-testid={`milestone-status-${m.sortOrder}`}
                >
                  {STATUS_LABEL[m.status]}
                </span>
                {m.status !== "paid" && (
                  <Button
                    size="sm"
                    onClick={() => setRecording(m)}
                    data-testid={`record-payment-${m.sortOrder}`}
                  >
                    Record Payment
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end border-t-2 border-primary pt-3 text-sm">
          <div className="w-64 space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Received</span>
              <span className="figure">{formatCurrency(amountPaid)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span className="font-display uppercase tracking-wide">Balance Due</span>
              <span className="figure" data-testid="balance-due">
                {formatCurrency(remaining)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>

      <EditScheduleDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        quoteId={quoteId}
        milestones={milestones}
      />
      <RecordPaymentDialog
        open={recording !== null}
        onOpenChange={(open) => !open && setRecording(null)}
        quoteId={quoteId}
        milestone={recording}
      />
    </Card>
  );
}
```

- [ ] **Step 4: Write `components/quote/PaymentHistoryCard.tsx`** (receipt send wired in Task 7 — the button posts to the route created there)

```tsx
"use client";

/**
 * Payment History Card
 *
 * Recorded payments with per-payment receipt sending and delete (undo).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Receipt, Trash2, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/quote-calculations";
import { formatDate } from "@/lib/utils";
import type { QuotePayment } from "@/types/database";
import type { MilestoneView } from "@/lib/payment-schedule";

interface PaymentHistoryCardProps {
  quoteId: string;
  payments: QuotePayment[];
  milestones: MilestoneView[];
  recipientEmail?: string;
}

export function PaymentHistoryCard({
  quoteId,
  payments,
  milestones,
  recipientEmail,
}: PaymentHistoryCardProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const milestoneName = (id: string) =>
    milestones.find((m) => m.id === id)?.name ?? "—";

  if (payments.length === 0) return null;

  const sendReceipt = async (paymentId: string) => {
    setBusyId(paymentId);
    setError(null);
    try {
      const response = await fetch(
        `/api/quotes/${quoteId}/payments/${paymentId}/receipt`,
        { method: "POST" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to send receipt");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send receipt");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (paymentId: string) => {
    setBusyId(paymentId);
    setError(null);
    try {
      const response = await fetch(
        `/api/quotes/${quoteId}/payments/${paymentId}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to delete payment");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete payment");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="mb-8" data-testid="payment-history-card">
      <CardHeader>
        <CardTitle className="font-display uppercase tracking-wide">
          Payments Received
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-primary text-left">
                <th className="eyebrow pb-2">Date</th>
                <th className="eyebrow pb-2">Milestone</th>
                <th className="eyebrow pb-2">Method</th>
                <th className="eyebrow pb-2">Note</th>
                <th className="eyebrow pb-2 text-right">Amount</th>
                <th className="eyebrow pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="ledger-row" data-testid={`payment-row-${p.id}`}>
                  <td className="py-2">{formatDate(p.paid_at)}</td>
                  <td className="py-2">{milestoneName(p.milestone_id)}</td>
                  <td className="py-2 capitalize">{p.method ?? "—"}</td>
                  <td className="max-w-40 truncate py-2 text-muted-foreground">
                    {p.note ?? ""}
                  </td>
                  <td className="figure py-2 text-right font-medium">
                    {formatCurrency(p.amount)}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        disabled={busyId === p.id || !recipientEmail}
                        title={
                          !recipientEmail
                            ? "No client email on file"
                            : p.receipt_sent_count > 0
                              ? `Receipt sent ${p.receipt_sent_count}× — send again`
                              : "Send receipt"
                        }
                        onClick={() => sendReceipt(p.id)}
                        aria-label="Send receipt for this payment"
                        data-testid={`send-payment-receipt-${p.id}`}
                      >
                        {busyId === p.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Receipt
                            className={`h-4 w-4 ${p.receipt_sent_count > 0 ? "text-green-600" : ""}`}
                            aria-hidden="true"
                          />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2 text-destructive"
                        disabled={busyId === p.id}
                        onClick={() => remove(p.id)}
                        aria-label="Delete this payment"
                        data-testid={`delete-payment-${p.id}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && (
          <p className="mt-3 text-sm text-destructive" role="alert" aria-live="polite">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Wire into `app/quote/[id]/page.tsx`**

After the existing `lineItems` fetch add:

```typescript
import { ensureDefaultSchedule, getPayments } from "@/lib/db/payments";
import { deriveMilestoneViews } from "@/lib/payment-schedule";
import { PaymentScheduleCard } from "@/components/quote/PaymentScheduleCard";
import { PaymentHistoryCard } from "@/components/quote/PaymentHistoryCard";
```

```typescript
  const [milestones, payments] = await Promise.all([
    ensureDefaultSchedule(params.id, user.id),
    getPayments(params.id, user.id),
  ]);
  const milestoneViews = deriveMilestoneViews(milestones, payments, quote.total);
```

Replace the header status badge span (`data-testid="quote-status-badge"`) content with three-state:

```tsx
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
```

Render after the Line Items card:

```tsx
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
```

- [ ] **Step 6: Verify in browser** (`npm run dev` running)

```bash
npx tsx -e "
import { chromium } from '@playwright/test';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ storageState: 'e2e/.auth/user.json' });
  await p.goto('http://localhost:3000/quote/20000000-0000-0000-0000-000000000002');
  await p.waitForSelector('[data-testid=payment-schedule-card]');
  await p.click('[data-testid=record-payment-0]');
  await p.waitForSelector('[data-testid=record-payment-dialog]');
  const prefill = await p.locator('[data-testid=payment-amount-input]').inputValue();
  console.log('prefill:', prefill);
  await p.click('[data-testid=payment-save]');
  await p.waitForSelector('[data-testid=payment-history-card]', { timeout: 8000 });
  console.log('badge:', await p.locator('[data-testid=quote-status-badge]').innerText());
  await b.close();
})();
"
```

Expected: prefill = the deposit amount (10% of total), badge shows `Partially Paid · $… due`. Then delete the test payment through the history card trash icon (or via psql). `npm run type-check` + `npm run lint` clean.

- [ ] **Step 7: Commit**

```bash
git add components/quote/PaymentScheduleCard.tsx components/quote/EditScheduleDialog.tsx components/quote/RecordPaymentDialog.tsx components/quote/PaymentHistoryCard.tsx "app/quote/[id]/page.tsx"
git commit -m "feat(ui): payment schedule, record payment, payment history on quote page"
```

---

### Task 7: Per-payment receipts

**Files:**
- Create: `app/api/quotes/[id]/payments/[paymentId]/receipt/route.ts`
- Modify: `lib/email-content.ts` (payment-aware receipt copy)
- Reference: `app/api/quotes/[id]/receipt/route.ts` (existing whole-quote receipt route — copy its structure; read it fully first)

**Interfaces:**
- Consumes: existing receipt route's send mechanics (`sendQuoteEmailWithRetry` with `headerLabel: "Payment Receipt"`), `buildQuotePdfPayload`, `markPaymentReceiptSent` + `getPayments` (Task 3), `deriveMilestoneViews` (Task 2).
- Produces: `POST /api/quotes/[id]/payments/[paymentId]/receipt` → `{ success, emailId }`; `buildPaymentReceiptEmailContent(quote, companyInfo, quoteNumber, payment: { amount: number; paidAt: string; milestoneName: string }, amountPaid: number): EmailContent` in `lib/email-content.ts`.

- [ ] **Step 1: Add to `lib/email-content.ts`** (below `buildReceiptEmailContent`, reusing its `signatureLines`)

```typescript
/**
 * Receipt copy for ONE recorded payment: the payment, the running total
 * received, and the remaining balance.
 */
export function buildPaymentReceiptEmailContent(
  quote: QuoteData,
  companyInfo: CompanyInfo,
  quoteNumber: string,
  payment: { amount: number; paidAt: string; milestoneName: string },
  amountPaid: number
): EmailContent {
  const firstName = quote.clientInfo.name.split(" ")[0] || "there";
  const paidDate = new Date(payment.paidAt + "T00:00:00").toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" }
  );
  const balance = Math.max(quote.total - amountPaid, 0);

  const balanceLine =
    balance <= 0
      ? `That completes payment in full — thanks for your business.`
      : `Received to date: ${formatCurrency(amountPaid)} of ${formatCurrency(quote.total)}. Remaining balance: ${formatCurrency(balance)}.`;

  const lines = [
    `Hi ${firstName},`,
    "",
    `We've received your payment of ${formatCurrency(payment.amount)} (${payment.milestoneName}) for quote ${quoteNumber} on ${paidDate}. A receipt is attached as a PDF for your records.`,
    "",
    balanceLine,
    "",
    ...signatureLines(companyInfo),
  ];

  return {
    subject: `Payment receipt — ${quoteNumber} from ${companyInfo.name}`,
    message: lines.join("\n"),
  };
}
```

- [ ] **Step 2: Write the route.** Read `app/api/quotes/[id]/receipt/route.ts` first and mirror its structure exactly (auth → fetch quote/line items → `buildQuotePdfPayload` → `sendQuoteEmailWithRetry` with `headerLabel`), with these differences:

  - Also load `getPayments(params.id, user.id)` and find `params.paymentId`; 404 if absent.
  - Resolve the milestone name via `ensureDefaultSchedule` + find by `payment.milestone_id`.
  - Recipient: quote's `recipient_email` ?? contact email; 400 `NO_RECIPIENT` if neither.
  - Content from `buildPaymentReceiptEmailContent(quoteData, companyInfo, quote.quote_number, { amount: payment.amount, paidAt: payment.paid_at, milestoneName }, quote.amount_paid)` passed as `customSubject`/`customMessage`, `headerLabel: "Payment Receipt"`.
  - On success: `await markPaymentReceiptSent(params.paymentId, user.id)` (do NOT bump the quote-level `receipt_sent_count` — per-payment tracking supersedes it).

- [ ] **Step 3: Verify** (RESEND_MOCK=1 in the dev server env, or accept a real send to the Resend owner address)

```bash
npx tsx -e "
import { chromium } from '@playwright/test';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ storageState: 'e2e/.auth/user.json' });
  const base = 'http://localhost:3000/api/quotes/20000000-0000-0000-0000-000000000002';
  const ms = await (await p.request.get(base + '/milestones')).json();
  const rec = await (await p.request.post(base + '/payments', { data: {
    milestoneId: ms.milestones[0].id, amount: 50 } })).json();
  const rcpt = await p.request.post(base + '/payments/' + rec.payment.id + '/receipt');
  console.log('receipt:', rcpt.status(), JSON.stringify(await rcpt.json()));
  await p.request.delete(base + '/payments/' + rec.payment.id);
  await b.close();
})();
"
```

Expected: `receipt: 200 {"success":true,...}` (mock) and `quote_payments.receipt_sent_count` incremented before the delete. `npm run type-check` clean.

- [ ] **Step 4: Commit**

```bash
git add lib/email-content.ts "app/api/quotes/[id]/payments/[paymentId]/receipt"
git commit -m "feat(receipts): per-payment receipt email with running balance"
```

---

### Task 8: Quote PDF shows the schedule; retire old paid-toggle flow

**Files:**
- Modify: `components/quote/QuotePDFDocument.tsx` (optional `scheduleLines?: string[]` prop rendered as a "Payment Schedule" section — read the file first and follow its section style)
- Modify: `lib/quote-pdf.ts` (thread `scheduleLines` through `generateQuotePDF`)
- Modify: `app/api/quotes/[id]/pdf/route.ts` and `app/api/send-quote/route.ts` (build `scheduleLines` from milestones)
- Modify: `components/quote/QuoteActionsMenu.tsx` (remove Mark paid/unpaid item, `PaymentStatusDialog`, and the quote-level Send receipt item — receipts are per-payment now; menu keeps Download PDF)
- Delete: `app/api/quotes/[id]/payment/route.ts`
- Modify: `lib/db/quotes.ts` (delete `setQuotePaid`; keep `getPaymentHistory` only if still referenced — otherwise delete it and its types imports)
- Modify: `components/contacts/ClientsTab.tsx` + `components/contacts/PaymentHistoryDialog.tsx` (history dialog fetches `GET /api/quotes/[id]/payments` and renders date/milestone/amount/method/note; ClientsTab drops the paid-toggle action and `PaymentStatusDialog` import — status text derives from quote `is_paid`/`amount_paid` already present in its data)
- Delete: `components/contacts/PaymentStatusDialog.tsx` (after all imports are gone)

**Interfaces:**
- Consumes: `deriveMilestoneViews` (Task 2), `ensureDefaultSchedule`/`getPayments` (Task 3).
- Produces: `generateQuotePDF(quote, companyInfo, quoteNumber, quoteDate, validUntil?, scheduleLines?)`. `scheduleLines` format: `"Deposit — 10% — $697.31"` per milestone.

- [ ] **Step 1: PDF.** In both PDF-producing routes, after loading milestones/payments build:

```typescript
    const scheduleLines = deriveMilestoneViews(milestones, payments, quote.total).map(
      (m) => `${m.name} — ${m.percentage}% — ${formatCurrency(m.amount)}`
    );
```

Pass through `generateQuotePDF(...)`; in `QuotePDFDocument` render a "Payment Schedule" block (one `<Text>` per line) between line items/totals and the terms section, only when `scheduleLines?.length`.

- [ ] **Step 1b: Receipt PDF context.** The per-payment receipt route (Task 7) also passes `scheduleLines`, with paid progress appended per milestone so the receipt shows payments to date:

```typescript
    const scheduleLines = deriveMilestoneViews(milestones, payments, quote.total).map(
      (m) =>
        `${m.name} — ${m.percentage}% — ${formatCurrency(m.amount)}` +
        (m.paidAmount > 0 ? ` — received ${formatCurrency(m.paidAmount)}` : "")
    );
```

- [ ] **Step 1c: Keep `is_paid` honest on tax edits.** `updateQuote` in `lib/db/quotes.ts` writes `total` directly when the tax rate or discount changes (its recompute block) — the payment-state trigger does not fire on that path. Extend that block:

```typescript
    updateData.tax_amount = taxAmount;
    const newTotal = current.subtotal + taxAmount - discount;
    updateData.total = newTotal;
    // total moved → derived paid state must move with it (the trigger
    // only fires on quote_payments / line-item changes)
    updateData.is_paid = current.amount_paid >= newTotal && newTotal > 0;
    updateData.paid_at =
      current.amount_paid >= newTotal && newTotal > 0
        ? (current.paid_at ?? new Date().toISOString())
        : null;
```

(`current` comes from the existing `getQuote` call in that block; `amount_paid` exists on `Quote` after Task 2.)

- [ ] **Step 2: Remove the toggle flow** as listed in Files. Grep to catch stragglers:

```bash
grep -rn "setQuotePaid\|PaymentStatusDialog\|quotes/\[id\]/payment\b\|/payment\"" app components lib --include="*.ts*"
```

Expected after edits: no hits (except `payments` routes). Delete `app/api/quotes/[id]/payment/route.ts` and `components/contacts/PaymentStatusDialog.tsx`.

- [ ] **Step 3: Verify** — `npm run type-check` + `npm run lint` clean; download a PDF and confirm the schedule section:

```bash
npx tsx -e "
import { chromium } from '@playwright/test';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ storageState: 'e2e/.auth/user.json' });
  const r = await p.request.get('http://localhost:3000/api/quotes/20000000-0000-0000-0000-000000000002/pdf');
  console.log('pdf:', r.status(), (await r.body()).length, 'bytes');
  await b.close();
})();
"
```

Expected: 200, non-trivial byte count. Open the PDF manually once to eyeball the schedule section.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(pdf): payment schedule on quote PDF; retire manual paid toggle"
```

---

### Task 9: e2e rework + seed data

**Files:**
- Modify: `e2e/clients.spec.ts` (paid-toggle tests → payments flow)
- Modify: any other spec asserting `quote-paid-toggle` / `quote-status-badge` semantics (grep first: `grep -rn "paid-toggle\|status-badge\|PaymentStatus" e2e/`)
- Modify: `db/seeds/dev_seed.sql` + `supabase/seed.sql`

**Interfaces:**
- Consumes: testids from Task 6 (`record-payment-0`, `payment-amount-input`, `payment-save`, `quote-status-badge`, `balance-due`, `edit-schedule-button`, `schedule-save`).

- [ ] **Step 1: Seed.** In `db/seeds/dev_seed.sql`:
  - After the quotes insert, add default milestones for all four seeded quotes (explicit UUIDs `60000000-…`, four rows each: Deposit 10 / Before construction starts 30 / During the work 30 / On completion 30, sort_order 0-3).
  - Replace the `payment_status_changes` insert with two `quote_payments` rows for the paid quote `20000000-…-0003`: a deposit payment (10% of its total) dated 9 days ago and a closing payment for the remainder dated 6 days ago (note `'Paid by check #2183'`) — compute amounts with a `SELECT total …` sub-select like the existing seed does for the closing payment amount: `total - ROUND(total * 0.10, 2)`.
  - Remove `is_paid`/`paid_at` literals from the quotes insert for quote 3 (set FALSE/NULL); the trigger derives them when the payments insert runs.
  - Mirror: `cp db/seeds/dev_seed.sql supabase/seed.sql`.

- [ ] **Step 2: Verify seed** — `supabase db reset`, then:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
 "SELECT quote_number, is_paid, amount_paid, total FROM quotes ORDER BY quote_number;"
```

Expected: quote 903 `is_paid = t` with `amount_paid = total`; others `f` / 0.

- [ ] **Step 3: Rewrite `e2e/clients.spec.ts`.** Keep the existing setup test (create client + quote). Replace the three payment tests with:

```typescript
  test("record a partial payment from the schedule", async ({ page }) => {
    await page.goto(quoteUrl); // pattern from the existing spec's shared state
    await page.click('[data-testid="record-payment-0"]');
    await page.waitForSelector('[data-testid="record-payment-dialog"]');
    await page.fill('[data-testid="payment-note-input"]', "deposit check #77");
    await page.click('[data-testid="payment-save"]');
    await expect(page.locator('[data-testid="quote-status-badge"]')).toContainText(
      "Partially Paid"
    );
    await expect(
      page.locator('[data-testid="milestone-status-0"]')
    ).toContainText("Paid");
  });

  test("covering the balance marks the quote paid", async ({ page }) => {
    await page.goto(quoteUrl);
    // record remaining milestones (1..3) at their prefilled amounts
    for (const i of [1, 2, 3]) {
      await page.click(`[data-testid="record-payment-${i}"]`);
      await page.waitForSelector('[data-testid="record-payment-dialog"]');
      await page.click('[data-testid="payment-save"]');
      await page.waitForSelector('[data-testid="record-payment-dialog"]', {
        state: "detached",
      });
    }
    await expect(page.locator('[data-testid="quote-status-badge"]')).toHaveText("Paid");
    await expect(page.locator('[data-testid="balance-due"]')).toHaveText("$0.00");
  });

  test("schedule guard: percentages must sum to 100", async ({ page }) => {
    await page.goto(quoteUrl);
    await page.click('[data-testid="edit-schedule-button"]');
    await page.waitForSelector('[data-testid="edit-schedule-dialog"]');
    await page.fill('[data-testid="milestone-pct-0"]', "50");
    await page.click('[data-testid="schedule-save"]');
    await expect(page.locator('[data-testid="edit-schedule-dialog"]')).toContainText(
      "sum to 100"
    );
  });
```

Adapt `quoteUrl` acquisition to how the existing spec threads state between tests (it creates the quote in the setup test — reuse its mechanism verbatim).

- [ ] **Step 4: Run the suite**

```bash
npx playwright test e2e/clients.spec.ts
```

Expected: all pass. Then the full gate:

```bash
npm run type-check && npm run lint && npm run test:e2e
```

Expected: clean (full suite may take several minutes; investigate any failure before proceeding).

- [ ] **Step 5: Commit**

```bash
git add e2e/ db/seeds/dev_seed.sql supabase/seed.sql
git commit -m "test(e2e): split-payments flows; seed milestone schedules and payments"
```

---

## Final Verification (after all tasks)

1. `npm run type-check && npm run lint` — clean.
2. `npx tsx scripts/check-payment-schedule.ts` — ALL PASS.
3. `npm run test:e2e` — full suite green.
4. Manual walk: quote page → edit schedule to 20/80 → record deposit → badge Partially Paid → receipt email (mock) → cover balance → badge Paid → download PDF, schedule section present → edit tax rate on a partially-paid quote and confirm badge/balance move with the new total.
5. `supabase db reset` → login → seeded paid quote (Q-2026-903) shows Paid with two payments in history.
