# Voice to invoice: spoken job notes become a draft quote

**Date:** 2026-08-08
**Status:** Approved for planning

## Why

`lib/subscription.ts` marks Ultimate as not purchasable, and the comment names
the reason: the tier is gated on voice-to-invoice, which does not exist. Ultimate
has no feature of its own today — only a higher quote ceiling that nobody hits —
so there is nothing to sell. This spec builds the missing feature.

The job it does for a contractor: standing in a driveway with dirty hands, say
what was done, and get a quote draft that is already filled in with their own
catalog prices. Typing eight line items on a phone is the thing that keeps
invoices from going out the same day.

## Decisions taken during design

These were the live questions. Recording them so the plan does not relitigate.

| Question | Decision |
|---|---|
| Who confirms the draft? | The **contractor**. No client-facing approval flow, no public route, no accept/decline state on quotes. |
| Where is audio captured? | **In-app mic, record-then-send** (`MediaRecorder`). Not streaming, not telephony, not file upload. |
| What may the parser output? | **Catalog match first, ad-hoc fallback.** The model never invents a price. |
| Client from voice? | **Match existing, else propose a new client** (name only). Contractor confirms before anything is created. |
| Audio retention | **Kept ~7 days, then purged.** Transcript is kept indefinitely. |
| Tier gating | **Ultimate-only**, and Ultimate **stays** in `UNAVAILABLE_TIERS` this release. Unlocking the tier is a deliberate follow-up. |

## Non-goals

- No client-facing quote approval. Explicitly rejected above.
- No live/streaming transcription.
- No telephony. Nobody calls a number.
- No LLM-authored prices, ever. See the structural guarantee below.
- No second quote-write path. Voice populates the existing
  `POST /api/quotes`; it never creates a quote itself.
- No voice editing of an existing quote. Voice creates drafts only.

## Architecture

Six units, each usable and testable on its own.

| Module | Purpose | Depends on |
|---|---|---|
| `components/quote/VoiceCapture.tsx` | `MediaRecorder` control: permission, record, stop, level meter, upload. Emits a `File`. Knows nothing about quotes. | browser APIs |
| `app/api/voice/draft/route.ts` | Guard → tier gate → rate limit → orchestrate → return `VoiceDraft`. Thin. | the three below |
| `lib/voice/transcribe.ts` | `audio → { transcript, durationSec }`. Provider and Blob write live here. | AI SDK, Vercel Blob |
| `lib/voice/extract.ts` | `transcript → ExtractedUtterance`, Zod-validated. | AI SDK `generateObject` |
| `lib/voice/resolve.ts` | `ExtractedUtterance + userId → VoiceDraft`. Catalog match, contact match, confidence. **No model call.** | `lib/db/work-items`, `lib/db/contacts` |
| `components/quote/VoiceDraftReview.tsx` | Editable draft rows; submits through the existing quote path. | `POST /api/quotes` |

### The structural guarantee on prices

`ExtractedUtterance` has no `unitPrice` field and no `workItemId` field. The
model is not instructed to avoid prices — its output schema has nowhere to put
one. `resolve.ts` is the only code that assigns money, and it assigns only
prices already in the contractor's own `work_items` rows.

This is the load-bearing decision of the whole design. A model that picks the
$450 catalog line instead of the $45 one produces a wrong invoice sent to a real
client under the contractor's name. Deterministic matching with a visible
confidence threshold is worth more here than the round trip it saves.

### Data flow

```
VoiceCapture ──File──▶ POST /api/voice/draft
                          │ 1. getCurrentUser()
                          │ 2. resolveTier() !== "ultimate" → 403 VOICE_REQUIRES_ULTIMATE
                          │ 3. rate limit: in-memory burst + persisted daily cap
                          │ 4. transcribe()  ── Blob put (private, 7-day expiry)
                          │ 5. extract()     ── generateObject + Zod
                          │ 6. resolve()     ── work_items + contacts, user-scoped
                          ▼
                     VoiceDraft ──▶ VoiceDraftReview ──▶ POST /api/quotes (unchanged)
```

### Contact matching needs its own tokenizer

`fuzzyMatchContact` (`lib/db/contacts.ts:153`) runs a raw
`ilike('name', '%' + name + '%')`. Passing it the spoken phrase
`"the Mendez place"` matches nothing, because the substring test runs the wrong
direction: the stored name `Mendez` is not a superset of the phrase.

`resolve.ts` therefore tokenizes the extracted client name, queries per
candidate token, and scores the returned contacts. `fuzzyMatchContact` keeps its
current contract — `POST /api/quotes` depends on it and is not in scope here.

## Data model

New paired migration `013_voice_captures.sql` / `013_rollback.sql` in
`db/migrations/`, mirrored into `supabase/migrations/` with a timestamp prefix.

```sql
create table voice_captures (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  quote_id        uuid references quotes(id) on delete set null,
  transcript      text not null,
  duration_sec    numeric(6,2),
  blob_url        text,
  blob_expires_at timestamptz,
  model           text,
  created_at      timestamptz not null default now()
);
create index voice_captures_user_created_idx
  on voice_captures (user_id, created_at desc);
create index voice_captures_expiry_idx
  on voice_captures (blob_expires_at) where blob_url is not null;
```

`gen_random_uuid()`, not `uuid_generate_v4()` — the latter fails on hosted
Supabase.

`quote_id` is nullable with `on delete set null`. Abandoned drafts are the common
case, and deleting a quote must not erase the record of a call that cost money.
`model` records which model produced an extraction, so drift after a model swap
is diagnosable.

## Wire contracts

`lib/voice/schemas.ts`, Zod, matching the validation style of every other route.

```ts
// What the model may emit. Note what is absent.
ExtractedUtterance = {
  clientName: string | null,
  lines: { rawText: string, quantity: number, unit: string | null }[],
}

// What resolve.ts produces.
VoiceDraft = {
  captureId: string,
  transcript: string,
  client:
    | { kind: "matched",  contactId: string, name: string }
    | { kind: "proposed", name: string }
    | { kind: "none" },
  lines: {
    rawText: string,
    quantity: number,
    match:
      | { kind: "catalog", workItemId: string, name: string,
          unitPrice: number, confidence: number }
      | { kind: "adhoc", description: string, unitPrice: 0 },
  }[],
}
```

A catalog match below the confidence threshold degrades to `adhoc` rather than
guessing. An unmatched line the contractor fills in is a better outcome than a
confidently wrong price on a client's invoice.

`{ kind: "proposed" }` pre-fills a new-client row with the spoken name only.
Voice does not carry email or address reliably, and nothing is written to
`contacts` until the contractor submits the quote.

## Tier gating

Mirrors the existing `EMAIL_REQUIRES_PRO` gate:
`resolveTier(user.subscription_tier) !== "ultimate"` → 403
`VOICE_REQUIRES_ULTIMATE`. Always `resolveTier`, never `as Tier` or
`?? "free"` — an unrecognized stored tier must fail closed.

Ultimate **remains** in `UNAVAILABLE_TIERS` when this ships. Nobody can buy the
tier, so in practice only accounts switched through the dev
`PATCH /api/subscription` (flag-guarded, never set in prod) can reach the
feature. That is the intended pre-launch state: the feature is observable in
production before it is sold.

Unlocking is a separate follow-up change — remove `"ultimate"` from
`UNAVAILABLE_TIERS`, verify the landing pricing CTA, `UpgradeDialog`,
`ChangePlanDialog`, and the `TIER_UNAVAILABLE` refusal in
`POST /api/billing/change-plan` all flip together, and confirm the live-mode
`STRIPE_PRICE_ULTIMATE` resolves. Out of scope here.

## Cost control

Voice spends real money per call, which nothing else in this app does. Two
mechanisms, because the existing one is not sufficient alone.

1. **`checkRateLimit` (`lib/rate-limit.ts:20`) is an in-process `Map`.** On Fluid
   Compute that is per-instance, so the effective ceiling is
   `limit × instance count`. Adequate for billing reads. Not a spend control.
   It stays, at 6 requests / 60s, to absorb bursts cheaply.
2. **Persisted daily cap.** Count `voice_captures` for the user since UTC
   midnight; default 40/day; over it → 429 `VOICE_DAILY_LIMIT`. The DB count is
   the real gate.

Edge rejections before any provider call: audio longer than **90 seconds** or
larger than **4 MB** is refused client-side and server-side (Vercel Functions
reject any request body over 4.5 MB with an opaque platform 413 before the
handler runs, so the cap must sit under that line — do not raise it back
toward or above 4.5 MB). A `MediaRecorder` left running in a truck pocket must
not bill an hour of speech-to-text.

## Provider wiring

AI SDK v7 through **Vercel AI Gateway**, addressed with `"provider/model"`
strings rather than a hardcoded `@ai-sdk/*` provider package. The extraction
model can then be swapped without a code change, and spend is visible in one
place. Both calls sit behind `lib/voice/*`; no app code imports a model SDK.

**Open item for the plan, deliberately not guessed here:** whether AI Gateway
fronts speech-to-text the way it fronts text generation. The AI SDK exposes
transcription through `transcribe` (`experimental_transcribe` is deprecated
in v7). The first task of the
implementation plan loads the `vercel:ai-sdk` and `vercel:ai-gateway` skills and
confirms the transcription path before any code is written. If Gateway does not
cover speech-to-text, `transcribe.ts` calls a provider directly — the seam is
already in the right place for either answer.

New environment variables:

```bash
AI_GATEWAY_API_KEY=
VOICE_MODEL_TRANSCRIBE=    # provider/model string
VOICE_MODEL_EXTRACT=       # provider/model string
BLOB_READ_WRITE_TOKEN=     # Vercel Blob, private store
VOICE_MOCK=1               # dev/e2e: fixed transcript + draft, no spend, no mic
```

`VOICE_MOCK` mirrors the existing `RESEND_MOCK` convention so dev and e2e never
spend tokens and never need a working microphone.

## Retention

`/api/cron/purge-voice-audio`, exposing both `GET` and `POST` and guarded by
`CRON_SECRET`, matching `/api/cron/reconcile-billing`. Deletes blobs whose `blob_expires_at` has passed and nulls `blob_url`.
The transcript survives; the audio does not.

## Error handling

Every failure has a defined surface. None of them lose the contractor's work.

| Failure | Behavior |
|---|---|
| Mic permission denied | Inline explanation plus a link to the normal typed form. Never a dead button. |
| No `MediaRecorder` support | Feature-detect and hide the voice entry point rather than fail on tap. |
| Silence, or under 1 second | Rejected client-side. No upload, no spend. |
| Empty or unparseable transcript | 422 with the transcript echoed back, so the contractor sees what was heard. |
| `generateObject` schema violation or model error | One retry, then 502 `VOICE_EXTRACT_FAILED`. The transcript is still returned and the draft falls back to a single ad-hoc line holding it — a bad parse is a head start, not a loss. |
| Blob write fails | **Non-fatal.** Log, continue, leave `blob_url` null. Retention is a debugging convenience and must never cost someone their invoice. |
| Zero catalog matches | Draft renders all-ad-hoc with a nudge toward the Work Catalog, connecting to the existing `CatalogOnboarding` story. |
| Daily cap reached | 429 `VOICE_DAILY_LIMIT` with a plain message. |

## Testing

**Unit tests carry most of the weight**, because `resolve.ts` holds the logic
that can produce a wrong invoice and it has no network dependency.

- `resolve.ts` against fixture transcripts: exact catalog match; plural and
  singular forms (`"light fixture"` vs `"fixtures"`); quantity with a spoken unit
  (`"two hours"`); a sub-threshold match degrading to `adhoc`; an unmatched
  client producing `proposed`; and `"the Mendez place"` matching the contact
  `Mendez`, pinning the tokenizer bug described above.
- Schema tests: `ExtractedUtterance` rejects any payload carrying a price or an
  id. This guards the structural invariant against a future schema edit.
- Tier matrix: extend `lib/__tests__/tier-matrix.test.ts` so free, pro, null and
  an unrecognized tier all receive 403.
- `e2e/voice.spec.ts` with `VOICE_MOCK=1` and Playwright's
  `--use-fake-device-for-media-capture`: record → draft → edit one line → save →
  assert the quote exists with the correct total. `data-testid` on every
  interactive node, per repo convention. The shared e2e user is already Ultimate,
  so the tier baseline holds; if a test changes it, restore in `afterEach`, not
  in a `try/finally`.

**Not tested in CI:** real transcription accuracy. That is a model-quality
question, checked by hand against recorded samples during implementation.

## Success criteria

1. An account on the Ultimate tier — reached through the dev tier switch this
   release, since the tier is not yet purchasable — records a spoken job summary
   and reaches a saved quote without typing a line item description.
2. Every price on the draft traces to one of that contractor's `work_items` rows
   or is left at zero for them to fill.
3. Free and Pro accounts receive 403 `VOICE_REQUIRES_ULTIMATE`.
4. `npm run type-check` and `npm run lint` pass; unit and e2e suites pass.
5. Audio older than seven days is gone from Blob storage; transcripts remain.
