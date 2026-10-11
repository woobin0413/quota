"use client";

/**
 * One-time success banner after Stripe Checkout returns to
 * /dashboard?upgraded=1. Copy reads the LIVE tier from the API (the
 * webhook may lag the redirect by seconds), then strips the param.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { useSubscription } from "./use-subscription";

export function UpgradedBanner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const upgraded = searchParams.get("upgraded") === "1";
  const [show, setShow] = useState(false);
  const { sub } = useSubscription();

  useEffect(() => {
    if (upgraded) {
      setShow(true);
      // Strip the param so refresh/back doesn't re-trigger the banner.
      router.replace("/dashboard", { scroll: false });
    }
  }, [upgraded, router]);

  if (!show || !sub) return null;

  const line =
    sub.quoteLimit === null
      ? `You're on ${sub.tierLabel} — unlimited quotes.`
      : `You're on ${sub.tierLabel} — ${sub.quoteLimit} quotes.`;

  return (
    <div
      role="status"
      data-testid="upgraded-banner"
      className="mb-6 flex items-center gap-2 border border-accent bg-accent/10 px-4 py-3 text-sm"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span>{line}</span>
    </div>
  );
}
