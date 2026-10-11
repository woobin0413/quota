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
