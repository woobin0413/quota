"use client";

/**
 * Clients Tab
 *
 * Lists all clients with their quotes. Each quote shows its derived
 * paid/partial/unpaid status (from recorded payments) and a link to
 * its payment history.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChevronDown, ChevronRight, History, Mail, Phone } from "lucide-react";
import { PaymentHistoryDialog } from "./PaymentHistoryDialog";
import { formatCurrency } from "@/lib/quote-calculations";
import type { Contact, Quote } from "@/types/database";

interface ClientWithQuotes extends Contact {
  quotes: Quote[];
}

export function ClientsTab() {
  const [clients, setClients] = useState<ClientWithQuotes[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyQuoteId, setHistoryQuoteId] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/clients");
      const data = await response.json();
      if (data.success) {
        setClients(data.clients);
      } else {
        setError(data.message || "Failed to load clients");
      }
    } catch {
      setError("Failed to load clients");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const toggleExpanded = (clientId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3 pt-4" data-testid="clients-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4" data-testid="clients-tab">
      <Card>
        <CardHeader>
          <CardTitle>Clients</CardTitle>
          <CardDescription>
            Your clients and their quotes. Payment status is derived from
            recorded payments — record payments on the quote page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          {clients.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <p className="mb-2 font-medium">No clients yet</p>
              <p className="text-sm">
                Clients are added automatically when you create quotes.
              </p>
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {clients.map((client) => {
                const isOpen = expanded.has(client.id);
                return (
                  <div key={client.id} data-testid={`client-${client.name}`}>
                    <button
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
                      onClick={() => toggleExpanded(client.id)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${client.name}`}
                      data-testid={`client-toggle-${client.name}`}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{client.name}</p>
                        <p className="flex items-center gap-3 text-sm text-muted-foreground">
                          {client.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {client.email}
                            </span>
                          )}
                          {client.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {client.phone}
                            </span>
                          )}
                        </p>
                      </div>
                      <Badge variant="secondary">
                        {client.quotes.length}{" "}
                        {client.quotes.length === 1 ? "quote" : "quotes"}
                      </Badge>
                    </button>

                    {isOpen && (
                      <div className="border-t bg-muted/30 px-4 py-2">
                        {client.quotes.length === 0 ? (
                          <p className="py-3 text-sm text-muted-foreground">
                            No quotes for this client yet.
                          </p>
                        ) : (
                          <div className="divide-y">
                            {client.quotes.map((quote) => (
                              <div
                                key={quote.id}
                                className="flex flex-wrap items-center gap-3 py-3"
                                data-testid={`quote-row-${quote.quote_number}`}
                              >
                                <Link
                                  href={`/quote/${quote.quote_number}`}
                                  className="figure font-medium hover:underline"
                                >
                                  {quote.quote_number}
                                </Link>
                                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                                  {quote.project_name}
                                </span>
                                <span className="figure font-medium">
                                  {formatCurrency(quote.total)}
                                </span>
                                <span
                                  className={`stamp ${
                                    quote.is_paid ? "stamp-paid" : "stamp-unpaid"
                                  }`}
                                  data-testid={`paid-badge-${quote.quote_number}`}
                                >
                                  {quote.is_paid
                                    ? "Paid"
                                    : quote.amount_paid > 0
                                      ? "Partially Paid"
                                      : "Unpaid"}
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setHistoryQuoteId(quote.id)}
                                  aria-label="Payment history"
                                  data-testid={`history-${quote.quote_number}`}
                                >
                                  <History className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {historyQuoteId && (
        <PaymentHistoryDialog
          quoteId={historyQuoteId}
          open={!!historyQuoteId}
          onOpenChange={(open) => !open && setHistoryQuoteId(null)}
        />
      )}
    </div>
  );
}
