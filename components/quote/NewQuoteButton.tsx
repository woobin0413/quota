"use client";

/**
 * Primary "New Quote" action that disables itself when the current plan has no
 * quotes left this month (mirrors the server 403 QUOTE_LIMIT guard on
 * /api/quotes). Free/Pro at their monthly cap get a disabled button hinting at
 * an upgrade — or, when no higher plan is purchasable, at the monthly reset;
 * unlimited (or still-loading) plans link through as normal.
 */

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/components/subscription/use-subscription";
import { noQuotesLeftTitle } from "@/lib/subscription";

interface NewQuoteButtonProps {
  size?: "default" | "sm";
  className?: string;
}

export function NewQuoteButton({ size = "default", className }: NewQuoteButtonProps) {
  const { sub } = useSubscription();

  const label = (
    <>
      <Plus className="mr-2 h-4 w-4" />
      New Quote
    </>
  );

  if (sub != null && sub.quotesRemaining === 0) {
    return (
      <Button
        size={size}
        disabled
        title={noQuotesLeftTitle(sub.tier)}
        data-testid="new-quote-button"
        className={className}
      >
        {label}
      </Button>
    );
  }

  return (
    <Button asChild size={size} className={className} data-testid="new-quote-button">
      <Link href="/new-quote">{label}</Link>
    </Button>
  );
}
