/**
 * lib/db barrel
 *
 * Existing call sites import repository modules directly (e.g.
 * `@/lib/db/quotes`), so this barrel currently only re-exports the
 * payments repository per Task 3. Extend with further `export * from
 * "./<module>"` lines as needed.
 */

export * from "./payments";
