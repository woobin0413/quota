"use client";

import { useCallback, useEffect, useState } from "react";
import type { BillingSummary, InvoiceRow } from "@/lib/billing/summary";

export function useBilling() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, i] = await Promise.all([
        fetch("/api/billing/summary").then((r) => r.json()),
        fetch("/api/billing/invoices").then((r) => r.json()),
      ]);
      if (!s.success) throw new Error(s.message || "Could not load billing");
      setSummary(s.summary);
      setInvoices(i.success ? i.invoices : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load billing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Optimistic patch (webhook lag) — same pattern as cancel/reactivate today.
  const patchSummary = useCallback((over: Partial<BillingSummary>) => {
    setSummary((prev) => (prev ? { ...prev, ...over } : prev));
  }, []);

  return { summary, invoices, loading, error, refresh, patchSummary };
}
