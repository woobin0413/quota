"use client";

/**
 * Import Starter Items Dialog
 *
 * Lets the contractor pick one or more trades and import the
 * corresponding starter catalog templates.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { TRADES, TRADE_LABELS, type Trade } from "@/lib/catalog-templates";

interface ImportStarterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportStarterDialog({
  open,
  onOpenChange,
  onImported,
}: ImportStarterDialogProps) {
  const [selected, setSelected] = useState<Trade[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTrade = (trade: Trade) => {
    setSelected((prev) =>
      prev.includes(trade)
        ? prev.filter((t) => t !== trade)
        : [...prev, trade]
    );
  };

  const handleImport = async () => {
    if (selected.length === 0) return;
    setIsImporting(true);
    setError(null);

    try {
      const response = await fetch("/api/work-items/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trades: selected }),
      });
      const data = await response.json();

      if (data.success) {
        onImported();
        onOpenChange(false);
        setSelected([]);
      } else {
        setError(data.message || "Import failed");
      }
    } catch {
      setError("Import failed");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="import-starter-dialog">
        <DialogHeader>
          <DialogTitle>Import starter items</DialogTitle>
          <DialogDescription>
            Pick your trade(s). We&apos;ll add common work items with
            industry-standard prices — you can adjust everything afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {TRADES.map((trade) => (
            <div key={trade} className="flex items-center gap-2">
              <Checkbox
                id={`trade-${trade}`}
                checked={selected.includes(trade)}
                onCheckedChange={() => toggleTrade(trade)}
                data-testid={`trade-checkbox-${trade}`}
              />
              <Label htmlFor={`trade-${trade}`} className="cursor-pointer">
                {TRADE_LABELS[trade]}
              </Label>
            </div>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={selected.length === 0 || isImporting}
            data-testid="import-confirm-button"
          >
            {isImporting ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
