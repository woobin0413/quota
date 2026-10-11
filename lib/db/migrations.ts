/**
 * Migration Runner
 *
 * Utilities for running database migrations safely.
 *
 * @module lib/db/migrations
 */

import { sql } from "@vercel/postgres";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// =====================================================
// MIGRATION TRACKING TABLE
// =====================================================

/**
 * Ensure migrations table exists
 */
async function ensureMigrationsTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
}

/**
 * Get list of executed migrations
 */
async function getExecutedMigrations(): Promise<string[]> {
  await ensureMigrationsTable();

  const result = await sql`
    SELECT name FROM _migrations
    ORDER BY executed_at ASC
  `;

  return result.rows.map((row) => row.name);
}

/**
 * Record migration as executed
 */
async function recordMigration(name: string): Promise<void> {
  await sql`
    INSERT INTO _migrations (name)
    VALUES (${name})
  `;
}

// =====================================================
// MIGRATION EXECUTION
// =====================================================

/**
 * Execute a migration SQL file
 *
 * @param migrationPath - Path to migration file
 * @param migrationName - Name of migration
 */
async function executeMigration(
  migrationPath: string,
  migrationName: string
): Promise<void> {
  console.log(`Running migration: ${migrationName}`);

  const migrationSQL = readFileSync(migrationPath, "utf-8");

  // Execute migration in a transaction
  const client = await sql.connect();

  try {
    await client.query("BEGIN");
    await client.query(migrationSQL);
    await recordMigration(migrationName);
    await client.query("COMMIT");

    console.log(`✓ Migration completed: ${migrationName}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`✗ Migration failed: ${migrationName}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run all pending migrations
 *
 * Looks for migration files in db/migrations/ directory.
 *
 * @example
 * ```bash
 * npm run migrate
 * ```
 */
export async function runMigrations(): Promise<void> {
  const migrationsDir = join(process.cwd(), "db", "migrations");

  // Get all migration files
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql") && !file.endsWith("_rollback.sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found");
    return;
  }

  // Get executed migrations
  const executedMigrations = await getExecutedMigrations();

  // Filter pending migrations
  const pendingMigrations = files.filter(
    (file) => !executedMigrations.includes(file)
  );

  if (pendingMigrations.length === 0) {
    console.log("No pending migrations");
    return;
  }

  console.log(`Found ${pendingMigrations.length} pending migration(s)`);

  // Execute each pending migration
  for (const file of pendingMigrations) {
    const migrationPath = join(migrationsDir, file);
    await executeMigration(migrationPath, file);
  }

  console.log("All migrations completed successfully");
}

/**
 * Rollback the last migration
 *
 * Looks for corresponding _rollback.sql file.
 *
 * @example
 * ```bash
 * npm run migrate:rollback
 * ```
 */
export async function rollbackMigration(): Promise<void> {
  const executedMigrations = await getExecutedMigrations();

  if (executedMigrations.length === 0) {
    console.log("No migrations to rollback");
    return;
  }

  const lastMigration = executedMigrations[executedMigrations.length - 1];
  const rollbackFile = lastMigration.replace(".sql", "_rollback.sql");
  const rollbackPath = join(
    process.cwd(),
    "db",
    "migrations",
    rollbackFile
  );

  console.log(`Rolling back migration: ${lastMigration}`);

  const rollbackSQL = readFileSync(rollbackPath, "utf-8");

  const client = await sql.connect();

  try {
    await client.query("BEGIN");
    await client.query(rollbackSQL);

    // Remove migration record
    await sql`
      DELETE FROM _migrations
      WHERE name = ${lastMigration}
    `;

    await client.query("COMMIT");
    console.log(`✓ Rollback completed: ${lastMigration}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`✗ Rollback failed: ${lastMigration}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get migration status
 *
 * Shows which migrations have been executed.
 */
export async function getMigrationStatus(): Promise<{
  executed: string[];
  pending: string[];
}> {
  const migrationsDir = join(process.cwd(), "db", "migrations");

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql") && !file.endsWith("_rollback.sql"))
    .sort();

  const executedMigrations = await getExecutedMigrations();

  const pending = files.filter(
    (file) => !executedMigrations.includes(file)
  );

  return {
    executed: executedMigrations,
    pending,
  };
}

// =====================================================
// CLI COMMANDS
// =====================================================

/**
 * Run migrations from command line
 *
 * Usage:
 * ```bash
 * node -r tsx lib/db/migrations.ts migrate
 * node -r tsx lib/db/migrations.ts rollback
 * node -r tsx lib/db/migrations.ts status
 * ```
 */
if (require.main === module) {
  const command = process.argv[2];

  (async () => {
    try {
      switch (command) {
        case "migrate":
          await runMigrations();
          break;

        case "rollback":
          await rollbackMigration();
          break;

        case "status": {
          const status = await getMigrationStatus();
          console.log("\nMigration Status:");
          console.log("================");
          console.log(
            `\nExecuted (${status.executed.length}):`
          );
          status.executed.forEach((m) => console.log(`  ✓ ${m}`));
          console.log(`\nPending (${status.pending.length}):`);
          status.pending.forEach((m) => console.log(`  • ${m}`));
          break;
        }

        default:
          console.log("Usage: migrations.ts [migrate|rollback|status]");
          process.exit(1);
      }

      process.exit(0);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  })();
}
