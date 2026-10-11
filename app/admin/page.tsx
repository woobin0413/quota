/**
 * Admin Page — owner's back office.
 *
 * KPI dashboard: signups, tier breakdown + MRR, pending cancellations,
 * recent signups, and account-sharing signals. Gated to ADMIN_EMAILS;
 * everyone else gets a 404 (never a 403 — the page shouldn't exist for them).
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isAdminEmail } from "@/lib/admin";
import { requireUser } from "@/lib/auth";
import {
  getSignupStats,
  getTierBreakdown,
  getPendingCancellations,
  getRecentSignups,
  getSharingSignals,
} from "@/lib/db/admin-metrics";
import { TIER_LABEL } from "@/lib/subscription";
import type { Tier } from "@/lib/subscription";
import { formatDate } from "@/lib/utils";

// No descriptive metadata title: a static "Admin" <title> would render on the
// notFound() 404 for authenticated non-admins, fingerprinting that /admin
// exists. Inherit the root layout's generic title instead.
export const dynamic = "force-dynamic";

function tierLabel(tier: string): string {
  return TIER_LABEL[tier as Tier] ?? tier;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="eyebrow mb-1">{label}</p>
        <p className="figure text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function AdminPage() {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) notFound();

  const [signups, tiers, cancellations, recent, sharing] = await Promise.all([
    getSignupStats(),
    getTierBreakdown(),
    getPendingCancellations(),
    getRecentSignups(),
    getSharingSignals(),
  ]);

  return (
    <div className="container mx-auto px-4 py-8" data-testid="admin-page">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow mb-1">The back office</p>
          <h1 className="font-display text-4xl font-bold uppercase">Admin</h1>
          <p className="text-muted-foreground">
            Signups, subscriptions, and account health at a glance
          </p>
        </div>
        <Button asChild variant="outline">
          <Link
            href="https://dashboard.stripe.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Revenue &amp; fees → Stripe
            <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total users" value={signups.total} />
        <StatCard label="New (7d)" value={signups.last7} />
        <StatCard label="New (30d)" value={signups.last30} />
        <StatCard label="MRR" value={`$${tiers.mrr}`} />
        <StatCard label="Free" value={tiers.free} />
        <StatCard label="Pro" value={tiers.pro} />
        <StatCard label="Ultimate" value={tiers.ultimate} />
      </div>

      {/* Pending cancellations */}
      <Card className="mb-8" data-testid="pending-cancellations">
        <CardHeader>
          <CardTitle className="font-display uppercase tracking-wide">
            Pending Cancellations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cancellations.length === 0 ? (
            <p className="text-sm text-muted-foreground">None</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-primary text-left">
                    <th className="eyebrow pb-2">Email</th>
                    <th className="eyebrow pb-2">Tier</th>
                    <th className="eyebrow pb-2 text-right">Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {cancellations.map((c) => (
                    <tr key={c.id} className="ledger-row">
                      <td className="py-2">{c.email}</td>
                      <td className="py-2">{tierLabel(c.tier)}</td>
                      <td className="figure py-2 text-right">
                        {c.currentPeriodEnd
                          ? formatDate(c.currentPeriodEnd)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent signups */}
      <Card className="mb-8" data-testid="recent-signups">
        <CardHeader>
          <CardTitle className="font-display uppercase tracking-wide">
            Recent Signups
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">None</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-primary text-left">
                    <th className="eyebrow pb-2">Email</th>
                    <th className="eyebrow pb-2">Tier</th>
                    <th className="eyebrow pb-2">Joined</th>
                    <th className="eyebrow pb-2 text-right">Quotes</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="ledger-row">
                      <td className="py-2">{r.email}</td>
                      <td className="py-2">{tierLabel(r.tier)}</td>
                      <td className="figure py-2">{formatDate(r.createdAt)}</td>
                      <td className="figure py-2 text-right">{r.quoteCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sharing signals */}
      <Card data-testid="sharing-signals">
        <CardHeader>
          <CardTitle className="font-display uppercase tracking-wide">
            Sharing Signals
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Heuristics only — VPNs, mobile networks, and phone+laptop use cause
            false positives. Review before acting.
          </p>
        </CardHeader>
        <CardContent>
          {sharing.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No usage recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-primary text-left">
                    <th className="eyebrow pb-2">Email</th>
                    <th className="eyebrow pb-2">Tier</th>
                    <th className="eyebrow pb-2 text-right">Avg devices/day</th>
                    <th className="eyebrow pb-2 text-right">
                      Concurrent-IP days
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sharing.map((s) => (
                    <tr key={s.userId} className="ledger-row">
                      <td className="py-2">{s.email}</td>
                      <td className="py-2">{tierLabel(s.tier)}</td>
                      <td
                        className={`figure py-2 text-right ${
                          s.avgCombosPerActiveDay >= 4
                            ? "font-semibold text-destructive"
                            : ""
                        }`}
                      >
                        {s.avgCombosPerActiveDay}
                      </td>
                      <td
                        className={`figure py-2 text-right ${
                          s.concurrentIpDays >= 2
                            ? "font-semibold text-destructive"
                            : ""
                        }`}
                      >
                        {s.concurrentIpDays}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
