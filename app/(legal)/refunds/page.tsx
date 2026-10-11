import { SUPPORT_EMAIL } from "@/lib/site";
import { Clause, ContactCard, LegalHeader } from "../_components";

export const metadata = { title: "Refund Policy — Quota" };

export default function RefundsPage() {
  return (
    <>
      <LegalHeader
        eyebrow="Legal"
        title="Refund Policy"
        summary="One clear window, no fine print. Here is exactly when a charge comes back to you."
      />

      <div className="max-w-[70ch]">
        {/* The signature callout: the 3-day rule, unmissable. */}
        <section
          aria-labelledby="three-day-rule"
          className="border border-l-4 border-border border-l-accent bg-card p-6 shadow-[6px_6px_0_hsl(var(--accent)/0.18)] sm:p-8"
        >
          <div className="flex items-center gap-3">
            <span
              className="figure text-3xl font-bold leading-none text-accent"
              aria-hidden="true"
            >
              3
            </span>
            <p className="eyebrow text-accent">The 3-day rule</p>
          </div>
          <p
            id="three-day-rule"
            className="mt-4 font-display text-2xl font-bold leading-snug tracking-tight text-foreground sm:text-[1.75rem]"
          >
            {/* prettier-ignore */}
            {"If you cancel within 3 days of a charge — whether it's your first payment or a monthly renewal — we'll refund that charge in full. After 3 days, the charge for that billing period is non-refundable."}
          </p>
        </section>

        <div className="mt-4">
          <Clause n={2} title="How to cancel">
            <p>
              Open Plan &amp; Billing from your account menu and choose Cancel
              subscription. Cancelling stops all future charges, and you keep
              full access to your plan until the end of the period you&apos;ve
              already paid for.
            </p>
          </Clause>

          <Clause n={3} title="How refunds arrive">
            <p>
              Refunds are issued to the original payment method via Stripe. They
              typically arrive within 5-10 business days, depending on your bank.
            </p>
          </Clause>
        </div>

        <ContactCard heading="Need a refund?">
          For requests within the 3-day window, email us with the email address
          on your account — {SUPPORT_EMAIL}.
        </ContactCard>
      </div>
    </>
  );
}
