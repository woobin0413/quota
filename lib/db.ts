/**
 * Database Module - Main Export
 *
 * This is the main entry point for all database operations.
 * It exports organized repositories for users, contacts, and quotes.
 *
 * @module lib/db
 *
 * @example
 * ```typescript
 * import { db, users, contacts, quotes } from '@/lib/db';
 *
 * // Using repositories
 * const user = await users.getUserByAuth0Id(auth0UserId);
 * const contactList = await contacts.getAllContacts(userId);
 * const quote = await quotes.getQuote(quoteId);
 *
 * // Using transactions
 * await db.transaction(async (client) => {
 *   // Atomic operations
 * });
 * ```
 */

// =====================================================
// CORE DATABASE EXPORTS
// =====================================================

export { db, transaction, supabaseAdmin } from "./db/core";
export { getOrCreateUser } from "./db/sync-user";

export type {
  DatabaseError,
  ValidationError,
  NotFoundError,
  QuotaExceededError,
} from "@/types/database";

// =====================================================
// REPOSITORY EXPORTS
// =====================================================

/**
 * User repository
 *
 * Handles user accounts, authentication, and quota management.
 */
import * as usersRepo from "./db/users";
export const users = usersRepo;

/**
 * Contact repository
 *
 * Handles client contacts, search, and analytics.
 */
import * as contactsRepo from "./db/contacts";
export const contacts = contactsRepo;

/**
 * Quote repository
 *
 * Handles quotes, line items, and quote analytics.
 */
import * as quotesRepo from "./db/quotes";
export const quotes = quotesRepo;

/**
 * Work item repository
 *
 * Handles the contractor's configurable work catalog.
 */
import * as workItemsRepo from "./db/work-items";
export const workItems = workItemsRepo;

/**
 * Migration utilities
 *
 * Tools for running database migrations.
 */
import * as migrationsRepo from "./db/migrations";
export const migrations = migrationsRepo;

// =====================================================
// CONVENIENCE RE-EXPORTS
// =====================================================

// User functions
export const {
  getUserByAuth0Id,
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  getQuotaInfo,
  checkQuotaLimit,
  updateQuotaUsage,
  updateSubscription,
  countUserQuotes,
  linkStripeCustomer,
  getUserStats,
} = usersRepo;

// Contact functions
export const {
  getAllContacts,
  getContactById,
  searchContacts,
  getRecentContacts,
  createContact,
  updateContact,
  deleteContact,
  fuzzyMatchContact,
  bulkCreateContacts,
  getContactStats,
  getTopContactsByRevenue,
} = contactsRepo;

// Quote functions
export const {
  getQuote,
  getQuoteWithContact,
  getQuoteComplete,
  getUserQuotes,
  createQuote,
  updateQuote,
  deleteQuote,
  getQuoteLineItems,
  bulkCreateLineItems,
  getQuoteStats,
  getRecentQuotes,
} = quotesRepo;

// Work item functions
export const {
  getWorkItems,
  getWorkItemById,
  createWorkItem,
  updateWorkItem,
  setWorkItemActive,
  bulkCreateWorkItems,
} = workItemsRepo;

// =====================================================
// TYPE EXPORTS
// =====================================================

export type {
  // Row types
  UserRow,
  ContactRow,
  QuoteRow,
  QuoteLineItemRow,
  PaymentRow,
  QuoteActivityRow,
  // Input types
  CreateUserInput,
  UpdateUserInput,
  CreateContactInput,
  UpdateContactInput,
  CreateQuoteInput,
  UpdateQuoteInput,
  CreateLineItemInput,
  UpdateLineItemInput,
  // Output types
  User,
  Contact,
  Quote,
  QuoteLineItem,
  Payment,
  QuoteWithContact,
  QuoteWithItems,
  QuoteComplete,
  // Filter types
  QuoteFilters,
  PaginationParams,
  PaginatedResult,
  QuoteStats,
  QuotaInfo,
  // Enums
  PaymentStatus,
  ActivityAction,
  SubscriptionTier,
} from "@/types/database";

// =====================================================
// DEFAULT EXPORT
// =====================================================

/**
 * Default export for convenient access
 *
 * @example
 * ```typescript
 * import db from '@/lib/db';
 *
 * const user = await db.users.getUserByAuth0Id(auth0UserId);
 * const contacts = await db.contacts.getAllContacts(userId);
 * const quote = await db.quotes.getQuote(quoteId);
 * ```
 */
const db = {
  users: usersRepo,
  contacts: contactsRepo,
  quotes: quotesRepo,
  migrations: migrationsRepo,
};

export default db;
