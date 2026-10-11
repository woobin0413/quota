# Landing Depth & Motion Pass — Design

**Date:** 2026-07-14
**Status:** Approved (menu items 1+3+4+6 from modernization review)
**Guidance:** `frontend-design` + `web-animation-design` skills (Emil Kowalski
motion rules: entrances use ease-out; animate only transform/opacity;
marketing pages may exceed 300ms; every animated element carries its own
reduced-motion handling).

## Problem

The landing page shipped visually strong but static and flat. Four upgrades
make it feel crafted without changing structure or copy:

1. **Signature moment — PAID stamp slam** (hero, page load)
2. **Scroll-reveal choreography** (all sections)
3. **Ledger-paper texture** (hero + voice sections)
4. **OG share image** (social/SMS link previews)

## Non-Goals

- No copy changes, no new sections, no layout restructuring
- No animation library (CSS + one IntersectionObserver hook — no framer-motion)
- No fee calculator / product-screenshot section (separate follow-ups)
- No dark-mode landing variant

## 1. Signature: PAID stamp slam (hero)

Narrative on page load: the quote writes itself, then gets stamped paid.

- Invoice-mock line items ink in staggered (existing `fade-in-up`,
  ~120ms stagger, ease-out) starting ~200ms after load.
- The `Paid` stamp is the finale: appears after the items (~900ms),
  slamming down — `opacity 0, scale(1.6)` → `scale(0.95)` → settle `scale(1)`
  (single keyframe with 3 stops), ~400ms, strong ease-out (expo-like curve
  baked into keyframe percentages). Keeps its existing rotation/placement.
- Card gives a 1px sympathetic dip (`translateY`) timed with stamp landing —
  subtle, transform-only.
- All GPU-safe (transform/opacity), `will-change` on the stamp during the
  animation window.
- `prefers-reduced-motion: reduce` → everything static at final state.
- Hero totals/line items remain in the DOM from first paint (SEO unaffected).

## 2. Scroll-reveal choreography

- New client primitive `components/landing/Reveal.tsx`:
  `<Reveal delay={ms} as?>` — IntersectionObserver (threshold ~0.2,
  `once: true`), pre-state `opacity-0 translate-y-3`, in-view transition
  `500ms` ease-out-cubic with `transitionDelay`.
  Reduced-motion (via `matchMedia` check) and no-IO environments render
  visible immediately. Observer disconnects after firing.
- Applied to: section eyebrow+heading blocks; feature cards (60ms stagger);
  pricing cards (90ms stagger); testimonial cards (80ms stagger); FAQ block;
  footer CTA.
- **Voice teaser fix:** the transcript/line-item animation currently plays on
  mount — finished before anyone scrolls to it. Gate it on in-view (same
  hook): mic pulses continuously, transcript + line items play once when the
  section enters the viewport.
- Playwright note: pre-reveal `opacity-0` elements still count as visible to
  Playwright (only `display:none`/`visibility:hidden` are "hidden"), so the
  existing e2e assertions stay valid.

## 3. Ledger-paper texture

- Utility class `.ledger-paper` in `app/globals.css`: faint horizontal ruled
  lines via `repeating-linear-gradient` (1px `hsl(var(--primary) / 0.04)`
  every 28px) over the existing background color. No images, no new colors.
- Applied to the Hero section and Voice teaser section wrappers only —
  the rest of the page stays flat for contrast.
- Must not affect text contrast (lines sit far below AA thresholds).

## 4. OG share image

- Dynamic OG endpoint `app/og/route.tsx` using `ImageResponse` from
  `next/og` (built into Next 14): 1200×630, navy `#1e2f4a`-family background
  matching `--primary`, QUOTA wordmark, headline "Price the job. Send the
  bill. Get paid.", amber accent, a simplified invoice-card motif with PAID
  stamp. Pure JSX/inline styles (ImageResponse constraint).
- `app/page.tsx` metadata: `openGraph.images: [{ url: "/og", width: 1200,
  height: 630 }]` + `twitter: { card: "summary_large_image" }`.
- `/og` added to middleware `PUBLIC_ROUTES` (boundary-matched like the rest).

## Testing / Verification

- Existing gate: type-check, lint, unit, `e2e/landing.spec.ts` + smoke — all
  stay green (no testid/copy changes).
- New e2e additions (extend `e2e/landing.spec.ts`): `/og` returns 200 with
  `content-type: image/png`; stamp element eventually visible on load.
- Reduced-motion spot check: Playwright context with `reducedMotion:
  "reduce"` → hero stamp visible immediately (no animation dependency).
- Controller visual pass: screenshots desktop EN + mobile; confirm reveal
  choreography, texture subtlety, stamp moment; run `web-design-guidelines`
  review on the changed components.

## Implementation Surface

- `app/globals.css` (+`.ledger-paper`, stamp-slam + card-dip keyframes,
  reduced-motion guards)
- `tailwind.config.ts` (easing tokens if needed)
- `components/landing/Reveal.tsx` (new)
- `components/landing/sections.tsx` (orchestration + reveal application)
- `app/og/route.tsx` (new) + `app/page.tsx` metadata + `middleware.ts`
- `e2e/landing.spec.ts` (2 added tests)
