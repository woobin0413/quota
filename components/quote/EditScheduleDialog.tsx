"use client";

/**
 * Edit Schedule Dialog
 *
 * Edits milestone names/percentages. Live sum indicator; server re-validates
 * (sum=100, paid milestones kept, amounts not below paid).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import type { MilestoneView } from "@/lib/payment-schedule";

interface Row {
  id?: string;
  name: string;
  percentage: string; // string while editing
  paidAmount: number;
}

interface EditScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  milestones: MilestoneView[];
}

export function EditScheduleDialog({
  open,
  onOpenChange,
  quoteId,
  milestones,
}: EditScheduleDialogProps) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setRows(
        milestones.map((m) => ({
          id: m.id,
          name: m.name,
          percentage: String(m.percentage),
          paidAmount: m.paidAmount,
        }))
      );
      setErrors([]);
    }
  }, [open, milestones]);

  const sum = rows.reduce((s, r) => s + (Number(r.percentage) || 0), 0);

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const response = await fetch(`/api/quotes/${quoteId}/milestones`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          milestones: rows.map((r, i) => ({
            id: r.id,
            name: r.name.trim(),
            percentage: Number(r.percentage),
            sortOrder: i,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setErrors(
          data.details?.map((d: { message: string }) => d.message) ?? [
            data.message || "Failed to save schedule",
          ]
        );
        return;
      }
      onOpenChange(false);
      router.refresh();
    } catch {
      setErrors(["Failed to save schedule"]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="edit-schedule-dialog">
        <DialogHeader>
          <DialogTitle>Payment Schedule</DialogTitle>
          <DialogDescription>
            Percentages must add up to 100. Milestones with payments can&apos;t be
            removed or shrunk below what&apos;s been paid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {rows.map((row, i) => (
            <div key={row.id ?? `new-${i}`} className="flex items-center gap-2">
              <Input
                value={row.name}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                }
                placeholder="Milestone name"
                className="flex-1"
                data-testid={`milestone-name-${i}`}
              />
              <Input
                type="number"
                inputMode="decimal"
                min={0.01}
                max={100}
                step={0.01}
                value={row.percentage}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r, j) => (j === i ? { ...r, percentage: e.target.value } : r))
                  )
                }
                className="w-24 text-right"
                aria-label={`Milestone ${i + 1} percentage`}
                data-testid={`milestone-pct-${i}`}
              />
              <span className="text-sm text-muted-foreground">%</span>
              <Button
                variant="ghost"
                size="sm"
                className="px-2"
                disabled={row.paidAmount > 0}
                title={row.paidAmount > 0 ? "Has payments — cannot remove" : "Remove"}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                aria-label={`Remove milestone ${i + 1}`}
                data-testid={`milestone-remove-${i}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}

          <div className="flex items-center justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((rs) => [...rs, { name: "", percentage: "", paidAmount: 0 }])
              }
              data-testid="milestone-add"
            >
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Add milestone
            </Button>
            <span
              className={`text-sm ${Math.abs(sum - 100) < 0.001 ? "text-muted-foreground" : "text-destructive"}`}
              data-testid="schedule-sum"
            >
              Total: {sum}%
            </span>
          </div>
        </div>

        {errors.length > 0 && (
          <ul className="space-y-1 text-sm text-destructive" role="alert">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} data-testid="schedule-save">
            {saving ? "Saving…" : "Save Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
