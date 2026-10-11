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
          name="email"
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
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
