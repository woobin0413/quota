/**
 * Clients API Route
 *
 * GET /api/clients - List clients with their quotes (for the Clients tab)
 *
 * @module api/clients
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";

// Session lookup requires request headers — never statically render
export const dynamic = "force-dynamic";
import { getAllContacts } from "@/lib/db/contacts";
import { getUserQuotes } from "@/lib/db/quotes";
import { logger } from "@/lib/logger";

/**
 * Quotes are fetched in one query and joined to contacts in memory rather than
 * per contact, so the cost is two queries instead of N+1. The tradeoff is this
 * ceiling: past it, some contact's `quotes` array is short. `quotesTruncated`
 * says so out loud — a client that silently renders a partial list is showing
 * a contractor the wrong history.
 */
const QUOTE_FETCH_LIMIT = 500;

/** Defaults preserve the pre-pagination behaviour exactly. */
const listClientsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(200),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export async function GET(request: NextRequest) {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    userId = user.id;

    const { searchParams } = new URL(request.url);
    const validation = listClientsSchema.safeParse({
      limit: searchParams.get("limit") ?? undefined,
      offset: searchParams.get("offset") ?? undefined,
    });

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid query parameters",
          code: "VALIDATION_ERROR",
        },
        { status: 400 }
      );
    }

    const { limit, offset } = validation.data;

    const [contacts, quotes] = await Promise.all([
      getAllContacts(user.id, { limit, offset }),
      getUserQuotes(user.id, {}, { limit: QUOTE_FETCH_LIMIT }),
    ]);

    const quotesByContact = new Map<string, typeof quotes.data>();
    for (const quote of quotes.data) {
      const list = quotesByContact.get(quote.contact_id) ?? [];
      list.push(quote);
      quotesByContact.set(quote.contact_id, list);
    }

    const clients = contacts.data.map((contact) => ({
      ...contact,
      quotes: quotesByContact.get(contact.id) ?? [],
    }));

    return NextResponse.json({
      success: true,
      clients,
      // Additive, and deliberately so: `/api/v1/clients` is a frozen surface, and
      // a caller that cannot distinguish "these are all your clients" from "here
      // are the first 200 of 340" will ship a silent data-loss bug.
      pagination: {
        total: contacts.total,
        limit: contacts.limit,
        offset: contacts.offset,
        hasMore: contacts.hasMore,
      },
      quotesTruncated: quotes.hasMore,
    });
  } catch (error) {
    logger.error("Clients list error", { err: error, route: "GET /api/clients", userId });
    return NextResponse.json(
      { success: false, message: "Failed to load clients", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
