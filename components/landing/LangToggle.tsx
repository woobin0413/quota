"use client";

import { useLocale } from "@/components/landing/LanguageProvider";

/** EN/ES segmented switch; persists via LanguageProvider. */
export function LangToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const base =
    "px-2.5 py-1 font-display text-xs font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset";
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
