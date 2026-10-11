"use client";

/**
 * Dashboard content, selected by the ?tab= URL param (quotes | clients |
 * catalog). The tab BAR was removed — Clients and Work Catalog are reached
 * from the top navigation now; the dashboard defaults to the Quotes view.
 */

import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DashboardContent } from "./DashboardContent";
import { ClientsTab } from "@/components/contacts";
import { CatalogTab } from "@/components/catalog";

const VALID_TABS = ["quotes", "clients", "catalog"] as const;
type TabValue = (typeof VALID_TABS)[number];

export function DashboardTabs() {
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab") ?? "quotes";
  const activeTab: TabValue = (VALID_TABS as readonly string[]).includes(
    tabParam
  )
    ? (tabParam as TabValue)
    : "quotes";

  return (
    <Tabs value={activeTab}>
      <TabsContent value="quotes">
        <DashboardContent />
      </TabsContent>
      <TabsContent value="clients">
        <ClientsTab />
      </TabsContent>
      <TabsContent value="catalog">
        <CatalogTab />
      </TabsContent>
    </Tabs>
  );
}
