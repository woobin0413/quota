# Tasks: Work Catalog & Invoicing Restructure

Ordered by dependency. Each task ≤ ~5 files, independently verifiable.

## 1. Database

- [x] **1.1 Migration 002 + rollback**
  - Acceptance: `002_work_catalog.sql` creates `work_items` + `payment_status_changes`, renames `users.clerk_user_id` → `auth0_user_id`, alters `quotes` (+`is_paid`, +`paid_at`, −audio columns), alters `quote_line_items` (+`work_item_id`), drops `audio_recordings`; `002_rollback.sql` fully reverses it. No trigger/index in 001 still references dropped columns.
  - Verify: apply + rollback + re-apply against dev DB without errors.
  - Files: `db/migrations/002_work_catalog.sql`, `db/migrations/002_rollback.sql`

- [x] **1.2 Types for new schema**
  - Acceptance: `WorkItem`, `CreateWorkItemInput`, `UpdateWorkItemInput`, `PaymentStatusChange` types; `Quote` type gains `isPaid`/`paidAt`; `User` type uses `auth0UserId`; audio fields removed from types.
  - Verify: `npm run type-check` (expected failures only in code slated for deletion/replacement in task 2).
  - Files: `types/database.ts`, `types/index.ts`

## 2. Remove Voice/AI + Auth Swap

- [x] **2.1 Delete AI + audio code**
  - Acceptance: `lib/ai/`, `app/api/process-audio*`, `components/audio/`, `hooks/useAudioRecorder.ts`, `lib/validators/audio-processing.ts`, `types/ai.ts` deleted; dashboard "Voice Quote" button removed; `grep -ri "process-audio\|useAudioRecorder\|gemini\|whisper" app lib components hooks types` returns nothing.
  - Verify: `npm run build` passes (auth errors allowed until 2.2).
  - Files: deletions + `app/dashboard/page.tsx`, `.env.example`

- [x] **2.2 Clerk → Auth0 (atomic swap)**
  - Acceptance: `@auth0/nextjs-auth0` installed, `@clerk/nextjs` removed; `lib/auth0.ts` client + `middleware.ts` rewritten (protect all but `/`, `/auth/*`, `/api/webhooks/*`); `lib/auth.ts` `getCurrentUser()` with first-login auto-provisioning into `users`; all Clerk `auth()`/`useAuth()` call sites migrated; `(auth)` sign-in/up pages deleted; login/logout links to `/auth/login`, `/auth/logout`; `grep -ri clerk app lib components middleware.ts` returns nothing.
  - Verify: `npm run build`; manual browser — login via Auth0, dashboard loads, users row auto-created, logout works.
  - Files: `middleware.ts`, `lib/auth0.ts`, `lib/auth.ts`, `lib/db/users.ts`, all pages/routes with auth calls, `package.json`, `.env.example`

## 3. Work Catalog Backend

- [x] **3.1 Work items repository + starter templates**
  - Acceptance: `lib/db/work-items.ts` implements functions per design; `lib/catalog-templates.ts` exports starter items for 7 trades; exported from `lib/db`.
  - Verify: `npm run type-check`; quick node script exercising CRUD against dev DB.
  - Files: `lib/db/work-items.ts`, `lib/catalog-templates.ts`, `lib/db.ts` (or `lib/db/index.ts`)

- [x] **3.2 Work items API routes**
  - Acceptance: GET/POST `/api/work-items`, PATCH/DELETE `/api/work-items/[id]`, POST `/api/work-items/import` — auth-guarded, Zod-validated, user-scoped.
  - Verify: `curl` each route with dev session; 401 when unauthenticated.
  - Files: `app/api/work-items/route.ts`, `app/api/work-items/[id]/route.ts`, `app/api/work-items/import/route.ts`, `lib/validations.ts`

## 4. Quotes Backend

- [x] **4.1 Paid status + note history + per-contact queries**
  - Acceptance: `setQuotePaid(userId, quoteId, paid, note?)` runs in a transaction — updates `is_paid`/`paid_at` and inserts `payment_status_changes` row; `getPaymentHistory()` returns changes newest-first; `getQuotesByContact()` returns contact's quotes; PATCH `/api/quotes/[id]/payment` accepts `{ paid, note? }` with ownership check; GET returns history.
  - Verify: `curl` toggle round-trip with note; history endpoint returns both changes; DB rows correct.
  - Files: `lib/db/quotes.ts`, `app/api/quotes/[id]/payment/route.ts`, `lib/validations.ts`, `types/database.ts`

## 5. UI

- [x] **5.1 Dashboard tabs shell**
  - Acceptance: dashboard shows Quotes | Clients | Work Catalog tabs; Quotes tab = existing content minus voice CTA; tab selection survives navigation (URL param).
  - Verify: manual browser check on all three tabs.
  - Files: `app/dashboard/page.tsx`, `components/dashboard/DashboardContent.tsx`, `components/dashboard/index.ts`

- [x] **5.2 Work Catalog tab**
  - Acceptance: table of work items (name, category, unit, price, active); inline edit; add-item form; deactivate; "Import starter items" dialog by trade.
  - Verify: manual — import, edit price, add custom, deactivate; reload persists.
  - Files: `components/catalog/CatalogTab.tsx`, `components/catalog/WorkItemForm.tsx`, `components/catalog/ImportStarterDialog.tsx`, `components/catalog/index.ts`

- [x] **5.3 Quote builder (rebuild new-quote)**
  - Acceptance: select/create client → searchable catalog picker → lines with editable qty/price → ad-hoc line support → live totals → save draft → redirect to `/quote/[id]`.
  - Verify: manual full build of a quote; totals match; line items persisted with `work_item_id`.
  - Files: `components/quote/NewQuoteForm.tsx` (rewrite), `components/quote/CatalogPicker.tsx`, `components/quote/index.ts`, `app/new-quote/page.tsx`

- [x] **5.4 Clients tab**
  - Acceptance: client list with quote counts; expanding a client shows their quotes (number, project, total, status, paid badge); Paid/Unpaid toggle opens dialog with optional note field, confirms, calls payment API, updates optimistically; payment history (changes + notes + timestamps) viewable per quote.
  - Verify: manual — mark paid with note, reload, state + history persist; toggle back to unpaid.
  - Files: `components/contacts/ClientsTab.tsx`, `components/contacts/PaidToggle.tsx`, `components/contacts/PaymentStatusDialog.tsx`, `components/contacts/PaymentHistoryPopover.tsx`, `components/contacts/index.ts`

- [x] **5.5 Send invoice wiring**
  - Acceptance: `/quote/[id]` send action emails PDF via existing send-quote route; status → `sent`; `RESEND_MOCK=1` short-circuits real send for tests.
  - Verify: send with mock flag; check status + `email_sent_count` increment.
  - Files: `app/quote/[id]/page.tsx`, `lib/email-sender.ts`

## 6. E2E Testing

- [x] **6.1 Playwright setup + Auth0 login**
  - Acceptance: `@playwright/test` installed; `playwright.config.ts` with webServer; global setup logs in through Auth0 Universal Login with `E2E_AUTH0_USER_EMAIL`/`E2E_AUTH0_USER_PASSWORD`, saves storageState; `npm run test:e2e` script; `e2e/auth.spec.ts` covers redirect-to-login + logout.
  - Verify: authed smoke spec (dashboard renders) + auth spec pass.
  - Files: `playwright.config.ts`, `e2e/global.setup.ts`, `e2e/smoke.spec.ts`, `e2e/auth.spec.ts`, `package.json`, `.env.example`

- [x] **6.2 Catalog spec**
  - Acceptance: import starter items, add custom item, edit price, deactivate — all asserted through UI.
  - Verify: `npx playwright test e2e/catalog.spec.ts` green.
  - Files: `e2e/catalog.spec.ts`

- [x] **6.3 Quote flow spec (critical journey)**
  - Acceptance: new quote → pick client → add 2 catalog items + 1 ad-hoc → totals correct → save → send (mocked Resend) → status `sent`.
  - Verify: `npx playwright test e2e/quote-flow.spec.ts` green.
  - Files: `e2e/quote-flow.spec.ts`

- [x] **6.4 Clients/paid spec**
  - Acceptance: clients tab shows client + quote; toggle paid with note → badge updates → note in history → persists after reload; toggle back to unpaid with note works.
  - Verify: `npx playwright test e2e/clients.spec.ts` green.
  - Files: `e2e/clients.spec.ts`

## 7. Cleanup

- [x] **7.1 Docs + seed refresh**
  - Acceptance: CLAUDE.md rewritten for new architecture (AI section removed, catalog/invoicing/e2e sections added); `db/seeds/dev_seed.sql` updated (no audio rows, sample work items); `.env.example` final.
  - Verify: `npm run build`, `npm run lint`, full `npm run test:e2e` green.
  - Files: `CLAUDE.md`, `db/seeds/dev_seed.sql`, `.env.example`
