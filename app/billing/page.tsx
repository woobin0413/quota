import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { AppFooter } from "@/components/layout/AppFooter";
import { BillingCenter } from "@/components/billing/BillingCenter";

export const metadata: Metadata = { title: "Plan & Billing — Quota" };

export default function BillingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="container mx-auto flex-1 px-4 py-8">
        <h1 className="mb-6 font-display text-2xl font-bold uppercase tracking-tight">Plan &amp; Billing</h1>
        <BillingCenter />
      </main>
      <AppFooter />
    </div>
  );
}
