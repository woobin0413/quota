# TDD: Work Catalog & Invoicing Restructure

## Tech Stack

Next.js 14 App Router, TypeScript strict, Tailwind + shadcn/ui, PostgreSQL (@vercel/postgres), **Auth0** (`@auth0/nextjs-auth0`, replaces Clerk), Resend email, @react-pdf/renderer. New dev dep: `@playwright/test`. Removed: `@clerk/nextjs`.

## Commands

```
Dev:        npm run dev
Build:      npm run build
Type check: npm run type-check
Lint:       npm run lint
E2E:        npx playwright test          (add script: "test:e2e")
Migration:  psql $POSTGRES_URL -f db/migrations/002_work_catalog.sql
Rollback:   psql $POSTGRES_URL -f db/migrations/002_rollback.sql
```

## Database Changes — Migration 002

### New table: `work_items`

```sql
CREATE TABLE work_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'each',  -- each, hours, sqft, lf
  default_unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  category VARCHAR(100),          -- trade: electrical, plumbing, carpentry...
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_default_price CHECK (default_unit_price >= 0),
  CONSTRAINT unique_work_item_name_per_user UNIQUE (user_id, name)
);
CREATE INDEX idx_work_items_user ON work_items(user_id) WHERE is_active = TRUE;
```

### Alter `users` (Clerk → Auth0)

```sql
ALTER TABLE users RENAME COLUMN clerk_user_id TO auth0_user_id;
-- Auth0 `sub` claim format: "auth0|abc123", "google-oauth2|...", etc.
```

Existing unique constraint/index carries over with the rename. Dev-stage data: existing rows with Clerk ids become orphans; acceptable (fresh accounts) — optionally truncate in dev.

### Alter `quotes`

```sql
ALTER TABLE quotes
  ADD COLUMN is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN paid_at TIMESTAMP WITH TIME ZONE,
  DROP COLUMN audio_recording_url,
  DROP COLUMN audio_transcript;
```

Rationale: `is_paid` boolean instead of new enum values — avoids touching the `quote_status` enum (Postgres enum removal is painful) and the existing `payments.payment_status` enum stays reserved for future in-app payments. Paid/unpaid is orthogonal to send state. Payments occur entirely outside the system; the toggle records the outcome.

### New table: `payment_status_changes` (note history)

```sql
CREATE TABLE payment_status_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_paid BOOLEAN NOT NULL,          -- the new state
  note TEXT,                         -- optional, e.g. "paid by check #1042"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_payment_changes_quote ON payment_status_changes(quote_id, created_at DESC);
```

Every toggle inserts a row; latest row's note doubles as the "current" note. Kept separate from `quote_activity` (which is trigger-driven and generic) so the UI can render a clean, purpose-built payment history.

### Alter `quote_line_items`

```sql
ALTER TABLE quote_line_items
  ADD COLUMN work_item_id UUID REFERENCES work_items(id) ON DELETE SET NULL;
```

Nullable — ad-hoc (non-catalog) lines remain allowed.

### Drop

```sql
DROP TABLE audio_recordings;
```

Rollback file (`002_rollback.sql`) reverses all of the above, recreating `audio_recordings` from the 001 definition.

## Starter Catalog Seeding

Templates live in code, not a global DB table: `lib/catalog-templates.ts` exports `CATALOG_TEMPLATES: Record<Trade, WorkItemTemplate[]>` (labor lines at the established trade rates + common material/service lines per trade). The Work Catalog UI offers "Import starter items" → user picks trade(s) → `bulkCreateWorkItems()` inserts copies owned by the user. Duplicate names skipped via the unique constraint (`ON CONFLICT DO NOTHING`).

## Code Removal Map

| Delete | Notes |
|---|---|
| `lib/ai/` (entire dir) | gemini-service, openai-service, audio-utils, comparison, cost-tracking |
| `app/api/process-audio/`, `app/api/process-audio-fallback/` | |
| `components/audio/` | AudioRecorder, AudioVisualizer |
| `hooks/useAudioRecorder.ts` | |
| `lib/validators/audio-processing.ts`, `types/ai.ts` | |
| Audio references in `types/database.ts`, `lib/db/*`, seed data | grep-verify zero remaining references |
| `@clerk/nextjs` dependency + all `auth()`/`useAuth()` call sites | replaced by Auth0 session helpers |
| `app/(auth)/sign-in`, `app/(auth)/sign-up` catch-all pages | Auth0 Universal Login is hosted; local pages unnecessary |

Keep `lib/rate-limit.ts` (used by email sending).

## Authentication — Auth0

**SDK:** `@auth0/nextjs-auth0` (v4). Auth routes are served by the SDK's middleware — no route handlers to write: `/auth/login`, `/auth/logout`, `/auth/callback`, `/auth/profile`.

**Structure:**

```
lib/auth0.ts        → export const auth0 = new Auth0Client()  (reads env vars)
middleware.ts       → auth0.middleware(request); redirect to /auth/login when
                      no session on protected paths (everything except /, /auth/*, /api/webhooks/*)
lib/auth.ts         → getCurrentUser(): reads auth0.getSession(), looks up users row
                      by auth0_user_id (sub claim), auto-provisions on first login
                      (INSERT ... ON CONFLICT DO NOTHING with email/name from session)
```

**Call-site migration:** every `auth()` (Clerk) becomes `const session = await auth0.getSession()` in Server Components / route handlers; `userId` derives from the provisioned `users.id` via `getCurrentUser()`. Client components get user via the SDK's `useUser()` where needed. Login/logout buttons link to `/auth/login` and `/auth/logout`.

**Auto-provisioning replaces Clerk webhooks:** first authenticated request upserts the `users` row. No user-sync webhook needed.

**Env vars:**

```
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_SECRET=<32-byte hex, self-generated: openssl rand -hex 32>
APP_BASE_URL=http://localhost:3000
```

**Auth0 dashboard config (Regular Web Application):**
- Allowed Callback URLs: `http://localhost:3000/auth/callback`
- Allowed Logout URLs: `http://localhost:3000`
- Database connection (Username-Password) enabled for e2e test user

## New Modules

### `lib/db/work-items.ts` (repository, follows existing pattern)

```typescript
getWorkItems(userId, { includeInactive? }): Promise<WorkItem[]>
getWorkItemById(userId, id): Promise<WorkItem>
createWorkItem(userId, input: CreateWorkItemInput): Promise<WorkItem>
updateWorkItem(userId, id, input: UpdateWorkItemInput): Promise<WorkItem>
setWorkItemActive(userId, id, active: boolean): Promise<void>
bulkCreateWorkItems(userId, inputs: CreateWorkItemInput[]): Promise<number>
```

### `lib/db/quotes.ts` additions

```typescript
setQuotePaid(userId, quoteId, paid: boolean, note?: string): Promise<Quote>
// transaction: UPDATE quotes SET is_paid, paid_at  +  INSERT payment_status_changes
getPaymentHistory(userId, quoteId): Promise<PaymentStatusChange[]>
getQuotesByContact(userId, contactId): Promise<Quote[]>
```

### API Routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/work-items` | GET, POST | List / create catalog items |
| `/api/work-items/[id]` | PATCH, DELETE | Update / deactivate (soft) |
| `/api/work-items/import` | POST | Bulk import starter templates by trade |
| `/api/quotes/[id]/payment` | PATCH | `{ paid: boolean, note?: string }` → toggle + log history row |
| `/api/quotes/[id]/payment` | GET | payment status change history |
| `/api/quotes`, `/api/send-quote` | existing | reused; auth guard swapped to Auth0 |

All routes: Auth0 session guard (`getCurrentUser()`), Zod-validated bodies, ownership check (userId scoping) — same pattern as existing routes.

## UI Structure

```
app/dashboard/page.tsx
  └─ <Tabs> Quotes | Clients | Work Catalog
       ├─ QuotesTab      (existing DashboardContent, minus voice CTA)
       ├─ ClientsTab     components/contacts/ClientsTab.tsx
       │    └─ per client: quotes list → status badge + PaidToggle
       │         └─ toggle opens PaymentStatusDialog (confirm + optional note)
       │             + PaymentHistoryPopover (past changes w/ notes)
       └─ CatalogTab     components/catalog/CatalogTab.tsx
            ├─ WorkItemTable (edit inline: name, unit, price, active)
            ├─ WorkItemForm  (add new)
            └─ ImportStarterDialog (pick trade → import)

app/new-quote/page.tsx  → rebuilt QuoteBuilder
  1. Client select (existing contacts + inline create)
  2. Catalog picker: searchable work item list → "Add" → line item
     (quantity + unit price editable per line; ad-hoc line supported)
  3. Totals panel (subtotal/tax/total — DB trigger recalculates on save)
  4. Save draft → redirect /quote/[id]
  5. Send: existing send flow on /quote/[id] (PDF + Resend email)
```

Component conventions: shadcn/ui primitives, Server Components by default, `"use client"` only for interactive pieces (QuoteBuilder, PaidToggle, WorkItemTable). Client-side fetches hit the API routes; server components use `lib/db` directly.

## Testing Strategy

**Framework:** Playwright (`@playwright/test`), specs in `e2e/`, config `playwright.config.ts` (baseURL `http://localhost:3000`, `webServer: npm run dev`, chromium desktop project).

**Auth:** global setup performs a real Auth0 Universal Login through the browser once (fill email/password on the hosted login page), saves `storageState`, all specs reuse it. Test user lives in the tenant's Username-Password database connection. Credentials via `E2E_AUTH0_USER_EMAIL` / `E2E_AUTH0_USER_PASSWORD` env vars. If the tenant has bot detection/attack protection enabled, allowlist the test IP or disable for dev tenant.

**Email:** Resend never called for real in tests — `page.route('**/api/send-quote', ...)` is NOT mocked (route logic must run); instead the Resend SDK call is bypassed with `RESEND_MOCK=1` env check in `lib/email-sender.ts` returning a fake success id. Assert on the API response + status change.

**Specs:**

| File | Covers |
|---|---|
| `e2e/catalog.spec.ts` | import starter items, add custom item, edit price, deactivate |
| `e2e/quote-flow.spec.ts` | critical journey: new quote → pick client → add catalog items → totals correct → save → send → status `sent` |
| `e2e/clients.spec.ts` | clients tab lists client + quotes; mark paid with note → badge updates → history shows note → persists on reload; toggle back to unpaid with note |
| `e2e/auth.spec.ts` | unauthenticated user redirected to Auth0 login; logout clears session |

**Environment:** local `npm run dev` + existing dev database (`.env.local`). Tests create their own data with unique names, clean up after themselves where practical.

**Unit level:** no unit test framework exists; e2e is the coverage layer for this change (matches decision from planning interview).

## Boundaries

- **Always:** run `npm run type-check` and `npm run lint` before marking a task done; scope every DB query by `user_id`; keep migration + rollback in lockstep.
- **Ask first:** new dependencies beyond `@playwright/test`/`@auth0/nextjs-auth0`; any change to `quote_status` enum; touching Stripe/payments tables.
- **Never:** commit secrets or `.env.local`; delete `payments`/`quote_activity` tables; call real Resend/AI APIs from tests.

## Risks

| Risk | Mitigation |
|---|---|
| DB triggers reference dropped audio columns | Grep 001 schema for trigger dependencies before writing 002 |
| Existing `NewQuoteForm`/`QuoteEditor` deeply coupled to AI output shape | Rebuild `NewQuoteForm` fresh; keep `QuoteEditor`/PDF/preview which operate on saved quotes |
| Auth0 bot detection blocks Playwright sign-in | Disable attack protection on dev tenant, or allowlist; login once in global setup and reuse storageState |
| Clerk removal breaks every protected page at once | Do auth swap as one atomic task (middleware + helper + all call sites) before UI tasks |
| Dev DB shared state breaks test idempotency | Unique-suffix test data + targeted cleanup |
