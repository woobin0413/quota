"use client";

/**
 * Profile Settings Dialog
 *
 * Edits the business profile (company info on quote emails/PDFs) in a
 * dialog so the contractor never leaves the page they're on. Fetches a
 * fresh profile from /api/profile each time it opens.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { Loader2 } from "lucide-react";

interface Profile {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  phone: string | null;
  companyAddress: string | null;
  companyWebsite: string | null;
  logoUrl: string | null;
  email: string;
}

interface ProfileSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save (e.g. so the header can refresh). */
  onSaved?: (profile: { companyName: string | null }) => void;
}

export function ProfileSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: ProfileSettingsDialogProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setProfile(null);
    setLoadError(null);

    fetch("/api/profile")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.success) throw new Error(data.message);
        setProfile(data.profile);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load your profile. Close and try again.");
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="profile-settings-dialog">
        <DialogHeader>
          <DialogTitle>Profile Settings</DialogTitle>
          <DialogDescription>
            {profile
              ? `Signed in as ${profile.email}. This info appears on quotes sent to your clients.`
              : "This info appears on quotes sent to your clients."}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="text-sm text-destructive" role="alert">
            {loadError}
          </p>
        ) : profile ? (
          <ProfileForm
            initialProfile={{
              firstName: profile.firstName ?? "",
              lastName: profile.lastName ?? "",
              companyName: profile.companyName ?? "",
              phone: profile.phone ?? "",
              companyAddress: profile.companyAddress ?? "",
              companyWebsite: profile.companyWebsite ?? "",
              logoUrl: profile.logoUrl ?? null,
            }}
            onSaved={onSaved}
          />
        ) : (
          <div
            className="flex items-center justify-center py-10 text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
            Loading profile…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
