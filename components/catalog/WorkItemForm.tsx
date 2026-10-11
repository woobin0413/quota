"use client";

/**
 * Work Item Form
 *
 * Inline form for adding a custom work item to the catalog.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TRADE_LABELS, TRADES } from "@/lib/catalog-templates";
import type { WorkItem } from "@/types/database";

const UNITS = ["each", "hours", "sqft", "lf", "cf", "day"];

interface WorkItemFormProps {
  onCreated: (item: WorkItem) => void;
  onCancel: () => void;
}

export function WorkItemForm({ onCreated, onCancel }: WorkItemFormProps) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("each");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<string>("general");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedPrice = parseFloat(price);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      setError("Enter a valid price");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/work-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          unitOfMeasure: unit,
          defaultUnitPrice: parsedPrice,
          category,
        }),
      });
      const data = await response.json();

      if (data.success) {
        onCreated(data.item);
      } else {
        setError(data.message || "Failed to create item");
      }
    } catch {
      setError("Failed to create item");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-4 rounded-md border p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end"
      data-testid="work-item-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="wi-name">Name</Label>
        <Input
          id="wi-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Outlet installation"
          data-testid="work-item-name-input"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wi-unit">Unit</Label>
        <Select value={unit} onValueChange={setUnit}>
          <SelectTrigger id="wi-unit" data-testid="work-item-unit-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wi-price">Price</Label>
        <Input
          id="wi-price"
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          data-testid="work-item-price-input"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wi-category">Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger id="wi-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRADES.map((t) => (
              <SelectItem key={t} value={t}>
                {TRADE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isSaving} data-testid="work-item-save-button">
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive sm:col-span-5" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
