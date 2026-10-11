"use client";

/**
 * Catalog Picker
 *
 * Searchable list of the contractor's work items; clicking Add
 * appends a line to the quote builder.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus, Search } from "lucide-react";
import { formatCurrency } from "@/lib/quote-calculations";
import type { WorkItem } from "@/types/database";

interface CatalogPickerProps {
  onAdd: (item: WorkItem) => void;
}

export function CatalogPicker({ onAdd }: CatalogPickerProps) {
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/work-items")
      .then((r) => r.json())
      .then((data) => setItems(data.success ? data.items : []))
      .catch(() => setItems([]));
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.category ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

  return (
    <Card className="h-fit lg:sticky lg:top-20" data-testid="catalog-picker">
      <CardHeader>
        <CardTitle>Your catalog</CardTitle>
        <CardDescription>Click to add work to the quote.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search work items…"
            className="pl-8"
            data-testid="catalog-search-input"
          />
        </div>

        {items === null ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Your catalog is empty.{" "}
            <Link
              href="/dashboard?tab=catalog"
              className="underline hover:text-foreground"
            >
              Set it up
            </Link>{" "}
            to build quotes faster.
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No items match &quot;{search}&quot;.
          </p>
        ) : (
          <div className="max-h-[420px] divide-y overflow-y-auto rounded-md border">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-3 py-2"
                data-testid={`picker-item-${item.name}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="figure text-xs text-muted-foreground">
                    {formatCurrency(item.defaultUnitPrice)} /{" "}
                    {item.unit_of_measure}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onAdd(item)}
                  aria-label={`Add ${item.name}`}
                  data-testid={`picker-add-${item.name}`}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
