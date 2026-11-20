/**
 * Temporary sign-in accounts (one per role) for the signed-in browser tests.
 *
 * Runs only when E2E_SUPABASE_URL, E2E_SUPABASE_KEY and E2E_SUPABASE_SECRET_KEY
 * point at a DEV Supabase project. Accounts use @example.test addresses, are
 * created already confirmed (no email is sent) and are deleted afterwards.
 * Audit-log rows about them remain, because the audit log is append-only.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const ROLE_USERS_FILE = path.join(process.cwd(), "test-results", ".role-users.json");
export const TEST_ROLES = ["installer", "crew_lead", "project_manager", "office_admin"] as const;
export type TestRole = (typeof TEST_ROLES)[number];
export type RoleUser = { role: TestRole; email: string; password: string; userId: string; firstName: string };

export function signedInTestsEnabled(): boolean {
  return Boolean(
    process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_KEY && process.env.E2E_SUPABASE_SECRET_KEY,
  );
}

export function api(pathname: string, init: RequestInit = {}) {
  const key = process.env.E2E_SUPABASE_SECRET_KEY!;
  return fetch(`${process.env.E2E_SUPABASE_URL}${pathname}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  });
}

async function ok(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return res;
}

export async function createRoleUsers(): Promise<RoleUser[]> {
  const run = randomBytes(4).toString("hex");
  const users: RoleUser[] = [];
  try {
    for (const role of TEST_ROLES) {
      const email = `e2e-${role.replace("_", "-")}-${run}@example.test`;
      const password = `${randomBytes(12).toString("base64url")}9a`;
      const res = await ok(
        await api("/auth/v1/admin/users", {
          method: "POST",
          body: JSON.stringify({ email, password, email_confirm: true }),
        }),
        `create ${role} login`,
      );
      const { id } = (await res.json()) as { id: string };
      const firstName = `E2E ${role}`;
      users.push({ role, email, password, userId: id, firstName });
      await ok(
        await api("/rest/v1/employees", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ user_id: id, first_name: firstName, last_name: "Test", email, role }),
        }),
        `create ${role} employee`,
      );
    }
  } catch (e) {
    await deleteRoleUsers(users);
    throw e;
  }
  mkdirSync(path.dirname(ROLE_USERS_FILE), { recursive: true });
  writeFileSync(ROLE_USERS_FILE, JSON.stringify(users));
  return users;
}

export async function deleteRoleUsers(users: RoleUser[] = readRoleUsers()): Promise<void> {
  // Delete the admin last so the "keep at least one office admin" rule never trips.
  for (const u of [...users].reverse()) {
    await api(`/rest/v1/employees?email=eq.${encodeURIComponent(u.email)}`, { method: "DELETE" });
    await api(`/auth/v1/admin/users/${u.userId}`, { method: "DELETE" });
  }
  rmSync(ROLE_USERS_FILE, { force: true });
}

export function readRoleUsers(): RoleUser[] {
  try {
    return JSON.parse(readFileSync(ROLE_USERS_FILE, "utf8")) as RoleUser[];
  } catch {
    return [];
  }
}
