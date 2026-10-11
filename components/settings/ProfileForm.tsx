/**
 * Profile Form
 *
 * Edit business profile fields (company info shown on quote emails/PDFs).
 * Rendered inside ProfileSettingsDialog; the dialog provides the chrome.
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Check } from "lucide-react";
import { LogoUploader } from "@/components/settings/LogoUploader";
import {
  formatPhoneInput,
  isValidPhone,
  isValidWebsite,
  PHONE_ERROR,
  WEBSITE_ERROR,
} from "@/lib/profile-validation";

interface ProfileFields {
  firstName: string;
  lastName: string;
  companyName: string;
  phone: string;
  companyAddress: string;
  companyWebsite: string;
  logoUrl: string | null;
}

type FieldErrors = Partial<Record<keyof ProfileFields, string>>;

interface ProfileFormProps {
  initialProfile: ProfileFields;
  /** Called after a successful save (e.g. so the header can refresh). */
  onSaved?: (profile: { companyName: string | null }) => void;
}

export function ProfileForm({ initialProfile, onSaved }: ProfileFormProps) {
  const [profile, setProfile] = useState<ProfileFields>(initialProfile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const setField =
    (field: keyof ProfileFields) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      let value = e.target.value;
      // Auto-format US phone as digits are typed; skip on deletion so
      // backspace isn't fought by the formatter re-adding ") " etc.
      if (field === "phone" && value.length > profile.phone.length) {
        value = formatPhoneInput(value);
      }
      setProfile((prev) => ({ ...prev, [field]: value }));
      setFieldErrors((prev) =>
        prev[field] ? { ...prev, [field]: undefined } : prev
      );
      setSaved(false);
    };

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    const phone = profile.phone.trim();
    const website = profile.companyWebsite.trim();
    if (phone && !isValidPhone(phone)) errors.phone = PHONE_ERROR;
    if (website && !isValidWebsite(website))
      errors.companyWebsite = WEBSITE_ERROR;
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const errors = validate();
    setFieldErrors(errors);
    const firstInvalid = (["phone", "companyWebsite"] as const).find(
      (f) => errors[f]
    );
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: profile.firstName.trim() || null,
          lastName: profile.lastName.trim() || null,
          companyName: profile.companyName.trim() || null,
          phone: profile.phone.trim() || null,
          companyAddress: profile.companyAddress.trim() || null,
          companyWebsite: profile.companyWebsite.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to save profile");
      }

      setSaved(true);
      onSaved?.({ companyName: profile.companyName.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="profile-form"
    >
      <LogoUploader
        logoUrl={profile.logoUrl}
        onChange={(logoUrl) => setProfile((p) => ({ ...p, logoUrl }))}
      />

      {/* Auth0 signup collects only an email, so unless the user filled in the
          first-run panel these are the only place a name ever gets set. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First Name</Label>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            value={profile.firstName}
            onChange={setField("firstName")}
            placeholder="Bob"
            maxLength={100}
            data-testid="profile-first-name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name</Label>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            value={profile.lastName}
            onChange={setField("lastName")}
            placeholder="Rivera"
            maxLength={100}
            data-testid="profile-last-name"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="companyName">Company Name</Label>
        <Input
          id="companyName"
          name="companyName"
          autoComplete="organization"
          value={profile.companyName}
          onChange={setField("companyName")}
          placeholder="Bob's Plumbing LLC"
          maxLength={255}
          data-testid="profile-company-name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={profile.phone}
          onChange={setField("phone")}
          placeholder="(555) 123-4567"
          maxLength={50}
          aria-invalid={Boolean(fieldErrors.phone)}
          aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
          data-testid="profile-phone"
        />
        {fieldErrors.phone && (
          <p
            id="phone-error"
            className="text-sm text-destructive"
            data-testid="profile-phone-error"
          >
            {fieldErrors.phone}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="companyAddress">Address</Label>
        <Textarea
          id="companyAddress"
          name="companyAddress"
          autoComplete="street-address"
          value={profile.companyAddress}
          onChange={setField("companyAddress")}
          placeholder="123 Main St, Springfield, IL 62701"
          maxLength={500}
          rows={2}
          data-testid="profile-address"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="companyWebsite">Website</Label>
        <Input
          id="companyWebsite"
          name="companyWebsite"
          autoComplete="url"
          inputMode="url"
          spellCheck={false}
          value={profile.companyWebsite}
          onChange={setField("companyWebsite")}
          placeholder="bobsplumbing.com"
          maxLength={255}
          aria-invalid={Boolean(fieldErrors.companyWebsite)}
          aria-describedby={
            fieldErrors.companyWebsite ? "companyWebsite-error" : undefined
          }
          data-testid="profile-website"
        />
        {fieldErrors.companyWebsite && (
          <p
            id="companyWebsite-error"
            className="text-sm text-destructive"
            data-testid="profile-website-error"
          >
            {fieldErrors.companyWebsite}
          </p>
        )}
      </div>

      {error && (
        <p
          className="text-sm text-destructive"
          role="alert"
          aria-live="polite"
          data-testid="profile-error"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving} data-testid="profile-save">
          {saving && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          Save Changes
        </Button>
        <span
          className="flex items-center gap-1 text-sm text-muted-foreground"
          aria-live="polite"
          data-testid="profile-saved"
        >
          {saved && (
            <>
              <Check className="h-4 w-4 text-green-600" aria-hidden="true" />
              Saved
            </>
          )}
        </span>
      </div>
    </form>
  );
}
