/**
 * Database test harness.
 *
 * Builds a fresh database from `supabase/tests/supabase-shim.sql` plus every
 * migration in `supabase/migrations` (in filename order), then lets tests run
 * queries *as a specific signed-in user* exactly the way Supabase's API does:
 * switch to the `authenticated` role and set the `request.jwt.claims` setting.
 *
 * Each `asUser` call runs inside a transaction that is always rolled back, so
 * tests cannot leak state into each other.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client, type QueryResult } from "pg";

export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? "pfo_test";
const SERVER_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54329/postgres";

function urlForDb(db: string): string {
  const u = new URL(SERVER_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

const ROOT = join(__dirname, "..", "..");

/** Drop and recreate the test database, then apply shim + migrations. */
export async function rebuildDatabase(): Promise<void> {
  const admin = new Client({ connectionString: SERVER_URL });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${TEST_DB_NAME} with (force)`);
    await admin.query(`create database ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }
  const db = new Client({ connectionString: urlForDb(TEST_DB_NAME) });
  await db.connect();
  try {
    await db.query(readFileSync(join(ROOT, "tests", "supabase-shim.sql"), "utf8"));
    const dir = join(ROOT, "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      try {
        await db.query(readFileSync(join(dir, file), "utf8"));
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await db.end();
  }
}

/** Superuser connection for seeding fixtures (bypasses RLS). */
export async function superuser<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: urlForDb(TEST_DB_NAME) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export type Q = (sql: string, params?: unknown[]) => Promise<QueryResult>;

async function asRole<T>(
  role: "authenticated" | "anon",
  userId: string | null,
  fn: (q: Q) => Promise<T>,
): Promise<T> {
  return superuser(async (c) => {
    await c.query("begin");
    try {
      await c.query(`set local role ${role}`);
      const claims = userId ? { sub: userId, role } : { role };
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
      // Savepoint per statement so an expected error doesn't abort the test transaction.
      const q: Q = async (sql, params) => {
        await c.query("savepoint s");
        try {
          const r = await c.query(sql, params as unknown[]);
          await c.query("release savepoint s");
          return r;
        } catch (e) {
          await c.query("rollback to savepoint s");
          throw e;
        }
      };
      return await fn(q);
    } finally {
      await c.query("rollback");
    }
  });
}

/** Run queries as a signed-in Supabase user (role `authenticated`). */
export const asUser = <T>(userId: string, fn: (q: Q) => Promise<T>) =>
  asRole("authenticated", userId, fn);

/** Run queries as an anonymous (signed-out) API caller. */
export const asAnon = <T>(fn: (q: Q) => Promise<T>) => asRole("anon", null, fn);
