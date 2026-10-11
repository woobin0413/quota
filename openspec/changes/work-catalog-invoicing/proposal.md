# PRD: Work Catalog & Invoicing Restructure

> **Status: implemented (record of the original pivot).** For live current state see `CLAUDE.md`. Notable deltas since this PRD:
> - **No sales tax** — the tax field/line/calc was removed app-wide (DB `tax_rate` kept, unused).
> - **Dashboard tabs → top nav** — the Quotes/Clients/Catalog tab bar was removed; Clients & Work Catalog are top-nav links (`/dashboard?tab=…`), dashboard defaults to Quotes.
> - New clients capture an **address**, shown on the quote's Client Information.
> - First-run **catalog onboarding** prompt for new users.
> - Email invoicing (quote send **and** payment receipts) is **Pro+** gated.
> - Later work not in this PRD: Stripe subscription billing, in-app auth pages, anon-lockdown migration `011`.

## Why

Quota's current foundation is built around voice-to-quote (audio recording → AI extraction). The product direction has changed: contractors will instead **select pre-defined work items from a configurable catalog**, build a quote from those items, send it to the client as an invoice email, and track payment status manually. The voice/AI pipeline is removed entirely.

## What Changes

### Removed
- Voice recording UI (`components/audio/`, `hooks/useAudioRecorder.ts`)
- AI processing layer (`lib/ai/`, `/api/process-audio`, `/api/process-audio-fallback`)
- `audio_recordings` table and audio columns on `quotes`
- `GEMINI_API_KEY` / `OPENAI_API_KEY` environment requirements
- "Voice Quote" entry point on dashboard
- **Clerk authentication** — replaced by Auth0 (`@auth0/nextjs-auth0`); `@clerk/nextjs` removed

### Added
1. **Work Catalog** — per-contractor catalog of work items (name, description, unit, default price, trade category). Pre-seeded with industry-standard starter items by trade; contractor can edit prices, deactivate items, and add their own.
2. **Quote Builder (rebuilt)** — contractor picks a client, selects work items from the catalog, adjusts quantity/price per line, reviews totals, saves.
3. **Invoice Send** — generate PDF from the quote and email it to the client (reuses existing Resend email system + PDF renderer).
4. **Clients Tab** — dashboard tab listing all clients with their quotes; each quote shows status and a **Paid / Unpaid** toggle the contractor controls manually. Payment happens outside the system (cash, check, Zelle, etc.) — the toggle records the outcome. Each status change prompts for an optional note (e.g. "paid by check #1042"); notes are kept as a history.
5. **Dashboard Tabs** — restructured into: **Quotes | Clients | Work Catalog**.
6. **Auth0 User Management** — sign-up/sign-in/logout via Auth0 Universal Login; users table keyed by Auth0 `sub`.
7. **Playwright E2E Suite** — covers the new critical journey end-to-end.

## User Stories

1. **As a contractor**, I manage a catalog of the work I do, each with my own price, so quoting is fast and consistent.
   - Acceptance: can create, edit, deactivate work items; can import starter items for my trade; prices persist.
2. **As a contractor**, I build a quote by selecting work items and quantities, so I don't type line items from scratch.
   - Acceptance: catalog picker with search; quantity and unit price editable per line; subtotal/tax/total computed automatically.
3. **As a contractor**, I send the finished quote to my client as a professional invoice email with PDF attached.
   - Acceptance: email delivered via Resend with PDF; quote status moves to `sent`; send count tracked.
4. **As a contractor**, I see all my clients and their quotes in one tab and mark each quote paid or unpaid, since clients pay me outside the app.
   - Acceptance: clients list with per-client quotes; paid/unpaid toggle; toggling opens a dialog with an optional note field; paid state, timestamp, and note persist and display; note history viewable per quote.
5. **As a contractor**, I sign up and log in with Auth0 so my account and data are secure.
   - Acceptance: Auth0 Universal Login for sign-up/sign-in/logout; first login auto-provisions a row in `users`; all data scoped to my user.

## Lifecycle (single document model)

One document — the quote — carries the full lifecycle. No separate invoice entity.

```
draft ──send──▶ sent ──mark paid──▶ paid
                 ▲                    │
                 └────mark unpaid─────┘
```

- `sent` and not paid = "unpaid" in the UI.
- Existing statuses (`viewed`, `accepted`, `rejected`, `expired`) remain in the schema but are not surfaced in the new UI (kept for forward compatibility).

## Success Criteria

- [ ] Contractor can complete the full journey in the browser: sign in via Auth0 → import/edit catalog → new quote → select client → add work items → send email → see quote under Clients tab → mark paid with a note.
- [ ] All voice/AI and Clerk code paths deleted; `npm run build` and `npm run type-check` pass with zero references to removed modules.
- [ ] Migration 002 applies and rolls back cleanly.
- [ ] Payment status changes record who/when/note and display a history.
- [ ] Playwright suite passes locally against `npm run dev` (real Auth0 test user, mocked Resend).

## Out of Scope

- Client-facing public quote view / accept-reject flow (future change)
- In-app payment collection of any kind — payments happen entirely outside the system; Stripe code paths untouched/dormant
- Migrating existing Clerk users to Auth0 (dev-stage app; fresh accounts acceptable)
- Voice/AI re-introduction
- Subscription/quota enforcement changes
- Multi-currency, multi-tax-jurisdiction

## Open Questions

- Starter catalog contents per trade — initial set derived from existing labor rates (GC $75/hr, electrician $100/hr, plumber $110/hr, HVAC $100/hr, carpenter $65/hr, painter $50/hr, landscaper $55/hr) plus common materials lines. Confirm during review.
