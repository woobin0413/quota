/**
 * Quote Layout
 *
 * Wraps quote pages with the header.
 */

import { AppFooter, Header } from "@/components/layout";

export default function QuoteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>{children}</main>
      <AppFooter />
    </div>
  );
}
