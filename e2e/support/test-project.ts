/** A temporary project (dev Supabase only) for tests that need a job to work on. */
import { randomBytes } from "node:crypto";
import { api, type RoleUser } from "./role-users";

/** True once the "saved calculations" migration has been applied to the dev project. */
export async function savedCalculationsTableExists(): Promise<boolean> {
  const res = await api("/rest/v1/saved_calculations?select=id&limit=1");
  return res.ok;
}

/** Creates a scheduled project with `crew` assigned. Returns its id and name. */
export async function createTestProject(crew: RoleUser[]): Promise<{ id: string; name: string }> {
  const name = `E2E Job ${randomBytes(3).toString("hex")}`;
  const res = await api("/rest/v1/projects", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name, status: "scheduled" }),
  });
  if (!res.ok) throw new Error(`create project failed: ${res.status} ${await res.text()}`);
  const [{ id }] = (await res.json()) as { id: string }[];
  for (const u of crew) {
    const emp = await api(`/rest/v1/employees?select=id&email=eq.${encodeURIComponent(u.email)}`);
    const [{ id: employeeId }] = (await emp.json()) as { id: string }[];
    const a = await api("/rest/v1/project_assignments", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ project_id: id, employee_id: employeeId }),
    });
    if (!a.ok) throw new Error(`assign crew failed: ${a.status} ${await a.text()}`);
  }
  return { id, name };
}

/** True once the work orders migration has been applied to the dev project. */
export async function workOrdersTableExists(): Promise<boolean> {
  const res = await api("/rest/v1/field_work_orders?select=id&limit=1");
  return res.ok;
}

/** Adds a site contact to the project. */
export async function addTestContact(projectId: string, contact: { name: string; title?: string; phone?: string }): Promise<void> {
  const res = await api("/rest/v1/project_contacts", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ project_id: projectId, is_primary: true, ...contact }),
  });
  if (!res.ok) throw new Error(`add contact failed: ${res.status} ${await res.text()}`);
}

/**
 * Deletes the project (its assignments and saved calculations go with it).
 * A project with a published work order can't be deleted (published revisions
 * are permanent), so those are closed and marked as test data instead.
 */
export async function deleteTestProject(id: string): Promise<void> {
  const res = await api(`/rest/v1/projects?id=eq.${id}`, { method: "DELETE" });
  if (!res.ok) {
    await api(`/rest/v1/projects?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "closed", scope_summary: "Automated test data (published work order kept permanently)." }),
    });
  }
}
