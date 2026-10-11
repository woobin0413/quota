import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const SEED_USER_ID = "00000000-0000-0000-0000-000000000001";
const SEED_AUTH0_ID = "user_demo_contractor_1";

export function seedConfig(env) {
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  // Never send the service-role key or modify seed identities on a hosted DB.
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Seed linking requires a loopback Supabase URL.");
  }
  if (
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !/^auth0\|[A-Za-z0-9_-]+$/.test(env.E2E_AUTH0_USER_ID ?? "")
  ) {
    throw new Error(
      "Set SUPABASE_SERVICE_ROLE_KEY and E2E_AUTH0_USER_ID in .env.local."
    );
  }
  return {
    url: url.origin,
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    auth0Id: env.E2E_AUTH0_USER_ID,
  };
}

export async function linkDevSeed(client, auth0Id) {
  const { data, error } = await client
    .from("users")
    .update({ auth0_user_id: auth0Id })
    .eq("id", SEED_USER_ID)
    .eq("auth0_user_id", SEED_AUTH0_ID)
    .select("id");
  if (error) throw new Error("Could not link the development seed identity.");
  if (data?.length === 1) return;
  const existing = await client
    .from("users")
    .select("auth0_user_id")
    .eq("id", SEED_USER_ID)
    .maybeSingle();
  if (existing.error || existing.data?.auth0_user_id !== auth0Id) {
    throw new Error(
      "Expected development seed user not found. Run the local seed first."
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const config = seedConfig(process.env);
    const client = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await linkDevSeed(client, config.auth0Id);
    console.log("Development seed identity linked.");
  } catch {
    // SDK and URL errors may include private configuration; keep CLI output generic.
    console.error(
      "Seed linking failed. Check the local database and required .env.local values."
    );
    process.exitCode = 1;
  }
}
