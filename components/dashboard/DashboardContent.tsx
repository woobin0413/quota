/**
 * DashboardContent Component
 *
 * Client component that displays quote stats and recent quotes.
 * Fetches data from /api/quotes and displays in a responsive grid.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QuotaBadge } from "@/components/subscription/QuotaBadge";
import { NewQuoteButton } from "@/components/quote/NewQuoteButton";
import {
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  Plus,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// =====================================================
// TYPES
// =====================================================

interface QuoteStats {
  total: number;
  unpaid: number;
  paid: number;
  totalRevenue: number; // sum of totals of paid quotes
}

interface QuoteWithContact {
  id: string;
  quote_number: string;
  project_name: string;
  is_paid: boolean;
  total: number;
  created_at: string;
  contact: {
    name: string;
    email?: string;
    company?: string;
  };
}

interface DashboardData {
  data: QuoteWithContact[];
  stats: QuoteStats;
  pagination: {
    total: number;
    hasMore: boolean;
  };
}

// =====================================================
// HELPERS
// =====================================================

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// =====================================================
// COMPONENT
// =====================================================

export function DashboardContent() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const response = await fetch("/api/quotes?limit=10");

        if (!response.ok) {
          throw new Error("Failed to fetch quotes");
        }

        const result = await response.json();
        setData(result);
      } catch (err) {
        console.error("Dashboard fetch error:", err);
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  // Loading state
  if (isLoading) {
    return <DashboardSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <XCircle className="h-12 w-12 text-destructive" />
          <p className="text-center text-muted-foreground">{error}</p>
          <Button onClick={() => window.location.reload()}>Try Again</Button>
        </CardContent>
      </Card>
    );
  }

  const stats = data?.stats;
  const quotes = data?.data || [];

  return (
    <div className="space-y-8">
      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Quotes"
          value={stats?.total || 0}
          icon={FileText}
          description="All quotes"
        />
        <StatCard
          title="Revenue"
          value={formatCurrency(stats?.totalRevenue || 0)}
          icon={DollarSign}
          description={`${stats?.paid || 0} paid`}
          highlight
        />
        <StatCard
          title="Unpaid"
          value={stats?.unpaid || 0}
          icon={Clock}
          description="Awaiting payment"
        />
        <StatCard
          title="Paid"
          value={stats?.paid || 0}
          icon={CheckCircle}
          description="Payment received"
        />
      </div>

      {/* Recent Quotes */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Quotes</CardTitle>
            <CardDescription>
              Your latest quotes and their payment status
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <QuotaBadge />
            <NewQuoteButton size="sm" />
          </div>
        </CardHeader>
        <CardContent>
          {quotes.length === 0 ? (
            <EmptyState />
          ) : (
            <div>
              <div className="divide-y overflow-hidden rounded-lg border">
                {quotes.map((quote) => (
                  <QuoteRow key={quote.id} quote={quote} />
                ))}
              </div>

              {data?.pagination.hasMore && (
                <div className="flex justify-center pt-4">
                  <Button variant="outline" asChild>
                    <Link href="/quotes">
                      View All Quotes
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================
// SUB-COMPONENTS
// =====================================================

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  highlight,
}: {
  title: string;
  value: string | number;
  icon: typeof FileText;
  description: string;
  highlight?: boolean;
}) {
  return (
    <Card className={cn(highlight && "border-primary")}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="eyebrow">{title}</p>
            <p className={cn("figure text-2xl font-semibold", highlight && "text-success")}>
              {value}
            </p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <div className={cn(
            "flex h-12 w-12 items-center justify-center rounded-sm",
            highlight ? "bg-success/10" : "bg-muted"
          )}>
            <Icon className={cn("h-6 w-6", highlight ? "text-success" : "text-muted-foreground")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuoteRow({ quote }: { quote: QuoteWithContact }) {
  const config = quote.is_paid
    ? { label: "Paid", stamp: "stamp-paid", icon: CheckCircle }
    : { label: "Unpaid", stamp: "stamp-unpaid", icon: FileText };
  const StatusIcon = config.icon;

  return (
    <Link
      href={`/quote/${quote.quote_number}`}
      className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center gap-4">
        <div className="hidden h-10 w-10 items-center justify-center rounded-full bg-muted sm:flex">
          <StatusIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">{quote.project_name}</p>
          <p className="text-sm text-muted-foreground">
            {quote.contact.name}
            {quote.contact.company && ` • ${quote.contact.company}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="figure font-medium">{formatCurrency(quote.total)}</p>
          <p className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(quote.created_at), { addSuffix: true })}
          </p>
        </div>
        <span className={`stamp ${config.stamp}`}>{config.label}</span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
        <FileText className="h-10 w-10 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">No quotes yet</h3>
        <p className="text-muted-foreground">
          Create your first quote to get started
        </p>
      </div>
      <Button asChild>
        <Link href="/new-quote">
          <Plus className="mr-2 h-4 w-4" />
          Create Your First Quote
        </Link>
      </Button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      {/* Stats skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-12 w-12 rounded-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quotes skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="space-y-2 text-right">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
