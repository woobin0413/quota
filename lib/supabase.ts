/**
 * Supabase Client
 *
 * Provides server and client-side Supabase clients.
 *
 * Clients are created lazily on first use: importing this module (which any
 * route pulls in transitively) must never require env vars to be present, or
 * builds without runtime secrets fail while collecting page data.
 *
 * @module lib/supabase
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

let anonClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

function createAnonClient(): SupabaseClient {
  if (!anonClient) {
    anonClient = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    );
  }
  return anonClient;
}

function createAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }
  return adminClient;
}

/**
 * Wrap a client factory so the underlying client is only built on first
 * property access, keeping the exports drop-in compatible with the eager ones.
 */
function lazyClient(resolve: () => SupabaseClient): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get(_target, prop) {
      const client = resolve();
      const value = Reflect.get(client, prop, client);
      return typeof value === "function" ? value.bind(client) : value;
    },
    set(_target, prop, value) {
      return Reflect.set(resolve(), prop, value);
    },
    has(_target, prop) {
      return Reflect.has(resolve(), prop);
    },
  });
}

/**
 * Supabase client for client-side usage (respects RLS)
 */
export const supabase: SupabaseClient = lazyClient(createAnonClient);

/**
 * Supabase admin client for server-side usage (bypasses RLS)
 * Only use this on the server side!
 */
export const supabaseAdmin: SupabaseClient = lazyClient(createAdminClient);

/**
 * Get the appropriate Supabase client
 * @param useAdmin - Use admin client (server-side only)
 */
export function getSupabaseClient(useAdmin = false) {
  return useAdmin ? supabaseAdmin : supabase;
}

export default supabase;
