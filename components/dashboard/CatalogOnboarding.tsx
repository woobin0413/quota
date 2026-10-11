"use client";

/**
 * First-run guidance for new contractors: when the work catalog is empty,
 * prompt them to set up their price book first so quotes can be built by
 * picking items instead of typing ad-hoc lines every time. Skippable — the
 * dismissal is remembered locally, and the panel never shows again once the
 * catalog has at least one item.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ImportStarterDialog } from "@/components/catalog/ImportStarterDialog";
import { BookOpen, Sparkles } from "lucide-react";
import { CATALOG_ONBOARDING_DISMISSED as DISMISS_KEY } from "@/lib/onboarding-keys";

export function CatalogOnboarding() {
  const [show, setShow] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY)) {
      return; // previously skipped
    }
    fetch("/api/work-items")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.items) && data.items.length === 0) {
          setShow(true);
        }
      })
      .catch(() => {
        // non-critical — if this fails, just don't show onboarding
      });
  }, []);

  const dismiss = () => {
    if (typeof window !== "undefined") localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      className="mb-8 border-2 border-accent bg-accent/5 p-5 sm:p-6"
      data-testid="catalog-onboarding"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded bg-accent/15 p-2 text-accent" aria-hidden="true">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="font-display text-lg font-bold uppercase tracking-wide">
              Start with your price book
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add the work you do and your prices once — then build every quote by
              picking items, no retyping. Import a starter set for your trade to get
              going in seconds.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => setImportOpen(true)}
              data-testid="onboarding-import"
            >
              <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
              Import starter items
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/dashboard?tab=catalog" data-testid="onboarding-add-manually">
                Add my own
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismiss}
              data-testid="onboarding-skip"
            >
              Skip for now
            </Button>
          </div>
        </div>
      </div>

      <ImportStarterDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          setImportOpen(false);
          setShow(false); // catalog now has items
        }}
      />
    </div>
  );
}
