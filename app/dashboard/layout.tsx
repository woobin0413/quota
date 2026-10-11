/**
 * Dashboard Layout
 *
 * Wraps all dashboard pages with the header.
 */

import { AppFooter, Header } from "@/components/layout";

export default function DashboardLayout({
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
