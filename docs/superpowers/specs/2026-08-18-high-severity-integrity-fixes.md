# Spec: High-severity integrity fixes

## Objective

Fix only the three high-severity review findings:

1. A quote created for an existing client must retain that client's exact ID.
2. Quota enforcement, contact resolution, quote insertion, line-item insertion,
   and default-schedule creation must commit or roll back as one operation.
3. Default-schedule initialization and schedule replacement must be atomic,
   idempotent, and reject milestone IDs outside the current quote.

The web and `/api/v1` request contracts remain backward compatible.

## Tech Stack

- Next.js 14 App Router and strict TypeScript
- PostgreSQL/Supabase RPC functions
- Zod request validation
- Vitest and Playwright

## Commands

```bash
npm run type-check
npm run lint
npm run test:unit
npm run build
```

## Project Structure

- `app/api/quotes/route.ts` — additive quote request contract and response mapping
- `components/quote/NewQuoteForm.tsx` — sends the selected client ID
- `lib/db/quotes.ts` — atomic quote-creation repository boundary
- `lib/db/payments.ts` — atomic schedule repository boundary
- `supabase/migrations/` and `db/migrations/` — paired database functions
- `lib/__tests__/` — route/repository regression tests

## Code Style

Use existing camelCase TypeScript inputs and snake_case PostgreSQL parameters.
Repository functions own Supabase response/error handling; route handlers own
HTTP validation and response shapes.

```ts
const result = await createQuoteAtomic(user.id, {
  clientId: data.clientId,
  clientInfo: data.clientInfo,
  lineItems: data.lineItems,
});
```

## Testing Strategy

- Unit-test that quote creation passes `clientId` through and maps an atomic
  quota rejection to the existing `QUOTE_LIMIT` response.
- Unit-test that unknown schedule IDs are rejected and RPC failures cannot
  return partial success.
- Keep the mobile re-export parity suite passing.
- Run type-check, lint, all unit tests, and production build.
- Run Playwright only when its Docker/Supabase/Auth0 prerequisites are available.

## Boundaries

- Always: preserve tenant scoping, validate UUIDs at the API boundary, keep the
  `/api/v1` contract additive, and pair database migrations.
- Ask first: destructive cleanup of pre-existing corrupt schedules or any API
  field removal.
- Never: change the medium/low review findings, expose service credentials, or
  implement a fake application-level transaction.

## Success Criteria

- Selecting an existing client sends and persists its owned UUID.
- Name substrings are never used to select a contact during quote creation.
- Two concurrent creates for one user cannot both pass the final quota check.
- Any failure during quote creation leaves no contact, quote, line items, or
  schedule from that request committed.
- Concurrent default-schedule initialization creates exactly one schedule.
- Schedule replacement either fully succeeds or changes nothing.
- Supplied milestone IDs must all belong to the target quote and user.
- Existing response shapes and `/api/v1` handler parity remain intact.

## Open Questions

None. The user explicitly limited implementation to the reviewed high-severity
findings; all other review findings remain out of scope.
