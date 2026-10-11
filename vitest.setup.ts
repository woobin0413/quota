// Vitest global setup.
//
// Some modules (e.g. lib/supabase.ts) read env vars at import time and throw
// if they are missing. Tests that import API routes pull those modules into
// the graph even when the code path under test never touches the DB. Provide
// harmless placeholders so imports don't crash; tests mock or never call the
// clients, so these values are never used to make real requests.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
