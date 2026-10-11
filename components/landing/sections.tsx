"use client";

/**
 * Landing page sections. All copy from useLandingCopy() — no
 * hardcoded strings. Ledger design vocabulary throughout.
 */

import Link from "next/link";
import { useUser } from "@auth0/nextjs-auth0";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, BadgeDollarSign, BookOpen, FileText, History,
  Mic, Receipt, ShieldCheck, Stamp,
} from "lucide-react";
import { useLandingCopy } from "@/components/landing/LanguageProvider";
import { LangToggle } from "@/components/landing/LangToggle";
import { WaitlistForm } from "@/components/landing/WaitlistForm";
import { FaqItem } from "@/components/landing/FaqItem";
import { Reveal, useInView } from "@/components/landing/Reveal";
import { LEGAL_LINKS } from "@/lib/site";
import { isTierAvailable } from "@/lib/subscription";
import { SIGN_IN_URL, SIGN_UP_URL } from "@/lib/auth-urls";

const SAMPLE_LINES = [
  { desc: "Panel upgrade (200A)", qty: "1 ea", amount: "2,500.00" },
  { desc: "Electrician labor", qty: "6 hr", amount: "600.00" },
  { desc: "Outlet installation", qty: "4 ea", amount: "600.00" },
];

export function LandingHeader() {
  const copy = useLandingCopy();
  const { user } = useUser();
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
          {user ? (
            <Button
              asChild
              variant="ghost"
              className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/dashboard" data-testid="nav-dashboard">
                {copy.header.dashboard}
              </Link>
            </Button>
          ) : (
            <>
              <Button
                asChild
                variant="ghost"
                className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                {/* Plain anchors: /auth/* is served by the Auth0 middleware,
                    not a Next route, so a client-side transition would 404. */}
                <a href={SIGN_IN_URL} data-testid="nav-signin">
                  {copy.header.signIn}
                </a>
              </Button>
              <Button
                asChild
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <a href={SIGN_UP_URL} data-testid="nav-signup">
                  {copy.header.signUp}
                </a>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function Hero() {
  const copy = useLandingCopy();
  return (
    <section
      className="ledger-paper container mx-auto grid items-center gap-12 px-4 py-20 lg:grid-cols-2 lg:py-28"
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
            <a href={SIGN_UP_URL} data-testid="hero-signup">
              {copy.hero.ctaPrimary}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href="#pricing">{copy.hero.ctaSecondary}</a>
          </Button>
        </div>
      </div>

      {/* Signature: the quote sheet itself (preserved from prior page) */}
      <div className="relative mx-auto w-full max-w-md">
        <div className="hero-card-dip border bg-card p-6 shadow-[6px_6px_0_hsl(var(--primary)/0.12)]">
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
            {SAMPLE_LINES.map((line, i) => (
              <div
                key={line.desc}
                className="hero-ink ledger-row flex items-baseline justify-between gap-4 py-2 text-sm"
                style={{ animationDelay: `${0.2 + i * 0.12}s` }}
              >
                <span className="min-w-0 flex-1 truncate">{line.desc}</span>
                <span className="text-xs text-muted-foreground">{line.qty}</span>
                <span className="figure">${line.amount}</span>
              </div>
            ))}
          </div>
          <div
            className="hero-ink mt-4 flex items-center justify-between border-t-2 border-primary pt-3"
            style={{ animationDelay: `${0.2 + SAMPLE_LINES.length * 0.12}s` }}
          >
            <span className="font-display text-sm font-bold uppercase tracking-[0.14em]">Total</span>
            <span className="figure text-lg font-semibold">$3,700.00</span>
          </div>
        </div>
        <span className="hero-stamp-slam stamp stamp-paid stamp-large absolute -right-3 -top-4 bg-card/80">Paid</span>
      </div>
    </section>
  );
}

export function VoiceTeaser() {
  const copy = useLandingCopy();
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  return (
    <section className="ledger-paper border-t bg-card" data-testid="landing-voice">
      <div className="container mx-auto grid items-center gap-12 px-4 py-20 lg:grid-cols-2">
        <div>
          <p className="stamp stamp-unpaid mb-4">{copy.voice.eyebrow}</p>
          <h2 className="mb-4 font-display text-4xl font-bold uppercase tracking-tight text-balance">
            {copy.voice.title}
          </h2>
          <p className="mb-8 max-w-md text-muted-foreground">{copy.voice.sub}</p>
          <WaitlistForm />
        </div>

        {/* Mock: spoken words become line items */}
        <div ref={ref} className="relative mx-auto w-full max-w-md">
          <div className="border bg-background p-6 shadow-[6px_6px_0_hsl(var(--accent)/0.25)]">
            <div className="mb-4 flex items-center gap-2 border-b pb-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15">
                <Mic className="h-4 w-4 text-accent motion-safe:animate-pulse" aria-hidden="true" />
              </span>
              <p
                className={`text-sm italic text-muted-foreground ${
                  inView
                    ? "opacity-0 motion-safe:animate-[fade-in-up_0.5s_ease-out_forwards] motion-reduce:opacity-100"
                    : "opacity-0 motion-reduce:opacity-100"
                }`}
                style={{ animationDelay: "0.1s" }}
              >
                {copy.voice.transcript}
              </p>
            </div>
            <div>
              {[
                { d: "Copper repipe", q: "140 lf", a: "2,590.00" },
                { d: "Water heater 50 gal", q: "1 ea", a: "1,850.00" },
                { d: "Toilet install", q: "2 ea", a: "750.00" },
              ].map((line, i) => (
                <div
                  key={line.d}
                  className={`ledger-row flex items-baseline justify-between gap-4 py-2 text-sm ${
                    inView
                      ? "opacity-0 motion-safe:animate-[fade-in-up_0.5s_ease-out_forwards] motion-reduce:opacity-100"
                      : "opacity-0 motion-reduce:opacity-100"
                  }`}
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
        <Reveal>
          <p className="eyebrow mb-2 text-center">{copy.features.eyebrow}</p>
          <h2 className="mx-auto mb-12 max-w-2xl text-center font-display text-4xl font-bold uppercase tracking-tight text-balance">
            {copy.features.title}
          </h2>
        </Reveal>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {copy.features.items.map((item, i) => {
            const Icon = FEATURE_ICONS[i] ?? FileText;
            return (
              <Reveal key={item.title} delay={i * 60}>
                <div className="border bg-card p-6 transition-transform hover:-translate-y-1 hover:shadow-[6px_6px_0_hsl(var(--primary)/0.12)]">
                  <span className="mb-4 flex h-10 w-10 items-center justify-center bg-accent/15">
                    <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                  </span>
                  <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-wide">
                    {item.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              </Reveal>
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
        <Reveal>
          <p className="eyebrow mb-2 text-center">{copy.pricing.eyebrow}</p>
          <h2 className="mx-auto mb-3 max-w-2xl text-center font-display text-4xl font-bold uppercase tracking-tight text-balance">
            {copy.pricing.title}
          </h2>
          <p className="mb-12 text-center text-muted-foreground">{copy.pricing.sub}</p>
        </Reveal>
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
          {copy.pricing.tiers.map((tier, i) => {
            const popular = tier.id === "pro";
            // Read from the tier policy, not the card's position: removing a
            // tier from UNAVAILABLE_TIERS must open this CTA too.
            const comingSoon = !isTierAvailable(tier.id);
            return (
              <Reveal key={tier.name} delay={i * 90} className="h-full">
                <div
                  className={`relative h-full border bg-background p-8 ${popular ? "border-2 border-accent shadow-[6px_6px_0_hsl(var(--accent)/0.25)]" : ""}`}
                >
                {popular && (
                  <span className="stamp stamp-paid absolute -top-3 left-6 bg-background">
                    {copy.pricing.popular}
                  </span>
                )}
                {comingSoon && (
                  <span className="stamp absolute -top-3 left-6 bg-background text-muted-foreground">
                    {copy.pricing.comingSoon}
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
                  {comingSoon ? (
                    <Button
                      className="w-full"
                      variant="outline"
                      disabled
                      data-testid={`pricing-cta-${tier.id}`}
                    >
                      {copy.pricing.comingSoon}
                    </Button>
                  ) : (
                    <Button
                      asChild
                      className={`w-full ${popular ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}`}
                      variant={popular ? "default" : "outline"}
                    >
                      <a href={SIGN_UP_URL} data-testid={`pricing-cta-${tier.id}`}>
                        {copy.pricing.cta}
                      </a>
                    </Button>
                  )}
                </div>
              </Reveal>
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
        <Reveal>
          <p className="eyebrow mb-2 text-center">{copy.proof.eyebrow}</p>
          <h2 className="mx-auto mb-12 max-w-2xl text-center font-display text-4xl font-bold uppercase tracking-tight text-balance">
            {copy.proof.title}
          </h2>
        </Reveal>
        <div className="mb-10 grid gap-6 lg:grid-cols-3">
          {copy.proof.quotes.map((q, i) => (
            <Reveal key={q.name} delay={i * 80} className="h-full">
              <figure className="h-full border bg-card p-6">
                <blockquote className="mb-4 text-sm leading-relaxed">“{q.text}”</blockquote>
                <figcaption className="flex items-center justify-between">
                  <span className="text-sm font-medium">{q.name}</span>
                  <span className="eyebrow">{q.trade}</span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
        <Reveal delay={250}>
          <div className="flex flex-wrap justify-center gap-2">
            {copy.proof.trades.map((t) => (
              <span key={t} className="stamp border-muted-foreground/40 text-muted-foreground">{t}</span>
            ))}
          </div>
        </Reveal>
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
        <Reveal>
          <p className="eyebrow mb-2 text-center">{copy.faq.eyebrow}</p>
          <h2 className="mb-10 text-center font-display text-4xl font-bold uppercase tracking-tight text-balance">
            {copy.faq.title}
          </h2>
        </Reveal>
        <Reveal>
          <div>
            {copy.faq.items.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function LandingFooter() {
  const copy = useLandingCopy();
  return (
    <footer className="border-t bg-primary text-primary-foreground" data-testid="landing-footer">
      <div className="container mx-auto px-4 py-16 text-center">
        <Reveal>
          <h2 className="mx-auto mb-6 max-w-xl font-display text-3xl font-bold uppercase tracking-tight text-balance">
            {copy.footer.cta}
          </h2>
          <Button asChild size="lg" className="mb-12 bg-accent text-accent-foreground hover:bg-accent/90">
            <a href={SIGN_UP_URL} data-testid="footer-signup">
              {copy.footer.ctaButton}
            </a>
          </Button>
        </Reveal>
        <div className="flex flex-col items-center gap-8 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
          <div>
            <span className="flex items-center justify-center gap-2 font-display text-sm font-bold uppercase tracking-wide sm:justify-start">
              <FileText className="h-4 w-4 text-accent" aria-hidden="true" />
              Quota
            </span>
            <p className="mt-2 text-sm text-primary-foreground/70">{copy.hero.eyebrow}</p>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/70 underline-offset-4 transition-colors hover:text-primary-foreground hover:underline hover:decoration-accent"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-10 border-t border-primary-foreground/20 pt-6">
          <p className="text-center text-xs text-primary-foreground/60 sm:text-left">
            © {new Date().getFullYear()} Quota. {copy.footer.rights}
          </p>
        </div>
      </div>
    </footer>
  );
}
