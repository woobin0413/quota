"use client";

/**
 * First-run business profile capture.
 *
 * Auth0 signup collects an email and a password and nothing else — database
 * connections don't issue `given_name`/`family_name`, so a new contractor
 * reaches the dashboard with `first_name`, `last_name` and `company_name` all
 * NULL. That matters because the quote PDF falls back
 * `company_name || fullName || email` (see lib/quote-pdf.ts), so a contractor
 * who never opens Settings sends their first invoice with a raw email address
 * where the business name belongs.
 *
 * This asks once, on the dashboard, when the business name is missing. It is
 * deliberately not part of the signup screen: Universal Login is hosted by
 * Auth0 and adding fields there costs a partial + a pre-user-registration
 * Action, while buying nothing — the data isn't needed until the first quote.
 *
 * An inline panel rather than a dialog, matching CatalogOnboarding. A modal
 * marks the rest of the page aria-hidden, which both traps a contractor on
 * arrival and hides the dashboard from every e2e spec that lands here while the
 * profile is still blank. Skippable for the same reason — a first-run wall is
 * worse than a fallback. The dismissal is remembered locally, and the panel
 * stops appearing for good once the business name is actually set.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Receipt } from "lucide-react";
import {
  PROFILE_ONBOARDING_DISMISSED as DISMISS_KEY,
  PROFILE_UPDATED_EVENT,
} from "@/lib/onboarding-keys";

interface ProfileOnboardingProps {
  /** Called once the profile is saved, so the header can pick up the name. */
  onSaved?: (companyName: string) => void;
}

export function ProfileOnboarding({ onSaved }: ProfileOnboardingProps) {
  const [show, setShow] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY)) {
      return; // previously skipped
    }
    // The guard is load-bearing, not hygiene. StrictMode double-invokes this in
    // dev (mount → cleanup → remount), so two requests are in flight. Without
    // it the first response can land after the panel is already showing and
    // overwrite whatever the contractor has typed with the empty values it
    // fetched — they then save a name that silently reverts to NULL.
    let cancelled = false;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success && !data.profile?.companyName) {
          // Prefill anything a social login did give us.
          setFirstName(data.profile?.firstName ?? "");
          setLastName(data.profile?.lastName ?? "");
          setShow(true);
        }
      })
      .catch(() => {
        // non-critical — if this fails, just don't prompt
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    if (typeof window !== "undefined") localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const business = companyName.trim();
    if (!business) {
      setError("Add the name you want clients to see on your invoices.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          companyName: business,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message ?? "Could not save. Try again.");
        return;
      }
      if (typeof window !== "undefined") {
        localStorage.setItem(DISMISS_KEY, "1");
        // The header fetched the profile on mount; tell it the name changed.
        window.dispatchEvent(
          new CustomEvent(PROFILE_UPDATED_EVENT, { detail: business })
        );
      }
      onSaved?.(business);
      setShow(false);
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!show) return null;

  return (
    <div
      className="mb-8 border-2 border-accent bg-accent/5 p-5 sm:p-6"
      data-testid="profile-onboarding"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded bg-accent/15 p-2 text-accent" aria-hidden="true">
          <Receipt className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="font-display text-lg font-bold uppercase tracking-wide">
              Who&apos;s sending the invoice?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your business name prints at the top of every quote and invoice your
              clients receive. Without it they&apos;ll see your email address
              instead. You can change it later in Settings.
            </p>
          </div>

          <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="onboarding-company">
                  Business name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="onboarding-company"
                  name="companyName"
                  value={companyName}
                  onChange={(e) => {
                    setCompanyName(e.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. Rivera Plumbing"
                  maxLength={255}
                  required
                  aria-describedby={error ? "onboarding-error" : undefined}
                  data-testid="onboarding-company-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="onboarding-first">First name</Label>
                <Input
                  id="onboarding-first"
                  name="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  maxLength={100}
                  autoComplete="given-name"
                  data-testid="onboarding-first-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="onboarding-last">Last name</Label>
                <Input
                  id="onboarding-last"
                  name="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  maxLength={100}
                  autoComplete="family-name"
                  data-testid="onboarding-last-name"
                />
              </div>
            </div>

            {error && (
              <p
                id="onboarding-error"
                role="alert"
                className="text-sm text-destructive"
                data-testid="onboarding-error"
              >
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={saving}
                data-testid="onboarding-profile-save"
              >
                {saving && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {saving ? "Saving…" : "Save and continue"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={dismiss}
                disabled={saving}
                data-testid="onboarding-profile-skip"
              >
                Skip for now
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
