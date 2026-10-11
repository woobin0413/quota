import Link from "next/link";
import { FileText } from "lucide-react";
import { LEGAL_LINKS } from "@/lib/site";
import { auth0 } from "@/lib/auth0";

export default async function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth0.getSession();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 font-display font-bold uppercase tracking-wide focus-visible:text-accent"
          >
            <FileText className="h-5 w-5 text-accent" aria-hidden="true" />
            Quota
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="underline-offset-4 hover:text-foreground hover:underline focus-visible:text-foreground"
              >
                {l.label}
              </Link>
            ))}
            {session && (
              <Link
                href="/dashboard"
                className="font-semibold text-foreground underline-offset-4 hover:text-accent hover:underline"
                data-testid="legal-dashboard-link"
              >
                Dashboard
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main
        className="ledger-paper container mx-auto max-w-5xl px-4 py-12 sm:py-16"
        data-testid="legal-page"
      >
        {children}
      </main>
    </div>
  );
}
