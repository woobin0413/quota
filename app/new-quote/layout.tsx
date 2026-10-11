/**
 * New Quote Layout
 *
 * Wraps new quote page with the header.
 */

import { AppFooter, Header } from "@/components/layout";

export default function NewQuoteLayout({
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
