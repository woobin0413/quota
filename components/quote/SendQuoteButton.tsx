"use client";

/**
 * Send Quote Button
 *
 * Sends the quote to the client via email (with PDF attachment)
 * through POST /api/send-quote, then refreshes the page so the
 * send metadata ("Sent N× · last ...") updates. Sending does not
 * change the quote's paid/unpaid status.
 *
 * Subject and message are contractor-editable, prepopulated by the
 * server from the same payload the PDF renders from. Figures in the
 * email body render from that payload and are not editable here.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Send, Paperclip } from "lucide-react";
import { useSubscription } from "@/components/subscription/use-subscription";
import { UpgradeDialog } from "@/components/subscription/UpgradeDialog";

interface SendQuoteButtonProps {
  quoteId: string;
  defaultEmail?: string;
  defaultName?: string;
  defaultSubject?: string;
  defaultMessage?: string;
  /** e.g. "Q-2026-901.pdf · 4 items · Total $6,973.09" */
  attachmentSummary?: string;
  /** Paid quotes are receipts, not quotations — sending is disabled. */
  isPaid?: boolean;
}

export function SendQuoteButton({
  quoteId,
  defaultEmail = "",
  defaultName = "",
  defaultSubject = "",
  defaultMessage = "",
  attachmentSummary,
  isPaid = false,
}: SendQuoteButtonProps) {
  const router = useRouter();
  const { sub } = useSubscription();
  const isFree = sub?.tier === "free";
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail);
  const [name, setName] = useState(defaultName);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setError(null);

    if (!subject.trim()) {
      setError("Subject is empty");
      return;
    }

    setIsSending(true);

    try {
      const response = await fetch("/api/send-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId,
          recipientEmail: email.trim(),
          recipientName: name.trim() || "Client",
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      const data = await response.json();

      if (data.success) {
        setOpen(false);
        router.refresh();
      } else {
        setError(data.error || "Failed to send quote");
      }
    } catch {
      setError("Failed to send quote");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => (isFree ? setUpgradeOpen(true) : setOpen(true))}
        disabled={isPaid}
        title={isPaid ? "This quote is paid — use Send receipt in the Actions menu" : undefined}
        data-testid="send-quote-button"
      >
        <Send className="mr-2 h-4 w-4" aria-hidden="true" />
        Send to client
      </Button>

      {isFree && (
        <UpgradeDialog
          open={upgradeOpen}
          onOpenChange={setUpgradeOpen}
          currentTier="free"
          reason="Email invoicing is a Pro feature. Upgrade to email, or download the PDF from the Actions menu."
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="send-quote-dialog">
          <DialogHeader>
            <DialogTitle>Send quote</DialogTitle>
            <DialogDescription>
              Emails the quote to your client with a PDF attached. Edit the
              subject and message as needed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="send-name">Client name</Label>
                <Input
                  id="send-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Smith"
                  data-testid="send-name-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="send-email">Client email</Label>
                <Input
                  id="send-email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="client@example.com"
                  data-testid="send-email-input"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="send-subject">Subject</Label>
              <Input
                id="send-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                data-testid="send-subject-input"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="send-message">Message</Label>
              <Textarea
                id="send-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={7}
                maxLength={2000}
                data-testid="send-message-input"
              />
            </div>

            {attachmentSummary && (
              <p className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                Attached: {attachmentSummary}
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert" aria-live="polite">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={!email.trim() || isSending}
              data-testid="send-confirm-button"
            >
              {isSending ? "Sending…" : "Send email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
