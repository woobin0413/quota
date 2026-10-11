# Business Logo Branding — Design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Author:** Senior fullstack (pairing with SpaceBoy)

## Problem

Contractors want their business logo on client-facing artifacts. Today quotes
and receipts carry only the company **name** text. Goal: let a contractor
upload a logo in profile settings and have it appear on:

- Quote PDF header
- Payment-receipt PDF header
- All outgoing emails (quote send + payment-receipt emails)

("Everywhere" was the chosen scope.)

## Non-Goals

- Multiple logos / theme variants
- In-app image cropping or editing UI
- CDN beyond Supabase Storage
- Changing the existing text company-name branding (logo augments, never
  replaces — text stays for accessibility and plain-text fallback)

## Constraints & Context

- Email `<img>` and `@react-pdf` `<Image>` both require a **publicly
  reachable URL**. Base64 data URIs are rejected/stripped by many email
  clients and bloat DB rows — ruled out.
- App already uses Supabase (service-role `supabaseAdmin`). No storage bucket
  exists yet. `sharp` is not installed.
- Profile "extra" fields (`companyAddress`, `companyWebsite`) already live in
  `users.metadata` JSONB — the logo URL follows the same pattern (no column
  migration).
- Emails are HTML table templates (`lib/email-templates.ts`): one quote
  template + two receipt templates. PDF is `@react-pdf/renderer`
  (`components/quote/QuotePDFDocument.tsx`) with a `headerRow`.
- Accepted logo types are **PNG and JPEG only**. WebP dropped —
  @react-pdf/renderer v4 cannot render it (silent PDF gap).

## Architecture

### 1. Storage — Supabase Storage public bucket `logos`

- Bucket `logos`, **public read**, created via a new
  `supabase/migrations/*.sql` file (insert into `storage.buckets` + RLS
  policies) so `supabase db reset` reproduces it locally.
- Object path: `{userId}/logo.<ext>` — one logo per user, `upsert: true` on
  re-upload.
- **Writes** happen only through the service-role server route; there is no
  client-side/anon write policy. Public read is acceptable — a logo is meant
  to be visible on invoices.
- The public URL is stored in `users.metadata.logoUrl`, with a
  `?v={unix-ts}` query suffix appended at save time to cache-bust email/CDN
  copies after a re-upload.

### 2. Upload API — `POST/DELETE /api/profile/logo`

`POST` (multipart/form-data, field `file`):

1. `getCurrentUser()` guard (401 otherwise).
2. Read file into a Buffer.
3. **Validate:**
   - Size ≤ 2 MB (reject 413/400 with message).
   - Type by **magic-byte sniff** (not Content-Type/extension trust):
     - PNG: `89 50 4E 47`
     - JPEG: `FF D8 FF`
   - Reject everything else, **including SVG** (XSS vector + poor `@react-pdf`
     SVG support) and **WebP** (dropped — @react-pdf/renderer v4 cannot
     render it, a silent PDF gap).
4. Upload to `logos/{userId}/logo.<ext>` via `supabaseAdmin.storage`
   (`upsert: true`, `contentType` from the sniffed type).
5. Compute public URL, append `?v={Date.now()}`, persist to
   `metadata.logoUrl` via the users repository.
6. Return `{ success: true, logoUrl }`.

`DELETE`: remove the storage object(s) for the user and clear
`metadata.logoUrl`. Returns `{ success: true }`.

Existing `PATCH /api/profile` (JSON) is unchanged — file upload needs its own
multipart route.

### 3. Data plumbing

- `CompanyInfo` interface gains `logoUrl?: string | null` in **both**
  `lib/quote-pdf.ts` and `types/email.ts` (keep the two in sync).
- `buildQuotePdfPayload(...)` reads `user.metadata?.logoUrl` into
  `companyInfo.logoUrl`.
- Every place that builds a `CompanyInfo` for email does the same.

### 4. Rendering

**PDF** (`QuotePDFDocument` + the receipt layout):
- When `logoUrl` present, render `<Image src={logoUrl} />` in `headerRow`,
  constrained to `maxHeight ~48pt`, width auto, aspect preserved.
- Company-name text stays regardless.

**Email** (quote + 2 receipt templates):
- When `logoUrl` present, render `<img src="{logoUrl}" height="40"
  alt="{companyName}" style="...">` in the header table cell. Inline styles
  for client compatibility. Omitted entirely when absent (no broken-image
  icon).

### 5. Settings UI — `components/settings/ProfileForm.tsx`

New **Business Logo** section:
- Preview of current logo (or a placeholder tile when none).
- **Upload** button → hidden file input → client pre-validation (type + size
  for instant feedback) → `POST /api/profile/logo` multipart → update preview
  from returned URL.
- **Remove** button → `DELETE /api/profile/logo` → revert to placeholder.
- Helper text: "PNG or JPG · max 2 MB · a wide transparent PNG works best."

## Data Flow

```
Settings (ProfileForm) --multipart--> POST /api/profile/logo
   -> validate (magic bytes, size)
   -> supabaseAdmin.storage.upload(logos/{userId}/logo.ext, upsert)
   -> metadata.logoUrl = publicUrl?v=ts
   <- { logoUrl }

Send quote / receipt:
   user.metadata.logoUrl -> buildQuotePdfPayload / email CompanyInfo
      -> companyInfo.logoUrl
         -> PDF <Image>        (header)
         -> email <img>        (header cell)
```

## Error Handling

- Invalid type / oversize / no file → 400 with a clear message; UI surfaces it
  inline near the upload control.
- Storage upload failure → 500, logged via `logger.error` with `{ userId,
  route }`; UI shows a generic retry message.
- Missing/broken `logoUrl` at render time → templates simply omit the image
  (guarded by presence check); PDF falls back to name-only header.

## Security

- Path namespaced by `userId` → no cross-tenant overwrite.
- Writes only through the authenticated service-role route; no anon write
  policy on the bucket.
- Magic-byte validation defeats extension/Content-Type spoofing.
- SVG rejected (script-in-SVG XSS; also unsupported by `@react-pdf`).
- Public read is intentional and low-risk (logos are public on invoices);
  filenames are namespaced, not secret.

## Testing

- **Unit:** validation helper — rejects SVG, WebP, oversize, wrong magic
  bytes; accepts valid PNG/JPEG.
- **Integration/route:** POST stores object + sets `metadata.logoUrl`; DELETE
  clears it; unauth → 401.
- **e2e:** upload logo in settings → preview updates; send quote (mocked) →
  email HTML contains the `<img>`; PDF payload carries `logoUrl`.

## Dev Caveat

Local Supabase Storage public URL is `http://127.0.0.1:54321/...` — renders in
local PDF, but will **not** load in a real inbox (dev uses `RESEND_MOCK`, so
no real send). Production public URL works in both email and PDF.

## Implementation Surface (estimate)

- 1 storage migration (bucket + policies), mirrored per repo convention
- 1 API route `app/api/profile/logo/route.ts` (POST + DELETE)
- Validation helper (magic bytes + size)
- `CompanyInfo` type + payload plumbing (2 files)
- 3 email templates + 2 PDF layouts
- 1 settings UI section + client upload logic
- Tests (unit + e2e)
