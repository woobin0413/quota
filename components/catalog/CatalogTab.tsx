"use client";

/**
 * Work Catalog Tab
 *
 * The contractor's configurable catalog of work items:
 * list with inline price editing, add form, deactivate,
 * and starter-template import by trade.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus, Download, Trash2, Check, X, Pencil } from "lucide-react";
import { WorkItemForm } from "./WorkItemForm";
import { ImportStarterDialog } from "./ImportStarterDialog";
import { formatCurrency } from "@/lib/quote-calculations";
import type { WorkItem } from "@/types/database";

export function CatalogTab() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");

  const loadItems = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/work-items");
      const data = await response.json();
      if (data.success) {
        setItems(data.items);
      } else {
        setError(data.message || "Failed to load catalog");
      }
    } catch {
      setError("Failed to load catalog");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const startEditPrice = (item: WorkItem) => {
    setEditingId(item.id);
    setEditPrice(String(item.defaultUnitPrice));
  };

  const savePrice = async (item: WorkItem) => {
    const price = parseFloat(editPrice);
    if (isNaN(price) || price < 0) return;

    const response = await fetch(`/api/work-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultUnitPrice: price }),
    });

    if (response.ok) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, defaultUnitPrice: price } : i
        )
      );
    }
    setEditingId(null);
  };

  const deactivateItem = async (item: WorkItem) => {
    const response = await fetch(`/api/work-items/${item.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3 pt-4" data-testid="catalog-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4" data-testid="catalog-tab">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Work Catalog</CardTitle>
            <CardDescription>
              The work you offer, with your prices. Quotes are built from
              these items.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowImport(true)}
              data-testid="import-starter-button"
            >
              <Download className="mr-2 h-4 w-4" />
              Import starter items
            </Button>
            <Button
              onClick={() => setShowAddForm((v) => !v)}
              data-testid="add-work-item-button"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add item
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          {showAddForm && (
            <div className="mb-6">
              <WorkItemForm
                onCreated={(item) => {
                  setItems((prev) => [...prev, item]);
                  setShowAddForm(false);
                }}
                onCancel={() => setShowAddForm(false)}
              />
            </div>
          )}

          {items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <p className="mb-2 font-medium">Your catalog is empty</p>
              <p className="text-sm">
                Import starter items for your trade, or add your own.
              </p>
            </div>
          ) : (
            <div className="divide-y rounded-md border" data-testid="work-item-list">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-3"
                  data-testid={`work-item-${item.name}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      per {item.unit_of_measure}
                      {item.category && (
                        <Badge variant="secondary" className="ml-2">
                          {item.category}
                        </Badge>
                      )}
                    </p>
                  </div>

                  {editingId === item.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") savePrice(item);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="w-28"
                        autoFocus
                        data-testid="edit-price-input"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => savePrice(item)}
                        aria-label="Save price"
                        data-testid="save-price-button"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                        aria-label="Cancel edit"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="figure flex items-center gap-1 rounded px-2 py-1 font-medium hover:bg-muted"
                      onClick={() => startEditPrice(item)}
                      aria-label={`Edit price for ${item.name}`}
                      data-testid={`price-${item.name}`}
                    >
                      {formatCurrency(item.defaultUnitPrice)}
                      <Pencil className="ml-1 h-3 w-3 text-muted-foreground" />
                    </button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deactivateItem(item)}
                    aria-label={`Remove ${item.name}`}
                    data-testid={`remove-${item.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ImportStarterDialog
        open={showImport}
        onOpenChange={setShowImport}
        onImported={loadItems}
      />
    </div>
  );
}
