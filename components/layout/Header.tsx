/**
 * Header Component
 *
 * Main navigation header with user info and sign out.
 */

"use client";

import Link from "next/link";
import Image from "next/image";
import { useUser } from "@auth0/nextjs-auth0";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  LogOut,
  Menu,
  X,
  FileText,
  Settings,
  ChevronDown,
  CreditCard,
  BookOpen,
  LifeBuoy,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ProfileSettingsDialog } from "@/components/settings/ProfileSettingsDialog";
import { PlanChip } from "@/components/subscription/PlanChip";
import { useSubscription } from "@/components/subscription/use-subscription";
import { noQuotesLeftTitle } from "@/lib/subscription";
import {
  ONBOARDING_DISMISS_KEYS,
  PROFILE_UPDATED_EVENT,
} from "@/lib/onboarding-keys";

export function Header() {
  const { user, isLoading } = useUser();
  const { sub } = useSubscription();
  const quotaHint =
    sub != null && sub.quotesRemaining === 0 ? noQuotesLeftTitle(sub.tier) : undefined;
  const atQuoteLimit = quotaHint !== undefined;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Company name lives in the app DB (set via Profile Settings), not in
  // the Auth0 session — fetch it once the user is known.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch("/api/profile")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.success) {
          setCompanyName(data.profile.companyName);
          setIsAdmin(Boolean(data.isAdmin));
        }
      })
      .catch(() => {}); // header falls back to name/email
    return () => {
      cancelled = true;
    };
  }, [user]);

  // The first-run dialog can set the business name after that fetch resolved.
  useEffect(() => {
    const onProfileUpdated = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      if (typeof name === "string") setCompanyName(name);
    };
    window.addEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
  }, []);

  const handleSignOut = () => {
    // The onboarding dismissals are keyed per device, not per user: leaving them
    // behind means the next person to sign in on a shared machine never sees
    // the first-run prompts — the catalog one is the app's primary onboarding
    // step, and skipping the profile one sends their first invoice out with a
    // raw email address as the business name.
    // The landing language preference is not session data — it stays.
    try {
      ONBOARDING_DISMISS_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Private-browsing modes can throw on localStorage access. Signing out
      // matters more than clearing a UI flag, so never block the navigation.
    }
    window.location.href = "/auth/logout";
  };

  const isLoaded = !isLoading;

  // Business name first; personal name/email as fallback
  const displayName = companyName || user?.name || user?.email || "User";

  return (
    <header className="sticky top-0 z-50 w-full bg-primary text-primary-foreground">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        {/* Logo + Desktop Navigation (grouped left) */}
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-accent" aria-hidden="true" />
            <span className="font-display text-xl font-bold uppercase tracking-[0.08em]">
              Quota
            </span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            <Link
              href="/dashboard"
              className="border-b-2 border-transparent pb-0.5 font-display text-sm font-semibold uppercase tracking-[0.1em] text-primary-foreground/75 transition-colors hover:border-accent hover:text-primary-foreground"
            >
              Dashboard
            </Link>
            <Link
              href="/dashboard?tab=clients"
              className="border-b-2 border-transparent pb-0.5 font-display text-sm font-semibold uppercase tracking-[0.1em] text-primary-foreground/75 transition-colors hover:border-accent hover:text-primary-foreground"
            >
              Clients
            </Link>
            <Link
              href="/dashboard?tab=catalog"
              className="border-b-2 border-transparent pb-0.5 font-display text-sm font-semibold uppercase tracking-[0.1em] text-primary-foreground/75 transition-colors hover:border-accent hover:text-primary-foreground"
            >
              Work Catalog
            </Link>
            {atQuoteLimit ? (
              <span
                aria-disabled="true"
                title={quotaHint}
                data-testid="new-quote-nav"
                className="cursor-not-allowed border-b-2 border-transparent pb-0.5 font-display text-sm font-semibold uppercase tracking-[0.1em] text-primary-foreground/40"
              >
                New Quote
              </span>
            ) : (
              <Link
                href="/new-quote"
                data-testid="new-quote-nav"
                className="border-b-2 border-transparent pb-0.5 font-display text-sm font-semibold uppercase tracking-[0.1em] text-primary-foreground/75 transition-colors hover:border-accent hover:text-primary-foreground"
              >
                New Quote
              </Link>
            )}
          </nav>
        </div>

        {/* User Menu - Desktop */}
        <div className="hidden items-center gap-3 md:flex">
          {isLoaded && user && (
            <>
              <PlanChip />
              {/* modal={false}: modal menu + modal dialog fight over body
                  pointer-events when the dialog opens from a menu item,
                  leaving the page frozen after the dialog closes */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium outline-none transition-colors hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-primary data-[state=open]:bg-primary-foreground/10"
                  data-testid="user-menu-trigger"
                >
                  {user.picture && (
                    <Image
                      src={user.picture}
                      alt={displayName}
                      width={28}
                      height={28}
                      className="rounded-full ring-1 ring-primary-foreground/30"
                    />
                  )}
                  <span>{displayName}</span>
                  <ChevronDown className="h-4 w-4 text-primary-foreground/60" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <p className="font-medium">{displayName}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setSettingsOpen(true)}
                    className="cursor-pointer"
                    data-testid="menu-profile-settings"
                  >
                    <Settings className="h-4 w-4" aria-hidden="true" />
                    Profile Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="cursor-pointer" data-testid="menu-billing">
                    <Link href="/billing">
                      <CreditCard className="h-4 w-4" aria-hidden="true" />
                      Plan &amp; billing
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="cursor-pointer" data-testid="menu-catalog">
                    <Link href="/dashboard?tab=catalog">
                      <BookOpen className="h-4 w-4" aria-hidden="true" />
                      Work Catalog
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="cursor-pointer" data-testid="menu-help">
                    <Link href="/about">
                      <LifeBuoy className="h-4 w-4" aria-hidden="true" />
                      Help &amp; Contact
                    </Link>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem asChild className="cursor-pointer" data-testid="menu-admin">
                      <Link href="/admin">
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                        Admin
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="cursor-pointer text-destructive focus:text-destructive"
                    data-testid="menu-sign-out"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-primary md:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? (
            <X className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Menu className="h-6 w-6" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="border-t bg-background text-foreground md:hidden">
          <div className="container mx-auto px-4 py-4">
            {isLoaded && user && (
              <div className="mb-4 flex items-center gap-3 border-b pb-4">
                {user.picture && (
                  <Image
                    src={user.picture}
                    alt={displayName}
                    width={40}
                    height={40}
                    className="rounded-full"
                  />
                )}
                <div>
                  <p className="font-medium">{displayName}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>
            )}
            <nav className="flex flex-col gap-2">
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileMenuOpen(false)}
              >
                Dashboard
              </Link>
              <Link
                href="/dashboard?tab=clients"
                className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileMenuOpen(false)}
              >
                Clients
              </Link>
              {atQuoteLimit ? (
                <span
                  aria-disabled="true"
                  title={quotaHint}
                  data-testid="new-quote-nav-mobile"
                  className="cursor-not-allowed rounded-md px-3 py-2 text-sm font-medium text-muted-foreground"
                >
                  New Quote
                </span>
              ) : (
                <Link
                  href="/new-quote"
                  data-testid="new-quote-nav-mobile"
                  className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  New Quote
                </Link>
              )}
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                Profile Settings
              </button>
              <Link
                href="/billing"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileMenuOpen(false)}
              >
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                Plan &amp; billing
              </Link>
              <Link
                href="/dashboard?tab=catalog"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileMenuOpen(false)}
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                Work Catalog
              </Link>
              <Link
                href="/about"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileMenuOpen(false)}
              >
                <LifeBuoy className="h-4 w-4" aria-hidden="true" />
                Help &amp; Contact
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Admin
                </Link>
              )}
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-destructive hover:bg-muted"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign Out
              </button>
            </nav>
          </div>
        </div>
      )}

      <ProfileSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={({ companyName }) => setCompanyName(companyName)}
      />
    </header>
  );
}
