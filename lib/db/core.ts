/**
 * Core Database Layer
 *
 * Provides type-safe query helpers, error handling, and query logging
 * using Supabase JS client.
 *
 * @module lib/db/core
 */

import { supabaseAdmin } from "@/lib/supabase";
import {
  DatabaseError,
  DbErrorCode,
  NotFoundError,
  ValidationError,
} from "@/types/database";
import { logger } from "@/lib/logger";

// =====================================================
// CONFIGURATION
// =====================================================

const isDevelopment = process.env.NODE_ENV === "development";
const QUERY_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

/**
 * Database configuration
 */
export const dbConfig = {
  isDevelopment,
  queryTimeout: QUERY_TIMEOUT,
  maxRetries: MAX_RETRIES,
  retryDelay: RETRY_DELAY,
  logQueries: isDevelopment,
};

// =====================================================
// QUERY LOGGING
// =====================================================

/**
 * Log query execution in development
 */
function logQuery(query: string, params?: unknown[], duration?: number) {
  if (!dbConfig.logQueries) return;

  const timestamp = new Date().toISOString();
  console.log(`[DB ${timestamp}]`, {
    query: query.trim(),
    params,
    duration: duration ? `${duration}ms` : undefined,
  });
}

/**
 * Log query error
 */
function logError(error: unknown, query?: string) {
  logger.error("Database query failed", {
    err: error,
    query: query?.trim(),
  });
}

// =====================================================
// ERROR HANDLING
// =====================================================

/**
 * Map PostgreSQL error codes to user-friendly messages
 */
function mapErrorToMessage(code: string, constraint?: string): string {
  switch (code) {
    case DbErrorCode.UNIQUE_VIOLATION:
      if (constraint?.includes("email")) {
        return "This email address is already in use.";
      }
      if (constraint?.includes("quote_number")) {
        return "Quote number already exists.";
      }
      return "This record already exists.";

    case DbErrorCode.FOREIGN_KEY_VIOLATION:
      return "Cannot perform this operation due to related records.";

    case DbErrorCode.NOT_NULL_VIOLATION:
      return "Required field is missing.";

    case DbErrorCode.CHECK_VIOLATION:
      if (constraint?.includes("email_format")) {
        return "Invalid email address format.";
      }
      if (constraint?.includes("financial")) {
        return "Invalid financial amount.";
      }
      return "Data validation failed.";

    case DbErrorCode.CONNECTION_ERROR:
      return "Unable to connect to database.";

    case DbErrorCode.TIMEOUT:
      return "Database query timed out.";

    default:
      return "An unexpected database error occurred.";
  }
}

/**
 * Handle database errors and convert to appropriate error types
 */
export function handleDatabaseError(error: unknown, query?: string): never {
  logError(error, query);

  // Supabase errors have a 'code' property
  if (error && typeof error === "object" && "code" in error) {
    const pgError = error as {
      code: string;
      constraint?: string;
      details?: string;
      message?: string;
    };

    const message = mapErrorToMessage(pgError.code, pgError.constraint);

    throw new DatabaseError(message, pgError.code, {
      constraint: pgError.constraint,
      detail: pgError.details,
      originalError: error,
    });
  }

  // Handle other errors
  if (error instanceof Error) {
    throw new DatabaseError(error.message, undefined, {
      originalError: error,
    });
  }

  throw new DatabaseError("An unknown database error occurred", undefined, {
    originalError: error,
  });
}

// =====================================================
// RETRY LOGIC
// =====================================================

/**
 * Execute query with retry logic for transient failures
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // Don't retry on user errors
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError
    ) {
      throw error;
    }

    // Retry on connection/timeout errors
    if (retries > 0) {
      const shouldRetry =
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === DbErrorCode.CONNECTION_ERROR ||
          error.code === DbErrorCode.TIMEOUT);

      if (shouldRetry) {
        await new Promise((resolve) =>
          setTimeout(resolve, dbConfig.retryDelay)
        );
        return executeWithRetry(fn, retries - 1);
      }
    }

    throw error;
  }
}

// =====================================================
// TYPE-SAFE QUERY HELPERS
// =====================================================

/**
 * Execute a type-safe SQL query with error handling and logging
 *
 * @example
 * ```typescript
 * const users = await query<UserRow>(
 *   'SELECT * FROM users WHERE id = $1',
 *   [userId]
 * );
 * ```
 */
export async function query<T = unknown>(
  queryText: string,
  params?: unknown[]
): Promise<T[]> {
  const startTime = Date.now();

  try {
    const result = await executeWithRetry(async () => {
      // Convert $1, $2, etc. placeholders to actual values for Supabase rpc
      // Supabase uses rpc for raw SQL queries
      const { data, error } = await supabaseAdmin.rpc("exec_sql", {
        query_text: queryText,
        query_params: params || [],
      });

      if (error) {
        throw error;
      }

      return { rows: data || [] };
    });

    const duration = Date.now() - startTime;
    logQuery(queryText, params, duration);

    return result.rows as T[];
  } catch (error) {
    // If rpc doesn't exist, fall back to direct query approach
    // This handles the case where exec_sql function isn't set up
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      String((error as { message: string }).message).includes("exec_sql")
    ) {
      // Fall back to using Supabase's from() method for simple queries
      return await executeDirectQuery<T>(queryText, params);
    }
    handleDatabaseError(error, queryText);
  }
}

/**
 * Execute a direct query using Supabase's from() method
 * This is a fallback when rpc isn't available
 */
async function executeDirectQuery<T>(
  queryText: string,
  params?: unknown[]
): Promise<T[]> {
  const startTime = Date.now();

  // Parse simple SELECT queries
  const selectMatch = queryText.match(
    /SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?$/is
  );

  if (selectMatch) {
    const [, columns, table, where, orderBy, limit, offset] = selectMatch;

    // This fallback cannot apply WHERE/ORDER BY/OFFSET. Silently ignoring
    // them would return unfiltered (potentially cross-user) rows, so refuse
    // instead of executing the query incorrectly.
    if (where || orderBy || offset) {
      throw new Error(
        "Queries with WHERE, ORDER BY, or OFFSET require the exec_sql function. Please create it in Supabase."
      );
    }

    let query = supabaseAdmin.from(table).select(columns === "*" ? "*" : columns);

    if (limit) {
      query = query.limit(parseInt(limit));
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const duration = Date.now() - startTime;
    logQuery(queryText, params, duration);

    return (data || []) as T[];
  }

  // For INSERT, UPDATE, DELETE - need to parse and use appropriate methods
  // This is a simplified implementation
  throw new Error(
    "Complex queries require the exec_sql function. Please create it in Supabase."
  );
}

/**
 * Execute a query and return a single row or null
 *
 * @example
 * ```typescript
 * const user = await queryOne<UserRow>(
 *   'SELECT * FROM users WHERE id = $1',
 *   [userId]
 * );
 * ```
 */
export async function queryOne<T = unknown>(
  queryText: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(queryText, params);
  return rows[0] ?? null;
}

/**
 * Execute a query and return a single row or throw NotFoundError
 *
 * @example
 * ```typescript
 * const user = await queryOneOrThrow<UserRow>(
 *   'SELECT * FROM users WHERE id = $1',
 *   [userId],
 *   'User'
 * );
 * ```
 */
export async function queryOneOrThrow<T = unknown>(
  queryText: string,
  params: unknown[],
  entityName: string
): Promise<T> {
  const row = await queryOne<T>(queryText, params);

  if (!row) {
    throw new NotFoundError(
      `${entityName} not found`,
      entityName,
      params[0]?.toString()
    );
  }

  return row;
}

/**
 * Execute multiple queries in a transaction
 * Note: Supabase doesn't have native transaction support in JS client
 * For atomic operations, use a PostgreSQL function or handle at application level
 *
 * @example
 * ```typescript
 * await transaction(async () => {
 *   await query('INSERT INTO users ...');
 *   await query('INSERT INTO contacts ...');
 * });
 * ```
 */
export async function transaction<T>(
  callback: () => Promise<T>
): Promise<T> {
  // Supabase JS client doesn't support transactions directly
  // For critical atomic operations, create a PostgreSQL function
  // This is a simple wrapper that executes the callback
  try {
    return await callback();
  } catch (error) {
    throw error;
  }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Parse PostgreSQL DECIMAL to number
 */
export function parseDecimal(value: string | null): number {
  if (value === null) return 0;
  return parseFloat(value);
}

/**
 * Format number to PostgreSQL DECIMAL string
 */
export function formatDecimal(value: number): string {
  return value.toFixed(2);
}

/**
 * Convert camelCase to snake_case for database columns
 */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert snake_case to camelCase for JavaScript objects
 */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Build WHERE clause from filters object
 *
 * @example
 * ```typescript
 * const { where, params } = buildWhereClause({
 *   status: 'active',
 *   created_at: { gte: new Date('2024-01-01') }
 * });
 * // WHERE status = $1 AND created_at >= $2
 * ```
 */
export function buildWhereClause(
  filters: Record<string, unknown>,
  startIndex = 1
): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = startIndex;

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      // Handle operators: { gte: value, lte: value }
      const operators = value as Record<string, unknown>;
      for (const [op, opValue] of Object.entries(operators)) {
        const sqlOp = {
          eq: "=",
          ne: "!=",
          gt: ">",
          gte: ">=",
          lt: "<",
          lte: "<=",
          like: "LIKE",
          ilike: "ILIKE",
        }[op];

        if (sqlOp) {
          conditions.push(`${key} ${sqlOp} $${paramIndex}`);
          params.push(opValue);
          paramIndex++;
        }
      }
    } else if (Array.isArray(value)) {
      // Handle IN clause
      conditions.push(`${key} = ANY($${paramIndex})`);
      params.push(value);
      paramIndex++;
    } else {
      // Simple equality
      conditions.push(`${key} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
  }

  const where = conditions.length > 0 ? conditions.join(" AND ") : "TRUE";
  return { where, params };
}

/**
 * Build pagination clause
 */
export function buildPaginationClause(
  limit?: number,
  offset?: number
): string {
  const clauses: string[] = [];

  if (limit !== undefined) {
    clauses.push(`LIMIT ${limit}`);
  }

  if (offset !== undefined) {
    clauses.push(`OFFSET ${offset}`);
  }

  return clauses.join(" ");
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  return emailRegex.test(email);
}

/**
 * Validate required fields
 */
export function validateRequired<T extends Record<string, unknown>>(
  data: T,
  requiredFields: (keyof T)[]
): void {
  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null || data[field] === "") {
      throw new ValidationError(
        `Field '${String(field)}' is required`,
        String(field)
      );
    }
  }
}

// =====================================================
// SUPABASE QUERY BUILDER HELPERS
// =====================================================

/**
 * Get Supabase admin client for direct table access
 */
export { supabaseAdmin };

/**
 * Main database object with all query methods
 */
export const db = {
  query,
  queryOne,
  queryOneOrThrow,
  transaction,
  supabase: supabaseAdmin,
};
