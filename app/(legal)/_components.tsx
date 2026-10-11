import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/site";

/**
 * Shared building blocks for the legal + about pages.
 *
 * The pages are a printed contract rendered on estimate paper: an eyebrow,
 * a display title, a one-line plain-language summary, and a "Last updated"
 * stamp sitting under a 2px accent rule. Ordered clauses are numbered in
 * the left margin the way a real contract numbers its sections — the one
 * signature move; everything else stays calm.
 */

const LAST_UPDATED = "July 18, 2026";

export function LegalHeader({
  eyebrow,
  title,
  summary,
}: {
  eyebrow: string;
  title: string;
  summary: string;
}) {
  return (
    <header className="mb-12">
      <p className="eyebrow mb-3">{eyebrow}</p>
      <h1 className="font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-muted-foreground">
        {summary}
      </p>
      <div className="mt-6 h-0.5 w-full bg-accent" aria-hidden="true" />
      <p className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        <span className="eyebrow">Last updated</span>
        <span className="figure font-semibold text-foreground">
          {LAST_UPDATED}
        </span>
      </p>
    </header>
  );
}

/**
 * A numbered clause. The number hangs in the left margin as a mono accent
 * figure, like a section number in a printed contract.
 */
export function Clause({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  const label = String(n).padStart(2, "0");
  return (
    <section
      id={`section-${n}`}
      className="grid scroll-mt-24 grid-cols-[2.5rem_1fr] gap-x-3 border-t border-dashed border-border/70 py-8 sm:grid-cols-[3.5rem_1fr] sm:gap-x-6"
    >
      <span
        className="figure select-none pt-1 text-sm font-bold text-accent sm:text-base"
        aria-hidden="true"
      >
        {label}
      </span>
      <div>
        <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-tight">
          {title}
        </h2>
        <div className="max-w-[65ch] leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent">
          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * Sticky in-page table of contents. Desktop only — hidden below lg so it
 * never crowds the mobile reading column.
 */
export function TableOfContents({
  items,
}: {
  items: { n: number; title: string }[];
}) {
  return (
    <nav
      aria-label="On this page"
      className="sticky top-24 hidden lg:block"
    >
      <p className="eyebrow mb-4">On this page</p>
      <ol className="space-y-2.5">
        {items.map((item) => (
          <li key={item.n} className="flex gap-3 text-sm">
            <span className="figure text-xs text-accent" aria-hidden="true">
              {String(item.n).padStart(2, "0")}
            </span>
            <a
              href={`#section-${item.n}`}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:text-foreground"
            >
              {item.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Accent-bordered contact card at the foot of each page.
 */
export function ContactCard({
  heading = "Get in touch",
  children,
}: {
  heading?: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="mt-14 border border-l-4 border-border border-l-accent bg-card p-6 shadow-[6px_6px_0_hsl(var(--accent)/0.18)] sm:p-8">
      <p className="eyebrow mb-2">{heading}</p>
      <p className="max-w-[60ch] leading-relaxed text-muted-foreground">
        {children}
      </p>
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="mt-4 inline-flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.08em] text-foreground underline decoration-accent decoration-2 underline-offset-4 hover:text-accent focus-visible:text-accent"
      >
        {SUPPORT_EMAIL}
      </a>
    </aside>
  );
}

export { Link };
