import { BookOpen, FileText, CheckCircle2 } from "lucide-react";
import { ContactCard } from "../_components";

export const metadata = { title: "About — Quota" };

const VALUES = [
  {
    icon: BookOpen,
    title: "Price book",
    body: "The work you do at the prices you charge, always in your pocket.",
  },
  {
    icon: FileText,
    title: "Quote fast",
    body: "Pick items, add anything one-off, finish in minutes — not at 10pm.",
  },
  {
    icon: CheckCircle2,
    title: "Get paid",
    body: "Send a PDF invoice, then track who's paid and who hasn't.",
  },
];

export default function AboutPage() {
  return (
    <>
      <header className="mb-14">
        <p className="eyebrow mb-4">Company</p>
        <h1 className="max-w-[20ch] text-balance font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:max-w-none sm:text-6xl">
          Billing software that&apos;s simpler than the work it bills.
        </h1>
        <p className="mt-5 max-w-[54ch] text-lg leading-relaxed text-muted-foreground">
          Quota is the price book, quote pad, and payment tracker for
          contractors who bill in the field — and nothing they don&apos;t need.
        </p>
        <div className="mt-6 h-0.5 w-full bg-accent" aria-hidden="true" />
      </header>

      <section
        aria-label="What Quota does"
        className="grid gap-px border border-border bg-border shadow-[6px_6px_0_hsl(var(--accent)/0.12)] sm:grid-cols-3"
      >
        {VALUES.map(({ icon: Icon, title, body }, i) => (
          <div key={title} className="bg-card p-6 sm:p-7">
            <div className="mb-4 flex items-center gap-3">
              <span className="figure text-xs text-accent" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex h-9 w-9 items-center justify-center bg-accent/15">
                <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
              </span>
            </div>
            <h2 className="mb-2 font-display text-lg font-bold uppercase tracking-tight">
              {title}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
        ))}
      </section>

      <div className="mt-14 max-w-[65ch] space-y-6 text-lg leading-relaxed text-muted-foreground">
        <p>
          Quota is built for contractors who quote in the field. Your price book
          lives in your pocket: the work you do, at the prices you charge. When a
          client asks for a number, you pick the items, add anything one-off, and
          have a finished quote in minutes — not at the kitchen table at 10pm.
        </p>
        <p>
          Send the quote as a PDF invoice straight to your client&apos;s inbox,
          then track who&apos;s paid and who hasn&apos;t. No accounting degree
          required, no bloated back office to configure — just quotes out and
          payments tracked.
        </p>
        <p>
          We&apos;re a small team that believes billing software should be
          simpler than the work it bills. Every feature in Quota exists because a
          contractor needed it, and nothing more.
        </p>
      </div>

      <div className="max-w-[65ch]">
        <ContactCard heading="Say hello">
          Questions, ideas, or something not working? A real person reads every
          message.
        </ContactCard>
      </div>
    </>
  );
}
