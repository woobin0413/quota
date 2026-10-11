/**
 * Database Type Definitions
 *
 * This file contains all TypeScript types for database operations.
 * Types are organized by entity and include Input/Output variants.
 */

// =====================================================
// ENUMS & LITERAL TYPES
// =====================================================

export type PaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "refunded" | "canceled";
export type ActivityAction = "created" | "updated" | "sent" | "viewed" | "accepted" | "rejected" | "expired" | "deleted" | "restored";
export type SubscriptionTier = "free" | "pro" | "ultimate";

// =====================================================
// DATABASE ROW TYPES (snake_case - matches DB)
// =====================================================

/**
 * User account from database
 */
export interface UserRow {
  id: string;
  auth0_user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  subscription_tier: SubscriptionTier;
  subscription_status: string;
  stripe_customer_id: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  monthly_quote_limit: number;
  quotes_this_month: number;
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
  deleted_at: Date | null;
}

/**
 * Contact from database
 */
export interface ContactRow {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string;
  notes: string | null;
  tags: string[] | null;
  total_quotes: number;
  accepted_quotes: number;
  total_revenue: string; // DECIMAL comes as string
  last_quote_date: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * Quote from database
 */
export interface QuoteRow {
  id: string;
  user_id: string;
  contact_id: string;
  quote_number: string;
  version: number;
  parent_quote_id: string | null;
  project_name: string;
  description: string | null;
  subtotal: string; // DECIMAL comes as string
  tax_rate: string; // DECIMAL comes as string
  tax_amount: string; // DECIMAL comes as string
  discount_amount: string; // DECIMAL comes as string
  total: string; // DECIMAL comes as string
  valid_until: Date | null;
  sent_at: Date | null;
  terms_and_conditions: string | null;
  notes: string | null;
  internal_notes: string | null;
  is_paid: boolean;
  paid_at: Date | null;
  amount_paid: number | string;
  recipient_email: string | null;
  email_sent_count: number;
  last_email_sent_at: Date | null;
  receipt_sent_at: Date | null;
  receipt_sent_count: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * Quote line item from database
 */
export interface QuoteLineItemRow {
  id: string;
  quote_id: string;
  description: string;
  quantity: string; // DECIMAL comes as string
  unit_price: string; // DECIMAL comes as string
  total: string; // DECIMAL comes as string
  unit_of_measure: string | null;
  category: string | null;
  sku: string | null;
  work_item_id: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Work catalog item from database
 */
export interface WorkItemRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  unit_of_measure: string;
  default_unit_price: string; // DECIMAL comes as string
  category: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Payment status change (manual paid/unpaid toggle history)
 */
export interface PaymentStatusChangeRow {
  id: string;
  quote_id: string;
  user_id: string;
  is_paid: boolean;
  note: string | null;
  created_at: Date;
}

// =====================================================
// SPLIT PAYMENTS (payment_milestones / quote_payments)
// =====================================================

export interface PaymentMilestoneRow {
  id: string;
  quote_id: string;
  user_id: string;
  name: string;
  percentage: number | string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentMilestone {
  id: string;
  quote_id: string;
  user_id: string;
  name: string;
  percentage: number;
  sort_order: number;
}

export type PaymentMethod = "cash" | "check" | "zelle" | "other";

export interface QuotePaymentRow {
  id: string;
  quote_id: string;
  milestone_id: string;
  user_id: string;
  amount: number | string;
  paid_at: string;
  method: PaymentMethod | null;
  note: string | null;
  receipt_sent_at: Date | null;
  receipt_sent_count: number;
  created_at: Date;
}

export interface QuotePayment {
  id: string;
  quote_id: string;
  milestone_id: string;
  user_id: string;
  amount: number;
  paid_at: string; // ISO date (yyyy-mm-dd)
  method: PaymentMethod | null;
  note: string | null;
  receipt_sent_at: Date | null;
  receipt_sent_count: number;
  created_at: Date;
}

/**
 * Payment from database
 */
export interface PaymentRow {
  id: string;
  quote_id: string;
  user_id: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  amount: string; // DECIMAL comes as string
  currency: string;
  status: PaymentStatus;
  payment_method_type: string | null;
  last_four: string | null;
  processed_at: Date | null;
  failed_at: Date | null;
  refunded_at: Date | null;
  failure_reason: string | null;
  stripe_metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Quote activity from database
 */
export interface QuoteActivityRow {
  id: string;
  quote_id: string;
  user_id: string | null;
  action: ActivityAction;
  description: string | null;
  changes: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

// =====================================================
// INPUT TYPES (for create/update operations)
// =====================================================

/**
 * Input for creating a new user
 */
export interface CreateUserInput {
  auth0UserId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  avatarUrl?: string;
}

/**
 * Input for updating a user
 */
export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  avatarUrl?: string;
  settings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Input for creating a contact
 */
export interface CreateContactInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  notes?: string;
  tags?: string[];
}

/**
 * Input for updating a contact
 */
export interface UpdateContactInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  notes?: string;
  tags?: string[];
}

/**
 * Input for creating a quote
 */
export interface CreateQuoteInput {
  contactId: string;
  projectName: string;
  description?: string;
  taxRate?: number;
  discountAmount?: number;
  validUntil?: Date;
  termsAndConditions?: string;
  notes?: string;
  internalNotes?: string;
}

/**
 * Input for updating a quote
 */
export interface UpdateQuoteInput {
  contactId?: string;
  projectName?: string;
  description?: string;
  taxRate?: number;
  discountAmount?: number;
  validUntil?: Date;
  termsAndConditions?: string;
  notes?: string;
  internalNotes?: string;
  recipientEmail?: string;
}

/**
 * Input for creating a quote line item
 */
export interface CreateLineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  unitOfMeasure?: string;
  category?: string;
  sku?: string;
  workItemId?: string;
  sortOrder?: number;
}

/**
 * Input for creating a work catalog item
 */
export interface CreateWorkItemInput {
  name: string;
  description?: string;
  unitOfMeasure?: string;
  defaultUnitPrice: number;
  category?: string;
  sortOrder?: number;
}

/**
 * Input for updating a work catalog item
 */
export interface UpdateWorkItemInput {
  name?: string;
  description?: string;
  unitOfMeasure?: string;
  defaultUnitPrice?: number;
  category?: string;
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * Input for updating a line item
 */
export interface UpdateLineItemInput {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  unitOfMeasure?: string;
  category?: string;
  sku?: string;
  sortOrder?: number;
}

// =====================================================
// OUTPUT TYPES (with computed fields)
// =====================================================

/**
 * User with computed full name
 */
export interface User extends Omit<UserRow, 'deleted_at'> {
  fullName: string;
}

/**
 * Contact with parsed revenue
 */
export interface Contact extends Omit<ContactRow, 'total_revenue' | 'deleted_at'> {
  totalRevenue: number;
}

/**
 * Quote with parsed financial values
 */
export interface Quote extends Omit<QuoteRow, 'subtotal' | 'tax_rate' | 'tax_amount' | 'discount_amount' | 'total' | 'amount_paid' | 'deleted_at'> {
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  amount_paid: number;
}

/**
 * Quote line item with parsed values
 */
export interface QuoteLineItem extends Omit<QuoteLineItemRow, 'quantity' | 'unit_price' | 'total'> {
  quantity: number;
  unitPrice: number;
  total: number;
}

/**
 * Work catalog item with parsed price
 */
export interface WorkItem extends Omit<WorkItemRow, 'default_unit_price'> {
  defaultUnitPrice: number;
}

/**
 * Payment status change entry
 */
export type PaymentStatusChange = PaymentStatusChangeRow;

/**
 * Payment with parsed amount
 */
export interface Payment extends Omit<PaymentRow, 'amount'> {
  amount: number;
}

/**
 * Quote with contact information
 */
export interface QuoteWithContact extends Quote {
  contact: Contact;
}

/**
 * Quote with line items
 */
export interface QuoteWithItems extends Quote {
  lineItems: QuoteLineItem[];
}

/**
 * Complete quote with all relations
 */
export interface QuoteComplete extends Quote {
  contact: Contact;
  lineItems: QuoteLineItem[];
  activity?: QuoteActivityRow[];
  payments?: Payment[];
}

// =====================================================
// FILTER & QUERY TYPES
// =====================================================

/**
 * Filters for querying quotes
 */
export interface QuoteFilters {
  contactId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Quote statistics
 */
export interface QuoteStats {
  total: number;
  unpaid: number;
  paid: number;
  totalRevenue: number; // sum of totals of paid quotes
}

/**
 * User quota information
 */
export interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
  percentage: number;
  canCreateQuote: boolean;
}

// =====================================================
// ERROR TYPES
// =====================================================

/**
 * Database error codes
 */
export enum DbErrorCode {
  UNIQUE_VIOLATION = '23505',
  FOREIGN_KEY_VIOLATION = '23503',
  NOT_NULL_VIOLATION = '23502',
  CHECK_VIOLATION = '23514',
  CONNECTION_ERROR = 'ECONNREFUSED',
  TIMEOUT = 'ETIMEDOUT',
}

/**
 * Custom database error
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Not found error
 */
export class NotFoundError extends Error {
  constructor(
    message: string,
    public entity?: string,
    public id?: string
  ) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Quota exceeded error
 */
export class QuotaExceededError extends Error {
  constructor(
    message: string,
    public used: number,
    public limit: number
  ) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}
