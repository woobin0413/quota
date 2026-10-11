# Marketing Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/` as a bilingual (EN/ES) marketing landing page: hero, voice-to-invoice "coming soon" waitlist, feature grid, pricing, social proof, FAQ.

**Architecture:** `app/page.tsx` stays a server component (SEO `metadata`) that renders one client tree `<LandingPage/>` — locale is client state (LanguageProvider: `?lang` → localStorage → navigator.language), so every section reads copy from a typed EN/ES dictionary via `useLandingCopy()`. Waitlist is the app's first public POST: zod + honeypot + idempotent duplicate handling, rows in `waitlist_signups`.

**Tech Stack:** Next.js 14 App Router, Tailwind + existing ledger design vocabulary (`eyebrow`, `stamp`, `figure`, `font-display`), lucide-react icons, native `<details>` FAQ (no new deps), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-13-marketing-landing-page-design.md`

## Global Constraints

- Tiers exactly: **Free $0** (3 clients) · **Pro $15/mo** ("Most popular") · **Ultimate $29/mo**. Footnote: founding prices.
- Voice-to-invoice is **"Coming soon"** — copy must never imply it is live.
- All landing copy (incl. form messages, FAQ) comes from `lib/landing-copy.ts` — no hardcoded strings in landing components. EN and ES key-identical (typed).
- App name is **Quota** everywhere.
- Honeypot field name: `website`. Filled honeypot AND duplicate email both return `{ success: true }` (silent; no enumeration).
- Keep existing hero headline pattern + JSX invoice mock; do not replace with image files.
- Respect `prefers-reduced-motion` for all animation.
- Migrations: paired `db/migrations/008_waitlist.sql` + `008_rollback.sql`, mirrored to `supabase/migrations/20260713000001_waitlist.sql`.
- testids: `waitlist-email`, `waitlist-submit`, `waitlist-success`, `lang-toggle`, and one `landing-<section>` per section (hero, voice, features, pricing, proof, faq, footer).
- `npm run type-check` and `npm run lint` clean before any task is done (2 pre-existing warnings in `lib/email-sender.ts` + `lib/quote-calculations.ts` are OK).
- Branch: `feat/marketing-landing` (exists; spec committed).

## File Structure

| File | Responsibility |
|---|---|
| `db/migrations/008_waitlist.sql` + `008_rollback.sql` + supabase mirror | `waitlist_signups` table |
| `app/api/waitlist/route.ts` (create) | Public POST: validate, honeypot, idempotent insert |
| `middleware.ts` (modify line ~5) | Add `/api/waitlist` to `PUBLIC_ROUTES` |
| `lib/landing-copy.ts` (create) | Typed `LandingCopy` + `LANDING_COPY: Record<Locale, LandingCopy>` |
| `components/landing/LanguageProvider.tsx` (create) | Locale context + `useLandingCopy()` + `useLocale()` |
| `components/landing/LangToggle.tsx` (create) | EN/ES switch, persists localStorage |
| `components/landing/WaitlistForm.tsx` (create) | Email capture w/ honeypot + states |
| `components/landing/FaqItem.tsx` (create) | Styled `<details>` accordion row |
| `components/landing/LandingPage.tsx` (create) | Client tree assembling all sections |
| `components/landing/sections.tsx` (create) | Header, Hero, VoiceTeaser, Features, Pricing, SocialProof, Faq, Footer (one file — they share copy hooks and are only consumed by LandingPage) |
| `app/page.tsx` (rewrite) | Server: `metadata` + `<LandingPage/>` |
| `e2e/landing.spec.ts` (create) | Render, toggle, waitlist, anchor |

**Parallel groups:** Task 1 and Task 2 touch disjoint files → MAY run as parallel subagents. Tasks 3 → 4 → 5 are sequential (each consumes the previous).

---

### Task 1: Waitlist backend (migration + public API)  [parallel-group A]

**Files:**
- Create: `db/migrations/008_waitlist.sql`, `db/migrations/008_rollback.sql`, `supabase/migrations/20260713000001_waitlist.sql`
- Create: `app/api/waitlist/route.ts`
- Modify: `middleware.ts` (PUBLIC_ROUTES, line ~5)

**Interfaces:**
- Consumes: `supabaseAdmin` from `@/lib/db/core`, `parseJsonBody` from `@/lib/api-validation`, `logger` from `@/lib/logger`.
- Produces: `POST /api/waitlist` accepting `{ email: string, locale?: "en"|"es", website?: string }` → `{ success: true }` (all non-error paths) | 400 `{ success:false, message }` | 500. Task 3's WaitlistForm posts to it; Task 5's e2e exercises it.

- [ ] **Step 1: Write the migration**

`db/migrations/008_waitlist.sql`:

```sql
-- 008: Voice-to-invoice waitlist signups (public landing page capture)

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  locale VARCHAR(5) NOT NULL DEFAULT 'en',
  source VARCHAR(50) NOT NULL DEFAULT 'voice-teaser',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent duplicate handling keys on lowercased email
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email_lower
  ON waitlist_signups (LOWER(email));

COMMENT ON TABLE waitlist_signups IS 'Landing-page waitlist (voice-to-invoice teaser); public POST /api/waitlist';
```

`db/migrations/008_rollback.sql`:

```sql
-- Rollback 008
DROP TABLE IF EXISTS waitlist_signups;
```

Mirror: `cp db/migrations/008_waitlist.sql supabase/migrations/20260713000001_waitlist.sql`

- [ ] **Step 2: Apply to running local DB (no reset)**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f db/migrations/008_waitlist.sql`
Expected: `CREATE TABLE`, `CREATE INDEX`, `COMMENT`.
Verify: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d waitlist_signups" | head -12` shows the columns.

- [ ] **Step 3: Add the public route to middleware**

`middleware.ts` line ~5:

```ts
const PUBLIC_ROUTES = ["/", "/api/webhooks", "/api/waitlist"];
```

- [ ] **Step 4: Create the route**

`app/api/waitlist/route.ts`:

```ts
/**
 * Waitlist Route (public)
 *
 * POST /api/waitlist — landing-page email capture for the
 * voice-to-invoice teaser. No auth. Anti-abuse: zod validation,
 * `website` honeypot (bots fill it → silent success, no write),
 * and duplicate emails return success without a second row
 * (no enumeration signal either way).
 *
 * @module api/waitlist
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/db/core";
import { parseJsonBody } from "@/lib/api-validation";
import { logger } from "@/lib/logger";

const waitlistSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  locale: z.enum(["en", "es"]).optional().default("en"),
  // Honeypot: humans never see it; bots fill it
  website: z.string().optional().default(""),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, waitlistSchema);
    if (parsed.response) return parsed.response;

    const { email, locale, website } = parsed.data;

    // Honeypot tripped — pretend success, write nothing
    if (website !== "") {
      return NextResponse.json({ success: true });
    }

    const { error } = await supabaseAdmin
      .from("waitlist_signups")
      .insert({ email: email.toLowerCase(), locale, source: "voice-teaser" });

    // 23505 = unique_violation → already signed up → idempotent success
    if (error && error.code !== "23505") throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Waitlist signup error", {
      err: error,
      route: "POST /api/waitlist",
    });
    return NextResponse.json(
      { success: false, message: "Something went wrong. Try again.", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
```

Note: verify `parseJsonBody`'s exact return contract in `lib/api-validation.ts` before use; adjust destructuring if its shape differs from `{ data, response }`.

- [ ] **Step 5: Verify with curl (dev server on :3000)**

```bash
curl -s -X POST http://localhost:3000/api/waitlist -H 'Content-Type: application/json' -d '{"email":"wl-test@example.com"}'
# → {"success":true}
curl -s -X POST http://localhost:3000/api/waitlist -H 'Content-Type: application/json' -d '{"email":"wl-test@example.com"}'
# → {"success":true}  (duplicate, idempotent)
curl -s -X POST http://localhost:3000/api/waitlist -H 'Content-Type: application/json' -d '{"email":"bot@spam.com","website":"http://spam"}'
# → {"success":true}  (honeypot)
curl -s -X POST http://localhost:3000/api/waitlist -H 'Content-Type: application/json' -d '{"email":"not-an-email"}'
# → 400 with validation message
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "SELECT email, locale FROM waitlist_signups;"
# → exactly one row: wl-test@example.com (bot row absent). Then clean up:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "DELETE FROM waitlist_signups WHERE email='wl-test@example.com';"
```

- [ ] **Step 6: Gate + commit**

```bash
npm run type-check && npm run lint
git add db/migrations/008_waitlist.sql db/migrations/008_rollback.sql supabase/migrations/20260713000001_waitlist.sql app/api/waitlist/route.ts middleware.ts
git commit -m "feat(landing): public waitlist endpoint with honeypot"
```

---

### Task 2: Landing copy dictionary (EN + ES)  [parallel-group A]

**Files:**
- Create: `lib/landing-copy.ts`

**Interfaces:**
- Produces: `type Locale = "en" | "es"`, `interface LandingCopy` (shape below), `const LANDING_COPY: Record<Locale, LandingCopy>`. Tasks 3-4 consume via `useLandingCopy()`.

- [ ] **Step 1: Create the module** (full content — ES is natural Latin-American trades Spanish, not literal translation)

```ts
/**
 * Landing Copy — EN/ES
 *
 * Every string on the marketing landing page lives here so both
 * locales stay key-identical by type. "presupuesto" = quote,
 * "factura" = invoice, per trades usage.
 */

export type Locale = "en" | "es";

export interface LandingCopy {
  header: { signIn: string };
  hero: {
    eyebrow: string;
    line1: string; line2: string; line3: string;
    sub: string;
    ctaPrimary: string; ctaSecondary: string;
    feeBadge: string;
  };
  voice: {
    eyebrow: string; title: string; sub: string;
    transcript: string;
    waitlistLabel: string; waitlistPlaceholder: string; waitlistButton: string;
    waitlistSuccess: string; waitlistError: string; waitlistInvalid: string;
  };
  features: {
    eyebrow: string; title: string;
    items: { title: string; body: string }[]; // exactly 6
  };
  pricing: {
    eyebrow: string; title: string; sub: string;
    perMonth: string; popular: string; footnote: string; cta: string;
    tiers: { name: string; price: string; blurb: string; bullets: string[] }[]; // exactly 3: Free, Pro, Ultimate
  };
  proof: {
    eyebrow: string; title: string; disclaimer: string;
    quotes: { text: string; name: string; trade: string }[]; // 3 placeholders
    trades: string[]; // chips
  };
  faq: {
    eyebrow: string; title: string;
    items: { q: string; a: string }[]; // exactly 5
  };
  footer: { cta: string; ctaButton: string; signIn: string; rights: string };
}

export const LANDING_COPY: Record<Locale, LandingCopy> = {
  en: {
    header: { signIn: "Sign in" },
    hero: {
      eyebrow: "Quoting for the trades",
      line1: "Price the job.",
      line2: "Send the bill.",
      line3: "Get paid.",
      sub: "Keep your own price book, build a quote in a couple of taps, and email it to the client with a PDF attached. Mark it paid when the check clears — Quota keeps the ledger.",
      ctaPrimary: "Start free",
      ctaSecondary: "See pricing",
      feeBadge: "No card fees. Ever.",
    },
    voice: {
      eyebrow: "Coming soon",
      title: "Speak the job. Send the bill.",
      sub: "Say it like you'd say it to your apprentice — Quota drafts the quote from your own price book. Join the waitlist and be first in line.",
      transcript: "“140 feet of copper repipe, a 50-gallon water heater, and two toilets…”",
      waitlistLabel: "Get early access",
      waitlistPlaceholder: "you@company.com",
      waitlistButton: "Join the waitlist",
      waitlistSuccess: "You're on the list. We'll email you at launch.",
      waitlistError: "Something went wrong. Try again.",
      waitlistInvalid: "Enter a valid email",
    },
    features: {
      eyebrow: "Why Quota",
      title: "Built for how contractors actually work",
      items: [
        { title: "Your price book", body: "Set up the work you do once — your services, your units, your prices. Start from trade templates and adjust to your market." },
        { title: "Milestone payments", body: "Deposit, mid-job, completion. Put a payment schedule on every quote and get paid in stages like the big outfits." },
        { title: "We never touch your money", body: "Cash, check, Zelle — collect it your way and keep 100%. Quota tracks it; no processor, no percentage, no waiting on payouts." },
        { title: "Your logo on everything", body: "Quotes and receipts carry your brand, not ours. Clean, professional PDFs that win jobs at the kitchen table." },
        { title: "Receipts on tap", body: "Record a payment and send a proper receipt in one tap. Your clients get paper; you get a clean history." },
        { title: "Client memory", body: "Every quote, payment, and note per client — so next year's callback starts with last year's numbers." },
      ],
    },
    pricing: {
      eyebrow: "Pricing",
      title: "Start free. Upgrade when the work does.",
      sub: "No card fees on any plan — we never take a cut of your money.",
      perMonth: "/mo",
      popular: "Most popular",
      footnote: "Founding prices — locked in for early users.",
      cta: "Start free",
      tiers: [
        { name: "Free", price: "$0", blurb: "For trying it on a real job", bullets: ["3 clients", "Unlimited quotes", "PDF export", "“Made with Quota” footer"] },
        { name: "Pro", price: "$15", blurb: "For the working contractor", bullets: ["Unlimited clients", "Email invoicing", "Milestone schedules", "Your logo + PDF themes"] },
        { name: "Ultimate", price: "$29", blurb: "Everything, plus what's next", bullets: ["Everything in Pro", "Payment receipts", "Follow-up reminders", "Voice-to-invoice at launch", "Spanish client documents"] },
      ],
    },
    proof: {
      eyebrow: "The trades",
      title: "Made for every truck, every trade",
      disclaimer: "Illustrative examples while we're in early access.",
      quotes: [
        { text: "I quoted a repipe from the driveway before the competition got home to their laptop.", name: "M. Torres", trade: "Plumbing" },
        { text: "The deposit-first schedule alone paid for the year.", name: "D. Okafor", trade: "Electrical" },
        { text: "Clients stopped asking if I'm ‘a real company.’ The PDF did that.", name: "S. Alvarez", trade: "Painting" },
      ],
      trades: ["Plumbing", "Electrical", "Painting", "HVAC", "Landscaping", "Remodeling"],
    },
    faq: {
      eyebrow: "FAQ",
      title: "Fair questions",
      items: [
        { q: "Do you take a cut of my payments?", a: "No. Quota never touches your money. You collect cash, check, or transfer directly — we just keep the ledger straight. No processing fees, ever." },
        { q: "Is there a Spanish version?", a: "This page speaks Spanish today (top-right toggle), and Spanish client documents are coming to the Ultimate plan. The full app in Spanish is on the roadmap." },
        { q: "Who owns my data?", a: "You do. Your catalog, clients, and quotes are yours — export them anytime, and if you leave, they leave with you." },
        { q: "Can I cancel anytime?", a: "Yes. Monthly plans, no contracts. Downgrade to Free and keep your data." },
        { q: "When does voice-to-invoice launch?", a: "It's in active development. Waitlist members get it first, at no extra charge on Ultimate." },
      ],
    },
    footer: {
      cta: "Win the next job at the kitchen table.",
      ctaButton: "Start quoting free",
      signIn: "Sign in",
      rights: "All rights reserved.",
    },
  },
  es: {
    header: { signIn: "Iniciar sesión" },
    hero: {
      eyebrow: "Presupuestos para los oficios",
      line1: "Cotiza el trabajo.",
      line2: "Manda la factura.",
      line3: "Cobra.",
      sub: "Arma tu propia lista de precios, crea un presupuesto en un par de toques y envíalo al cliente por correo con PDF adjunto. Márcalo pagado cuando te paguen — Quota lleva las cuentas.",
      ctaPrimary: "Empieza gratis",
      ctaSecondary: "Ver precios",
      feeBadge: "Sin comisiones. Nunca.",
    },
    voice: {
      eyebrow: "Próximamente",
      title: "Dilo hablando. Manda la factura.",
      sub: "Dilo como se lo dirías a tu ayudante — Quota arma el presupuesto con tus propios precios. Únete a la lista de espera y sé de los primeros.",
      transcript: "“140 pies de tubería de cobre, un calentador de 50 galones y dos inodoros…”",
      waitlistLabel: "Acceso anticipado",
      waitlistPlaceholder: "tu@empresa.com",
      waitlistButton: "Unirme a la lista",
      waitlistSuccess: "Ya estás en la lista. Te avisamos al lanzar.",
      waitlistError: "Algo salió mal. Inténtalo de nuevo.",
      waitlistInvalid: "Escribe un correo válido",
    },
    features: {
      eyebrow: "Por qué Quota",
      title: "Hecho para cómo trabaja el contratista de verdad",
      items: [
        { title: "Tu lista de precios", body: "Configura una sola vez el trabajo que haces — tus servicios, tus unidades, tus precios. Empieza con plantillas por oficio y ajústalas a tu mercado." },
        { title: "Pagos por etapas", body: "Depósito, mitad de obra, entrega. Pon un calendario de pagos en cada presupuesto y cobra por etapas como las empresas grandes." },
        { title: "Nunca tocamos tu dinero", body: "Efectivo, cheque, Zelle — cobra a tu manera y quédate con el 100%. Quota lo registra; sin procesador, sin porcentaje, sin esperar depósitos." },
        { title: "Tu logo en todo", body: "Presupuestos y recibos con tu marca, no la nuestra. PDFs limpios y profesionales que ganan trabajos en la mesa de la cocina." },
        { title: "Recibos al instante", body: "Registra un pago y envía un recibo formal en un toque. Tu cliente recibe su papel; tú, un historial limpio." },
        { title: "Memoria de clientes", body: "Cada presupuesto, pago y nota por cliente — para que la llamada del próximo año empiece con los números del anterior." },
      ],
    },
    pricing: {
      eyebrow: "Precios",
      title: "Empieza gratis. Sube cuando el trabajo suba.",
      sub: "Sin comisiones de tarjeta en ningún plan — nunca tomamos parte de tu dinero.",
      perMonth: "/mes",
      popular: "El más popular",
      footnote: "Precios de lanzamiento — fijos para los primeros usuarios.",
      cta: "Empieza gratis",
      tiers: [
        { name: "Free", price: "$0", blurb: "Para probarlo en un trabajo real", bullets: ["3 clientes", "Presupuestos ilimitados", "Exportar PDF", "Pie “Hecho con Quota”"] },
        { name: "Pro", price: "$15", blurb: "Para el contratista en activo", bullets: ["Clientes ilimitados", "Facturas por correo", "Calendario de pagos", "Tu logo + estilos de PDF"] },
        { name: "Ultimate", price: "$29", blurb: "Todo, más lo que viene", bullets: ["Todo lo de Pro", "Recibos de pago", "Recordatorios de seguimiento", "Voz a factura al lanzar", "Documentos en español para clientes"] },
      ],
    },
    proof: {
      eyebrow: "Los oficios",
      title: "Para cada camioneta, cada oficio",
      disclaimer: "Ejemplos ilustrativos durante el acceso anticipado.",
      quotes: [
        { text: "Cotizé una retubería desde la entrada antes de que la competencia llegara a su laptop.", name: "M. Torres", trade: "Plomería" },
        { text: "Solo el calendario con depósito por adelantado pagó el año entero.", name: "D. Okafor", trade: "Electricidad" },
        { text: "Los clientes dejaron de preguntar si soy ‘una empresa de verdad.’ El PDF lo logró.", name: "S. Alvarez", trade: "Pintura" },
      ],
      trades: ["Plomería", "Electricidad", "Pintura", "Climatización", "Jardinería", "Remodelación"],
    },
    faq: {
      eyebrow: "Preguntas",
      title: "Preguntas justas",
      items: [
        { q: "¿Se quedan con parte de mis pagos?", a: "No. Quota nunca toca tu dinero. Cobras en efectivo, cheque o transferencia directamente — nosotros solo llevamos las cuentas claras. Sin comisiones, nunca." },
        { q: "¿Hay versión en español?", a: "Esta página habla español hoy (botón arriba a la derecha), y los documentos para clientes en español llegan al plan Ultimate. La app completa en español está en el plan de trabajo." },
        { q: "¿De quién son mis datos?", a: "Tuyos. Tu catálogo, tus clientes y tus presupuestos te pertenecen — expórtalos cuando quieras, y si te vas, se van contigo." },
        { q: "¿Puedo cancelar cuando quiera?", a: "Sí. Planes mensuales, sin contratos. Baja al plan Free y conserva tus datos." },
        { q: "¿Cuándo llega voz a factura?", a: "Está en pleno desarrollo. Los de la lista de espera lo reciben primero, sin costo extra en Ultimate." },
      ],
    },
    footer: {
      cta: "Gana el próximo trabajo en la mesa de la cocina.",
      ctaButton: "Empieza a cotizar gratis",
      signIn: "Iniciar sesión",
      rights: "Todos los derechos reservados.",
    },
  },
};
```

- [ ] **Step 2: Gate + commit**

```bash
npm run type-check && npm run lint
git add lib/landing-copy.ts
git commit -m "feat(landing): typed EN/ES copy dictionary"
```

---

### Task 3: Client islands (LanguageProvider, LangToggle, WaitlistForm, FaqItem)

**Files:**
- Create: `components/landing/LanguageProvider.tsx`, `components/landing/LangToggle.tsx`, `components/landing/WaitlistForm.tsx`, `components/landing/FaqItem.tsx`

**Interfaces:**
- Consumes: `LANDING_COPY`, `Locale`, `LandingCopy` from `@/lib/landing-copy` (Task 2); `POST /api/waitlist` (Task 1).
- Produces for Task 4: `LanguageProvider` (wraps tree), `useLandingCopy(): LandingCopy`, `useLocale(): { locale: Locale; setLocale: (l: Locale) => void }`, `<LangToggle/>`, `<WaitlistForm/>`, `<FaqItem q={string} a={string}/>`.

- [ ] **Step 1: LanguageProvider**

```tsx
"use client";

/**
 * Landing locale context: ?lang= param → localStorage → browser
 * language → "en". Client-only by design (page-scoped i18n, v1).
 */

import { createContext, useContext, useEffect, useState } from "react";
import { LANDING_COPY, type LandingCopy, type Locale } from "@/lib/landing-copy";

const STORAGE_KEY = "quota-landing-lang";

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
}>({ locale: "en", setLocale: () => {} });

function detectLocale(): Locale {
  const param = new URLSearchParams(window.location.search).get("lang");
  if (param === "es" || param === "en") return param;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "es" || stored === "en") return stored;
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // "en" for SSR/first paint; corrected on mount (no hydration mismatch:
  // useEffect runs after hydration)
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useLandingCopy(): LandingCopy {
  return LANDING_COPY[useContext(LocaleContext).locale];
}
```

- [ ] **Step 2: LangToggle**

```tsx
"use client";

import { useLocale } from "@/components/landing/LanguageProvider";

/** EN/ES segmented switch; persists via LanguageProvider. */
export function LangToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const base =
    "px-2.5 py-1 font-display text-xs font-bold uppercase tracking-[0.14em] transition-colors";
  return (
    <div
      className={`inline-flex overflow-hidden rounded border border-primary-foreground/30 ${className}`}
      data-testid="lang-toggle"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => setLocale("en")}
        aria-pressed={locale === "en"}
        className={`${base} ${locale === "en" ? "bg-accent text-accent-foreground" : "text-primary-foreground/70 hover:text-primary-foreground"}`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale("es")}
        aria-pressed={locale === "es"}
        className={`${base} ${locale === "es" ? "bg-accent text-accent-foreground" : "text-primary-foreground/70 hover:text-primary-foreground"}`}
      >
        ES
      </button>
    </div>
  );
}
```

- [ ] **Step 3: WaitlistForm**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useLandingCopy, useLocale } from "@/components/landing/LanguageProvider";

/** Voice-teaser waitlist capture. Honeypot field name: "website". */
export function WaitlistForm() {
  const copy = useLandingCopy().voice;
  const { locale } = useLocale();
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "busy" | "done" | "error" | "invalid">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState("invalid");
      return;
    }
    setState("busy");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error();
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <p
        className="flex items-center gap-2 text-sm font-medium text-success"
        data-testid="waitlist-success"
        role="status"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {copy.waitlistSuccess}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-2" noValidate>
      <label htmlFor="waitlist-email" className="eyebrow block">
        {copy.waitlistLabel}
      </label>
      <div className="flex gap-2">
        <Input
          id="waitlist-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={copy.waitlistPlaceholder}
          className="bg-card"
          data-testid="waitlist-email"
          aria-invalid={state === "invalid"}
        />
        {/* Honeypot — visually hidden, tab-skipped; bots autofill it */}
        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="hidden"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
        <Button
          type="submit"
          disabled={state === "busy"}
          className="shrink-0 bg-accent text-accent-foreground hover:bg-accent/90"
          data-testid="waitlist-submit"
        >
          {state === "busy" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            copy.waitlistButton
          )}
        </Button>
      </div>
      {state === "invalid" && (
        <p className="text-xs text-destructive" role="alert">{copy.waitlistInvalid}</p>
      )}
      {state === "error" && (
        <p className="text-xs text-destructive" role="alert">{copy.waitlistError}</p>
      )}
    </form>
  );
}
```

- [ ] **Step 4: FaqItem** (native `<details>` — keyboard-accessible, no deps)

```tsx
"use client";

import { ChevronDown } from "lucide-react";

export function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{a}</p>
    </details>
  );
}
```

- [ ] **Step 5: Gate + commit**

```bash
npm run type-check && npm run lint
git add components/landing/LanguageProvider.tsx components/landing/LangToggle.tsx components/landing/WaitlistForm.tsx components/landing/FaqItem.tsx
git commit -m "feat(landing): locale provider, toggle, waitlist form, FAQ item"
```

---

### Task 4: Sections + page assembly

**Files:**
- Create: `components/landing/sections.tsx`, `components/landing/LandingPage.tsx`
- Rewrite: `app/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2-3 (exact names in their Produces blocks).
- Produces: `<LandingPage/>` (client component); `app/page.tsx` server component exporting `metadata` and rendering it.

**Design directives (binding):** keep ledger vocabulary (`eyebrow`, `stamp`, `figure`, navy header band, amber accent, `shadow-[6px_6px_0_...]` offset shadows). Sections alternate `bg-background` / `bg-card` with `border-t`. Preserve the existing hero headline JSX + sample-invoice mock from the current `app/page.tsx` (move into sections.tsx, driven by copy where text is user-visible). All animation gated by `motion-safe:` variants.

- [ ] **Step 1: sections.tsx** — one file, 8 exported sections. Complete code:

```tsx
"use client";

/**
 * Landing page sections. All copy from useLandingCopy() — no
 * hardcoded strings. Ledger design vocabulary throughout.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, BadgeDollarSign, BookOpen, FileText, History,
  Mic, Receipt, ShieldCheck, Stamp,
} from "lucide-react";
import { useLandingCopy } from "@/components/landing/LanguageProvider";
import { LangToggle } from "@/components/landing/LangToggle";
import { WaitlistForm } from "@/components/landing/WaitlistForm";
import { FaqItem } from "@/components/landing/FaqItem";

const SAMPLE_LINES = [
  { desc: "Panel upgrade (200A)", qty: "1 ea", amount: "2,500.00" },
  { desc: "Electrician labor", qty: "6 hr", amount: "600.00" },
  { desc: "Outlet installation", qty: "4 ea", amount: "600.00" },
];

export function LandingHeader() {
  const copy = useLandingCopy();
  return (
    <header className="sticky top-0 z-50 bg-primary/95 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2 text-primary-foreground">
          <FileText className="h-5 w-5 text-accent" aria-hidden="true" />
          <span className="font-display text-xl font-bold uppercase tracking-[0.08em]">
            Quota
          </span>
        </div>
        <div className="flex items-center gap-3">
          <LangToggle />
          <Button
            asChild
            variant="ghost"
            className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <Link href="/auth/login">{copy.header.signIn}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function Hero() {
  const copy = useLandingCopy();
  return (
    <section
      className="container mx-auto grid items-center gap-12 px-4 py-20 lg:grid-cols-2 lg:py-28"
      data-testid="landing-hero"
    >
      <div>
        <p className="eyebrow mb-4">{copy.hero.eyebrow}</p>
        <h1 className="mb-6 font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight sm:text-6xl">
          {copy.hero.line1}
          <br />
          {copy.hero.line2}
          <br />
          <span className="text-accent">{copy.hero.line3}</span>
        </h1>
        <p className="mb-6 max-w-md text-lg text-muted-foreground">{copy.hero.sub}</p>
        <p className="stamp stamp-paid mb-8">{copy.hero.feeBadge}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
            <Link href="/auth/login">
              {copy.hero.ctaPrimary}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href="#pricing">{copy.hero.ctaSecondary}</a>
          </Button>
        </div>
      </div>

      {/* Signature: the quote sheet itself (preserved from prior page) */}
      <div className="relative mx-auto w-full max-w-md">
        <div className="border bg-card p-6 shadow-[6px_6px_0_hsl(var(--primary)/0.12)]">
          <div className="mb-4 flex items-start justify-between border-b-2 border-primary pb-3">
            <div>
              <p className="eyebrow">Quote</p>
              <p className="figure text-sm font-semibold">Q-2026-014</p>
            </div>
            <div className="text-right">
              <p className="eyebrow">Client</p>
              <p className="text-sm font-medium">Hernandez Residence</p>
            </div>
          </div>
          <div>
            {SAMPLE_LINES.map((line) => (
              <div key={line.desc} className="ledger-row flex items-baseline justify-between gap-4 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{line.desc}</span>
                <span className="text-xs text-muted-foreground">{line.qty}</span>
                <span className="figure">${line.amount}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t-2 border-primary pt-3">
            <span className="font-display text-sm font-bold uppercase tracking-[0.14em]">Total</span>
            <span className="figure text-lg font-semibold">$3,700.00</span>
          </div>
        </div>
        <span className="stamp stamp-paid stamp-large absolute -right-3 -top-4 bg-card/80">Paid</span>
      </div>
    </section>
  );
}

export function VoiceTeaser() {
  const copy = useLandingCopy();
  return (
    <section className="border-t bg-card" data-testid="landing-voice">
      <div className="container mx-auto grid items-center gap-12 px-4 py-20 lg:grid-cols-2">
        <div>
          <p className="stamp stamp-unpaid mb-4">{copy.voice.eyebrow}</p>
          <h2 className="mb-4 font-display text-4xl font-bold uppercase tracking-tight">
            {copy.voice.title}
          </h2>
          <p className="mb-8 max-w-md text-muted-foreground">{copy.voice.sub}</p>
          <WaitlistForm />
        </div>

        {/* Mock: spoken words become line items */}
        <div className="relative mx-auto w-full max-w-md">
          <div className="border bg-background p-6 shadow-[6px_6px_0_hsl(var(--accent)/0.25)]">
            <div className="mb-4 flex items-center gap-2 border-b pb-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15">
                <Mic className="h-4 w-4 text-accent motion-safe:animate-pulse" aria-hidden="true" />
              </span>
              <p className="text-sm italic text-muted-foreground">{copy.voice.transcript}</p>
            </div>
            <div>
              {[
                { d: "Copper repipe", q: "140 lf", a: "2,590.00" },
                { d: "Water heater 50 gal", q: "1 ea", a: "1,850.00" },
                { d: "Toilet install", q: "2 ea", a: "750.00" },
              ].map((line, i) => (
                <div
                  key={line.d}
                  className="ledger-row flex items-baseline justify-between gap-4 py-2 text-sm opacity-0 motion-safe:animate-[fade-in-up_0.5s_ease-out_forwards] motion-reduce:opacity-100"
                  style={{ animationDelay: `${0.4 + i * 0.35}s` }}
                >
                  <span className="min-w-0 flex-1 truncate">{line.d}</span>
                  <span className="text-xs text-muted-foreground">{line.q}</span>
                  <span className="figure">${line.a}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const FEATURE_ICONS = [BookOpen, Stamp, BadgeDollarSign, FileText, Receipt, History];

export function Features() {
  const copy = useLandingCopy();
  return (
    <section className="border-t" data-testid="landing-features">
      <div className="container mx-auto px-4 py-20">
        <p className="eyebrow mb-2 text-center">{copy.features.eyebrow}</p>
        <h2 className="mx-auto mb-12 max-w-2xl text-center font-display text-4xl font-bold uppercase tracking-tight">
          {copy.features.title}
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {copy.features.items.map((item, i) => {
            const Icon = FEATURE_ICONS[i] ?? FileText;
            return (
              <div
                key={item.title}
                className="border bg-card p-6 transition-transform hover:-translate-y-1 hover:shadow-[6px_6px_0_hsl(var(--primary)/0.12)]"
              >
                <span className="mb-4 flex h-10 w-10 items-center justify-center bg-accent/15">
                  <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                </span>
                <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-wide">
                  {item.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Pricing() {
  const copy = useLandingCopy();
  return (
    <section id="pricing" className="border-t bg-card" data-testid="landing-pricing">
      <div className="container mx-auto px-4 py-20">
        <p className="eyebrow mb-2 text-center">{copy.pricing.eyebrow}</p>
        <h2 className="mx-auto mb-3 max-w-2xl text-center font-display text-4xl font-bold uppercase tracking-tight">
          {copy.pricing.title}
        </h2>
        <p className="mb-12 text-center text-muted-foreground">{copy.pricing.sub}</p>
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
          {copy.pricing.tiers.map((tier, i) => {
            const popular = i === 1; // Pro
            return (
              <div
                key={tier.name}
                className={`relative border bg-background p-8 ${popular ? "border-2 border-accent shadow-[6px_6px_0_hsl(var(--accent)/0.25)]" : ""}`}
              >
                {popular && (
                  <span className="stamp stamp-paid absolute -top-3 left-6 bg-background">
                    {copy.pricing.popular}
                  </span>
                )}
                <h3 className="font-display text-lg font-bold uppercase tracking-wide">{tier.name}</h3>
                <p className="mt-2">
                  <span className="figure text-4xl font-bold">{tier.price}</span>
                  {tier.price !== "$0" && (
                    <span className="text-sm text-muted-foreground">{copy.pricing.perMonth}</span>
                  )}
                </p>
                <p className="mb-6 mt-1 text-sm text-muted-foreground">{tier.blurb}</p>
                <ul className="mb-8 space-y-2">
                  {tier.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                      {b}
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  className={`w-full ${popular ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}`}
                  variant={popular ? "default" : "outline"}
                >
                  <Link href="/auth/login">{copy.pricing.cta}</Link>
                </Button>
              </div>
            );
          })}
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">{copy.pricing.footnote}</p>
      </div>
    </section>
  );
}

export function SocialProof() {
  const copy = useLandingCopy();
  return (
    <section className="border-t" data-testid="landing-proof">
      <div className="container mx-auto px-4 py-20">
        <p className="eyebrow mb-2 text-center">{copy.proof.eyebrow}</p>
        <h2 className="mx-auto mb-12 max-w-2xl text-center font-display text-4xl font-bold uppercase tracking-tight">
          {copy.proof.title}
        </h2>
        <div className="mb-10 grid gap-6 lg:grid-cols-3">
          {copy.proof.quotes.map((q) => (
            <figure key={q.name} className="border bg-card p-6">
              <blockquote className="mb-4 text-sm leading-relaxed">“{q.text}”</blockquote>
              <figcaption className="flex items-center justify-between">
                <span className="text-sm font-medium">{q.name}</span>
                <span className="eyebrow">{q.trade}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {copy.proof.trades.map((t) => (
            <span key={t} className="stamp border-muted-foreground/40 text-muted-foreground">{t}</span>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground/70">{copy.proof.disclaimer}</p>
      </div>
    </section>
  );
}

export function Faq() {
  const copy = useLandingCopy();
  return (
    <section className="border-t bg-card" data-testid="landing-faq">
      <div className="container mx-auto max-w-3xl px-4 py-20">
        <p className="eyebrow mb-2 text-center">{copy.faq.eyebrow}</p>
        <h2 className="mb-10 text-center font-display text-4xl font-bold uppercase tracking-tight">
          {copy.faq.title}
        </h2>
        <div>
          {copy.faq.items.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  const copy = useLandingCopy();
  return (
    <footer className="border-t bg-primary text-primary-foreground" data-testid="landing-footer">
      <div className="container mx-auto px-4 py-16 text-center">
        <h2 className="mx-auto mb-6 max-w-xl font-display text-3xl font-bold uppercase tracking-tight">
          {copy.footer.cta}
        </h2>
        <Button asChild size="lg" className="mb-12 bg-accent text-accent-foreground hover:bg-accent/90">
          <Link href="/auth/login">{copy.footer.ctaButton}</Link>
        </Button>
        <div className="flex items-center justify-between border-t border-primary-foreground/20 pt-6 text-sm text-primary-foreground/70">
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-accent" aria-hidden="true" />
            Quota
          </span>
          <Link href="/auth/login" className="hover:text-primary-foreground">
            {copy.footer.signIn}
          </Link>
          <span>© {new Date().getFullYear()} Quota. {copy.footer.rights}</span>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: add the fade-in keyframes** to `tailwind.config.ts` `theme.extend.keyframes`/`animation` (or globals if the config already defines keyframes elsewhere — match existing convention):

```ts
keyframes: {
  "fade-in-up": {
    from: { opacity: "0", transform: "translateY(8px)" },
    to: { opacity: "1", transform: "translateY(0)" },
  },
},
```

(The `animate-[fade-in-up_...]` arbitrary value in sections.tsx references this keyframe name.)

- [ ] **Step 3: LandingPage.tsx**

```tsx
"use client";

import { LanguageProvider } from "@/components/landing/LanguageProvider";
import {
  Faq, Features, Hero, LandingFooter, LandingHeader,
  Pricing, SocialProof, VoiceTeaser,
} from "@/components/landing/sections";

export function LandingPage() {
  return (
    <LanguageProvider>
      <main className="min-h-screen bg-background">
        <LandingHeader />
        <Hero />
        <VoiceTeaser />
        <Features />
        <Pricing />
        <SocialProof />
        <Faq />
        <LandingFooter />
      </main>
    </LanguageProvider>
  );
}
```

- [ ] **Step 4: rewrite app/page.tsx**

```tsx
import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Quota — Quoting & invoicing for contractors",
  description:
    "Keep your own price book, quote in minutes, email invoices with PDFs, and track payments without giving up a cut. No card fees, ever.",
  openGraph: {
    title: "Quota — Quoting & invoicing for contractors",
    description:
      "Price the job. Send the bill. Get paid. No card fees, ever.",
    type: "website",
  },
};

export default function Home() {
  return <LandingPage />;
}
```

- [ ] **Step 5: manual render check**

Dev server: open http://localhost:3000 — all 8 sections render, toggle swaps copy, no console errors. (Controller does the full visual review in Task 5.)

- [ ] **Step 6: Gate + commit**

```bash
npm run type-check && npm run lint
git add components/landing/sections.tsx components/landing/LandingPage.tsx app/page.tsx tailwind.config.ts
git commit -m "feat(landing): bilingual marketing page — hero, voice teaser, pricing, FAQ"
```

---

### Task 5: e2e + full gate + visual review

**Files:**
- Create: `e2e/landing.spec.ts`

**Interfaces:**
- Consumes: testids from Tasks 3-4; `POST /api/waitlist` (Task 1); EN/ES hero copy from Task 2.

- [ ] **Step 1: write the spec**

```ts
import { test, expect } from "@playwright/test";

// Landing page is public — no storageState needed, but the saved auth
// state doesn't hurt; use a fresh context to prove public access.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("landing page", () => {
  test("renders all sections", async ({ page }) => {
    await page.goto("/");
    for (const id of [
      "landing-hero", "landing-voice", "landing-features",
      "landing-pricing", "landing-proof", "landing-faq", "landing-footer",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test("language toggle swaps hero copy", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Price the job.");
    await page.getByTestId("lang-toggle").getByRole("button", { name: "ES" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cotiza el trabajo.");
    // persists across reload
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cotiza el trabajo.");
  });

  test("?lang=es forces Spanish", async ({ page }) => {
    await page.goto("/?lang=es");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cotiza el trabajo.");
  });

  test("waitlist happy path", async ({ page }) => {
    await page.goto("/");
    const email = `wl-e2e-${Date.now()}@example.com`;
    await page.getByTestId("waitlist-email").fill(email);
    await page.getByTestId("waitlist-submit").click();
    await expect(page.getByTestId("waitlist-success")).toBeVisible();
  });

  test("waitlist rejects invalid email client-side", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("waitlist-email").fill("not-an-email");
    await page.getByTestId("waitlist-submit").click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("waitlist-success")).toHaveCount(0);
  });

  test("pricing anchor navigates", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /see pricing/i }).click();
    await expect(page).toHaveURL(/#pricing/);
    await expect(page.getByTestId("landing-pricing")).toBeInViewport();
  });
});
```

- [ ] **Step 2: run it** (kill any :3000 dev server first — Playwright starts its own; `lsof -ti:3000 | xargs kill`)

Run: `npx playwright test e2e/landing.spec.ts`
Expected: 6 passed. Clean up e2e waitlist rows:
`psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "DELETE FROM waitlist_signups WHERE email LIKE 'wl-e2e-%';"`

- [ ] **Step 3: full gate**

```bash
npm run type-check && npm run lint && npm run test:unit && npx playwright test e2e/landing.spec.ts e2e/smoke.spec.ts
```
Expected: all green.

- [ ] **Step 4: visual review (controller)**

Controller restarts dev server, screenshots `/` at 1440px and 390px widths, EN and ES, reviews against the spec's visual directives, iterates on polish directly if needed.

- [ ] **Step 5: Commit**

```bash
git add e2e/landing.spec.ts
git commit -m "test(landing): e2e coverage for sections, locale toggle, waitlist"
```

---

## Self-Review Notes

- **Spec coverage:** 8 sections (T4), EN/ES dictionary + toggle + persistence (T2/T3, e2e in T5), waitlist table/API/honeypot/idempotency (T1) + form (T3), pricing tiers verbatim (T2), reduced-motion (`motion-safe:`/`motion-reduce:` in T4), SEO metadata (T4), testids (T3/T4), placeholder-testimonial disclaimer (T2/T4). Doc-lang stays "en" per spec.
- **Type consistency:** `Locale`/`LandingCopy`/`LANDING_COPY` (T2) ↔ `useLandingCopy()`/`useLocale()` (T3) ↔ section usage (T4); testids in T3/T4 match T5 assertions; honeypot field `website` consistent T1↔T3.
- **Soft spots flagged inline:** `parseJsonBody` contract (T1 Step 4 note), keyframes location convention (T4 Step 2), fresh-context e2e for public access (T5).
- **Parallel-safety:** T1 and T2 share zero files; T3+ sequential.
