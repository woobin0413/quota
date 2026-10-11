# Voice to Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Ultimate contractor speak a job summary in the app and get a quote draft pre-filled with line items priced from their own work catalog.

**Architecture:** Browser `MediaRecorder` uploads audio to `POST /api/voice/draft`. The route transcribes the audio, asks a model for *structured but price-free* line data, then matches that data against the user's `work_items` and `contacts` in ordinary TypeScript — no model call. The resulting `VoiceDraft` pre-fills the existing `NewQuoteForm`, which saves through the unchanged `POST /api/quotes`. Voice never writes a quote.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Zod, Vitest, Playwright, Supabase (service-role), Vercel AI SDK v7 via AI Gateway, Vercel Blob.

**Spec:** `docs/superpowers/specs/2026-08-08-voice-to-invoice-design.md`

## Global Constraints

- **The extraction schema must never contain a price field or an id field.** `ExtractedUtterance` carries `clientName`, `rawText`, `quantity`, `unit` only. `lib/voice/resolve.ts` is the only code that assigns money.
- **Tier checks use `resolveTier(value)`** from `lib/subscription.ts`. Never `as Tier`, never `?? "free"`. An unrecognized stored tier must fail closed.
- **Ultimate stays in `UNAVAILABLE_TIERS`.** No task in this plan removes it. Unlocking the tier is a separate follow-up change.
- **Every DB query is scoped by `user_id`.** No exceptions.
- **Migrations are paired.** `db/migrations/013_voice_captures.sql` + `013_rollback.sql`, mirrored into `supabase/migrations/` with a timestamp prefix.
- **UUID defaults use `gen_random_uuid()`**, never `uuid_generate_v4()` (fails on hosted Supabase).
- **Audio limits: 90 seconds, 4 MB** (Vercel Functions reject any request body over 4.5 MB with an opaque platform 413 before the handler runs, so the cap must sit under that line). Enforced client-side *and* server-side, before any provider call.
- **`VOICE_MOCK=1` bypasses all provider calls**, mirroring the existing `RESEND_MOCK=1` convention. Dev and e2e never spend tokens and never need a microphone.
- **Interactive components carry stable `data-testid` attributes** — the e2e suite depends on them.
- **Run `npm run type-check` and `npm run lint` before considering any task done.**
- Unit tests: `npm run test` (Vitest). Test files live in `lib/__tests__/`.

## File Structure

| File | Responsibility |
|---|---|
| `lib/voice/config.ts` | Reads and validates voice env vars; exposes `voiceConfig()` and `isVoiceMock()`. |
| `lib/voice/schemas.ts` | Zod contracts: `ExtractedUtteranceSchema`, `VoiceDraft` types. The price-free guarantee lives here. |
| `lib/voice/text.ts` | Pure text helpers: `normalizeTokens`, `containmentScore`. No I/O. |
| `lib/voice/resolve.ts` | `ExtractedUtterance + userId → VoiceDraft`. Catalog and contact matching. No model call. |
| `lib/voice/transcribe.ts` | `audio → { transcript, durationSec }`. Blob write lives here. |
| `lib/voice/extract.ts` | `transcript → ExtractedUtterance` via `generateObject`. |
| `lib/db/voice-captures.ts` | `voice_captures` repository: create, count-since, expired listing, blob clearing. |
| `app/api/voice/draft/route.ts` | Auth → tier gate → limits → orchestrate → `VoiceDraft`. |
| `app/api/cron/purge-voice-audio/route.ts` | `CRON_SECRET`-guarded blob purge. |
| `components/quote/VoiceCapture.tsx` | `MediaRecorder` UI. Emits a `VoiceDraft` to its parent. |
| `components/quote/NewQuoteForm.tsx` | *Modified.* Accepts a `VoiceDraft` and pre-fills client + lines. |
| `db/migrations/013_voice_captures.sql` (+ rollback, + supabase mirror) | `voice_captures` table. |

**Deviation from the spec, deliberate:** the spec named a separate `VoiceDraftReview.tsx`. Implementing it would duplicate the line editor that `NewQuoteForm` already has. Instead `VoiceCapture` hands the draft to `NewQuoteForm`, which pre-fills its existing editable rows. Same user-visible behavior, one editor, and it keeps the spec's rule that voice is a populator and not a second write path.

---

### Task 1: Voice config module and provider verification

Before any code: confirm how transcription is actually reached. The spec left this open on purpose.

**Files:**
- Create: `lib/voice/config.ts`
- Test: `lib/__tests__/voice-config.test.ts`
- Modify: `package.json` (dependencies), `.env.example` if present, `CLAUDE.md` (env var block)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `isVoiceMock(): boolean`
  - `voiceConfig(): { transcribeModel: string; extractModel: string; blobToken: string | undefined }` — throws `Error` with a named message when a required var is missing and mock mode is off

- [ ] **Step 1: Verify the transcription path before writing provider code**

Load the `vercel:ai-sdk` skill and the `vercel:ai-gateway` skill. Answer one question and write the answer into `lib/voice/config.ts` as a comment:

> Does AI Gateway front speech-to-text, or must `transcribe.ts` call a provider directly?

The AI SDK exposes transcription through `experimental_transcribe`. If Gateway covers it, `VOICE_MODEL_TRANSCRIBE` is a `"provider/model"` string routed through Gateway. If it does not, `VOICE_MODEL_TRANSCRIBE` names a direct provider model and that provider's package is added in the next step. Either answer is acceptable — record which one is true, because Task 5 depends on it.

- [ ] **Step 2: Install dependencies**

```bash
npm install ai @vercel/blob
```

If Step 1 determined Gateway does not front speech-to-text, also install the direct provider package the skill identified.

- [ ] **Step 3: Write the failing test**

Create `lib/__tests__/voice-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isVoiceMock, voiceConfig } from "@/lib/voice/config";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
beforeEach(() => {
  delete process.env.VOICE_MOCK;
  delete process.env.VOICE_MODEL_TRANSCRIBE;
  delete process.env.VOICE_MODEL_EXTRACT;
});

describe("voice config", () => {
  it("reports mock mode only when VOICE_MOCK is exactly '1'", () => {
    expect(isVoiceMock()).toBe(false);
    process.env.VOICE_MOCK = "0";
    expect(isVoiceMock()).toBe(false);
    process.env.VOICE_MOCK = "1";
    expect(isVoiceMock()).toBe(true);
  });

  it("throws a named error when a model is missing and mock is off", () => {
    expect(() => voiceConfig()).toThrowError(/VOICE_MODEL_TRANSCRIBE/);
  });

  it("returns the configured models", () => {
    process.env.VOICE_MODEL_TRANSCRIBE = "openai/whisper-1";
    process.env.VOICE_MODEL_EXTRACT = "anthropic/claude-sonnet-5";
    const cfg = voiceConfig();
    expect(cfg.transcribeModel).toBe("openai/whisper-1");
    expect(cfg.extractModel).toBe("anthropic/claude-sonnet-5");
  });

  it("does not throw in mock mode even with nothing configured", () => {
    process.env.VOICE_MOCK = "1";
    expect(() => voiceConfig()).not.toThrow();
  });
});
```

- [ ] **Step 4: Run the test and verify it fails**

Run: `npm run test -- voice-config`
Expected: FAIL — cannot resolve `@/lib/voice/config`.

- [ ] **Step 5: Write the implementation**

Create `lib/voice/config.ts`:

```ts
/**
 * Voice pipeline configuration.
 *
 * Models are addressed as "provider/model" strings so the extraction model can
 * be swapped without a code change. VOICE_MOCK=1 bypasses every provider call,
 * mirroring RESEND_MOCK — dev and e2e must never spend tokens.
 *
 * Transcription routing: replace this line with the Step 1 finding, in the form
 * "AI Gateway fronts speech-to-text, so VOICE_MODEL_TRANSCRIBE is a
 * provider/model string" or "AI Gateway does not front speech-to-text, so
 * transcribe.ts calls <provider> directly". Task 5 depends on which is true.
 */

export function isVoiceMock(): boolean {
  return process.env.VOICE_MOCK === "1";
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Voice is not configured: ${name} is missing`);
  }
  return value;
}

export function voiceConfig(): {
  transcribeModel: string;
  extractModel: string;
  blobToken: string | undefined;
} {
  if (isVoiceMock()) {
    return {
      transcribeModel: "mock/transcribe",
      extractModel: "mock/extract",
      blobToken: undefined,
    };
  }
  return {
    transcribeModel: required("VOICE_MODEL_TRANSCRIBE"),
    extractModel: required("VOICE_MODEL_EXTRACT"),
    // Optional by design: a failed blob write must never cost a contractor
    // their invoice, so retention degrades rather than blocking.
    blobToken: process.env.BLOB_READ_WRITE_TOKEN,
  };
}
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `npm run test -- voice-config`
Expected: PASS, 4 tests.

- [ ] **Step 7: Document the env vars**

Add to the `CLAUDE.md` environment block, after the Stripe section:

```bash
# Voice to invoice (Ultimate)
AI_GATEWAY_API_KEY=
VOICE_MODEL_TRANSCRIBE=    # provider/model string for speech-to-text
VOICE_MODEL_EXTRACT=       # provider/model string for structured extraction
BLOB_READ_WRITE_TOKEN=     # Vercel Blob, private store; audio purged at 7 days
VOICE_MOCK=1               # dev/e2e: fixed transcript + draft, no spend, no mic
```

- [ ] **Step 8: Verify and commit**

```bash
npm run type-check && npm run lint && npm run test -- voice-config
git add lib/voice/config.ts lib/__tests__/voice-config.test.ts package.json package-lock.json CLAUDE.md
git commit -m "feat(voice): add voice pipeline configuration and mock switch"
```

---

### Task 2: `voice_captures` migration and repository

**Files:**
- Create: `db/migrations/013_voice_captures.sql`
- Create: `db/migrations/013_rollback.sql`
- Create: `supabase/migrations/20260808000000_voice_captures.sql`
- Create: `lib/db/voice-captures.ts`
- Test: `lib/__tests__/voice-captures-repo.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` from `@/lib/db/core`
- Produces:
  - `createVoiceCapture(userId: string, input: { transcript: string; durationSec: number; blobUrl?: string; blobExpiresAt?: string; model?: string }): Promise<{ id: string }>`
  - `countVoiceCapturesSince(userId: string, since: Date): Promise<number>`
  - `listExpiredAudio(now: Date, limit?: number): Promise<{ id: string; blob_url: string }[]>`
  - `clearVoiceAudio(ids: string[]): Promise<void>`

- [ ] **Step 1: Write the migration**

Create `db/migrations/013_voice_captures.sql`:

```sql
-- 013_voice_captures.sql
-- Records every voice capture: the transcript (kept), the audio blob
-- (purged at 7 days), and which model produced the extraction.

CREATE TABLE IF NOT EXISTS voice_captures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Nullable: abandoned drafts are the common case, and deleting a quote must
  -- not erase the record of a call that cost money.
  quote_id        UUID REFERENCES quotes(id) ON DELETE SET NULL,
  transcript      TEXT NOT NULL,
  duration_sec    NUMERIC(6,2),
  blob_url        TEXT,
  blob_expires_at TIMESTAMPTZ,
  model           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS voice_captures_user_created_idx
  ON voice_captures (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS voice_captures_expiry_idx
  ON voice_captures (blob_expires_at) WHERE blob_url IS NOT NULL;
```

Create `db/migrations/013_rollback.sql`:

```sql
-- 013_rollback.sql
DROP INDEX IF EXISTS voice_captures_expiry_idx;
DROP INDEX IF EXISTS voice_captures_user_created_idx;
DROP TABLE IF EXISTS voice_captures;
```

- [ ] **Step 2: Mirror into the Supabase migrations directory**

```bash
cp db/migrations/013_voice_captures.sql supabase/migrations/20260808000000_voice_captures.sql
```

Then open `supabase/migrations/011_lockdown_anon_access` (whatever timestamped filename it carries) and confirm whether it revokes grants table-by-table or schema-wide. If it is table-by-table, append matching `REVOKE ALL ON voice_captures FROM anon, authenticated;` to the new mirror file. If it revokes schema USAGE wholesale, nothing further is needed — note which was true in the commit message.

- [ ] **Step 3: Apply the migration locally and verify**

```bash
supabase db reset
```

Expected: completes without error. Then confirm the table exists:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d voice_captures"
```

Expected: the eight columns above, with `id` defaulting to `gen_random_uuid()`.

- [ ] **Step 4: Write the failing repository test**

Create `lib/__tests__/voice-captures-repo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/db/core", () => ({ supabaseAdmin: { from: (t: string) => from(t) } }));

import {
  countVoiceCapturesSince,
  createVoiceCapture,
} from "@/lib/db/voice-captures";

beforeEach(() => vi.clearAllMocks());

describe("voice-captures repository", () => {
  it("inserts scoped to the user and returns the new id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "vc1" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    from.mockReturnValue({ insert });

    const result = await createVoiceCapture("user-1", {
      transcript: "two hours of drywall repair",
      durationSec: 4.2,
    });

    expect(from).toHaveBeenCalledWith("voice_captures");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", transcript: "two hours of drywall repair" })
    );
    expect(result.id).toBe("vc1");
  });

  it("counts only the caller's captures since a timestamp", async () => {
    const gte = vi.fn().mockResolvedValue({ count: 7, error: null });
    const eq = vi.fn().mockReturnValue({ gte });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });

    const since = new Date("2026-08-08T00:00:00Z");
    const count = await countVoiceCapturesSince("user-1", since);

    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(gte).toHaveBeenCalledWith("created_at", since.toISOString());
    expect(count).toBe(7);
  });
});
```

- [ ] **Step 5: Run the test and verify it fails**

Run: `npm run test -- voice-captures-repo`
Expected: FAIL — cannot resolve `@/lib/db/voice-captures`.

- [ ] **Step 6: Write the repository**

Create `lib/db/voice-captures.ts`:

```ts
/**
 * voice_captures repository.
 *
 * Every read and write is scoped by user_id, except the purge helpers, which
 * operate on blob expiry across all users and are reachable only from the
 * CRON_SECRET-guarded cron route.
 */

import { supabaseAdmin } from "@/lib/db/core";

export interface CreateVoiceCaptureInput {
  transcript: string;
  durationSec: number;
  blobUrl?: string;
  blobExpiresAt?: string;
  model?: string;
}

export async function createVoiceCapture(
  userId: string,
  input: CreateVoiceCaptureInput
): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from("voice_captures")
    .insert({
      user_id: userId,
      transcript: input.transcript,
      duration_sec: input.durationSec,
      blob_url: input.blobUrl ?? null,
      blob_expires_at: input.blobExpiresAt ?? null,
      model: input.model ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { id: (data as { id: string }).id };
}

export async function countVoiceCapturesSince(
  userId: string,
  since: Date
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("voice_captures")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since.toISOString());

  if (error) throw error;
  return count ?? 0;
}

export async function listExpiredAudio(
  now: Date,
  limit = 200
): Promise<{ id: string; blob_url: string }[]> {
  const { data, error } = await supabaseAdmin
    .from("voice_captures")
    .select("id, blob_url")
    .not("blob_url", "is", null)
    .lt("blob_expires_at", now.toISOString())
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as { id: string; blob_url: string }[];
}

export async function clearVoiceAudio(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabaseAdmin
    .from("voice_captures")
    .update({ blob_url: null, blob_expires_at: null })
    .in("id", ids);

  if (error) throw error;
}
```

- [ ] **Step 7: Run the test and verify it passes**

Run: `npm run test -- voice-captures-repo`
Expected: PASS, 2 tests.

- [ ] **Step 8: Verify and commit**

```bash
npm run type-check && npm run lint && npm run test
git add db/migrations/013_voice_captures.sql db/migrations/013_rollback.sql supabase/migrations/20260808000000_voice_captures.sql lib/db/voice-captures.ts lib/__tests__/voice-captures-repo.test.ts
git commit -m "feat(voice): add voice_captures table and repository"
```

---

### Task 3: Wire contracts — the price-free extraction schema

**Files:**
- Create: `lib/voice/schemas.ts`
- Test: `lib/__tests__/voice-schemas.test.ts`

**Interfaces:**
- Consumes: `zod`
- Produces:
  - `ExtractedUtteranceSchema` (Zod) and `type ExtractedUtterance`
  - `type VoiceDraft`, `type VoiceDraftLine`, `type VoiceDraftClient`
  - `CATALOG_MATCH_THRESHOLD = 0.6`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/voice-schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ExtractedUtteranceSchema } from "@/lib/voice/schemas";

describe("ExtractedUtteranceSchema", () => {
  it("accepts a well-formed utterance", () => {
    const parsed = ExtractedUtteranceSchema.parse({
      clientName: "the Mendez place",
      lines: [{ rawText: "drywall repair", quantity: 2, unit: "hour" }],
    });
    expect(parsed.lines[0].quantity).toBe(2);
  });

  it("accepts a null client name", () => {
    const parsed = ExtractedUtteranceSchema.parse({ clientName: null, lines: [] });
    expect(parsed.clientName).toBeNull();
  });

  // The load-bearing guarantee: the model has nowhere to put a price or an id.
  it("strips a price the model tried to emit", () => {
    const parsed = ExtractedUtteranceSchema.parse({
      clientName: null,
      lines: [{ rawText: "drywall repair", quantity: 1, unit: null, unitPrice: 450 }],
    });
    expect(parsed.lines[0]).not.toHaveProperty("unitPrice");
  });

  it("strips a workItemId the model tried to emit", () => {
    const parsed = ExtractedUtteranceSchema.parse({
      clientName: null,
      lines: [{ rawText: "drywall repair", quantity: 1, unit: null, workItemId: "abc" }],
    });
    expect(parsed.lines[0]).not.toHaveProperty("workItemId");
  });

  it("rejects a non-positive quantity", () => {
    const result = ExtractedUtteranceSchema.safeParse({
      clientName: null,
      lines: [{ rawText: "drywall repair", quantity: 0, unit: null }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more lines than a single utterance can plausibly carry", () => {
    const lines = Array.from({ length: 51 }, () => ({
      rawText: "x",
      quantity: 1,
      unit: null,
    }));
    expect(ExtractedUtteranceSchema.safeParse({ clientName: null, lines }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test -- voice-schemas`
Expected: FAIL — cannot resolve `@/lib/voice/schemas`.

- [ ] **Step 3: Write the schemas**

Create `lib/voice/schemas.ts`:

```ts
/**
 * Voice pipeline wire contracts.
 *
 * ExtractedUtterance is what the model may emit. It has no unitPrice field and
 * no id field — not "the model is told not to", but structurally unable. A
 * model that picks the $450 catalog line instead of the $45 one produces a
 * wrong invoice sent to a real client under the contractor's name, so pricing
 * stays in resolve.ts, which reads only the contractor's own work_items rows.
 *
 * Zod objects strip unknown keys by default; the tests pin that behavior so a
 * future `.passthrough()` cannot quietly reopen the hole.
 */

import { z } from "zod";

/** Below this containment score a catalog match degrades to an ad-hoc line. */
export const CATALOG_MATCH_THRESHOLD = 0.6;

export const ExtractedLineSchema = z.object({
  /** The spoken phrase for this piece of work, verbatim. */
  rawText: z.string().min(1).max(300),
  quantity: z.number().positive().max(10_000),
  /** Spoken unit if one was said ("hour", "square foot"), else null. */
  unit: z.string().max(40).nullable(),
});

export const ExtractedUtteranceSchema = z.object({
  clientName: z.string().max(200).nullable(),
  lines: z.array(ExtractedLineSchema).max(50),
});

export type ExtractedLine = z.infer<typeof ExtractedLineSchema>;
export type ExtractedUtterance = z.infer<typeof ExtractedUtteranceSchema>;

export type VoiceDraftClient =
  | { kind: "matched"; contactId: string; name: string }
  | { kind: "proposed"; name: string }
  | { kind: "none" };

export type VoiceDraftMatch =
  | {
      kind: "catalog";
      workItemId: string;
      name: string;
      unit: string;
      unitPrice: number;
      confidence: number;
    }
  | { kind: "adhoc"; description: string; unitPrice: 0 };

export interface VoiceDraftLine {
  rawText: string;
  quantity: number;
  match: VoiceDraftMatch;
}

export interface VoiceDraft {
  captureId: string;
  transcript: string;
  client: VoiceDraftClient;
  lines: VoiceDraftLine[];
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test -- voice-schemas`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
npm run type-check && npm run lint
git add lib/voice/schemas.ts lib/__tests__/voice-schemas.test.ts
git commit -m "feat(voice): define price-free extraction contract and draft types"
```

---

### Task 4: Text helpers and deterministic resolution

This task holds the logic that can produce a wrong invoice. It has no network dependency, so it gets the heaviest test coverage in the plan.

**Files:**
- Create: `lib/voice/text.ts`
- Create: `lib/voice/resolve.ts`
- Test: `lib/__tests__/voice-text.test.ts`
- Test: `lib/__tests__/voice-resolve.test.ts`

**Interfaces:**
- Consumes: `ExtractedUtterance`, `VoiceDraft`, `CATALOG_MATCH_THRESHOLD` from Task 3; `getWorkItems(userId, options?)` from `@/lib/db/work-items`; `fuzzyMatchContact(userId, name)` from `@/lib/db/contacts`
- Produces:
  - `normalizeTokens(text: string): string[]`
  - `containmentScore(candidateTokens: string[], targetTokens: string[]): number`
  - `resolveDraft(userId: string, utterance: ExtractedUtterance, meta: { captureId: string; transcript: string }): Promise<VoiceDraft>`

- [ ] **Step 1: Write the failing text-helper test**

Create `lib/__tests__/voice-text.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { containmentScore, normalizeTokens } from "@/lib/voice/text";

describe("normalizeTokens", () => {
  it("lowercases, strips punctuation, and drops filler words", () => {
    expect(normalizeTokens("The Mendez place!")).toEqual(["mendez"]);
  });

  it("singularizes plurals so 'fixtures' matches 'fixture'", () => {
    expect(normalizeTokens("light fixtures")).toEqual(["light", "fixture"]);
  });

  it("keeps short words that are not filler", () => {
    expect(normalizeTokens("tile job")).toEqual(["tile"]);
  });

  it("returns an empty array for pure filler", () => {
    expect(normalizeTokens("the place")).toEqual([]);
  });
});

describe("containmentScore", () => {
  it("scores 1 when every target token appears in the candidate", () => {
    expect(containmentScore(["drywall", "repair", "upstair"], ["drywall", "repair"])).toBe(1);
  });

  it("scores 0.5 when half the target tokens appear", () => {
    expect(containmentScore(["drywall"], ["drywall", "repair"])).toBe(0.5);
  });

  it("scores 0 against an empty target", () => {
    expect(containmentScore(["drywall"], [])).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm run test -- voice-text`
Expected: FAIL — cannot resolve `@/lib/voice/text`.

- [ ] **Step 3: Write the text helpers**

Create `lib/voice/text.ts`:

```ts
/**
 * Pure text helpers for voice matching. No I/O, no model calls — this is the
 * layer the matching tests exercise directly.
 */

/**
 * Words that carry no matching signal in spoken job notes. "The Mendez place"
 * and "Mendez" must reduce to the same token set, or contact matching fails on
 * every naturally-spoken client reference.
 */
const FILLER = new Set([
  "the", "a", "an", "and", "or", "of", "for", "at", "on", "in", "to",
  "place", "job", "site", "house", "home", "property", "residence",
  "some", "few", "couple", "did", "done", "was", "were", "is", "are",
]);

/** Crude singularization: enough for "fixtures" → "fixture", no dictionary. */
function singularize(word: string): string {
  if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !FILLER.has(w))
    .map(singularize)
    .filter((w) => !FILLER.has(w));
}

/**
 * Fraction of the target's tokens present in the candidate.
 *
 * Deliberately asymmetric. The catalog item name is the target: a spoken line
 * that says more than the catalog name ("drywall repair upstairs") should
 * still match "drywall repair" at 1.0, while a spoken line that says less
 * ("drywall") should not.
 */
export function containmentScore(
  candidateTokens: string[],
  targetTokens: string[]
): number {
  if (targetTokens.length === 0) return 0;
  const candidate = new Set(candidateTokens);
  const hits = targetTokens.filter((t) => candidate.has(t)).length;
  return hits / targetTokens.length;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npm run test -- voice-text`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing resolution test**

Create `lib/__tests__/voice-resolve.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getWorkItems = vi.fn();
const fuzzyMatchContact = vi.fn();

vi.mock("@/lib/db/work-items", () => ({ getWorkItems: (...a: unknown[]) => getWorkItems(...a) }));
vi.mock("@/lib/db/contacts", () => ({ fuzzyMatchContact: (...a: unknown[]) => fuzzyMatchContact(...a) }));

import { resolveDraft } from "@/lib/voice/resolve";

const META = { captureId: "vc1", transcript: "..." };

const CATALOG = [
  { id: "wi-drywall", name: "Drywall repair", unit_of_measure: "hour", defaultUnitPrice: 85 },
  { id: "wi-fixture", name: "Light fixture install", unit_of_measure: "each", defaultUnitPrice: 120 },
  { id: "wi-premium", name: "Drywall repair premium ceiling", unit_of_measure: "hour", defaultUnitPrice: 450 },
];

beforeEach(() => {
  vi.clearAllMocks();
  getWorkItems.mockResolvedValue(CATALOG);
  fuzzyMatchContact.mockResolvedValue([]);
});

describe("resolveDraft — catalog matching", () => {
  it("matches a spoken line to a catalog item and takes ITS price", async () => {
    const draft = await resolveDraft(
      "u1",
      { clientName: null, lines: [{ rawText: "drywall repair", quantity: 2, unit: "hour" }] },
      META
    );
    expect(draft.lines[0].match).toMatchObject({
      kind: "catalog",
      workItemId: "wi-drywall",
      unitPrice: 85,
    });
  });

  it("matches plurals to the singular catalog name", async () => {
    const draft = await resolveDraft(
      "u1",
      { clientName: null, lines: [{ rawText: "light fixtures install", quantity: 1, unit: null }] },
      META
    );
    expect(draft.lines[0].match).toMatchObject({ kind: "catalog", workItemId: "wi-fixture" });
  });

  // The failure that matters most: never silently pick the dearer neighbour.
  it("prefers the tighter match over a longer, pricier catalog name", async () => {
    const draft = await resolveDraft(
      "u1",
      { clientName: null, lines: [{ rawText: "drywall repair", quantity: 1, unit: null }] },
      META
    );
    expect(draft.lines[0].match).toMatchObject({ workItemId: "wi-drywall", unitPrice: 85 });
  });

  it("degrades to an ad-hoc line at zero price below the threshold", async () => {
    const draft = await resolveDraft(
      "u1",
      { clientName: null, lines: [{ rawText: "hauled away the old deck", quantity: 1, unit: null }] },
      META
    );
    expect(draft.lines[0].match).toEqual({
      kind: "adhoc",
      description: "hauled away the old deck",
      unitPrice: 0,
    });
  });

  it("carries the spoken quantity through unchanged", async () => {
    const draft = await resolveDraft(
      "u1",
      { clientName: null, lines: [{ rawText: "drywall repair", quantity: 2.5, unit: "hour" }] },
      META
    );
    expect(draft.lines[0].quantity).toBe(2.5);
  });

  it("produces an all-ad-hoc draft when the catalog is empty", async () => {
    getWorkItems.mockResolvedValue([]);
    const draft = await resolveDraft(
      "u1",
      { clientName: null, lines: [{ rawText: "drywall repair", quantity: 1, unit: null }] },
      META
    );
    expect(draft.lines[0].match.kind).toBe("adhoc");
  });

  it("scopes the catalog read to the calling user", async () => {
    await resolveDraft("u1", { clientName: null, lines: [] }, META);
    expect(getWorkItems).toHaveBeenCalledWith("u1");
  });
});

describe("resolveDraft — client matching", () => {
  // Pins the fuzzyMatchContact direction bug: ILIKE '%the Mendez place%'
  // matches nothing, so resolve must query by token.
  it("matches 'the Mendez place' to the contact 'Mendez'", async () => {
    fuzzyMatchContact.mockImplementation(async (_u: string, name: string) =>
      name === "mendez" ? [{ id: "c1", name: "Mendez" }] : []
    );
    const draft = await resolveDraft("u1", { clientName: "the Mendez place", lines: [] }, META);
    expect(draft.client).toEqual({ kind: "matched", contactId: "c1", name: "Mendez" });
  });

  it("proposes a new client when nothing matches", async () => {
    const draft = await resolveDraft("u1", { clientName: "Okonkwo", lines: [] }, META);
    expect(draft.client).toEqual({ kind: "proposed", name: "Okonkwo" });
  });

  it("returns kind 'none' when no client was spoken", async () => {
    const draft = await resolveDraft("u1", { clientName: null, lines: [] }, META);
    expect(draft.client).toEqual({ kind: "none" });
  });

  it("picks the closest contact when several come back", async () => {
    fuzzyMatchContact.mockResolvedValue([
      { id: "c2", name: "Mendez Construction Partners LLC" },
      { id: "c1", name: "Mendez" },
    ]);
    const draft = await resolveDraft("u1", { clientName: "Mendez", lines: [] }, META);
    expect(draft.client).toMatchObject({ kind: "matched", contactId: "c1" });
  });
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npm run test -- voice-resolve`
Expected: FAIL — cannot resolve `@/lib/voice/resolve`.

- [ ] **Step 7: Write the resolver**

Create `lib/voice/resolve.ts`:

```ts
/**
 * Turns an ExtractedUtterance into a VoiceDraft.
 *
 * This module assigns every price in the product's voice path, and it does so
 * only from the contractor's own work_items rows. There is no model call here
 * and there must never be one: a confidently wrong price reaches a real client
 * under the contractor's name.
 */

import { getWorkItems } from "@/lib/db/work-items";
import { fuzzyMatchContact } from "@/lib/db/contacts";
import { containmentScore, normalizeTokens } from "@/lib/voice/text";
import {
  CATALOG_MATCH_THRESHOLD,
  type ExtractedUtterance,
  type VoiceDraft,
  type VoiceDraftClient,
  type VoiceDraftLine,
} from "@/lib/voice/schemas";

interface CatalogCandidate {
  id: string;
  name: string;
  unit: string;
  unitPrice: number;
  tokens: string[];
}

function bestCatalogMatch(
  rawText: string,
  candidates: CatalogCandidate[]
): { candidate: CatalogCandidate; confidence: number } | null {
  const spoken = normalizeTokens(rawText);
  if (spoken.length === 0) return null;

  let best: { candidate: CatalogCandidate; confidence: number } | null = null;

  for (const candidate of candidates) {
    const confidence = containmentScore(spoken, candidate.tokens);
    if (confidence < CATALOG_MATCH_THRESHOLD) continue;

    // Tie-break toward the tighter name. Two items can both score 1.0 when one
    // name is a subset of the other ("Drywall repair" vs "Drywall repair
    // premium ceiling"); the shorter is the one that was actually said.
    if (
      !best ||
      confidence > best.confidence ||
      (confidence === best.confidence &&
        candidate.tokens.length < best.candidate.tokens.length)
    ) {
      best = { candidate, confidence };
    }
  }

  return best;
}

async function resolveClient(
  userId: string,
  clientName: string | null
): Promise<VoiceDraftClient> {
  if (!clientName) return { kind: "none" };

  // fuzzyMatchContact is a raw ILIKE '%name%'. Handing it the spoken phrase
  // runs the substring test the wrong way round, so query by token instead.
  const tokens = normalizeTokens(clientName);
  const seen = new Map<string, { id: string; name: string }>();

  for (const token of tokens) {
    const matches = (await fuzzyMatchContact(userId, token)) as {
      id: string;
      name: string;
    }[];
    for (const match of matches) seen.set(match.id, match);
  }

  if (seen.size === 0) return { kind: "proposed", name: clientName };

  // Closest = fewest extra tokens beyond what was spoken.
  const spoken = new Set(tokens);
  const ranked = [...seen.values()].sort((a, b) => {
    const extra = (n: string) =>
      normalizeTokens(n).filter((t) => !spoken.has(t)).length;
    return extra(a.name) - extra(b.name);
  });

  return { kind: "matched", contactId: ranked[0].id, name: ranked[0].name };
}

export async function resolveDraft(
  userId: string,
  utterance: ExtractedUtterance,
  meta: { captureId: string; transcript: string }
): Promise<VoiceDraft> {
  const workItems = await getWorkItems(userId);

  const candidates: CatalogCandidate[] = workItems.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit_of_measure,
    unitPrice: item.defaultUnitPrice,
    tokens: normalizeTokens(item.name),
  }));

  const lines: VoiceDraftLine[] = utterance.lines.map((line) => {
    const match = bestCatalogMatch(line.rawText, candidates);

    if (!match) {
      return {
        rawText: line.rawText,
        quantity: line.quantity,
        match: { kind: "adhoc", description: line.rawText, unitPrice: 0 },
      };
    }

    return {
      rawText: line.rawText,
      quantity: line.quantity,
      match: {
        kind: "catalog",
        workItemId: match.candidate.id,
        name: match.candidate.name,
        unit: match.candidate.unit,
        unitPrice: match.candidate.unitPrice,
        confidence: match.confidence,
      },
    };
  });

  return {
    captureId: meta.captureId,
    transcript: meta.transcript,
    client: await resolveClient(userId, utterance.clientName),
    lines,
  };
}
```

- [ ] **Step 8: Run both test files and verify they pass**

Run: `npm run test -- voice-resolve voice-text`
Expected: PASS, 18 tests total.

- [ ] **Step 9: Verify and commit**

```bash
npm run type-check && npm run lint && npm run test
git add lib/voice/text.ts lib/voice/resolve.ts lib/__tests__/voice-text.test.ts lib/__tests__/voice-resolve.test.ts
git commit -m "feat(voice): resolve spoken lines against the contractor's catalog"
```

---

### Task 5: Transcription and extraction

**Files:**
- Create: `lib/voice/transcribe.ts`
- Create: `lib/voice/extract.ts`
- Test: `lib/__tests__/voice-extract.test.ts`

**Interfaces:**
- Consumes: `voiceConfig()`, `isVoiceMock()` from Task 1; `ExtractedUtteranceSchema` from Task 3
- Produces:
  - `transcribeAudio(audio: Buffer, contentType: string): Promise<{ transcript: string; durationSec: number; blobUrl?: string; blobExpiresAt?: string }>`
  - `extractUtterance(transcript: string): Promise<ExtractedUtterance>`
  - `MOCK_TRANSCRIPT` (from `transcribe.ts`) — the fixed transcript returned under `VOICE_MOCK=1`
  - `MOCK_UTTERANCE` (from `extract.ts`) — the fixed two-line utterance returned under `VOICE_MOCK=1`; the e2e spec's "two lines, client Mendez" assertions come from here
  - `AUDIO_RETENTION_DAYS = 7`

- [ ] **Step 1: Write the failing extraction test**

Create `lib/__tests__/voice-extract.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...a: unknown[]) => generateObject(...a) }));

import { extractUtterance } from "@/lib/voice/extract";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VOICE_MOCK;
  process.env.VOICE_MODEL_TRANSCRIBE = "openai/whisper-1";
  process.env.VOICE_MODEL_EXTRACT = "anthropic/claude-sonnet-5";
});

describe("extractUtterance", () => {
  it("returns the validated utterance", async () => {
    generateObject.mockResolvedValue({
      object: {
        clientName: "Mendez",
        lines: [{ rawText: "drywall repair", quantity: 2, unit: "hour" }],
      },
    });
    const result = await extractUtterance("two hours of drywall repair for Mendez");
    expect(result.lines).toHaveLength(1);
    expect(result.clientName).toBe("Mendez");
  });

  it("retries once when the first call throws, then succeeds", async () => {
    generateObject
      .mockRejectedValueOnce(new Error("schema violation"))
      .mockResolvedValueOnce({ object: { clientName: null, lines: [] } });
    const result = await extractUtterance("mumble");
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(result.lines).toEqual([]);
  });

  it("throws after two failures so the route can return 502", async () => {
    generateObject.mockRejectedValue(new Error("still broken"));
    await expect(extractUtterance("mumble")).rejects.toThrow();
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("strips a price the model emitted despite the schema", async () => {
    generateObject.mockResolvedValue({
      object: {
        clientName: null,
        lines: [{ rawText: "drywall", quantity: 1, unit: null, unitPrice: 999 }],
      },
    });
    const result = await extractUtterance("drywall");
    expect(result.lines[0]).not.toHaveProperty("unitPrice");
  });

  it("never calls the model in mock mode", async () => {
    process.env.VOICE_MOCK = "1";
    const result = await extractUtterance("anything");
    expect(generateObject).not.toHaveBeenCalled();
    expect(result.lines.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm run test -- voice-extract`
Expected: FAIL — cannot resolve `@/lib/voice/extract`.

- [ ] **Step 3: Write the extractor**

Create `lib/voice/extract.ts`:

```ts
/**
 * Structured extraction from a transcript.
 *
 * The output schema carries no price and no id (see lib/voice/schemas.ts), so
 * the model's job is narrow: split the utterance into pieces of work with
 * quantities, and name the client if one was mentioned.
 */

import { generateObject } from "ai";
import { isVoiceMock, voiceConfig } from "@/lib/voice/config";
import {
  ExtractedUtteranceSchema,
  type ExtractedUtterance,
} from "@/lib/voice/schemas";

const SYSTEM_PROMPT = `You convert a contractor's spoken job notes into structured line items.

Rules:
- Split the utterance into one entry per distinct piece of work.
- rawText is the spoken phrase for that work, verbatim, without quantities.
- quantity is the number spoken ("two hours" -> 2). Default to 1 when none is said.
- unit is the spoken unit ("hour", "square foot") or null.
- clientName is the person or property the work was for, or null if none was said.
- Never invent work that was not spoken. Never estimate prices; you cannot report them.`;

/** Fixed output for VOICE_MOCK=1. The e2e spec asserts against these values. */
export const MOCK_UTTERANCE: ExtractedUtterance = {
  clientName: "Mendez",
  lines: [
    { rawText: "drywall repair", quantity: 2, unit: "hour" },
    { rawText: "light fixture install", quantity: 1, unit: "each" },
  ],
};

export async function extractUtterance(
  transcript: string
): Promise<ExtractedUtterance> {
  if (isVoiceMock()) return MOCK_UTTERANCE;

  const { extractModel } = voiceConfig();

  // One retry: a schema violation is usually a sampling accident, and a second
  // attempt is far cheaper than making the contractor record again.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { object } = await generateObject({
        model: extractModel,
        schema: ExtractedUtteranceSchema,
        system: SYSTEM_PROMPT,
        prompt: transcript,
      });
      return ExtractedUtteranceSchema.parse(object);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npm run test -- voice-extract`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the transcriber**

Create `lib/voice/transcribe.ts`. Use the transcription call form confirmed in Task 1 Step 1 — if AI Gateway fronts speech-to-text, the model is the `voiceConfig().transcribeModel` string; if not, it is the direct provider's model object.

```ts
/**
 * Speech to text, plus the audio's 7-day retention write.
 *
 * The Blob write is deliberately non-fatal: retention exists to debug a bad
 * parse, and it must never cost a contractor their invoice.
 */

import { experimental_transcribe as transcribe } from "ai";
import { put } from "@vercel/blob";
import { isVoiceMock, voiceConfig } from "@/lib/voice/config";
import { logger } from "@/lib/logger";

export const AUDIO_RETENTION_DAYS = 7;

/** Fixed transcript for VOICE_MOCK=1. The e2e spec asserts against this. */
export const MOCK_TRANSCRIPT =
  "Two hours of drywall repair and a light fixture install for Mendez.";

export interface TranscriptionResult {
  transcript: string;
  durationSec: number;
  blobUrl?: string;
  blobExpiresAt?: string;
}

async function storeAudio(
  audio: Buffer,
  contentType: string
): Promise<{ blobUrl?: string; blobExpiresAt?: string }> {
  const { blobToken } = voiceConfig();
  if (!blobToken) return {};

  try {
    const key = `voice/${crypto.randomUUID()}`;
    const blob = await put(key, audio, {
      access: "public",
      addRandomSuffix: false,
      contentType,
      token: blobToken,
    });
    const expires = new Date(
      Date.now() + AUDIO_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );
    return { blobUrl: blob.url, blobExpiresAt: expires.toISOString() };
  } catch (error) {
    logger.error("Voice: audio retention write failed", { err: error });
    return {};
  }
}

export async function transcribeAudio(
  audio: Buffer,
  contentType: string
): Promise<TranscriptionResult> {
  if (isVoiceMock()) {
    return { transcript: MOCK_TRANSCRIPT, durationSec: 4.2 };
  }

  const { transcribeModel } = voiceConfig();
  const result = await transcribe({
    model: transcribeModel,
    audio,
  });

  const stored = await storeAudio(audio, contentType);

  return {
    transcript: result.text,
    durationSec: result.durationInSeconds ?? 0,
    ...stored,
  };
}
```

**If Task 1 found that Blob's private access mode is available on this account**, change `access: "public"` to the private mode and have the cron purge continue to work against the same key — a public URL for job-site audio is a privacy leak the retention window does not excuse. Record which mode was used in the commit message.

- [ ] **Step 6: Verify types and commit**

```bash
npm run type-check && npm run lint && npm run test -- voice-extract
git add lib/voice/transcribe.ts lib/voice/extract.ts lib/__tests__/voice-extract.test.ts
git commit -m "feat(voice): add transcription and structured extraction"
```

---

### Task 6: `POST /api/voice/draft`

**Files:**
- Create: `app/api/voice/draft/route.ts`
- Test: `lib/__tests__/voice-draft-gate.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5, plus `getCurrentUser` from `@/lib/auth`, `resolveTier` from `@/lib/subscription`, `checkRateLimit` from `@/lib/rate-limit`
- Produces: `POST` handler returning `{ success: true, draft: VoiceDraft }` or a coded error
- Error codes: `UNAUTHORIZED` 401 · `VOICE_REQUIRES_ULTIMATE` 403 · `VOICE_RATE_LIMIT` 429 · `VOICE_DAILY_LIMIT` 429 · `AUDIO_TOO_LARGE` 413 · `AUDIO_TOO_LONG` 413 · `NO_AUDIO` 400 · `VOICE_EMPTY_TRANSCRIPT` 422 · `VOICE_EXTRACT_FAILED` 502

- [ ] **Step 1: Write the failing gate test**

Create `lib/__tests__/voice-draft-gate.test.ts`, following the shape of the existing `send-quote-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getCurrentUser = vi.fn();
const countVoiceCapturesSince = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/db/voice-captures", () => ({
  countVoiceCapturesSince: (...a: unknown[]) => countVoiceCapturesSince(...a),
  createVoiceCapture: vi.fn().mockResolvedValue({ id: "vc1" }),
}));

import { POST as voiceDraftPOST } from "@/app/api/voice/draft/route";

function reqWithAudio(bytes: number) {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(bytes)], { type: "audio/webm" }), "clip.webm");
  form.append("durationSec", "5");
  return new Request("http://localhost/api/voice/draft", { method: "POST", body: form }) as never;
}

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.VOICE_MOCK = "1";
  countVoiceCapturesSince.mockResolvedValue(0);
});

describe("POST /api/voice/draft — access gate", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await voiceDraftPOST(reqWithAudio(1024));
    expect(res.status).toBe(401);
  });

  it.each([
    ["free", "free"],
    ["pro", "pro"],
    ["null", null],
    ["undefined", undefined],
    ["a tier the product no longer defines", "enterprise"],
  ])("403 VOICE_REQUIRES_ULTIMATE for %s", async (_label, stored) => {
    getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: stored });
    const res = await voiceDraftPOST(reqWithAudio(1024));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("VOICE_REQUIRES_ULTIMATE");
  });

  it("413 AUDIO_TOO_LARGE above 4 MB (Vercel's Function request-body ceiling is 4.5 MB), before any provider call", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: "ultimate" });
    const res = await voiceDraftPOST(reqWithAudio(4 * 1024 * 1024 + 1024));
    const body = await res.json();
    expect(res.status).toBe(413);
    expect(body.code).toBe("AUDIO_TOO_LARGE");
  });

  it("429 VOICE_DAILY_LIMIT once the day's cap is reached", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: "ultimate" });
    countVoiceCapturesSince.mockResolvedValue(40);
    const res = await voiceDraftPOST(reqWithAudio(1024));
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.code).toBe("VOICE_DAILY_LIMIT");
  });

  it("returns a draft for an Ultimate user in mock mode", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", subscription_tier: "ultimate" });
    const res = await voiceDraftPOST(reqWithAudio(1024));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.draft.transcript).toContain("drywall");
  });
});
```

Note: the last case reaches `resolveDraft`, which calls `getWorkItems` and `fuzzyMatchContact`. Add these mocks alongside the others at the top of the file:

```ts
vi.mock("@/lib/db/work-items", () => ({ getWorkItems: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/db/contacts", () => ({ fuzzyMatchContact: vi.fn().mockResolvedValue([]) }));
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm run test -- voice-draft-gate`
Expected: FAIL — cannot resolve `@/app/api/voice/draft/route`.

- [ ] **Step 3: Write the route**

Create `app/api/voice/draft/route.ts`:

```ts
/**
 * POST /api/voice/draft
 *
 * Audio in, VoiceDraft out. This route never writes a quote — the draft
 * pre-fills NewQuoteForm, which saves through POST /api/quotes as always.
 *
 * Voice is the only path in the app that spends money per request, so the
 * limits here are two: an in-process burst limiter (cheap, per-instance) and a
 * persisted daily cap (the real ceiling).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveTier } from "@/lib/subscription";
import { checkRateLimit } from "@/lib/rate-limit";
import { transcribeAudio } from "@/lib/voice/transcribe";
import { extractUtterance } from "@/lib/voice/extract";
import { resolveDraft } from "@/lib/voice/resolve";
import {
  countVoiceCapturesSince,
  createVoiceCapture,
} from "@/lib/db/voice-captures";
import { logger } from "@/lib/logger";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 90;
const DAILY_CAP = 40;

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail("UNAUTHORIZED", "Unauthorized", 401);

    if (resolveTier(user.subscription_tier) !== "ultimate") {
      return fail(
        "VOICE_REQUIRES_ULTIMATE",
        "Voice to invoice is an Ultimate feature.",
        403
      );
    }

    const burst = checkRateLimit(`voice-draft:${user.id}`, {
      windowMs: 60 * 1000,
      maxRequests: 6,
    });
    if (!burst.allowed) {
      return fail("VOICE_RATE_LIMIT", "Too many recordings. Try again shortly.", 429);
    }

    const used = await countVoiceCapturesSince(user.id, startOfUtcDay(new Date()));
    if (used >= DAILY_CAP) {
      return fail(
        "VOICE_DAILY_LIMIT",
        "You have reached today's voice limit. It resets at midnight UTC.",
        429
      );
    }

    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      return fail("NO_AUDIO", "No audio was received.", 400);
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return fail("AUDIO_TOO_LARGE", "That recording is too large.", 413);
    }

    const durationSec = Number(form.get("durationSec") ?? 0);
    if (durationSec > MAX_AUDIO_SECONDS) {
      return fail(
        "AUDIO_TOO_LONG",
        `Recordings are limited to ${MAX_AUDIO_SECONDS} seconds.`,
        413
      );
    }

    const buffer = Buffer.from(await audio.arrayBuffer());
    const transcription = await transcribeAudio(
      buffer,
      audio.type || "audio/webm"
    );

    if (!transcription.transcript.trim()) {
      return fail(
        "VOICE_EMPTY_TRANSCRIPT",
        "Nothing was heard in that recording.",
        422
      );
    }

    const capture = await createVoiceCapture(user.id, {
      transcript: transcription.transcript,
      durationSec: transcription.durationSec || durationSec,
      blobUrl: transcription.blobUrl,
      blobExpiresAt: transcription.blobExpiresAt,
      model: process.env.VOICE_MODEL_EXTRACT,
    });

    let utterance;
    try {
      utterance = await extractUtterance(transcription.transcript);
    } catch (error) {
      logger.error("Voice: extraction failed", { err: error, userId: user.id });
      // The transcript is still worth something — hand it back as one ad-hoc
      // line so a bad parse is a head start rather than a lost recording.
      return NextResponse.json(
        {
          success: false,
          code: "VOICE_EXTRACT_FAILED",
          message: "Could not read that recording. Here is what was heard.",
          draft: {
            captureId: capture.id,
            transcript: transcription.transcript,
            client: { kind: "none" },
            lines: [
              {
                rawText: transcription.transcript,
                quantity: 1,
                match: {
                  kind: "adhoc",
                  description: transcription.transcript,
                  unitPrice: 0,
                },
              },
            ],
          },
        },
        { status: 502 }
      );
    }

    const draft = await resolveDraft(user.id, utterance, {
      captureId: capture.id,
      transcript: transcription.transcript,
    });

    return NextResponse.json({ success: true, draft });
  } catch (error) {
    logger.error("Voice: draft failed", { err: error });
    return fail("VOICE_FAILED", "Could not build a draft from that recording.", 500);
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test -- voice-draft-gate`
Expected: PASS, 9 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run type-check && npm run lint && npm run test
git add app/api/voice/draft/route.ts lib/__tests__/voice-draft-gate.test.ts
git commit -m "feat(voice): add POST /api/voice/draft with tier gate and spend limits"
```

---

### Task 7: Audio retention purge cron

**Files:**
- Create: `app/api/cron/purge-voice-audio/route.ts`
- Modify: `vercel.json`
- Test: `lib/__tests__/voice-purge-cron.test.ts`

**Interfaces:**
- Consumes: `listExpiredAudio`, `clearVoiceAudio` from Task 2; `del` from `@vercel/blob`
- Produces: `GET` and `POST` handlers returning `{ success: true, purged: number }`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/voice-purge-cron.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listExpiredAudio = vi.fn();
const clearVoiceAudio = vi.fn();
const del = vi.fn();

vi.mock("@/lib/db/voice-captures", () => ({
  listExpiredAudio: (...a: unknown[]) => listExpiredAudio(...a),
  clearVoiceAudio: (...a: unknown[]) => clearVoiceAudio(...a),
}));
vi.mock("@vercel/blob", () => ({ del: (...a: unknown[]) => del(...a) }));

import { POST as purgePOST } from "@/app/api/cron/purge-voice-audio/route";

function req(auth?: string) {
  return new Request("http://localhost/api/cron/purge-voice-audio", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  }) as never;
}

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  listExpiredAudio.mockResolvedValue([]);
});

describe("POST /api/cron/purge-voice-audio", () => {
  it("401 without the bearer secret", async () => {
    expect((await purgePOST(req())).status).toBe(401);
  });

  it("401 with the wrong secret", async () => {
    expect((await purgePOST(req("Bearer nope"))).status).toBe(401);
  });

  it("deletes expired blobs and clears the columns", async () => {
    listExpiredAudio.mockResolvedValue([
      { id: "vc1", blob_url: "https://blob/a" },
      { id: "vc2", blob_url: "https://blob/b" },
    ]);
    const res = await purgePOST(req("Bearer s3cret"));
    const body = await res.json();

    expect(del).toHaveBeenCalledWith(["https://blob/a", "https://blob/b"], expect.anything());
    expect(clearVoiceAudio).toHaveBeenCalledWith(["vc1", "vc2"]);
    expect(body.purged).toBe(2);
  });

  it("clears the columns even when blob deletion throws, so it does not retry forever", async () => {
    listExpiredAudio.mockResolvedValue([{ id: "vc1", blob_url: "https://blob/a" }]);
    del.mockRejectedValue(new Error("gone"));
    const res = await purgePOST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(clearVoiceAudio).toHaveBeenCalledWith(["vc1"]);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm run test -- voice-purge-cron`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the cron route**

Create `app/api/cron/purge-voice-audio/route.ts`, matching the auth shape of `app/api/cron/reconcile-billing/route.ts`:

```ts
/**
 * Voice audio retention purge — /api/cron/purge-voice-audio
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (no session). Vercel sends GET
 * with the secret auto-injected, hence the GET handler delegating to POST.
 *
 * Deletes audio past its 7-day expiry. Transcripts are never touched.
 */

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { clearVoiceAudio, listExpiredAudio } from "@/lib/db/voice-captures";
import { logger } from "@/lib/logger";

function isAuthorized(header: string | null, secret: string): boolean {
  if (!header) return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.error("Cron: CRON_SECRET not configured", {
      route: "/api/cron/purge-voice-audio",
    });
    return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  }

  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expired = await listExpiredAudio(new Date());
  if (expired.length === 0) {
    return NextResponse.json({ success: true, purged: 0 });
  }

  try {
    await del(
      expired.map((row) => row.blob_url),
      { token: process.env.BLOB_READ_WRITE_TOKEN }
    );
  } catch (error) {
    // Clear the columns anyway. A blob we cannot delete is not a reason to
    // re-attempt the same rows on every run forever.
    logger.error("Cron: voice blob deletion failed", { err: error });
  }

  await clearVoiceAudio(expired.map((row) => row.id));
  return NextResponse.json({ success: true, purged: expired.length });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
```

- [ ] **Step 4: Add the schedule**

Modify `vercel.json` so `crons` reads:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/reconcile-billing",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/cron/purge-voice-audio",
      "schedule": "0 4 * * *"
    }
  ]
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm run test -- voice-purge-cron`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify and commit**

```bash
npm run type-check && npm run lint && npm run test
git add app/api/cron/purge-voice-audio/route.ts vercel.json lib/__tests__/voice-purge-cron.test.ts
git commit -m "feat(voice): purge recorded audio after the retention window"
```

---

### Task 8: `VoiceCapture` component

**Files:**
- Create: `components/quote/VoiceCapture.tsx`
- Modify: `components/quote/index.ts`

**Interfaces:**
- Consumes: `POST /api/voice/draft`; `VoiceDraft` type from Task 3
- Produces: `<VoiceCapture onDraft={(draft: VoiceDraft) => void} disabled?: boolean />`
- `data-testid` values: `voice-capture`, `voice-record-start`, `voice-record-stop`, `voice-status`, `voice-error`

- [ ] **Step 1: Write the component**

Create `components/quote/VoiceCapture.tsx`:

```tsx
"use client";

/**
 * Voice capture control for the quote builder.
 *
 * Records with MediaRecorder, uploads to /api/voice/draft, hands the resulting
 * draft to the parent form. Knows nothing about quotes or pricing.
 *
 * Every failure has a visible surface. A contractor standing in a driveway
 * must never be left with a button that does nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2 } from "lucide-react";
import type { VoiceDraft } from "@/lib/voice/schemas";

const MAX_SECONDS = 90;
const MIN_SECONDS = 1;

type Phase = "idle" | "recording" | "working";

interface VoiceCaptureProps {
  onDraft: (draft: VoiceDraft) => void;
  disabled?: boolean;
}

export function VoiceCapture({ onDraft, disabled }: VoiceCaptureProps) {
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);

  // Feature-detect rather than fail on tap: older iOS Safari has no
  // MediaRecorder, and a dead button is worse than no button.
  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof window.MediaRecorder !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia
    );
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      setSeconds(Math.floor(elapsed));
      if (elapsed >= MAX_SECONDS) recorderRef.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [phase]);

  const upload = useCallback(
    async (blob: Blob, durationSec: number) => {
      setPhase("working");
      try {
        const form = new FormData();
        form.append("audio", blob, "clip.webm");
        form.append("durationSec", String(durationSec));

        const res = await fetch("/api/voice/draft", { method: "POST", body: form });
        const body = await res.json();

        if (!res.ok) {
          setError(body.message ?? "Could not read that recording.");
          // A failed parse still returns the transcript as one ad-hoc line.
          if (body.draft) onDraft(body.draft as VoiceDraft);
          return;
        }
        onDraft(body.draft as VoiceDraft);
      } catch {
        setError("Could not reach the server. Check your connection.");
      } finally {
        setPhase("idle");
        setSeconds(0);
      }
    },
    [onDraft]
  );

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const durationSec = (Date.now() - startedAtRef.current) / 1000;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });

        if (durationSec < MIN_SECONDS) {
          setError("That was too short. Hold the button and describe the job.");
          setPhase("idle");
          setSeconds(0);
          return;
        }
        void upload(blob, durationSec);
      };

      recorder.start();
      recorderRef.current = recorder;
      setPhase("recording");
    } catch {
      setError(
        "Microphone access was blocked. Allow it in your browser settings, or type the job below."
      );
      setPhase("idle");
    }
  }, [upload]);

  if (!supported) return null;

  return (
    <div className="space-y-2" data-testid="voice-capture">
      {phase === "recording" ? (
        <Button
          type="button"
          variant="destructive"
          onClick={() => recorderRef.current?.stop()}
          data-testid="voice-record-stop"
        >
          <Square className="mr-2 h-4 w-4" />
          Stop ({MAX_SECONDS - seconds}s left)
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || phase === "working"}
          onClick={start}
          data-testid="voice-record-start"
        >
          {phase === "working" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mic className="mr-2 h-4 w-4" />
          )}
          {phase === "working" ? "Building your draft…" : "Describe the job out loud"}
        </Button>
      )}

      <p className="text-sm text-muted-foreground" data-testid="voice-status">
        {phase === "recording"
          ? "Listening — say what you did and who it was for."
          : "Speak the work and the client. We fill in your catalog prices."}
      </p>

      {error && (
        <p className="text-sm text-destructive" data-testid="voice-error">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Export it**

Add to `components/quote/index.ts`, matching the file's existing export style:

```ts
export { VoiceCapture } from "./VoiceCapture";
```

- [ ] **Step 3: Verify and commit**

```bash
npm run type-check && npm run lint
git add components/quote/VoiceCapture.tsx components/quote/index.ts
git commit -m "feat(voice): add MediaRecorder capture control"
```

---

### Task 9: Pre-fill `NewQuoteForm` from a draft

**Files:**
- Modify: `components/quote/NewQuoteForm.tsx`

**Interfaces:**
- Consumes: `<VoiceCapture onDraft={...} />` from Task 8; `VoiceDraft` from Task 3
- Produces: nothing new for later tasks — this is the integration point
- `data-testid` values added: none beyond those `VoiceCapture` already carries; existing line-row testids are reused

- [ ] **Step 1: Read the form's existing state shape**

Open `components/quote/NewQuoteForm.tsx`. The relevant state is `BuilderLine[]` (`{ key, workItemId?, description, quantity, unit, unitPrice }`), plus `clientMode`, `selectedClientId`, and `newClientName`. The draft maps onto exactly these — no new state shape is needed.

- [ ] **Step 2: Add the apply handler**

Inside the component, alongside the other `useCallback` handlers:

```tsx
const applyVoiceDraft = useCallback((draft: VoiceDraft) => {
  if (draft.client.kind === "matched") {
    setClientMode("existing");
    setSelectedClientId(draft.client.contactId);
  } else if (draft.client.kind === "proposed") {
    setClientMode("new");
    setNewClientName(draft.client.name);
  }

  setLines(
    draft.lines.map((line) => ({
      key: nextKey(),
      workItemId: line.match.kind === "catalog" ? line.match.workItemId : undefined,
      description:
        line.match.kind === "catalog" ? line.match.name : line.match.description,
      quantity: line.quantity,
      unit: line.match.kind === "catalog" ? line.match.unit : "each",
      unitPrice: line.match.unitPrice,
    }))
  );
}, []);
```

Add the import at the top of the file:

```tsx
import { VoiceCapture } from "./VoiceCapture";
import type { VoiceDraft } from "@/lib/voice/schemas";
import { useSubscription } from "@/components/subscription/use-subscription"; // already imported
```

- [ ] **Step 3: Render the control, gated on tier**

`useSubscription()` is already destructured as `sub` in this component. Render `VoiceCapture` above the client picker, only for Ultimate:

```tsx
{sub?.tier === "ultimate" && (
  <VoiceCapture onDraft={applyVoiceDraft} disabled={false} />
)}
```

This is a UI convenience only — the route's `resolveTier` check is the real gate, and it does not trust the client.

- [ ] **Step 4: Verify replacing lines is the intended behavior**

`applyVoiceDraft` replaces `lines` rather than appending. That is deliberate: a second recording is a correction, not an addition, and appending would silently double a contractor's invoice when they re-record. Leave a comment saying so directly above `setLines`.

- [ ] **Step 5: Nudge toward the catalog when nothing matched**

The spec requires that a draft with no catalog matches points the contractor at
the Work Catalog — a thin catalog is the one condition under which this feature
feels broken, and the fix is a link away.

Add state alongside the other `useState` calls:

```tsx
const [voiceAllAdhoc, setVoiceAllAdhoc] = useState(false);
```

Set it inside `applyVoiceDraft`, before `setLines`:

```tsx
setVoiceAllAdhoc(
  draft.lines.length > 0 && draft.lines.every((l) => l.match.kind === "adhoc")
);
```

Render it directly beneath `<VoiceCapture />`:

```tsx
{voiceAllAdhoc && (
  <p className="text-sm text-muted-foreground" data-testid="voice-no-catalog-match">
    None of that matched your catalog, so prices are blank. Add these to your{" "}
    <a href="/dashboard?tab=catalog" className="underline">
      Work Catalog
    </a>{" "}
    and the next recording fills them in automatically.
  </p>
)}
```

- [ ] **Step 6: Verify and commit**

```bash
npm run type-check && npm run lint && npm run test
git add components/quote/NewQuoteForm.tsx
git commit -m "feat(voice): pre-fill the quote builder from a voice draft"
```

---

### Task 10: Tier matrix, e2e coverage, and docs

**Files:**
- Modify: `lib/__tests__/tier-matrix.test.ts`
- Create: `e2e/voice.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing — this task closes the plan

- [ ] **Step 1: Extend the tier matrix**

Open `lib/__tests__/tier-matrix.test.ts`. The file declares a `TierContract` interface with a documented `canEmail` column whose enforcement lives in route gate specs. Add a sibling column in the same style:

```ts
  /** Voice to invoice — enforced in app/api/voice/draft/route.ts. */
  canVoice: boolean;
```

Set `canVoice: false` for `free` and `pro`, `true` for `ultimate`, and extend the comment block at the top of the file to name `voice-draft-gate.test.ts` alongside the other route gate specs.

- [ ] **Step 2: Run the tier matrix and verify it passes**

Run: `npm run test -- tier-matrix`
Expected: PASS.

- [ ] **Step 3: Give Playwright a fake microphone**

In `playwright.config.ts`, add the launch flags to the chromium project's `use` block:

```ts
launchOptions: {
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-capture",
  ],
},
```

`--use-fake-ui-for-media-stream` auto-grants the permission prompt; without it `getUserMedia` hangs and the spec fails as a timeout rather than a clear error.

- [ ] **Step 4: Write the e2e spec**

Create `e2e/voice.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

/**
 * Voice to invoice, end to end, with VOICE_MOCK=1.
 *
 * The mock returns a fixed transcript and utterance (see lib/voice/extract.ts
 * MOCK_UTTERANCE), so this spec asserts the wiring — record, draft, edit,
 * save — and never the model's accuracy.
 *
 * The shared e2e user is already Ultimate, which is what this feature needs.
 */

test.describe("voice to invoice", () => {
  test.skip(
    process.env.VOICE_MOCK !== "1",
    "Requires VOICE_MOCK=1 so no tokens are spent and no microphone is needed"
  );

  test("records, pre-fills the builder, and saves a quote", async ({ page }) => {
    await page.goto("/new-quote");

    const capture = page.getByTestId("voice-capture");
    await expect(capture).toBeVisible();

    await page.getByTestId("voice-record-start").click();
    await expect(page.getByTestId("voice-record-stop")).toBeVisible();

    // The fake device emits silence; the length is what matters for the guard.
    await page.waitForTimeout(1500);
    await page.getByTestId("voice-record-stop").click();

    // Mock draft: two lines, client "Mendez".
    await expect(page.getByTestId("voice-record-start")).toBeVisible({
      timeout: 15_000,
    });

    const descriptions = page.locator('[data-testid^="line-description"]');
    await expect(descriptions).toHaveCount(2);

    await page.getByRole("button", { name: /save/i }).click();
    await expect(page).toHaveURL(/\/quote\/[0-9a-f-]+/, { timeout: 15_000 });
  });
});
```

Before running, open `NewQuoteForm.tsx` and confirm the actual `data-testid` on the line description inputs. If it differs from `line-description`, use the real one — do not add a new testid for the test's convenience.

- [ ] **Step 5: Run the e2e spec**

```bash
VOICE_MOCK=1 npx playwright test e2e/voice.spec.ts
```

Expected: PASS. If the draft does not arrive, check that `VOICE_MOCK=1` reached the dev server Playwright starts — `playwright.config.ts` controls that environment, not your shell alone.

- [ ] **Step 6: Document the feature**

Add to `CLAUDE.md`. In the API route table:

```
| `/api/voice/draft` | POST | Audio → `VoiceDraft` (Ultimate-only · 403 `VOICE_REQUIRES_ULTIMATE`) |
| `/api/cron/purge-voice-audio` | GET, POST | Deletes recorded audio past its 7-day retention |
```

And a new subsection after "Subscription & Billing":

```markdown
### Voice to invoice (Ultimate)

`components/quote/VoiceCapture.tsx` records with `MediaRecorder` and posts to
`/api/voice/draft`, which transcribes, extracts, and resolves. **The extraction
schema (`lib/voice/schemas.ts`) has no price field and no id field** — the model
is structurally unable to author a price. `lib/voice/resolve.ts` assigns every
price, only from the user's own `work_items` rows, and degrades a match below
`CATALOG_MATCH_THRESHOLD` to an ad-hoc line at zero rather than guessing.

`fuzzyMatchContact` is a raw `ILIKE '%name%'`, so `resolve.ts` queries it by
**token** — passing the spoken phrase "the Mendez place" runs the substring test
the wrong way round and matches nothing.

Spend controls are two: the in-process `checkRateLimit` (per-instance on Fluid
Compute, so a burst absorber, not a ceiling) and a persisted 40/day cap counted
from `voice_captures`. Audio over 90s or 4MB is rejected before any provider
call. `VOICE_MOCK=1` bypasses providers entirely — set it in dev and e2e.

**Ultimate remains in `UNAVAILABLE_TIERS`.** The feature ships gated but the tier
is still unpurchasable; only the dev `PATCH /api/subscription` reaches it.
Unlocking is a separate change.
```

- [ ] **Step 7: Full verification and commit**

```bash
npm run type-check && npm run lint && npm run test
VOICE_MOCK=1 npx playwright test e2e/voice.spec.ts
git add lib/__tests__/tier-matrix.test.ts e2e/voice.spec.ts playwright.config.ts CLAUDE.md
git commit -m "test(voice): cover the tier gate and the end-to-end draft flow"
```

---

## Follow-up, deliberately out of scope

Unlocking Ultimate is a separate change: remove `"ultimate"` from `UNAVAILABLE_TIERS` in `lib/subscription.ts`, confirm the landing pricing CTA, `UpgradeDialog`, `ChangePlanDialog` and the `TIER_UNAVAILABLE` refusal in `POST /api/billing/change-plan` all flip together, and verify the live-mode `STRIPE_PRICE_ULTIMATE` resolves under the production key. Do it after watching the feature run in production.
