/**
 * Owner KPI queries (read-only, service-role). Small-scale by design —
 * aggregates in JS; revisit if user count makes this slow.
 */

import { supabaseAdmin } from "@/lib/db/core";

export interface SignupStats {
  total: number;
  last7: number;
  last30: number;
}

export async function getSignupStats(): Promise<SignupStats> {
  const since = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString();
  const base = () =>
    supabaseAdmin.from("users").select("id", { count: "exact", head: true }).is("deleted_at", null);

  const [{ count: total }, { count: last7 }, { count: last30 }] = await Promise.all([
    base(),
    base().gte("created_at", since(7)),
    base().gte("created_at", since(30)),
  ]);
  return { total: total ?? 0, last7: last7 ?? 0, last30: last30 ?? 0 };
}

export interface TierBreakdown {
  free: number;
  pro: number;
  ultimate: number;
  mrr: number;
}

export async function getTierBreakdown(): Promise<TierBreakdown> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("subscription_tier")
    .is("deleted_at", null);
  if (error) throw error;

  const counts = { free: 0, pro: 0, ultimate: 0 };
  for (const row of data ?? []) {
    const t = row.subscription_tier as keyof typeof counts;
    if (t in counts) counts[t]++;
  }
  return { ...counts, mrr: counts.pro * 15 + counts.ultimate * 29 };
}

export interface PendingCancellation {
  id: string;
  email: string;
  tier: string;
  currentPeriodEnd: string | null;
}

export async function getPendingCancellations(): Promise<PendingCancellation[]> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, email, subscription_tier, current_period_end")
    .eq("cancel_at_period_end", true)
    .is("deleted_at", null)
    .order("current_period_end", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    tier: r.subscription_tier,
    currentPeriodEnd: r.current_period_end,
  }));
}

export interface RecentSignup {
  id: string;
  email: string;
  tier: string;
  createdAt: string;
  quoteCount: number;
}

export async function getRecentSignups(limit = 20): Promise<RecentSignup[]> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, email, subscription_tier, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const users = data ?? [];
  const counts = await Promise.all(
    users.map(async (u) => {
      const { count } = await supabaseAdmin
        .from("quotes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", u.id)
        .is("deleted_at", null);
      return count ?? 0;
    })
  );
  return users.map((u, i) => ({
    id: u.id,
    email: u.email,
    tier: u.subscription_tier,
    createdAt: u.created_at,
    quoteCount: counts[i],
  }));
}

export interface SharingSignal {
  userId: string;
  email: string;
  tier: string;
  avgCombosPerActiveDay: number;
  concurrentIpDays: number;
}

/** Last-7-days sharing signals, strongest first. */
export async function getSharingSignals(): Promise<SharingSignal[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("usage_sessions")
    .select("user_id, ip, ua_hash, day")
    .gte("day", since);
  if (error) throw error;

  // Aggregate per user: combos per day, distinct IPs per day
  const byUserDay = new Map<string, Map<string, { combos: Set<string>; ips: Set<string> }>>();
  for (const row of data ?? []) {
    let days = byUserDay.get(row.user_id);
    if (!days) byUserDay.set(row.user_id, (days = new Map()));
    let d = days.get(row.day);
    if (!d) days.set(row.day, (d = { combos: new Set(), ips: new Set() }));
    d.combos.add(`${row.ip}|${row.ua_hash}`);
    d.ips.add(row.ip);
  }
  if (byUserDay.size === 0) return [];

  const userIds = [...byUserDay.keys()];
  const { data: users, error: uErr } = await supabaseAdmin
    .from("users")
    .select("id, email, subscription_tier")
    .in("id", userIds);
  if (uErr) throw uErr;
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  const signals: SharingSignal[] = [];
  for (const [userId, days] of byUserDay) {
    const u = userById.get(userId);
    if (!u) continue;
    let comboSum = 0;
    let concurrentIpDays = 0;
    for (const d of days.values()) {
      comboSum += d.combos.size;
      if (d.ips.size >= 2) concurrentIpDays++;
    }
    signals.push({
      userId,
      email: u.email,
      tier: u.subscription_tier,
      avgCombosPerActiveDay: Math.round((comboSum / days.size) * 10) / 10,
      concurrentIpDays,
    });
  }
  // Strongest signal first: concurrent-IP days, then combo average
  signals.sort(
    (a, b) =>
      b.concurrentIpDays - a.concurrentIpDays ||
      b.avgCombosPerActiveDay - a.avgCombosPerActiveDay
  );
  return signals;
}
