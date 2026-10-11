# Business Logo Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contractors upload a business logo in profile settings; it renders on quote/receipt PDFs and all outgoing emails.

**Architecture:** Supabase Storage public bucket `logos` (one object per user at `{userId}/logo.<ext>`, service-role writes only). Public URL stored in `users.metadata.logoUrl` (same JSONB pattern as `companyAddress`). All client-facing sends already build `CompanyInfo` via `buildQuotePdfPayload()` in `lib/quote-pdf.ts`, so plumbing `logoUrl` there covers the quote email, send-quote API, PDF download, and payment-receipt email in one spot. PDF prefetches the image to a Buffer with graceful fallback; email templates conditionally render an `<img>`.

**Tech Stack:** Next.js 14 App Router, Supabase Storage (`supabaseAdmin.storage`), `@react-pdf/renderer` `<Image>`, Vitest (new, unit tests), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-13-business-logo-branding-design.md`

## Global Constraints

- Accepted types: PNG, JPEG, WebP only — validated by **magic bytes**, never Content-Type/extension. SVG explicitly rejected.
- Max upload size: **2 MB** (2 × 1024 × 1024 bytes).
- Bucket: `logos`, public **read**; no anon/client write policy (service-role route only).
- Object path: `{userId}/logo.<ext>`; re-upload removes prior objects first.
- Stored URL carries `?v={Date.now()}` cache-bust suffix.
- Logo **augments** the company name — name text always stays on PDF and email.
- A broken/missing logo must never break a send: PDF prefetch falls back to name-only; email omits the `<img>` when no URL.
- Migrations: paired `db/migrations/007_logos_bucket.sql` + `007_rollback.sql`, mirrored to `supabase/migrations/20260713000000_logos_bucket.sql` (repo convention).
- UI helper copy (exact): `PNG, JPG, or WebP · max 2 MB · a wide transparent PNG works best.`
- Run `npm run type-check` and `npm run lint` before claiming any task done.
- Work on branch `feat/business-logo-branding` (already exists, spec committed).

## File Structure

| File | Responsibility |
|---|---|
| `lib/logo-validation.ts` (create) | Pure functions: magic-byte sniff + size check. No I/O. |
| `lib/__tests__/logo-validation.test.ts` (create) | Vitest unit tests for the above. |
| `db/migrations/007_logos_bucket.sql` + `007_rollback.sql` (create) | Bucket + public-read policy. |
| `supabase/migrations/20260713000000_logos_bucket.sql` (create) | Timestamped mirror for `supabase db reset`. |
| `lib/db/users.ts` (modify) | `updateUserLogoUrl(userId, logoUrl \| null)` — metadata merge. |
| `app/api/profile/logo/route.ts` (create) | POST multipart upload, DELETE remove. Auth → validate → storage → metadata. |
| `app/api/profile/route.ts` (modify) | `toProfile()` returns `logoUrl`. |
| `lib/quote-pdf.ts` (modify) | `CompanyInfo.logoUrl`, payload plumbing, logo Buffer prefetch. |
| `types/email.ts` (modify) | `CompanyInfo.logoUrl` + schema (keep in sync with quote-pdf). |
| `lib/email-sender.ts` (modify) | Inline companyInfo type + `companyLogoUrl` into email data. |
| `lib/email-templates.ts` (modify) | `QuoteEmailData.companyLogoUrl`; conditional header `<img>`. |
| `components/quote/QuotePDFDocument.tsx` (modify) | `logoSrc` prop → `<Image>` in header (quote + receipt share this header). |
| `components/settings/LogoUploader.tsx` (create) | Self-contained preview/upload/remove widget. |
| `components/settings/ProfileForm.tsx` + `ProfileSettingsDialog.tsx` (modify) | Mount LogoUploader; profile type gains `logoUrl`. |
| `e2e/profile-logo.spec.ts` (create) | Upload → preview → persists; remove → placeholder. |

---

### Task 1: Vitest + logo validation helper (TDD)

**Files:**
- Create: `lib/logo-validation.ts`
- Create: `lib/__tests__/logo-validation.test.ts`
- Modify: `package.json` (devDep `vitest`, script `test:unit`)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `sniffImageType(buf: Buffer): "png" | "jpeg" | "webp" | null`
  - `validateLogoUpload(buf: Buffer): { ok: true; type: "png" | "jpeg" | "webp"; ext: "png" | "jpg" | "webp"; contentType: string } | { ok: false; message: string }`
  - `MAX_LOGO_BYTES = 2 * 1024 * 1024`

- [ ] **Step 1: Install vitest and add script**

```bash
npm install -D vitest
```

In `package.json` scripts, replace the placeholder test script:

```json
"test": "vitest run",
"test:unit": "vitest run",
```

- [ ] **Step 2: Write the failing tests**

Create `lib/__tests__/logo-validation.test.ts` (relative import — no alias config needed):

```ts
import { describe, it, expect } from "vitest";
import {
  sniffImageType,
  validateLogoUpload,
  MAX_LOGO_BYTES,
} from "../logo-validation";

// Minimal real headers
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
  Buffer.from("VP8 "),
]);
const SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
const GIF = Buffer.from("GIF89a......");

describe("sniffImageType", () => {
  it("detects png", () => expect(sniffImageType(PNG)).toBe("png"));
  it("detects jpeg", () => expect(sniffImageType(JPEG)).toBe("jpeg"));
  it("detects webp", () => expect(sniffImageType(WEBP)).toBe("webp"));
  it("rejects svg", () => expect(sniffImageType(SVG)).toBeNull());
  it("rejects gif", () => expect(sniffImageType(GIF)).toBeNull());
  it("rejects empty", () => expect(sniffImageType(Buffer.alloc(0))).toBeNull());
  it("rejects short buffer", () =>
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull());
});

describe("validateLogoUpload", () => {
  it("accepts a valid png", () => {
    const r = validateLogoUpload(PNG);
    expect(r).toEqual({
      ok: true,
      type: "png",
      ext: "png",
      contentType: "image/png",
    });
  });
  it("maps jpeg → .jpg", () => {
    const r = validateLogoUpload(JPEG);
    expect(r.ok && r.ext).toBe("jpg");
  });
  it("rejects oversize", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]);
    const r = validateLogoUpload(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/2 MB/);
  });
  it("rejects svg with type message", () => {
    const r = validateLogoUpload(SVG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/PNG, JPG, or WebP/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/logo-validation.test.ts`
Expected: FAIL — `Cannot find module '../logo-validation'`

- [ ] **Step 4: Write the implementation**

Create `lib/logo-validation.ts`:

```ts
/**
 * Logo Upload Validation
 *
 * Pure validation for business-logo uploads: type by magic bytes
 * (never trust Content-Type or filename) and a size ceiling.
 * SVG is deliberately rejected — script-in-SVG XSS and no
 * @react-pdf/renderer support.
 */

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

export type LogoImageType = "png" | "jpeg" | "webp";

const TYPE_INFO: Record<
  LogoImageType,
  { ext: "png" | "jpg" | "webp"; contentType: string }
> = {
  png: { ext: "png", contentType: "image/png" },
  jpeg: { ext: "jpg", contentType: "image/jpeg" },
  webp: { ext: "webp", contentType: "image/webp" },
};

/** Identify PNG/JPEG/WebP by file signature; null for anything else. */
export function sniffImageType(buf: Buffer): LogoImageType | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "jpeg";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  return null;
}

export type LogoValidation =
  | { ok: true; type: LogoImageType; ext: "png" | "jpg" | "webp"; contentType: string }
  | { ok: false; message: string };

export function validateLogoUpload(buf: Buffer): LogoValidation {
  if (buf.length === 0) {
    return { ok: false, message: "No file received" };
  }
  if (buf.length > MAX_LOGO_BYTES) {
    return { ok: false, message: "Logo must be 2 MB or smaller" };
  }
  const type = sniffImageType(buf);
  if (!type) {
    return { ok: false, message: "Logo must be a PNG, JPG, or WebP image" };
  }
  return { ok: true, type, ...TYPE_INFO[type] };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/logo-validation.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 6: Type-check + commit**

```bash
npm run type-check
git add lib/logo-validation.ts lib/__tests__/logo-validation.test.ts package.json package-lock.json
git commit -m "feat(logo): magic-byte upload validation + vitest setup"
```

---

### Task 2: Storage bucket migration

**Files:**
- Create: `db/migrations/007_logos_bucket.sql`
- Create: `db/migrations/007_rollback.sql`
- Create: `supabase/migrations/20260713000000_logos_bucket.sql` (exact copy of 007)

**Interfaces:**
- Produces: public-read bucket `logos` usable via `supabaseAdmin.storage.from("logos")` (Task 4).

- [ ] **Step 1: Write the migration**

`db/migrations/007_logos_bucket.sql`:

```sql
-- 007: Business-logo storage bucket
-- Public READ (logos appear on invoices/emails); writes happen only
-- through the service-role API route — no anon/authenticated write policy.

INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read logos" ON storage.objects;
CREATE POLICY "Public read logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');
```

`db/migrations/007_rollback.sql`:

```sql
-- Rollback 007: remove logos bucket and its read policy
DROP POLICY IF EXISTS "Public read logos" ON storage.objects;
DELETE FROM storage.objects WHERE bucket_id = 'logos';
DELETE FROM storage.buckets WHERE id = 'logos';
```

Copy for the CLI:

```bash
cp db/migrations/007_logos_bucket.sql supabase/migrations/20260713000000_logos_bucket.sql
```

- [ ] **Step 2: Apply to the running local DB (no reset — keeps dev data)**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f db/migrations/007_logos_bucket.sql
```

Expected: `INSERT 0 1` (or `INSERT 0 0` + update), `DROP POLICY`, `CREATE POLICY`.

- [ ] **Step 3: Verify bucket exists and is public**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "SELECT id, public FROM storage.buckets WHERE id='logos';"
```

Expected: one row, `public = t`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/007_logos_bucket.sql db/migrations/007_rollback.sql supabase/migrations/20260713000000_logos_bucket.sql
git commit -m "feat(logo): logos storage bucket with public read policy"
```

---

### Task 3: Users repo — `updateUserLogoUrl`

**Files:**
- Modify: `lib/db/users.ts` (add function after `updateUserProfile`, ~line 215)

**Interfaces:**
- Consumes: existing `supabaseAdmin`, `NotFoundError` imports already in the file.
- Produces: `updateUserLogoUrl(userId: string, logoUrl: string | null): Promise<void>` — merges/clears `metadata.logoUrl`, preserving other metadata keys (Task 4 calls this).

- [ ] **Step 1: Add the function**

Append to `lib/db/users.ts` (mirror the metadata-merge pattern in `updateUserProfile`):

```ts
/**
 * Set or clear the business-logo URL in the metadata JSONB.
 * Merged so companyAddress/companyWebsite survive; null removes the key.
 */
export async function updateUserLogoUrl(
  userId: string,
  logoUrl: string | null
): Promise<void> {
  const { data: current, error: fetchError } = await supabaseAdmin
    .from("users")
    .select("metadata")
    .eq("id", userId)
    .is("deleted_at", null)
    .single();

  if (fetchError) {
    if (fetchError.code === "PGRST116") {
      throw new NotFoundError("User not found", "User", userId);
    }
    throw fetchError;
  }

  const metadata = { ...(current?.metadata ?? {}) };
  if (logoUrl === null) {
    delete metadata.logoUrl;
  } else {
    metadata.logoUrl = logoUrl;
  }

  const { error } = await supabaseAdmin
    .from("users")
    .update({ metadata })
    .eq("id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}
```

- [ ] **Step 2: Verify**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/db/users.ts
git commit -m "feat(logo): updateUserLogoUrl metadata helper"
```

---

### Task 4: Logo API route + profile GET exposure

**Files:**
- Create: `app/api/profile/logo/route.ts`
- Modify: `app/api/profile/route.ts` (`toProfile()` gains `logoUrl`)

**Interfaces:**
- Consumes: `validateLogoUpload` (Task 1), `updateUserLogoUrl` (Task 3), bucket `logos` (Task 2), `getCurrentUser` from `@/lib/auth`, `supabaseAdmin` from `@/lib/db/core`, `logger` from `@/lib/logger`.
- Produces:
  - `POST /api/profile/logo` (multipart field `file`) → `{ success: true, logoUrl: string }` | 400/401/500 `{ success: false, message }`
  - `DELETE /api/profile/logo` → `{ success: true }`
  - `GET /api/profile` response gains `logoUrl: string | null`

- [ ] **Step 1: Create the route**

`app/api/profile/logo/route.ts`:

```ts
/**
 * Business Logo Route
 *
 * POST   /api/profile/logo - Upload/replace the business logo (multipart "file")
 * DELETE /api/profile/logo - Remove the logo
 *
 * Storage: public bucket "logos", one object per user at {userId}/logo.<ext>.
 * Validation is magic-byte based (PNG/JPG/WebP, ≤2 MB); SVG rejected.
 *
 * @module api/profile/logo
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db/core";
import { updateUserLogoUrl } from "@/lib/db/users";
import { validateLogoUpload } from "@/lib/logo-validation";
import { logger } from "@/lib/logger";

const BUCKET = "logos";

/** Remove every object under the user's folder (handles ext changes on re-upload). */
async function removeExistingLogos(userId: string): Promise<void> {
  const { data: objects } = await supabaseAdmin.storage
    .from(BUCKET)
    .list(userId);
  if (objects?.length) {
    await supabaseAdmin.storage
      .from(BUCKET)
      .remove(objects.map((o) => `${userId}/${o.name}`));
  }
}

export async function POST(request: NextRequest) {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    userId = user.id;

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: "No file received", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const validation = validateLogoUpload(buf);
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, message: validation.message, code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    await removeExistingLogos(user.id);

    const path = `${user.id}/logo.${validation.ext}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: validation.contentType, upsert: true });
    if (uploadError) throw uploadError;

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    // Cache-bust so emails/CDNs pick up replacements
    const logoUrl = `${pub.publicUrl}?v=${Date.now()}`;

    await updateUserLogoUrl(user.id, logoUrl);

    return NextResponse.json({ success: true, logoUrl });
  } catch (error) {
    logger.error("Logo upload error", {
      err: error,
      route: "POST /api/profile/logo",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to upload logo", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    userId = user.id;

    await removeExistingLogos(user.id);
    await updateUserLogoUrl(user.id, null);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Logo delete error", {
      err: error,
      route: "DELETE /api/profile/logo",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to remove logo", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
```

Note: verify the `supabaseAdmin` import path — CLAUDE.md says `lib/db/core.ts`; if `lib/db/users.ts` imports it from elsewhere, match that.

- [ ] **Step 2: Expose `logoUrl` in GET /api/profile**

In `app/api/profile/route.ts`, `toProfile()` — add one line to the returned object:

```ts
    logoUrl: (user.metadata?.logoUrl as string | undefined) ?? null,
```

- [ ] **Step 3: Verify with curl against the dev server**

Dev server + Supabase must be running. Unauthenticated check (middleware 401):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/profile/logo
```

Expected: `401` (or a redirect status from middleware — either proves the guard).

Authenticated end-to-end happens in Task 8's e2e spec.

- [ ] **Step 4: Type-check, lint, commit**

```bash
npm run type-check && npm run lint
git add "app/api/profile/logo/route.ts" app/api/profile/route.ts
git commit -m "feat(logo): upload/remove API route; profile GET returns logoUrl"
```

---

### Task 5: CompanyInfo plumbing + PDF logo prefetch

**Files:**
- Modify: `lib/quote-pdf.ts` (interface + payload + prefetch)
- Modify: `types/email.ts` (interface + zod schema, ~line 155)
- Modify: `lib/email-sender.ts` (inline companyInfo type ~line 27; email data ~line 131)
- Modify: `lib/email-templates.ts` (`QuoteEmailData` interface ~line 13)

**Interfaces:**
- Consumes: `users.metadata.logoUrl` (set by Task 4).
- Produces:
  - `CompanyInfo.logoUrl?: string | null` (both definitions)
  - `QuoteEmailData.companyLogoUrl?: string` (Task 7 renders it)
  - `QuotePDFDocument` receives new prop `logoSrc?: Buffer | null` (Task 6 renders it)

- [ ] **Step 1: Extend both CompanyInfo definitions**

`lib/quote-pdf.ts` — in `CompanyInfo`:

```ts
  /** Public URL of the uploaded business logo (users.metadata.logoUrl). */
  logoUrl?: string | null;
```

`types/email.ts` — in `CompanyInfo`:

```ts
  logoUrl?: string | null;
```

and in `companyInfoSchema`:

```ts
  logoUrl: z.string().url("Invalid logo URL").max(500).nullable().optional(),
```

- [ ] **Step 2: Populate it in `buildQuotePdfPayload`**

In `lib/quote-pdf.ts`, inside the `companyInfo` literal (after `contractorName`):

```ts
    logoUrl: (user.metadata?.logoUrl as string | undefined) ?? null,
```

This single line feeds all four consumers (quote page prefill, send-quote, PDF download, payment receipt).

- [ ] **Step 3: Prefetch the logo for the PDF (graceful fallback)**

In `lib/quote-pdf.ts`, add above `generateQuotePDF`:

```ts
/**
 * Fetch the logo into a Buffer for @react-pdf. Any failure (bad URL,
 * timeout, deleted object) degrades to a logo-less PDF rather than
 * failing the send.
 */
async function fetchLogoBuffer(logoUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    logger.warn("Logo fetch failed; rendering PDF without logo", {
      err: error,
      logoUrl,
    });
    return null;
  }
}
```

(If `logger.warn` doesn't exist in `lib/logger.ts`, use `logger.error` — check the logger's API first.)

In `generateQuotePDF`, before building `pdfElement`:

```ts
    const logoSrc = companyInfo.logoUrl
      ? await fetchLogoBuffer(companyInfo.logoUrl)
      : null;
```

and pass it through:

```ts
    const pdfElement = QuotePDFDocument({
      quote,
      companyInfo,
      quoteNumber,
      quoteDate,
      validUntil,
      scheduleLines,
      paymentReceipt,
      logoSrc,
    });
```

(This won't compile until Task 6 adds the prop — do Tasks 5+6 back-to-back, commit together if needed, or add the prop stub first. Preferred: implement Task 6's prop change in the same commit.)

- [ ] **Step 4: Thread the email field**

`lib/email-templates.ts`, in `QuoteEmailData`:

```ts
  /** Public logo URL; header <img> renders only when present. */
  companyLogoUrl?: string;
```

`lib/email-sender.ts`:
- inline `companyInfo` type in `SendQuoteEmailOptions` gains `logoUrl?: string | null;`
- in the `emailData: QuoteEmailData` literal (after `companyPhone`):

```ts
      companyLogoUrl: companyInfo.logoUrl || undefined,
```

If the payment-receipt email path builds its own email-data object in this file, add the same line there — search `lib/email-sender.ts` for every `QuoteEmailData` literal.

- [ ] **Step 5: Verify + commit (combined with Task 6 if the prop forces it)**

```bash
npm run type-check
git add lib/quote-pdf.ts types/email.ts lib/email-sender.ts lib/email-templates.ts
git commit -m "feat(logo): plumb logoUrl through CompanyInfo and email data"
```

---

### Task 6: PDF header renders the logo

**Files:**
- Modify: `components/quote/QuotePDFDocument.tsx` (props ~line 284, styles ~line 73, header JSX ~line 338)

**Interfaces:**
- Consumes: `logoSrc?: Buffer | null` prop (Task 5 passes it).
- Produces: logo image at top of `companyBlock` on both quote and payment-receipt PDFs (shared header).

- [ ] **Step 1: Add the prop**

Add `Image` to the existing `@react-pdf/renderer` import. In the component's props interface and destructuring, add:

```ts
  /** Prefetched logo image; null/undefined renders the name-only header. */
  logoSrc?: Buffer | null;
```

- [ ] **Step 2: Add the style**

In `StyleSheet.create`, next to `companyName`:

```ts
  logo: {
    height: 48,
    maxWidth: 180,
    objectFit: "contain",
    marginBottom: 8,
    alignSelf: "flex-start",
  },
```

- [ ] **Step 3: Render it**

In the header JSX (`companyBlock`), above the company name — name text stays:

```tsx
          <View style={styles.companyBlock}>
            {logoSrc && <Image src={logoSrc} style={styles.logo} />}
            <Text style={styles.companyName}>{companyInfo.name}</Text>
```

- [ ] **Step 4: Verify render with a real buffer**

```bash
npm run type-check
```

Then visual check via the PDF download route once Task 8's e2e uploads a logo — or immediately: upload any PNG via the settings UI (after Task 8) and hit `/api/quotes/[id]/pdf`. For now type-check + the Task 5 commit gate suffice.

- [ ] **Step 5: Commit**

```bash
git add components/quote/QuotePDFDocument.tsx
git commit -m "feat(logo): render business logo in PDF header"
```

---

### Task 7: Email header renders the logo

**Files:**
- Modify: `lib/email-templates.ts` (header block ~line 95 in `generateQuoteEmailHTML`)

**Interfaces:**
- Consumes: `data.companyLogoUrl` (Task 5).
- Produces: conditional `<img>` above the company-name `<h1>` in the one shared HTML template (quote + receipt emails both use `generateQuoteEmailHTML`).

- [ ] **Step 1: Add the image to the header cell**

In `generateQuoteEmailHTML`, inside the header `<td>`, directly above the `<h1>`:

```ts
              ${
                data.companyLogoUrl
                  ? `<img src="${escapeHtml(data.companyLogoUrl)}" alt="${escapeHtml(companyName)}" height="40" style="display: block; margin: 0 auto 12px auto; height: 40px; max-width: 220px;" />`
                  : ""
              }
```

Notes: `height` attribute + inline style (Outlook honors the attribute); centered to match the header's `text-align: center`; `escapeHtml` already exists in this file. Plain-text template (`generateQuoteEmailText`) unchanged — logos have no text form.

- [ ] **Step 2: Verify**

```bash
npm run type-check && npm run lint
```

Quick sanity render (optional):

```bash
node -e "
const { generateQuoteEmailHTML } = require('./lib/email-templates.ts');
" 2>/dev/null || echo "verify via e2e instead (TS module)"
```

Real verification: Task 8 e2e asserts the `<img>` lands in the mocked send payload if practical; otherwise dev-server manual send with RESEND_MOCK.

- [ ] **Step 3: Commit**

```bash
git add lib/email-templates.ts
git commit -m "feat(logo): business logo in email header"
```

---

### Task 8: Settings UI — LogoUploader

**Files:**
- Create: `components/settings/LogoUploader.tsx`
- Modify: `components/settings/ProfileForm.tsx` (mount uploader; `ProfileFields`/props gain `logoUrl`)
- Modify: `components/settings/ProfileSettingsDialog.tsx` (pass `logoUrl` from GET /api/profile)

**Interfaces:**
- Consumes: `POST/DELETE /api/profile/logo` (Task 4), `GET /api/profile` `logoUrl` field (Task 4).
- Produces: `<LogoUploader logoUrl={string | null} onChange={(url: string | null) => void} />`

- [ ] **Step 1: Create the component**

`components/settings/LogoUploader.tsx`:

```tsx
"use client";

/**
 * Logo Uploader
 *
 * Business-logo section of profile settings: preview, upload, remove.
 * Client pre-validates type/size for instant feedback; the server
 * re-validates by magic bytes.
 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 2 * 1024 * 1024;

interface LogoUploaderProps {
  logoUrl: string | null;
  onChange: (logoUrl: string | null) => void;
}

export function LogoUploader({ logoUrl, onChange }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();

  const upload = async (file: File) => {
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Logo must be a PNG, JPG, or WebP image");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Logo must be 2 MB or smaller");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/profile/logo", { method: "POST", body });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to upload logo");
      }
      onChange(data.logoUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload logo");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/logo", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to remove logo");
      }
      onChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove logo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>Business Logo</Label>
      <div className="flex items-center gap-4">
        <div
          className="flex h-16 w-32 items-center justify-center overflow-hidden rounded border bg-muted/30"
          data-testid="logo-preview"
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external storage URL, fixed box
            <img
              src={logoUrl}
              alt="Business logo"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={pick}
            disabled={busy}
            data-testid="logo-upload-button"
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {logoUrl ? "Replace" : "Upload"}
          </Button>
          {logoUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={busy}
              data-testid="logo-remove-button"
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        PNG, JPG, or WebP · max 2 MB · a wide transparent PNG works best.
      </p>
      {error && (
        <p className="text-xs text-destructive" role="alert" data-testid="logo-error">
          {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Upload business logo"
        data-testid="logo-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire into ProfileForm**

`components/settings/ProfileForm.tsx`:
- `ProfileFields` gains `logoUrl: string | null;`
- track it in state alongside the rest (it saves immediately via its own API — not part of the form submit)
- render at the top of the form, before Company Name:

```tsx
      <LogoUploader
        logoUrl={profile.logoUrl}
        onChange={(logoUrl) => setProfile((p) => ({ ...p, logoUrl }))}
      />
```

with import `import { LogoUploader } from "@/components/settings/LogoUploader";`

- [ ] **Step 3: Wire the dialog**

`components/settings/ProfileSettingsDialog.tsx` fetches `/api/profile` on open — ensure the object passed as `initialProfile` includes `logoUrl` (GET already returns it after Task 4; add the field where the response is mapped into state, defaulting `?? null`).

- [ ] **Step 4: Verify in browser**

Dev server running. Manual: dashboard → user menu (`user-menu-trigger`) → Profile Settings (`menu-profile-settings`) → upload a PNG → preview shows; reopen dialog → still there; Remove → placeholder returns.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npm run type-check && npm run lint
git add components/settings/LogoUploader.tsx components/settings/ProfileForm.tsx components/settings/ProfileSettingsDialog.tsx
git commit -m "feat(logo): logo upload section in profile settings"
```

---

### Task 9: e2e spec + full verification gate

**Files:**
- Create: `e2e/profile-logo.spec.ts`

**Interfaces:**
- Consumes: testids from Task 8 (`logo-preview`, `logo-upload-button`, `logo-remove-button`, `logo-file-input`, `logo-error`), header testids (`user-menu-trigger`, `menu-profile-settings`, `profile-settings-dialog`).

- [ ] **Step 1: Write the spec**

`e2e/profile-logo.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// 1x1 transparent PNG
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function openProfileSettings(page: import("@playwright/test").Page) {
  await page.goto("/dashboard");
  await page.getByTestId("user-menu-trigger").click();
  await page.getByTestId("menu-profile-settings").click();
  await expect(page.getByTestId("profile-settings-dialog")).toBeVisible();
}

test.describe("business logo", () => {
  test("upload shows preview and persists; remove clears it", async ({ page }) => {
    await openProfileSettings(page);

    // Upload
    await page.getByTestId("logo-file-input").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: PNG_1PX,
    });
    await expect(page.getByTestId("logo-preview").locator("img")).toBeVisible();

    // Persists across dialog reopen
    await page.keyboard.press("Escape");
    await openProfileSettings(page);
    await expect(page.getByTestId("logo-preview").locator("img")).toBeVisible();

    // API reflects it
    const profile = await (await page.request.get("/api/profile")).json();
    expect(profile.logoUrl).toContain("/logos/");

    // Remove
    await page.getByTestId("logo-remove-button").click();
    await expect(page.getByTestId("logo-preview").locator("img")).toHaveCount(0);
    const after = await (await page.request.get("/api/profile")).json();
    expect(after.logoUrl).toBeNull();
  });

  test("rejects a non-image file client-side", async ({ page }) => {
    await openProfileSettings(page);
    await page.getByTestId("logo-file-input").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await expect(page.getByTestId("logo-error")).toContainText("PNG, JPG, or WebP");
  });
});
```

Note: hidden file inputs accept `setInputFiles` in Playwright. The GET /api/profile shape — adjust the assertion if the route nests the profile (check the actual response, e.g. `body.profile.logoUrl`).

- [ ] **Step 2: Run the spec**

Playwright config starts its own server (`reuseExistingServer: false`) — stop any running dev server first, or run against the suite normally:

```bash
npx playwright test e2e/profile-logo.spec.ts
```

Expected: 2 passed.

- [ ] **Step 3: Full gate**

```bash
npm run type-check && npm run lint && npm run test:unit && npx playwright test e2e/profile-logo.spec.ts e2e/quote-flow.spec.ts
```

Expected: all clean — quote-flow proves sends still work with logo plumbing in place.

- [ ] **Step 4: Manual visual check (PDF + email)**

Dev server up, logo uploaded: open a quote → Actions → download PDF → logo at top-left of header, name below it. Send quote (RESEND_MOCK=1) → no errors.

- [ ] **Step 5: Commit**

```bash
git add e2e/profile-logo.spec.ts
git commit -m "test(logo): e2e coverage for logo upload/remove"
```

---

## Self-Review Notes

- **Spec coverage:** storage bucket (T2), upload API + validation (T1/T4), metadata plumbing (T3/T5), PDF quote+receipt (T6 — shared header covers both), all emails (T7 — shared template), settings UI (T8), tests (T1/T9), dev caveat documented in spec. Receipt emails route through the same `generateQuoteEmailHTML` + `buildQuotePdfPayload` — confirmed by grep, single change point.
- **Type consistency:** `logoUrl?: string | null` on both CompanyInfo defs; `companyLogoUrl?: string` on QuoteEmailData; `logoSrc?: Buffer | null` on QuotePDFDocument; `updateUserLogoUrl(userId, logoUrl | null)` — names match across tasks.
- **Known soft spots called out inline:** logger.warn existence (T5), supabaseAdmin import path (T4), GET /api/profile response nesting (T9), Task 5↔6 compile coupling (commit together if needed).
