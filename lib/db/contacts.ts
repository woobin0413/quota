/**
 * Contact Repository
 *
 * Database operations for contact management using Supabase.
 * Includes full-text search, deduplication, and statistics.
 *
 * @module lib/db/contacts
 */

import { supabaseAdmin } from "./core";
import type {
  ContactRow,
  CreateContactInput,
  UpdateContactInput,
  Contact,
  PaginationParams,
  PaginatedResult,
} from "@/types/database";
import { NotFoundError, ValidationError } from "@/types/database";

// =====================================================
// TYPE TRANSFORMERS
// =====================================================

/**
 * Transform database row to Contact object
 */
export function transformContact(row: ContactRow): Contact {
  return {
    ...row,
    totalRevenue: parseFloat(row.total_revenue?.toString() || "0"),
  };
}

// =====================================================
// QUERY FUNCTIONS
// =====================================================

/**
 * Get all contacts for a user
 */
export async function getAllContacts(
  userId: string,
  pagination?: PaginationParams
): Promise<PaginatedResult<Contact>> {
  const {
    limit = 50,
    offset = 0,
    orderBy = "created_at",
    orderDirection = "DESC",
  } = pagination || {};

  // Get total count
  const { count } = await supabaseAdmin
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);

  const total = count || 0;

  // Get contacts
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order(orderBy, { ascending: orderDirection === "ASC" })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  return {
    data: (data || []).map(transformContact),
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}

/**
 * Get contact by ID
 */
export async function getContactById(
  contactId: string,
  userId: string
): Promise<Contact | null> {
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (error && error.code !== "PGRST116") throw error;

  return data ? transformContact(data as ContactRow) : null;
}

/**
 * Search contacts by name, company, or email
 */
export async function searchContacts(
  userId: string,
  searchQuery: string,
  limit = 50
): Promise<Contact[]> {
  if (!searchQuery || searchQuery.trim().length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .or(`name.ilike.%${searchQuery}%,company.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map(transformContact);
}

/**
 * Get recent contacts
 */
export async function getRecentContacts(
  userId: string,
  limit = 10
): Promise<Contact[]> {
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map(transformContact);
}

/**
 * Fuzzy match contact by name (for duplicate detection)
 * Note: This is a simplified version - for full trigram support,
 * you'd need to use Supabase's RPC with a custom function
 */
export async function fuzzyMatchContact(
  userId: string,
  name: string,
  _threshold = 0.3
): Promise<Contact[]> {
  // Simple ILIKE search as fallback since pg_trgm requires RPC
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .ilike("name", `%${name}%`)
    .limit(10);

  if (error) throw error;

  return (data || []).map(transformContact);
}

/**
 * Create a new contact
 */
export async function createContact(
  userId: string,
  data: CreateContactInput
): Promise<Contact> {
  if (!data.name) {
    throw new ValidationError("Name is required", "name");
  }

  if (data.email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(data.email)) {
    throw new ValidationError("Invalid email address format", "email");
  }

  const { data: row, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      user_id: userId,
      name: data.name,
      email: data.email ?? null,
      phone: data.phone ?? null,
      company: data.company ?? null,
      address: data.address ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      zip_code: data.zipCode ?? null,
      country: data.country ?? "USA",
      notes: data.notes ?? null,
      tags: data.tags ?? null,
    })
    .select()
    .single();

  if (error) throw error;

  return transformContact(row as ContactRow);
}

/**
 * Update a contact
 */
export async function updateContact(
  contactId: string,
  userId: string,
  data: UpdateContactInput
): Promise<Contact> {
  if (data.email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(data.email)) {
    throw new ValidationError("Invalid email address format", "email");
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.company !== undefined) updateData.company = data.company;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.state !== undefined) updateData.state = data.state;
  if (data.zipCode !== undefined) updateData.zip_code = data.zipCode;
  if (data.country !== undefined) updateData.country = data.country;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.tags !== undefined) updateData.tags = data.tags;

  const { data: row, error } = await supabaseAdmin
    .from("contacts")
    .update(updateData)
    .eq("id", contactId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new NotFoundError("Contact not found", "Contact", contactId);
    }
    throw error;
  }

  return transformContact(row as ContactRow);
}

/**
 * Soft delete a contact
 */
export async function deleteContact(
  contactId: string,
  userId: string
): Promise<void> {
  await supabaseAdmin
    .from("contacts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("user_id", userId);
}

/**
 * Bulk create contacts
 */
export async function bulkCreateContacts(
  userId: string,
  contacts: CreateContactInput[]
): Promise<Contact[]> {
  if (contacts.length === 0) return [];

  const insertData = contacts.map((contact) => ({
    user_id: userId,
    name: contact.name,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    company: contact.company ?? null,
    address: contact.address ?? null,
    city: contact.city ?? null,
    state: contact.state ?? null,
    zip_code: contact.zipCode ?? null,
    country: contact.country ?? "USA",
    notes: contact.notes ?? null,
    tags: contact.tags ?? null,
  }));

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert(insertData)
    .select();

  if (error) throw error;

  return (data || []).map(transformContact);
}

/**
 * Get contact statistics
 *
 * Reads the denormalized stats columns maintained by the
 * update_contact_stats trigger; accepted_quotes counts paid quotes
 * since migration 003.
 */
export async function getContactStats(
  contactId: string,
  userId: string
): Promise<{
  totalQuotes: number;
  paidQuotes: number;
  totalRevenue: number;
  averageQuoteValue: number;
}> {
  const { data: contact, error } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new NotFoundError("Contact not found", "Contact", contactId);
    }
    throw error;
  }

  const totalRevenue = parseFloat(contact.total_revenue?.toString() || "0");
  const averageQuoteValue =
    contact.accepted_quotes > 0 ? totalRevenue / contact.accepted_quotes : 0;

  return {
    totalQuotes: contact.total_quotes || 0,
    paidQuotes: contact.accepted_quotes || 0,
    totalRevenue,
    averageQuoteValue,
  };
}

/**
 * Get top contacts by revenue
 */
export async function getTopContactsByRevenue(
  userId: string,
  limit = 10
): Promise<Contact[]> {
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gt("total_revenue", 0)
    .order("total_revenue", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map(transformContact);
}

// Re-export Contact type for use in other files
export type { Contact };
