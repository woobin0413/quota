"use client";

/**
 * Internal Notes Card
 *
 * Inline editor for a quote's private internal note on the detail page.
 * The note is contractor-only: it is never rendered on the client PDF or
 * email. Saving PATCHes /api/quotes/[id] and refreshes the page.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Lock, Pencil } from "lucide-react";

interface InternalNotesCardProps {
  quoteId: string;
  internalNotes: string | null;
}

const MAX_LEN = 5000;

export function InternalNotesCard({
  quoteId,
  internalNotes,
}: InternalNotesCardProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(internalNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setValue(internalNotes ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (value.length > MAX_LEN) {
      setError(`Note must be ${MAX_LEN} characters or fewer`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalNotes: value }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to save note");
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-8" data-testid="internal-notes-card">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Internal Notes
            </CardTitle>
            <CardDescription className="mt-1">
              Private — not shown to the client or on the PDF.
            </CardDescription>
          </div>
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={startEdit}
              data-testid="edit-internal-notes"
            >
              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              {internalNotes ? "Edit" : "Add note"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
              }}
              rows={5}
              maxLength={MAX_LEN}
              placeholder="Notes for yourself about this quote…"
              autoFocus
              aria-label="Internal notes"
              aria-invalid={Boolean(error)}
              data-testid="internal-notes-input"
            />
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={saving}
                data-testid="internal-notes-save"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        ) : internalNotes ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {internalNotes}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground/70">No notes yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
