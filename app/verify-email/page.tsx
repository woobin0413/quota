/**
 * The gate's landing page.
 *
 * The "I've confirmed" button is not decoration. The session cookie was minted
 * at login and still carries email_verified: false — clicking the link in the
 * email updates Auth0, not the cookie. Without a way to re-mint the session the
 * user stays stuck here after doing exactly what we asked. Sending them back
 * through /auth/login issues a fresh session with the updated claim; because
 * they still have an Auth0 session, it is a silent round trip, not a re-login.
 */

"use client";

import { useState } from "react";
import { useUser } from "@auth0/nextjs-auth0";
import { Button } from "@/components/ui/button";
import { MailCheck } from "lucide-react";

export default function VerifyEmailPage() {
  const { user } = useUser();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const resend = async () => {
    setStatus("sending");
    setMessage(null);
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("sent");
      } else {
        setStatus("error");
        setMessage(body.message ?? "Could not send the email. Try again shortly.");
      }
    } catch {
      setStatus("error");
      setMessage("Could not send the email. Check your connection and try again.");
    }
  };

  return (
    <div className="container mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <MailCheck className="mb-4 h-10 w-10 text-accent" aria-hidden="true" />
      <p className="eyebrow mb-1">One more step</p>
      <h1 className="font-display mb-3 text-4xl font-bold uppercase">
        Confirm your email
      </h1>
      <p className="text-muted-foreground mb-8">
        We sent a confirmation link to{" "}
        <span className="font-medium">{user?.email ?? "your email address"}</span>.
        Click it to finish setting up your account.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        {/* A full navigation, not a router push: this must re-mint the session
            cookie so the updated email_verified claim is picked up. */}
        <Button asChild data-testid="verify-email-continue">
          <a href="/auth/login?returnTo=%2Fdashboard">I&apos;ve confirmed — continue</a>
        </Button>
        <Button
          variant="outline"
          onClick={resend}
          disabled={status === "sending" || status === "sent"}
          data-testid="verify-email-resend"
        >
          {status === "sending"
            ? "Sending…"
            : status === "sent"
              ? "Email sent"
              : "Resend the email"}
        </Button>
      </div>

      {message && (
        <p className="text-destructive mt-4 text-sm" data-testid="verify-email-error">
          {message}
        </p>
      )}

      <p className="text-muted-foreground mt-8 text-sm">
        Wrong address? <a className="underline" href="/auth/logout">Sign out</a> and
        start again.
      </p>
    </div>
  );
}
