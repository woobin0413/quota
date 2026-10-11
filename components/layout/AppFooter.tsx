import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/site";

/** Muted legal-links footer for authenticated app pages. */
export function AppFooter() {
  return (
    <footer
      className="border-t py-5 text-xs text-muted-foreground"
      data-testid="app-footer"
    >
      <div className="container mx-auto flex flex-col items-center gap-3 px-4 sm:flex-row sm:justify-between">
        <p className="order-2 text-center sm:order-1 sm:text-left">
          © {new Date().getFullYear()} Quota.
        </p>
        <nav className="order-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 sm:order-2">
          {LEGAL_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-semibold uppercase tracking-widest underline-offset-4 transition-colors hover:text-foreground hover:underline hover:decoration-accent"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
