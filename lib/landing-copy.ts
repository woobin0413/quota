/**
 * Landing Copy — EN/ES
 *
 * Every string on the marketing landing page lives here so both
 * locales stay key-identical by type. "presupuesto" = quote,
 * "factura" = invoice, per trades usage.
 */

import type { Tier } from "@/lib/subscription";

export type Locale = "en" | "es";

export interface LandingCopy {
  header: { signIn: string; signUp: string; dashboard: string };
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
    comingSoon: string; // CTA label for a not-yet-purchasable tier (Ultimate)
    // `id` ties each card to the tier policy in lib/subscription — the
    // "coming soon" state is read from UNAVAILABLE_TIERS, never from position.
    tiers: { id: Tier; name: string; price: string; blurb: string; bullets: string[] }[]; // exactly 3: Free, Pro, Ultimate
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
    header: { signIn: "Sign in", signUp: "Sign up", dashboard: "Dashboard" },
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
      sub: "On your phone, say it like you'd say it to your apprentice — Quota drafts the quote from your own price book. Built for the truck, not the desk: voice works on phones and tablets. Join the waitlist and be first in line.",
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
      comingSoon: "Coming soon",
      tiers: [
        { id: "free", name: "Free", price: "$0", blurb: "For trying it on a real job", bullets: ["3 quotes / mo", "PDF export", "Milestone schedules", "“Made with Quota” footer"] },
        { id: "pro", name: "Pro", price: "$15", blurb: "For the working contractor", bullets: ["15 quotes / mo", "Email invoicing", "Payment receipts", "Your logo on PDFs"] },
        { id: "ultimate", name: "Ultimate", price: "$29", blurb: "Everything, plus what's next", bullets: ["Unlimited quotes", "Everything in Pro", "Voice-to-invoice on your phone — coming soon"] },
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
        { q: "Is there a Spanish version?", a: "This page speaks Spanish today (top-right toggle). A full Spanish app experience is on our roadmap." },
        { q: "Who owns my data?", a: "You do. Your catalog, clients, and quotes are yours — export them anytime, and if you leave, they leave with you." },
        { q: "Can I cancel anytime?", a: "Yes. Monthly plans, no contracts. Downgrade to Free and keep your data." },
        { q: "When does voice-to-invoice launch?", a: "It's in active development. Waitlist members get it first, at no extra charge on Ultimate. It runs on phones and tablets — the job site, not the office — so on a computer you'll build quotes the usual way." },
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
    header: { signIn: "Iniciar sesión", signUp: "Regístrate", dashboard: "Panel" },
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
      sub: "Desde tu teléfono, dilo como se lo dirías a tu ayudante — Quota arma el presupuesto con tus propios precios. Hecho para la camioneta, no para el escritorio: la voz funciona en teléfonos y tabletas. Únete a la lista de espera y sé de los primeros.",
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
      comingSoon: "Próximamente",
      tiers: [
        { id: "free", name: "Free", price: "$0", blurb: "Para probarlo en un trabajo real", bullets: ["3 presupuestos / mes", "Exportar PDF", "Calendario de pagos", "Pie “Hecho con Quota”"] },
        { id: "pro", name: "Pro", price: "$15", blurb: "Para el contratista en activo", bullets: ["15 presupuestos / mes", "Facturas por correo", "Recibos de pago", "Tu logo en los PDF"] },
        { id: "ultimate", name: "Ultimate", price: "$29", blurb: "Todo, más lo que viene", bullets: ["Presupuestos ilimitados", "Todo lo de Pro", "Voz a factura desde tu teléfono — próximamente"] },
      ],
    },
    proof: {
      eyebrow: "Los oficios",
      title: "Para cada camioneta, cada oficio",
      disclaimer: "Ejemplos ilustrativos durante el acceso anticipado.",
      quotes: [
        { text: "Coticé una retubería desde la entrada antes de que la competencia llegara a su laptop.", name: "M. Torres", trade: "Plomería" },
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
        { q: "¿Hay versión en español?", a: "Esta página habla español hoy (botón arriba a la derecha). Una experiencia completa de la app en español está en nuestro plan de trabajo." },
        { q: "¿De quién son mis datos?", a: "Tuyos. Tu catálogo, tus clientes y tus presupuestos te pertenecen — expórtalos cuando quieras, y si te vas, se van contigo." },
        { q: "¿Puedo cancelar cuando quiera?", a: "Sí. Planes mensuales, sin contratos. Baja al plan Free y conserva tus datos." },
        { q: "¿Cuándo llega voz a factura?", a: "Está en pleno desarrollo. Los de la lista de espera lo reciben primero, sin costo extra en Ultimate. Funciona en teléfonos y tabletas — la obra, no la oficina — así que en la computadora harás los presupuestos como siempre." },
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
