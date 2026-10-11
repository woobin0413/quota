/**
 * Tenant isolation — every repository read/write must filter by user_id.
 *
 * This is the codebase's most consequential rule ("Every DB query scoped by
 * user_id — never trust client-provided ownership") and the app talks to
 * Postgres with the service-role key, so RLS is not a second line of defence:
 * a missing filter is a cross-tenant data leak, not a 403.
 *
 * Rather than assert query text, each repository call runs against a recording
 * stub of the Supabase client and must be shown to have applied
 * .eq("user_id", <caller's id>) — or, for child rows reached through a parent,
 * to have scoped the parent it was resolved from.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

/** Every .eq(column, value) applied since the last reset. */
let eqCalls: [string, unknown][] = [];

/**
 * Chainable stand-in for a PostgREST query builder. Any method returns another
 * builder, and awaiting one yields an empty result — enough for the repos to
 * run far enough to have applied their filters.
 */
function builder(): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
        }
        return (...args: unknown[]) => {
          if (prop === "eq") eqCalls.push([args[0] as string, args[1]]);
          return builder();
        };
      },
    }
  );
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: () => builder(), rpc: () => builder() },
}));

import {
  getQuote,
  getQuoteWithContact,
  getQuoteWithContactByNumber,
  getUserQuotes,
  updateQuote,
  deleteQuote,
  getQuoteLineItems,
  getQuoteStats,
  getRecentQuotes,
  getQuotesByContact,
} from "@/lib/db/quotes";
import {
  getAllContacts,
  getContactById,
  searchContacts,
  getRecentContacts,
  fuzzyMatchContact,
  updateContact,
  deleteContact,
  getContactStats,
} from "@/lib/db/contacts";
import {
  getWorkItems,
  getWorkItemById,
  updateWorkItem,
  setWorkItemActive,
} from "@/lib/db/work-items";

const USER = "user-under-test";
const OTHER = "someone-else";

beforeEach(() => {
  eqCalls = [];
});

/** Repository calls that must never cross a tenant boundary. */
const scopedCalls: [string, () => Promise<unknown>][] = [
  ["quotes.getQuote", () => getQuote("q1", USER)],
  ["quotes.getQuoteWithContact", () => getQuoteWithContact("q1", USER)],
  ["quotes.getQuoteWithContactByNumber", () => getQuoteWithContactByNumber("Q-2026-001", USER)],
  ["quotes.getUserQuotes", () => getUserQuotes(USER)],
  ["quotes.updateQuote", () => updateQuote("q1", USER, { projectName: "x" })],
  ["quotes.deleteQuote", () => deleteQuote("q1", USER)],
  ["quotes.getQuoteLineItems", () => getQuoteLineItems("q1", USER)],
  ["quotes.getQuoteStats", () => getQuoteStats(USER)],
  ["quotes.getRecentQuotes", () => getRecentQuotes(USER)],
  ["quotes.getQuotesByContact", () => getQuotesByContact(USER, "c1")],
  ["contacts.getAllContacts", () => getAllContacts(USER)],
  ["contacts.getContactById", () => getContactById("c1", USER)],
  ["contacts.searchContacts", () => searchContacts(USER, "ramirez")],
  ["contacts.getRecentContacts", () => getRecentContacts(USER)],
  ["contacts.fuzzyMatchContact", () => fuzzyMatchContact(USER, "Ramirez")],
  ["contacts.updateContact", () => updateContact("c1", USER, { name: "x" })],
  ["contacts.deleteContact", () => deleteContact("c1", USER)],
  ["contacts.getContactStats", () => getContactStats("c1", USER)],
  ["work-items.getWorkItems", () => getWorkItems(USER)],
  ["work-items.getWorkItemById", () => getWorkItemById(USER, "w1")],
  ["work-items.updateWorkItem", () => updateWorkItem(USER, "w1", { name: "x" })],
  ["work-items.setWorkItemActive", () => setWorkItemActive(USER, "w1", false)],
];

/**
 * Child tables are filtered through their parent — quote_line_items reaches
 * ownership as `quotes.user_id` on an inner join — so match either shape.
 */
const isOwnershipFilter = (column: string) =>
  column === "user_id" || column.endsWith(".user_id");

describe("repository tenant scoping", () => {
  it.each(scopedCalls)("%s filters on the caller's user_id", async (_name, run) => {
    // Domain-level failures (empty stub rows, NotFoundError) are irrelevant —
    // the filters have already been applied by the time they surface.
    await run().catch(() => undefined);

    const userFilters = eqCalls.filter(([column]) => isOwnershipFilter(column));
    expect(userFilters.length).toBeGreaterThan(0);
    for (const [, value] of userFilters) expect(value).toBe(USER);
    for (const [column] of eqCalls) {
      if (isOwnershipFilter(column)) expect(eqCalls).not.toContainEqual([column, OTHER]);
    }
  });
});

describe("getQuote's optional userId", () => {
  // getQuote(quoteId, userId?) is the one repository call that can run
  // unscoped. Callers in API routes must always pass the session user; this
  // pins the footgun so it cannot be widened silently.
  it("scopes when a user is supplied", async () => {
    await getQuote("q1", USER).catch(() => undefined);
    expect(eqCalls).toContainEqual(["user_id", USER]);
  });

  it("applies no user filter when the argument is omitted", async () => {
    await getQuote("q1").catch(() => undefined);
    expect(eqCalls.filter(([column]) => column === "user_id")).toHaveLength(0);
  });
});
