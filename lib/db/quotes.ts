/**
 * Quote Repository
 *
 * Database operations for quote management using Supabase.
 * Includes line items, status tracking, and analytics.
 *
 * @module lib/db/quotes
 */

import { supabaseAdmin } from "./core";
import type {
  QuoteRow,
  QuoteLineItemRow,
  CreateQuoteInput,
  UpdateQuoteInput,
  CreateLineItemInput,
  Quote,
  QuoteLineItem,
  QuoteWithContact,
  QuoteComplete,
  QuoteFilters,
  PaginationParams,
  PaginatedResult,
  QuoteStats,
  ContactRow,
} from "@/types/database";
import { NotFoundError, ValidationError } from "@/types/database";
import { resolveTier, type Tier } from "@/lib/subscription";
import { transformContact } from "./contacts";

// =====================================================
// TYPE TRANSFORMERS
// =====================================================

/**
 * Transform database row to Quote object
 */
function transformQuote(row: QuoteRow): Quote {
  return {
    ...row,
    subtotal: parseFloat(row.subtotal?.toString() || "0"),
    taxRate: parseFloat(row.tax_rate?.toString() || "0"),
    taxAmount: parseFloat(row.tax_amount?.toString() || "0"),
    discountAmount: parseFloat(row.discount_amount?.toString() || "0"),
    total: parseFloat(row.total?.toString() || "0"),
    amount_paid: parseFloat(row.amount_paid?.toString() || "0"),
  };
}

/**
 * Transform database row to QuoteLineItem object
 */
function transformLineItem(row: QuoteLineItemRow): QuoteLineItem {
  return {
    ...row,
    quantity: parseFloat(row.quantity?.toString() || "0"),
    unitPrice: parseFloat(row.unit_price?.toString() || "0"),
    total: parseFloat(row.total?.toString() || "0"),
  };
}

// =====================================================
// QUOTE QUERIES
// =====================================================

/**
 * Get quote by ID
 */
export async function getQuote(
  quoteId: string,
  userId?: string
): Promise<Quote | null> {
  let query = supabaseAdmin
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .is("deleted_at", null);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.single();

  if (error && error.code !== "PGRST116") throw error;

  return data ? transformQuote(data as QuoteRow) : null;
}

/**
 * Get quote with contact information
 */
export async function getQuoteWithContact(
  quoteId: string,
  userId: string
): Promise<QuoteWithContact | null> {
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select(
      `
      *,
      contacts (*)
    `
    )
    .eq("id", quoteId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  if (!data) return null;

  const quote = transformQuote(data as QuoteRow);
  return {
    ...quote,
    contact: transformContact(data.contacts as ContactRow),
  };
}

/**
 * Get quote (with contact) by its human-readable quote number (e.g. Q-2026-001).
 * Still scoped by user_id so a number owned by another user resolves to null.
 */
export async function getQuoteWithContactByNumber(
  quoteNumber: string,
  userId: string
): Promise<QuoteWithContact | null> {
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select(
      `
      *,
      contacts (*)
    `
    )
    .eq("quote_number", quoteNumber)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  if (!data) return null;

  const quote = transformQuote(data as QuoteRow);
  return {
    ...quote,
    contact: transformContact(data.contacts as ContactRow),
  };
}

/**
 * Get complete quote with all relations
 */
export async function getQuoteComplete(
  quoteId: string,
  userId: string
): Promise<QuoteComplete | null> {
  const quote = await getQuote(quoteId, userId);
  if (!quote) return null;

  // Relations are independent of each other — fetch in parallel
  const [
    { data: contact, error: contactError },
    lineItems,
    { data: activity },
    { data: payments },
  ] = await Promise.all([
    supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("id", quote.contact_id)
      .single(),
    getQuoteLineItems(quoteId, userId),
    supabaseAdmin
      .from("quote_activity")
      .select("*")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("payments")
      .select("*")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false }),
  ]);

  if (contactError) throw contactError;

  return {
    ...quote,
    contact: transformContact(contact as ContactRow),
    lineItems,
    activity: activity || [],
    payments: (payments || []).map((p) => ({
      ...p,
      amount: parseFloat(p.amount?.toString() || "0"),
    })),
  };
}

/**
 * Get user's quotes with filters
 */
export async function getUserQuotes(
  userId: string,
  filters?: QuoteFilters,
  pagination?: PaginationParams
): Promise<PaginatedResult<QuoteWithContact>> {
  const {
    limit = 50,
    offset = 0,
    orderBy = "created_at",
    orderDirection = "DESC",
  } = pagination || {};

  // Build query for count
  let countQuery = supabaseAdmin
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);

  // Build query for data
  let dataQuery = supabaseAdmin
    .from("quotes")
    .select(
      `
      *,
      contacts (name, email, company, phone)
    `
    )
    .eq("user_id", userId)
    .is("deleted_at", null);

  // Apply filters
  if (filters?.contactId) {
    countQuery = countQuery.eq("contact_id", filters.contactId);
    dataQuery = dataQuery.eq("contact_id", filters.contactId);
  }

  if (filters?.dateFrom) {
    countQuery = countQuery.gte("created_at", filters.dateFrom.toISOString());
    dataQuery = dataQuery.gte("created_at", filters.dateFrom.toISOString());
  }

  if (filters?.dateTo) {
    countQuery = countQuery.lte("created_at", filters.dateTo.toISOString());
    dataQuery = dataQuery.lte("created_at", filters.dateTo.toISOString());
  }

  if (filters?.minAmount !== undefined) {
    countQuery = countQuery.gte("total", filters.minAmount);
    dataQuery = dataQuery.gte("total", filters.minAmount);
  }

  if (filters?.maxAmount !== undefined) {
    countQuery = countQuery.lte("total", filters.maxAmount);
    dataQuery = dataQuery.lte("total", filters.maxAmount);
  }

  if (filters?.search) {
    countQuery = countQuery.ilike("project_name", `%${filters.search}%`);
    dataQuery = dataQuery.ilike("project_name", `%${filters.search}%`);
  }

  // Get count
  const { count } = await countQuery;
  const total = count || 0;

  // Get data with ordering and pagination
  const { data, error } = await dataQuery
    .order(orderBy, { ascending: orderDirection === "ASC" })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const quotes = (data || []).map((row) => ({
    ...transformQuote(row as QuoteRow),
    contact: {
      name: row.contacts?.name || "",
      email: row.contacts?.email || "",
      company: row.contacts?.company || "",
      phone: row.contacts?.phone || "",
    },
  })) as QuoteWithContact[];

  return {
    data: quotes,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}

/**
 * Create a new quote
 */
export async function createQuote(
  userId: string,
  data: CreateQuoteInput
): Promise<Quote> {
  if (!data.contactId || !data.projectName) {
    throw new ValidationError(
      "contactId and projectName are required",
      "contactId"
    );
  }

  const { data: row, error } = await supabaseAdmin
    .from("quotes")
    .insert({
      user_id: userId,
      contact_id: data.contactId,
      project_name: data.projectName,
      description: data.description ?? null,
      tax_rate: data.taxRate ?? 0,
      discount_amount: data.discountAmount ?? 0,
      valid_until: data.validUntil ?? null,
      terms_and_conditions: data.termsAndConditions ?? null,
      notes: data.notes ?? null,
      internal_notes: data.internalNotes ?? null,
    })
    .select()
    .single();

  if (error) throw error;

  return transformQuote(row as QuoteRow);
}

export interface AtomicQuoteCreateInput {
  clientId?: string;
  clientInfo: {
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  projectName: string;
  discountAmount: number;
  notes?: string;
  internalNotes?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    unit?: string;
    workItemId?: string;
  }>;
}

export type AtomicQuoteCreateResult =
  | {
      kind: "created";
      quote: { id: string; quote_number: string };
    }
  | {
      kind: "quotaExceeded";
      tier: Tier;
      limit: number;
    };

interface AtomicQuoteCreateRow {
  quote_id: string | null;
  quote_number: string | null;
  quota_exceeded: boolean;
  resolved_tier: string;
  quote_limit: number | null;
}

/**
 * Create a quote and every dependent row in one PostgreSQL transaction.
 * The RPC locks the owning user while checking quota, so concurrent requests
 * cannot both pass the final limit check.
 */
export async function createQuoteAtomic(
  userId: string,
  input: AtomicQuoteCreateInput
): Promise<AtomicQuoteCreateResult> {
  const { data, error } = await supabaseAdmin.rpc("create_quote_atomic", {
    p_user_id: userId,
    p_client_id: input.clientId ?? null,
    p_client_info: input.clientInfo,
    p_project_name: input.projectName,
    p_discount_amount: input.discountAmount,
    p_notes: input.notes ?? null,
    p_internal_notes: input.internalNotes ?? null,
    p_line_items: input.lineItems,
  });

  if (error) {
    if (error.message?.includes("CONTACT_NOT_FOUND")) {
      throw new NotFoundError("Client not found", "Contact", input.clientId);
    }
    throw error;
  }

  const row = (data as AtomicQuoteCreateRow[] | null)?.[0];
  if (!row) throw new Error("Quote creation returned no result");

  if (row.quota_exceeded) {
    if (row.quote_limit === null) {
      throw new Error("Quota rejection returned no limit");
    }
    return {
      kind: "quotaExceeded",
      tier: resolveTier(row.resolved_tier),
      limit: row.quote_limit,
    };
  }

  if (!row.quote_id || !row.quote_number) {
    throw new Error("Quote creation returned an incomplete result");
  }

  return {
    kind: "created",
    quote: { id: row.quote_id, quote_number: row.quote_number },
  };
}

/**
 * Update a quote
 */
export async function updateQuote(
  quoteId: string,
  userId: string,
  data: UpdateQuoteInput
): Promise<Quote> {
  const updateData: Record<string, unknown> = {};

  if (data.contactId !== undefined) updateData.contact_id = data.contactId;
  if (data.projectName !== undefined)
    updateData.project_name = data.projectName;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.taxRate !== undefined) updateData.tax_rate = data.taxRate;
  if (data.discountAmount !== undefined)
    updateData.discount_amount = data.discountAmount;
  if (data.validUntil !== undefined) updateData.valid_until = data.validUntil;
  if (data.termsAndConditions !== undefined)
    updateData.terms_and_conditions = data.termsAndConditions;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.internalNotes !== undefined)
    updateData.internal_notes = data.internalNotes;
  if (data.recipientEmail !== undefined)
    updateData.recipient_email = data.recipientEmail;

  // The totals trigger only fires on line-item changes, so recompute
  // tax_amount/total here when tax rate or discount change on their own
  // (same formula as calculate_quote_totals in the DB).
  if (data.taxRate !== undefined || data.discountAmount !== undefined) {
    const current = await getQuote(quoteId, userId);
    if (!current) {
      throw new NotFoundError("Quote not found", "Quote", quoteId);
    }
    const taxRate = data.taxRate ?? current.taxRate;
    const discount = data.discountAmount ?? current.discountAmount;
    const taxAmount = Math.round(current.subtotal * taxRate) / 100;
    updateData.tax_amount = taxAmount;
    const newTotal = Math.max(0, current.subtotal + taxAmount - discount);
    updateData.total = newTotal;
    // total moved → derived paid state must move with it (the trigger
    // only fires on quote_payments / line-item changes)
    updateData.is_paid = current.amount_paid >= newTotal && newTotal > 0;
    updateData.paid_at =
      current.amount_paid >= newTotal && newTotal > 0
        ? (current.paid_at ?? new Date().toISOString())
        : null;
  }

  const { data: row, error } = await supabaseAdmin
    .from("quotes")
    .update(updateData)
    .eq("id", quoteId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new NotFoundError("Quote not found", "Quote", quoteId);
    }
    throw error;
  }

  return transformQuote(row as QuoteRow);
}

/**
 * Soft delete a quote
 */
export async function deleteQuote(
  quoteId: string,
  userId: string
): Promise<void> {
  await supabaseAdmin
    .from("quotes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("user_id", userId);
}

// =====================================================
// LINE ITEM QUERIES
// =====================================================

/**
 * Get all line items for a quote (user-scoped via the owning quote)
 */
export async function getQuoteLineItems(
  quoteId: string,
  userId: string
): Promise<QuoteLineItem[]> {
  const { data, error } = await supabaseAdmin
    .from("quote_line_items")
    .select("*, quotes!inner(user_id)")
    .eq("quote_id", quoteId)
    .eq("quotes.user_id", userId)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => transformLineItem(row as QuoteLineItemRow));
}

/**
 * Bulk create line items for a quote
 */
export async function bulkCreateLineItems(
  quoteId: string,
  items: CreateLineItemInput[]
): Promise<QuoteLineItem[]> {
  if (items.length === 0) return [];

  const insertData = items.map((item, index) => ({
    quote_id: quoteId,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total: item.quantity * item.unitPrice,
    unit_of_measure: item.unitOfMeasure ?? null,
    category: item.category ?? null,
    sku: item.sku ?? null,
    work_item_id: item.workItemId ?? null,
    sort_order: item.sortOrder ?? index,
  }));

  const { data, error } = await supabaseAdmin
    .from("quote_line_items")
    .insert(insertData)
    .select();

  if (error) throw error;

  return (data || []).map(transformLineItem);
}

// =====================================================
// ANALYTICS
// =====================================================

/**
 * Get quote statistics for a user
 */
export async function getQuoteStats(userId: string): Promise<QuoteStats> {
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("is_paid, total")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;

  const quotes = data || [];
  const paidQuotes = quotes.filter((q) => q.is_paid);

  return {
    total: quotes.length,
    unpaid: quotes.length - paidQuotes.length,
    paid: paidQuotes.length,
    totalRevenue: paidQuotes.reduce(
      (sum, q) => sum + parseFloat(q.total?.toString() || "0"),
      0
    ),
  };
}

/**
 * Get recent quotes
 */
export async function getRecentQuotes(
  userId: string,
  limit = 10
): Promise<Quote[]> {
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map(transformQuote);
}

/**
 * Get all quotes for a specific contact (user-scoped)
 */
export async function getQuotesByContact(
  userId: string,
  contactId: string
): Promise<Quote[]> {
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("*")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((row) => transformQuote(row as QuoteRow));
}

// =====================================================
// EXPORT ALIASES
// =====================================================

export const getQuoteById = getQuote;
