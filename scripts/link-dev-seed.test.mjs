import assert from "node:assert/strict";
import { test } from "vitest";
import { seedConfig, linkDevSeed } from "./link-dev-seed.mjs";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
  E2E_AUTH0_USER_ID: "auth0|example_local_user",
};

test("accepts loopback only and rejects hosted URLs, credentials and missing settings", () => {
  assert.equal(seedConfig(env).url, env.NEXT_PUBLIC_SUPABASE_URL);
  for (const url of [
    "https://example.com",
    "http://localhost.example.com",
    "file:///tmp/db",
    "http://user:pass@localhost",
    "http://localhost/?secret=value",
    "http://localhost/api",
  ]) {
    assert.throws(() => seedConfig({ ...env, NEXT_PUBLIC_SUPABASE_URL: url }));
  }
  assert.throws(() => seedConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: "" }));
  assert.throws(() => seedConfig({ ...env, E2E_AUTH0_USER_ID: "" }));
});

function clientWith(updateResult, existingResult) {
  const calls = [];
  const query = {
    update(value) {
      calls.push(["update", value]);
      return this;
    },
    eq(...args) {
      calls.push(["eq", ...args]);
      return this;
    },
    select(value) {
      calls.push(["select", value]);
      return value === "id" ? Promise.resolve(updateResult) : this;
    },
    maybeSingle() {
      return Promise.resolve(existingResult);
    },
  };
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      return query;
    },
  };
}

test("updates only the synthetic seed identity, never another account", async () => {
  const client = clientWith({ data: [{ id: "seed" }], error: null });
  await linkDevSeed(client, env.E2E_AUTH0_USER_ID);
  assert.deepEqual(
    client.calls.filter((c) => c[0] === "eq"),
    [
      ["eq", "id", "00000000-0000-0000-0000-000000000001"],
      ["eq", "auth0_user_id", "user_demo_contractor_1"],
    ]
  );
  assert.deepEqual(
    client.calls.find((c) => c[0] === "update"),
    ["update", { auth0_user_id: env.E2E_AUTH0_USER_ID }]
  );
});

test("is idempotent and rejects missing, mismatched or failed seed updates", async () => {
  const noUpdate = { data: [], error: null };
  await linkDevSeed(
    clientWith(noUpdate, {
      data: { auth0_user_id: env.E2E_AUTH0_USER_ID },
      error: null,
    }),
    env.E2E_AUTH0_USER_ID
  );
  for (const existing of [
    { data: null },
    { data: { auth0_user_id: "someone_else" } },
    { error: { message: "private detail" } },
  ]) {
    await assert.rejects(
      linkDevSeed(clientWith(noUpdate, existing), env.E2E_AUTH0_USER_ID)
    );
  }
  await assert.rejects(
    linkDevSeed(
      clientWith({ error: { message: "private detail" } }),
      env.E2E_AUTH0_USER_ID
    ),
    /Could not link/
  );
});
