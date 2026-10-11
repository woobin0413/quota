/**
 * Dashboard Page
 *
 * Main dashboard showing quote stats and recent activity.
 * Protected route - requires authentication.
 */

import { Suspense } from "react";
import {
  DashboardTabs,
  CatalogOnboarding,
  ProfileOnboarding,
} from "@/components/dashboard";
import { UpgradedBanner } from "@/components/subscription/UpgradedBanner";
import { NewQuoteButton } from "@/components/quote/NewQuoteButton";
import { requireUser } from "@/lib/auth";

export default async function DashboardPage() {
  await requireUser();

  return (
    <div className="container mx-auto px-4 py-8">
      <Suspense fallback={null}>
        <UpgradedBanner />
      </Suspense>

      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow mb-1">The office</p>
          <h1 className="font-display text-4xl font-bold uppercase">
            Dashboard
          </h1>
          <p className="text-muted-foreground">
            Quotes, clients, and your price book in one place
          </p>
        </div>
        <div className="flex gap-2">
          <NewQuoteButton />
        </div>
      </div>

      {/* First-run: capture the business name that prints on every invoice.
          Auth0 signup only yields an email, so this is the first chance to ask. */}
      <ProfileOnboarding />

      {/* First-run: prompt new users to set up their catalog first */}
      <CatalogOnboarding />

      {/* Dashboard Content */}
      <Suspense>
        <DashboardTabs />
      </Suspense>
    </div>
  );
}
