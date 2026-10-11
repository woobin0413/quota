"use client";

/**
 * Logo Uploader
 *
 * Business-logo section of profile settings: preview, upload, remove.
 * Client pre-validates type/size for instant feedback; the server
 * re-validates by magic bytes.
 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

// PNG + JPG only — @react-pdf v4 cannot render WebP (silent PDF gap)
const ACCEPT = "image/png,image/jpeg";
const MAX_BYTES = 2 * 1024 * 1024;

interface LogoUploaderProps {
  logoUrl: string | null;
  onChange: (logoUrl: string | null) => void;
}

export function LogoUploader({ logoUrl, onChange }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();

  const upload = async (file: File) => {
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Logo must be a PNG or JPG image");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Logo must be 2 MB or smaller");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/profile/logo", { method: "POST", body });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to upload logo");
      }
      onChange(data.logoUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload logo");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/logo", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to remove logo");
      }
      onChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove logo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>Business Logo</Label>
      <div className="flex items-center gap-4">
        <div
          className="flex h-16 w-32 items-center justify-center overflow-hidden rounded border bg-muted/30"
          data-testid="logo-preview"
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external storage URL, fixed box
            <img
              src={logoUrl}
              alt="Business logo"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={pick}
            disabled={busy}
            data-testid="logo-upload-button"
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {logoUrl ? "Replace" : "Upload"}
          </Button>
          {logoUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={busy}
              data-testid="logo-remove-button"
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        PNG or JPG · max 2 MB · a wide transparent PNG works best.
      </p>
      {error && (
        <p className="text-xs text-destructive" role="alert" data-testid="logo-error">
          {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Upload business logo"
        data-testid="logo-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
    </div>
  );
}
