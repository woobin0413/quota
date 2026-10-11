# Marketing Landing Page (Bilingual) — Design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**App name:** Quota (renamed from SiteQuote)

## Problem

The current homepage is a thin hero + sign-in. Quota needs a marketing
landing page that makes contractors stop and look: showcase the app's
real advantages, tease the upcoming voice-to-invoice feature with a
waitlist, present pricing, and serve Spanish-speaking contractors — all
in a modern, big-tech-quality visual style while keeping Quota's
existing "contractor's ledger" brand identity (Barlow Condensed display
type, navy `--primary`, amber accent, stamp red).

Visual reference: modern sectioned layout (Dribbble "HopeRise" style —
bold type, rounded feature cards, generous whitespace, colorful stat
chips) **blended with** the existing ledger aesthetic, not replacing it.

## Decisions (locked)

- Voice-to-invoice is marketed as **"Coming soon" + waitlist email
  capture**. The feature is NOT built yet; the page must not imply it is
  live.
- Landing page is bilingual **EN/ES** with a client-side toggle.
  Spanish is page-only for now (app UI stays English).
- Pricing tiers: **Free $0** (3 clients) · **Pro $15/mo** · **Ultimate
  $29/mo**. "Founding price" framing allowed.
- Money-free positioning is a headline feature: "No card fees. Ever. We
  never touch your money."

## Non-Goals

- Building the actual voice-to-invoice feature (separate future project)
- App-wide i18n framework (page-scoped dictionary only)
- Real testimonials (placeholders clearly marked until real ones exist)
- Payment/checkout for the paid tiers (tiers link to signup; billing is
  a future project)
- CMS — copy lives in code

## Page Structure

Rebuild `app/page.tsx` as a server component composed of section
components in `components/landing/`:

1. **Sticky header** — Quota wordmark · language toggle (EN/ES) ·
   Sign in button. Translucent blur over content on scroll.
2. **Hero** — keep the existing headline pattern ("Price the job. Send
   the bill. Get paid.") and the live sample-invoice card mock (JSX, not
   screenshots). Add badge: "No card fees. Ever." CTAs: **Start free** →
   `/auth/login`, **See pricing** → `#pricing` anchor.
3. **Voice-to-invoice teaser** — eyebrow "Coming soon". Headline:
   "Speak the job. Send the bill." Animated mock: a transcript line
   types out, then line items appear one-by-one in a mini invoice card
   (CSS animation, no JS animation lib). **WaitlistForm** inline.
4. **Feature grid** — 6 cards: Work Catalog · Milestone payments ·
   Zero fees ("we never touch your money") · Logo-branded PDFs ·
   Payment receipts · Client history. Icon + title + 1-2 sentences.
5. **Pricing** (`#pricing`) — 3 cards:
   - **Free $0** — 3 clients, unlimited quotes, PDF export, "Made with
     Quota" footer on PDFs
   - **Pro $15/mo** — unlimited clients, email invoicing, milestone
     schedules, logo + PDF themes (highlighted "Most popular")
   - **Ultimate $29/mo** — everything in Pro + payment receipts,
     follow-up reminders, voice-to-invoice when it ships, Spanish
     client documents
   Each card CTA → `/auth/login`. Footnote: founding prices.
6. **Social proof** — 3 placeholder testimonial cards (marked as
   illustrative) + trade chips row (Plumbing, Electrical, Painting,
   HVAC, Landscaping, Remodeling).
7. **FAQ accordion** — 5 items: Do you take a cut of my payments? ·
   Is there a Spanish version? · Who owns my data / can I export? ·
   Can I cancel anytime? · When does voice-to-invoice launch?
8. **Footer** — repeat CTA + waitlist, minimal links (Sign in,
   contact email), © Quota.

## Bilingual (EN/ES)

- One dictionary module `lib/landing-copy.ts` exporting
  `LANDING_COPY: { en: {...}, es: {...} }` — typed so both locales must
  have identical keys (`Record<Locale, LandingCopy>`).
- Client `LanguageProvider` (context) wrapping the page's client
  sections: initial locale from `?lang=` param, else `localStorage`,
  else `navigator.language` startsWith "es", else `en`.
- Toggle in header persists choice to localStorage and updates context
  (no page reload).
- All landing copy — including FAQ, pricing bullets, form messages —
  comes from the dictionary. No hardcoded English in landing components.
- Spanish copy quality: natural Latin-American Spanish for trades
  audience, not literal machine translation ("presupuesto" for quote,
  "factura" for invoice).

## Waitlist

- **DB:** migration 008 (`db/migrations/008_waitlist.sql` +
  `008_rollback.sql`, mirrored to `supabase/migrations/` with timestamp
  prefix): table `waitlist_signups` — `id uuid pk default
  uuid_generate_v4()`, `email varchar(255) not null`, `locale
  varchar(5) not null default 'en'`, `source varchar(50) not null
  default 'voice-teaser'`, `created_at timestamptz default now()`,
  unique index on `lower(email)`.
- **API:** `POST /api/waitlist` — public (add `/api/waitlist` to
  middleware `PUBLIC_ROUTES`). Zod: `{ email: valid email ≤255, locale:
  "en"|"es" optional, website: string optional }` where `website` is a
  honeypot field — if non-empty, return `{ success: true }` without
  writing (silent drop). Duplicate email → also `{ success: true }`
  (idempotent; no email enumeration signal). DB errors → 500 via
  `logger.error`.
- **UI:** `WaitlistForm` client component — email input + submit,
  inline success ("You're on the list") and error states, honeypot
  hidden field, `data-testid="waitlist-email"` / `"waitlist-submit"` /
  `"waitlist-success"`.

## Visual / Technical Notes

- Server component page; client islands only where needed
  (LanguageProvider + toggle, WaitlistForm, FAQ accordion, voice-teaser
  animation trigger).
- Respect `prefers-reduced-motion`: typing/line-item animations degrade
  to static.
- Product mocks are JSX recreations (like the current sample invoice
  card), not image files — crisp at any DPI, theme-consistent.
- Existing utility classes (`eyebrow`, `stamp`, `figure`, `font-display`)
  are the design vocabulary; new landing-specific styles stay in
  component files/Tailwind, not globals.
- Accessibility: semantic sections + h1-h3 hierarchy, accordion keyboard
  operable (shadcn Accordion), toggle announces language, form labels.
- SEO: page `metadata` export (title "Quota — Quoting & invoicing for
  contractors", description, OpenGraph); `lang` attribute stays "en"
  (client toggle doesn't change document lang — acceptable for v1).

## Error Handling

- Waitlist POST failure → inline retry message (localized).
- Landing renders fully without JS except the client islands (form and
  toggle need JS; content readable regardless).

## Security

- `/api/waitlist` is the app's first public POST: validate with zod,
  honeypot for bots, silent-success on duplicates (no enumeration),
  length caps, no auth data touched. Service-role insert scoped to the
  one table.
- No user-generated content rendered on the page.

## Testing

- e2e `landing.spec.ts`: page renders all 8 sections (testids) ·
  language toggle swaps hero headline EN↔ES · waitlist happy path
  (unique email → success state) · honeypot filled → success shown but
  (optionally) no row · pricing anchor scrolls.
- Unit: none needed beyond existing (copy dictionary is typed; compile
  is the test).
- `npm run type-check` + `npm run lint` clean.
- Visual: controller screenshots page at desktop + mobile widths and
  reviews against this spec.

## Implementation Surface

- `app/page.tsx` rebuild + `components/landing/` (~8 components)
- `lib/landing-copy.ts` (EN + ES dictionaries)
- Migration 008 + mirror
- `app/api/waitlist/route.ts` + middleware public-route addition
- `e2e/landing.spec.ts`
