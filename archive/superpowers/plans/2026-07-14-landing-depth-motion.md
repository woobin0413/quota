# Landing Depth & Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the PAID-stamp signature moment, scroll-reveal choreography, ledger-paper texture, and an OG share image to the landing page — no copy/structure changes.

**Architecture:** Pure CSS keyframes for the hero orchestration (runs on load, GPU-safe transform/opacity only); one `Reveal` client primitive (IntersectionObserver, fire-once) drives scroll reveals and gates the voice-teaser animation on in-view; `next/og` `ImageResponse` renders `/og` dynamically; middleware exposes it publicly.

**Tech Stack:** CSS keyframes + Tailwind, IntersectionObserver, `next/og` (built into Next 14), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-14-landing-depth-motion-design.md`

## Global Constraints

- Animate **only `transform` and `opacity`** (web-animation-design golden rule). Entrances use ease-out curves.
- Every animated element ships a `prefers-reduced-motion: reduce` fallback rendering the **final** state statically (no `!important`).
- No animation library. No copy changes. No testid changes. Existing e2e must stay green untouched (Playwright treats `opacity-0` as visible).
- Hero orchestration timeline: line items stagger in from ~200ms (120ms apart), stamp slams at ~900ms (~400ms long), card dips 1px in sympathy.
- `.ledger-paper` lines: `hsl(var(--primary) / 0.04)`, 1px every 28px, horizontal only; applied ONLY to Hero + VoiceTeaser wrappers.
- `/og`: 1200×630 PNG via `ImageResponse`; added to `PUBLIC_ROUTES` with the exact-or-slash boundary matching already in `middleware.ts`.
- Gates per task: `npm run type-check && npm run lint` (2 pre-existing warnings in `lib/email-sender.ts` + `lib/quote-calculations.ts` OK).
- Branch: `feat/landing-motion`.

## File Structure

| File | Responsibility |
|---|---|
| `app/globals.css` (modify) | `.ledger-paper`, `stamp-slam` + `card-dip` + `ink-in` keyframes, `.hero-*` orchestration classes, reduced-motion guards |
| `components/landing/Reveal.tsx` (create) | `<Reveal>` wrapper + `useInView()` hook (shared by VoiceTeaser) |
| `components/landing/sections.tsx` (modify) | Hero orchestration classes, VoiceTeaser in-view gating, `<Reveal>` wraps |
| `app/og/route.tsx` (create) | Dynamic OG image |
| `app/page.tsx` (modify) | `openGraph.images` + `twitter` metadata |
| `middleware.ts` (modify) | `/og` public |
| `e2e/landing.spec.ts` (modify) | +2 tests (`/og` 200 png; stamp visible under reduced motion) |

**Parallel groups:** Task 1 (primitives/CSS) and Task 2 (OG image) are file-disjoint → MAY run as parallel subagents. Task 3 depends on Task 1. Task 4 last.

---

### Task 1: Motion primitives — CSS + Reveal component  [parallel-group A]

**Files:**
- Modify: `app/globals.css` (append inside `@layer utilities` or alongside the existing `.stamp` utilities — match file convention)
- Create: `components/landing/Reveal.tsx`

**Interfaces:**
- Produces for Task 3:
  - CSS classes: `.ledger-paper`, `.hero-ink` (+ per-item delay via inline style), `.hero-stamp-slam`, `.hero-card-dip`
  - `<Reveal delay={number} className={string}>{children}</Reveal>` (div wrapper)
  - `useInView<T extends HTMLElement>(threshold?: number): { ref: RefObject<T>; inView: boolean }` — `inView` is immediately `true` when reduced-motion or no IntersectionObserver.

- [ ] **Step 1: CSS** — append to `app/globals.css`:

```css
/* ── Landing motion: hero orchestration + scroll reveals ─────────── */

/* Ruled ledger paper: faint horizontal lines, no images */
.ledger-paper {
  background-image: repeating-linear-gradient(
    to bottom,
    transparent,
    transparent 27px,
    hsl(var(--primary) / 0.04) 27px,
    hsl(var(--primary) / 0.04) 28px
  );
}

/* Line items ink in (hero + voice mock) */
@keyframes ink-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.hero-ink {
  opacity: 0;
  animation: ink-in 0.45s cubic-bezier(0.215, 0.61, 0.355, 1) forwards;
}

/* The signature: PAID stamp slams down and settles */
@keyframes stamp-slam {
  0%   { opacity: 0; transform: scale(1.6) rotate(6deg); }
  70%  { opacity: 1; transform: scale(0.95) rotate(6deg); }
  100% { opacity: 1; transform: scale(1) rotate(6deg); }
}
.hero-stamp-slam {
  opacity: 0;
  will-change: transform;
  animation: stamp-slam 0.4s cubic-bezier(0.19, 1, 0.22, 1) 0.9s forwards;
}

/* Card takes the hit: 1px sympathetic dip timed with the stamp landing */
@keyframes card-dip {
  0%, 70% { transform: translateY(0); }
  80%     { transform: translateY(1px); }
  100%    { transform: translateY(0); }
}
.hero-card-dip {
  animation: card-dip 1.4s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .hero-ink,
  .hero-stamp-slam,
  .hero-card-dip {
    animation: none;
    opacity: 1;
  }
}
```

Note: the existing `.stamp.stamp-large` hero stamp is rotated by design — check its current rotation (utility or inline). If it carries no rotation today, drop the `rotate(6deg)` stops (keep scale only) so the animation doesn't add a rotation that wasn't there. Keep whatever visual rotation currently exists.

- [ ] **Step 2: Reveal component** — create `components/landing/Reveal.tsx`:

```tsx
"use client";

/**
 * Scroll-reveal primitive for the landing page.
 *
 * <Reveal> fades/slides its children up when scrolled into view (once).
 * useInView() is the raw hook — VoiceTeaser uses it to start its
 * transcript animation only when visible.
 *
 * Reduced-motion users and no-IntersectionObserver environments see
 * content immediately (inView starts true).
 */

import { useEffect, useRef, useState } from "react";

export function useInView<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return { ref, inView };
}

interface RevealProps {
  children: React.ReactNode;
  /** transition-delay in ms (stagger within a group) */
  delay?: number;
  className?: string;
}

export function Reveal({ children, delay = 0, className = "" }: RevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none ${
        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      } ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Gate + commit**

```bash
npm run type-check && npm run lint
git add app/globals.css components/landing/Reveal.tsx
git commit -m "feat(landing): motion primitives — reveal, stamp-slam, ledger paper"
```

---

### Task 2: OG share image  [parallel-group A]

**Files:**
- Create: `app/og/route.tsx`
- Modify: `app/page.tsx` (metadata), `middleware.ts` (PUBLIC_ROUTES)

**Interfaces:**
- Produces: `GET /og` → 1200×630 PNG. Task 4's e2e asserts 200 + `image/png`.

- [ ] **Step 1: OG route** — create `app/og/route.tsx`:

```tsx
/**
 * Dynamic OG image (1200×630) for social/SMS link previews.
 * Pure inline styles per ImageResponse constraints; palette mirrors
 * the landing tokens (navy primary, amber accent, paper card).
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#1c2b45",
          color: "#f7f5ef",
          padding: 64,
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 620 }}>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: 4,
              color: "#e8a33d",
              textTransform: "uppercase",
            }}
          >
            Quota
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 72,
              fontWeight: 800,
              lineHeight: 1.05,
              textTransform: "uppercase",
              marginTop: 24,
            }}
          >
            <span>Price the job.</span>
            <span>Send the bill.</span>
            <span style={{ color: "#e8a33d" }}>Get paid.</span>
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#c9c4b8", marginTop: 28 }}>
            Quoting &amp; invoicing for contractors — no card fees, ever.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 360,
            background: "#fdfcf8",
            color: "#1c2b45",
            borderRadius: 8,
            padding: 28,
            position: "relative",
            boxShadow: "10px 10px 0 rgba(0,0,0,0.25)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 700, borderBottom: "3px solid #1c2b45", paddingBottom: 12 }}>
            <span>Q-2026-014</span>
            <span>QUOTE</span>
          </div>
          {[
            ["Panel upgrade (200A)", "$2,500"],
            ["Electrician labor", "$600"],
            ["Outlet installation", "$600"],
          ].map(([d, a]) => (
            <div key={d} style={{ display: "flex", justifyContent: "space-between", fontSize: 18, padding: "10px 0", borderBottom: "1px dashed #d5d0c4" }}>
              <span>{d}</span>
              <span>{a}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, fontWeight: 800, paddingTop: 14 }}>
            <span>TOTAL</span>
            <span>$3,700</span>
          </div>
          <div
            style={{
              display: "flex",
              position: "absolute",
              top: -18,
              right: -14,
              transform: "rotate(6deg)",
              border: "4px solid #2e7d4f",
              color: "#2e7d4f",
              fontSize: 26,
              fontWeight: 800,
              padding: "4px 14px",
              letterSpacing: 3,
              background: "rgba(253,252,248,0.9)",
            }}
          >
            PAID
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
```

- [ ] **Step 2: metadata** — in `app/page.tsx`, extend the existing `metadata.openGraph` with:

```ts
    images: [{ url: "/og", width: 1200, height: 630 }],
```

and add a sibling top-level key:

```ts
  twitter: {
    card: "summary_large_image",
    title: "Quota — Quoting & invoicing for contractors",
    description: "Price the job. Send the bill. Get paid. No card fees, ever.",
    images: ["/og"],
  },
```

- [ ] **Step 3: middleware** — add `"/og"` to `PUBLIC_ROUTES` in `middleware.ts` (the boundary matcher already handles exact-or-slash).

- [ ] **Step 4: verify**

```bash
curl -s -o /tmp/og.png -w "%{http_code} %{content_type}\n" http://localhost:3000/og
# → 200 image/png ; open /tmp/og.png to eyeball if desired
```

- [ ] **Step 5: Gate + commit**

```bash
npm run type-check && npm run lint
git add app/og/route.tsx app/page.tsx middleware.ts
git commit -m "feat(landing): dynamic OG share image"
```

---

### Task 3: Sections integration (orchestration + reveals)  [after Task 1]

**Files:**
- Modify: `components/landing/sections.tsx`

**Interfaces:**
- Consumes: `.hero-ink`/`.hero-stamp-slam`/`.hero-card-dip`/`.ledger-paper` (Task 1 CSS), `Reveal` + `useInView` from `@/components/landing/Reveal`.

- [ ] **Step 1: Hero orchestration**
  - Hero `<section>` wrapper: add `ledger-paper` to its className.
  - Invoice-mock card div (`border bg-card p-6 shadow-…`): add `hero-card-dip`.
  - Each `SAMPLE_LINES` row: add `hero-ink` + inline `style={{ animationDelay: `${0.2 + i * 0.12}s` }}` (map already has index available — add `i` param).
  - The totals row (`mt-4 flex … border-t-2`): also `hero-ink` with delay `0.2 + SAMPLE_LINES.length * 0.12`.
  - The `Paid` stamp span: add `hero-stamp-slam`. If the stamp currently has no rotation, Task 1's keyframe was adjusted accordingly — just apply the class.

- [ ] **Step 2: VoiceTeaser plays on view**
  - `const { ref, inView } = useInView<HTMLDivElement>(0.35);` — attach `ref` to the mock card container.
  - Voice section wrapper: add `ledger-paper` alongside `bg-card`.
  - Replace the mount-time animation classes on the three mock line items: when `inView`, apply the existing `motion-safe:animate-[fade-in-up_0.5s_ease-out_forwards]` + delays; when not yet in view, just `opacity-0 motion-reduce:opacity-100`. (Conditional className on `inView` — CSS animation starts when the class lands.)
  - Transcript `<p>`: same in-view gating with a `fade-in-up` at delay 0.1s so words appear before items.

- [ ] **Step 3: Apply `<Reveal>` wraps** (import from `@/components/landing/Reveal`):
  - Features: wrap the eyebrow+h2 block in `<Reveal>`; wrap each feature card in `<Reveal delay={i * 60}>` (map index).
  - Pricing: heading block `<Reveal>`; each tier card `<Reveal delay={i * 90}>` — put the wrapper INSIDE the grid cell (Reveal renders a div; ensure grid child is the Reveal div — className pass-through supports `h-full` if needed).
  - SocialProof: heading `<Reveal>`; each quote card `<Reveal delay={i * 80}>`; chips row `<Reveal delay={250}>`.
  - Faq: wrap the heading block and the items container each in `<Reveal>`.
  - Footer: wrap the CTA h2+button block in `<Reveal>`.
  - Hero and header get NO Reveal (hero has its own orchestration; header is sticky chrome).

- [ ] **Step 4: manual check** — dev server: load `/`, confirm stamp slams after items ink in; scroll: sections reveal once, voice animation starts on entry; toggle OS reduced-motion (or DevTools emulation) → everything static-visible.

- [ ] **Step 5: Gate + commit**

```bash
npm run type-check && npm run lint
git add components/landing/sections.tsx
git commit -m "feat(landing): hero stamp orchestration, in-view voice teaser, scroll reveals"
```

---

### Task 4: e2e additions + full gate

**Files:**
- Modify: `e2e/landing.spec.ts` (append 2 tests inside the describe block)

- [ ] **Step 1: append tests**

```ts
  test("og image endpoint serves a png", async ({ page }) => {
    const res = await page.request.get("/og");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });

  test("hero stamp is visible with reduced motion", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.getByTestId("landing-hero").getByText("Paid")).toBeVisible();
    await ctx.close();
  });
```

- [ ] **Step 2: full gate** (kill :3000 first; `reuseExistingServer: false`)

```bash
npm run type-check && npm run lint && npm run test:unit && npx playwright test e2e/landing.spec.ts e2e/smoke.spec.ts
```
Expected: all green (8 landing tests now).

- [ ] **Step 3: Commit**

```bash
git add e2e/landing.spec.ts
git commit -m "test(landing): og endpoint + reduced-motion stamp coverage"
```

- [ ] **Step 4 (controller): visual + guidelines pass** — restart dev; screenshot desktop EN + mobile; verify stamp moment, reveal cadence, texture subtlety; run `web-design-guidelines` review over changed components; fix-or-defer findings.

---

## Self-Review Notes

- Spec coverage: stamp slam (T1 CSS + T3 wiring), reveals + voice gating (T1 primitive + T3), texture (T1 class + T3 application), OG (T2), tests (T4), reduced-motion everywhere (T1 media query, Reveal hook short-circuit, T4 e2e).
- Type consistency: `useInView` return `{ ref, inView }` used in T3; class names `.hero-ink/.hero-stamp-slam/.hero-card-dip/.ledger-paper` consistent T1↔T3; `/og` route ↔ metadata ↔ middleware ↔ e2e.
- Soft spots flagged: stamp's current rotation (T1 Step 1 note — implementer checks actual markup), Reveal-in-grid layout (T3 Step 3 note).
- Parallel-safety: T1 and T2 share zero files; T3 waits on T1; T4 last.
