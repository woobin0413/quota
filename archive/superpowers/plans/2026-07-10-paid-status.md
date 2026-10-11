# Paid/Unpaid as Only Quote Status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the quote lifecycle status (`draft/sent/viewed/accepted/rejected/expired`); `is_paid` (Unpaid → Paid) becomes the only quote status, and invoice sending becomes a status-free action that records metadata only.

**Architecture:** Drop the `status` column and lifecycle timestamps via migration 003. `is_paid` + `payment_status_changes` (already present) carry the payment state. Send flow keeps `sent_at` / `email_sent_count` / `recipient_email` as metadata. UI badges derive from `is_paid`; the quote page gains a Mark paid/unpaid control reusing `PaymentStatusDialog`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (service-role client), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-10-paid-status-design.md`

## Global Constraints

- Migration + rollback files stay in lockstep; mirror into `supabase/migrations/` with timestamp prefix (CLAUDE.md)
- Every DB query scoped by `user_id` (CLAUDE.md)
- Keep existing `data-testid` attributes where the element survives; `quote-status-badge` now renders `Paid`/`Unpaid`
- `npm run type-check` and `npm run lint` must pass before any commit
- Local verification DB: `supabase start` must be running; reset with `supabase db reset` (binary at `~/.local/share/supabase/supabase`)

---

### Task 1: Migration 003 — drop lifecycle status columns

**Files:**
- Create: `db/migrations/003_remove_quote_status.sql`
- Create: `db/migrations/003_rollback.sql`
- Create: `supabase/migrations/20260710000000_remove_quote_status.sql` (identical content to 003 forward migration)

**Interfaces:**
- Produces: `quotes` table without `status`, `viewed_at`, `accepted_at`, `rejected_at`. All other columns unchanged. Later tasks assume these columns are gone.

- [ ] **Step 1: Check the existing schema for the exact constraint/index names**

Run: `grep -n "status" db/migrations/001_initial_schema.sql | head -20`
Note the CHECK constraint syntax and any `idx_quotes_status`-style index — the DROP statements below must match what exists.

- [ ] **Step 2: Write the forward migration**

`db/migrations/003_remove_quote_status.sql`:

```sql
-- 003: Remove quote lifecycle status
-- Payment state (is_paid) is the only quote status. Sending an invoice
-- is a status-free action tracked by sent_at / email_sent_count.

BEGIN;

DROP INDEX IF EXISTS idx_quotes_status;

ALTER TABLE quotes
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS viewed_at,
  DROP COLUMN IF EXISTS accepted_at,
  DROP COLUMN IF EXISTS rejected_at;

COMMIT;
```

(Adjust the index name to whatever Step 1 found; if the CHECK constraint is inline on the column, dropping the column removes it automatically.)

- [ ] **Step 3: Write the rollback**

`db/migrations/003_rollback.sql`:

```sql
-- Rollback 003: restore quote lifecycle status columns

BEGIN;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired')),
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);

COMMIT;
```

(Match column types/constraints to how 001 defined them — copy from Step 1's output.)

- [ ] **Step 4: Mirror into supabase/migrations and reset**

```bash
cp db/migrations/003_remove_quote_status.sql supabase/migrations/20260710000000_remove_quote_status.sql
export PATH="$HOME/.local/share/supabase:$PATH"
supabase db reset
```

Expected: reset applies all migrations without error.

- [ ] **Step 5: Verify columns are gone**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='quotes' ORDER BY 1;"
```

Expected: no `status`, `viewed_at`, `accepted_at`, `rejected_at` rows; `sent_at`, `is_paid`, `paid_at`, `email_sent_count` still present.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/003_remove_quote_status.sql db/migrations/003_rollback.sql supabase/migrations/20260710000000_remove_quote_status.sql
git commit -m "feat(db): drop quote lifecycle status columns"
```

---

### Task 2: Types and repository sweep

**Files:**
- Modify: `types/database.ts` (remove `QuoteStatus`; remove status fields from `QuoteRow`; rewrite `QuoteStats`; remove `status` from `QuoteFilters`)
- Modify: `lib/db/quotes.ts` (delete `updateQuoteStatus`; drop status filter in `getUserQuotes`; rewrite `getQuoteStats`)
- Modify: `lib/db.ts` (drop `updateQuoteStatus` and `QuoteStatus` exports)

**Interfaces:**
- Consumes: Task 1's schema (no status columns).
- Produces: `QuoteStats` = `{ total: number; unpaid: number; paid: number; totalRevenue: number }` — `totalRevenue` sums `total` of paid quotes. `getQuoteStats(userId: string): Promise<QuoteStats>`. `QuoteFilters` without `status`. `Quote`/`QuoteRow` without `status`/`viewed_at`/`accepted_at`/`rejected_at`. `updateQuoteStatus` no longer exists.

- [ ] **Step 1: types/database.ts edits**

Remove line: `export type QuoteStatus = "draft" | "sent" | ...`.
In `QuoteRow`, remove the `status`, `viewed_at`, `accepted_at`, `rejected_at` fields.
Replace the `QuoteStats` interface with:

```typescript
export interface QuoteStats {
  total: number;
  unpaid: number;
  paid: number;
  totalRevenue: number; // sum of totals of paid quotes
}
```

In `QuoteFilters`, remove the `status?: QuoteStatus | QuoteStatus[]` field.
Search the file for any remaining `QuoteStatus` references (e.g. in `Quote` or activity types) and remove them.

- [ ] **Step 2: lib/db/quotes.ts edits**

Delete the whole `updateQuoteStatus` function (lines ~344-377, the one setting `sent_at`/`viewed_at`/etc. by status).
In `getUserQuotes`, delete the `if (filters?.status) { ... }` block.
Rewrite `getQuoteStats` (currently selects `status, total` and counts per lifecycle state):

```typescript
export async function getQuoteStats(userId: string): Promise<QuoteStats> {
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("is_paid, total")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;

  const quotes = data || [];
  const paidQuotes = quotes.filter((q) => q.is_paid);

  return {
    total: quotes.length,
    unpaid: quotes.length - paidQuotes.length,
    paid: paidQuotes.length,
    totalRevenue: paidQuotes.reduce(
      (sum, q) => sum + parseFloat(q.total?.toString() || "0"),
      0
    ),
  };
}
```

Remove `QuoteStatus` from the type import list at the top.

- [ ] **Step 3: lib/db.ts edits**

Remove `updateQuoteStatus,` from the quotes convenience re-export block and `QuoteStatus,` from the type export block.

- [ ] **Step 4: Type-check to surface every remaining reference**

Run: `npm run type-check`
Expected: FAIL listing every file still referencing `status` — these are handled by Tasks 3 and 4. Record the list; do NOT fix files outside this task's scope here. If errors appear inside `types/database.ts`, `lib/db/quotes.ts`, or `lib/db.ts`, fix those now.

- [ ] **Step 5: Commit**

```bash
git add types/database.ts lib/db/quotes.ts lib/db.ts
git commit -m "feat(db): payment state replaces lifecycle status in types and repos"
```

(Committing with downstream type errors is fine — Tasks 3-4 land before verification.)

---

### Task 3: Send flow — status-free sending

**Files:**
- Modify: `app/api/send-quote/route.ts`
- Modify: `hooks/useQuoteEditor.ts`
- Modify: `components/quote/QuotePDFDocument.tsx`
- Modify: `components/quote/QuotePreview.tsx`
- Modify: `components/quote/SendQuoteButton.tsx`

**Interfaces:**
- Consumes: Task 2 (no `updateQuoteStatus`, no `Quote.status`).
- Produces: `QuoteData` (in `hooks/useQuoteEditor.ts`) has `isPaid: boolean` instead of `status`. Send success response unchanged except no status semantics.

- [ ] **Step 1: hooks/useQuoteEditor.ts**

In the `QuoteData` interface replace:

```typescript
  status: "draft" | "sent" | "viewed" | "accepted" | "rejected";
```

with:

```typescript
  isPaid: boolean;
```

In the initial-state construction (~line 128) replace `status: initialData?.status || "draft",` with `isPaid: initialData?.isPaid ?? false,`.
Grep the rest of the hook for `status` and update any other references to the removed field.

- [ ] **Step 2: app/api/send-quote/route.ts**

Remove `updateQuoteStatus` from the `@/lib/db/quotes` import.
Delete the expired-quote guard block:

```typescript
    if (quote.status === "expired") { ... return 400 ... }
```

In the `quoteData` assembly replace `status: quote.status as QuoteData["status"],` with `isPaid: quote.is_paid,` (check the actual transformed field name — `transformQuote` maps `is_paid`; if the `Quote` type exposes `is_paid` snake_case, use that).
Delete the post-send status transition:

```typescript
    if (quote.status === "draft") {
      await updateQuoteStatus(quote.id, user.id, "sent");
    }
```

The existing metadata update (`sent_at`, `email_sent_count`, `recipient_email`) stays.

- [ ] **Step 3: PDF + preview stamps**

`components/quote/QuotePDFDocument.tsx` (~line 293) and `components/quote/QuotePreview.tsx` (~line 130) currently render `quote.status.charAt(0).toUpperCase() + quote.status.slice(1)`. Replace with:

```tsx
{quote.isPaid ? "Paid" : "Unpaid"}
```

If either component styles the stamp by status value, map `isPaid` → the existing paid/unpaid styles (`stamp-paid` / `stamp-unpaid` classes).

- [ ] **Step 4: SendQuoteButton comment**

`components/quote/SendQuoteButton.tsx` header comment mentions the badge reflecting the "sent" state — update the comment to say the send action records send metadata only. If the component triggers `router.refresh()` after success, keep it (refreshes the sent-metadata line).

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: remaining errors only in Task 4's files (`app/quote/[id]/page.tsx`, `app/api/quotes/route.ts`, `components/contacts/ClientsTab.tsx`, `components/dashboard/DashboardContent.tsx`). No errors in Task 3 files.

- [ ] **Step 6: Commit**

```bash
git add app/api/send-quote/route.ts hooks/useQuoteEditor.ts components/quote/QuotePDFDocument.tsx components/quote/QuotePreview.tsx components/quote/SendQuoteButton.tsx
git commit -m "feat(send): invoice sending no longer transitions quote status"
```

---

### Task 4: UI + quotes API — Paid/Unpaid everywhere

**Files:**
- Modify: `app/api/quotes/route.ts` (drop status query filter)
- Modify: `app/quote/[id]/page.tsx` (badge from is_paid, sent metadata, mark-paid control)
- Create: `components/quote/PaidStatusControl.tsx` (client wrapper for the dialog)
- Modify: `components/contacts/ClientsTab.tsx` (remove lifecycle chip)
- Modify: `components/dashboard/DashboardContent.tsx` (statusConfig → paid badge)

**Interfaces:**
- Consumes: `PaymentStatusDialog` from `components/contacts/PaymentStatusDialog.tsx` with props `{ open, onOpenChange, quoteNumber, markingPaid, onConfirm(note) }`; PATCH `/api/quotes/[id]/payment` body `{ paid: boolean, note?: string }`.
- Produces: `PaidStatusControl` client component: `{ quoteId: string; quoteNumber: string; isPaid: boolean }`.

- [ ] **Step 1: app/api/quotes/route.ts**

In `listQuotesSchema` remove the `status:` line. In the GET handler remove `status: searchParams.get("status") || undefined,` from `queryParams` and `status: filters.status ? [filters.status] : undefined,` from the `getUserQuotes` call.

- [ ] **Step 2: Create components/quote/PaidStatusControl.tsx**

```tsx
"use client";

/**
 * Paid/Unpaid control for the quote page: badge + toggle button
 * opening the shared PaymentStatusDialog.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PaymentStatusDialog } from "@/components/contacts/PaymentStatusDialog";

interface PaidStatusControlProps {
  quoteId: string;
  quoteNumber: string;
  isPaid: boolean;
}

export function PaidStatusControl({
  quoteId,
  quoteNumber,
  isPaid,
}: PaidStatusControlProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleConfirm = async (note: string) => {
    const response = await fetch(`/api/quotes/${quoteId}/payment`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paid: !isPaid, note: note || undefined }),
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || "Failed to update payment status");
    }
    router.refresh();
  };

  return (
    <div className="flex items-center gap-3">
      <span
        className={`stamp ${isPaid ? "stamp-paid" : "stamp-unpaid"}`}
        data-testid="quote-status-badge"
      >
        {isPaid ? "Paid" : "Unpaid"}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setDialogOpen(true)}
        data-testid="quote-paid-toggle"
      >
        {isPaid ? "Mark unpaid" : "Mark paid"}
      </Button>
      <PaymentStatusDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        quoteNumber={quoteNumber}
        markingPaid={!isPaid}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
```

(Check `app/globals.css` for the `stamp`/`stamp-paid`/`stamp-unpaid` classes the old badge used; reuse them. If `stamp-unpaid` renders alarm-red, that is acceptable per spec "neutral/red".)

- [ ] **Step 3: app/quote/[id]/page.tsx**

Delete `getStatusStamp()` and the old badge `<div className={\`stamp ...\`} data-testid="quote-status-badge">` block. Render instead:

```tsx
<PaidStatusControl
  quoteId={quote.id}
  quoteNumber={quote.quote_number}
  isPaid={quote.is_paid}
/>
```

(import `{ PaidStatusControl } from "@/components/quote/PaidStatusControl"`; verify the `Quote` type's field casing — `transformQuote` output — and use the actual property names.)

Below the header (near the existing Created/Valid-until block), add the sent-metadata line:

```tsx
{(quote.email_sent_count ?? 0) > 0 && quote.sent_at && (
  <p className="text-sm text-muted-foreground" data-testid="sent-meta">
    Sent {quote.email_sent_count}× · last {formatDate(quote.sent_at)}
  </p>
)}
```

(`formatDate` already imported from `@/lib/utils`. Match the actual field names on the transformed `Quote` type.)

- [ ] **Step 4: components/contacts/ClientsTab.tsx**

Remove the lifecycle status chip (~lines 199-204: the element rendering `quote.status` with `sent`-conditional styling). The paid badge already next to it stays.

- [ ] **Step 5: components/dashboard/DashboardContent.tsx**

Delete the `statusConfig` map (draft/sent/viewed/accepted/rejected/expired entries). In `QuoteRow`, derive display from `quote.is_paid`:

```tsx
const config = quote.is_paid
  ? { label: "Paid", stamp: "stamp-paid", icon: CheckCircle }
  : { label: "Unpaid", stamp: "stamp-unpaid", icon: FileText };
```

Remove now-unused icon imports (`Send`, `Clock`, `XCircle` — keep any still used elsewhere in the file). If the dashboard shows stat cards fed by `getQuoteStats`, update them to the new shape (`total`, `unpaid`, `paid`, `totalRevenue`) — check `app/dashboard/page.tsx` and the `DashboardContent` props for how stats flow in.

- [ ] **Step 6: Type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: PASS (only the 2 pre-existing `no-explicit-any` warnings in `lib/email-sender.ts` / `lib/quote-calculations.ts`).

- [ ] **Step 7: Commit**

```bash
git add app/api/quotes/route.ts app/quote/[id]/page.tsx components/quote/PaidStatusControl.tsx components/contacts/ClientsTab.tsx components/dashboard/DashboardContent.tsx
git commit -m "feat(ui): Paid/Unpaid badge and toggle replace lifecycle status"
```

---

### Task 5: E2E updates + full verification

**Files:**
- Modify: `e2e/quote-flow.spec.ts`
- Modify: `e2e/clients.spec.ts` (only if it asserts lifecycle status — check first)

**Interfaces:**
- Consumes: `quote-status-badge` renders `Unpaid`/`Paid`; `sent-meta` testid appears after a successful send; `quote-paid-toggle` opens `payment-status-dialog`.

- [ ] **Step 1: Update quote-flow assertions**

Line ~77: replace

```typescript
await expect(page.getByTestId("quote-status-badge")).toHaveText("Draft");
```

with

```typescript
await expect(page.getByTestId("quote-status-badge")).toHaveText("Unpaid");
```

Line ~110 (post-send): replace

```typescript
await expect(page.getByTestId("quote-status-badge")).toHaveText("Sent", { timeout: 15_000 });
```

with

```typescript
await expect(page.getByTestId("sent-meta")).toContainText("Sent 1×", { timeout: 15_000 });
```

Update the file's header comment ("verify status becomes sent" → "verify send metadata recorded").

- [ ] **Step 2: Check clients spec**

Run: `grep -n "Draft\|Sent\|quote.status" e2e/clients.spec.ts`
Expected: no lifecycle assertions (payment-dialog testids only). If any appear, update them the same way.

- [ ] **Step 3: Add quote-page paid-toggle coverage**

In `e2e/clients.spec.ts` (or quote-flow, wherever the quote page is already open), after the quote page loads, add:

```typescript
// Toggle paid from the quote page
await page.getByTestId("quote-paid-toggle").click();
await expect(page.getByTestId("payment-status-dialog")).toBeVisible();
await page.getByTestId("payment-confirm-button").click();
await expect(page.getByTestId("payment-status-dialog")).toBeHidden({ timeout: 15_000 });
await expect(page.getByTestId("quote-status-badge")).toHaveText("Paid");
```

(Verify the confirm button's actual testid in `PaymentStatusDialog` — grep `data-testid` in that file — and use it.)

- [ ] **Step 4: Full suite**

Run: `npm run test:e2e`
Expected: all tests pass (14 + any added). If quota trips, global setup resets it automatically.

- [ ] **Step 5: Final checks + commit**

```bash
npm run type-check && npm run lint
git add e2e/
git commit -m "test(e2e): assert Paid/Unpaid badge and send metadata"
```
