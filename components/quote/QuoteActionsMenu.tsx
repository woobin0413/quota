"use client";

/**
 * Quote Actions Menu
 *
 * Single dropdown housing the quote's secondary actions. Payment status
 * is derived from recorded payments (see PaymentScheduleCard /
 * PaymentHistoryCard on the quote page) — this menu just keeps Download
 * PDF off the primary header button (Send to client).
 *
 * This is the **only** Download PDF entry point. SendQuoteButton used to
 * render a second one beside it for free users, whose email is gated; that
 * duplicated this item for free accounts and showed nothing extra for paid
 * ones. Free users reach the PDF here like everyone else, which is why the
 * upgrade dialog's copy points at this menu by name.
 */

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown, Download } from "lucide-react";

interface QuoteActionsMenuProps {
  quoteId: string;
}

export function QuoteActionsMenu({ quoteId }: QuoteActionsMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" data-testid="quote-actions-trigger">
          Actions
          <ChevronDown className="ml-2 h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild data-testid="download-pdf">
          <a href={`/api/quotes/${quoteId}/pdf`} download className="cursor-pointer">
            <Download className="h-4 w-4" aria-hidden="true" />
            Download PDF
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
