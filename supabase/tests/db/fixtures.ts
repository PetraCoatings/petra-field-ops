import type { Client } from "pg";

/** Fixed ids make failures easy to read. */
export const U = {
  admin: "00000000-0000-4000-8000-00000000000a",
  pm: "00000000-0000-4000-8000-00000000000b",
  lead: "00000000-0000-4000-8000-00000000000c",
  installer: "00000000-0000-4000-8000-00000000000d",
  otherInstaller: "00000000-0000-4000-8000-00000000000e",
  inactive: "00000000-0000-4000-8000-00000000000f",
  noEmployee: "00000000-0000-4000-8000-000000000010",
} as const;

export const E = {
  admin: "10000000-0000-4000-8000-00000000000a",
  pm: "10000000-0000-4000-8000-00000000000b",
  lead: "10000000-0000-4000-8000-00000000000c",
  installer: "10000000-0000-4000-8000-00000000000d",
  otherInstaller: "10000000-0000-4000-8000-00000000000e",
  inactive: "10000000-0000-4000-8000-00000000000f",
} as const;

export const P = {
  assigned: "20000000-0000-4000-8000-000000000001",
  unassigned: "20000000-0000-4000-8000-000000000002",
} as const;

export const C = {
  assigned: "30000000-0000-4000-8000-000000000001",
  unassigned: "30000000-0000-4000-8000-000000000002",
} as const;

/** Idempotently (re)seed the standard cast of users, projects and assignments. */
export async function seed(c: Client): Promise<void> {
  await c.query(`
    truncate public.project_assignments, public.project_contacts, public.projects,
             public.customers, audit.log restart identity cascade;
    alter table public.employees disable trigger employees_protect_last_admin;
    delete from public.employees;
    alter table public.employees enable trigger employees_protect_last_admin;
    delete from auth.users;
  `);
  for (const [k, id] of Object.entries(U)) {
    await c.query("insert into auth.users (id, email) values ($1, $2)", [id, `${k}@example.test`]);
  }
  const rows: [string, string, string, string, boolean][] = [
    [E.admin, U.admin, "Olivia", "office_admin", true],
    [E.pm, U.pm, "Paul", "project_manager", true],
    [E.lead, U.lead, "Carlos", "crew_lead", true],
    [E.installer, U.installer, "Ivan", "installer", true],
    [E.otherInstaller, U.otherInstaller, "Oscar", "installer", true],
    [E.inactive, U.inactive, "Ina", "installer", false],
  ];
  for (const [id, uid, first, role, active] of rows) {
    await c.query(
      `insert into public.employees (id, user_id, first_name, last_name, email, phone, role, is_active)
       values ($1, $2, $3, 'Test', $4, '555-0100', $5, $6)`,
      [id, uid, first, `${first.toLowerCase()}@example.test`, role, active],
    );
  }
  await c.query(
    `insert into public.customers (id, name) values ($1, 'Acme Foods'), ($2, 'Secret Customer')`,
    [C.assigned, C.unassigned],
  );
  await c.query(
    `insert into public.projects (id, name, customer_id, crew_lead_id, project_manager_id, status)
     values ($1, 'Acme Warehouse', $2, $3, $4, 'scheduled'),
            ($5, 'Other Job', $6, null, $4, 'scheduled')`,
    [P.assigned, C.assigned, E.lead, E.pm, P.unassigned, C.unassigned],
  );
  await c.query(
    `insert into public.project_assignments (project_id, employee_id, role_on_job)
     values ($1, $2, 'installer')`,
    [P.assigned, E.installer],
  );
  await c.query(
    `insert into public.project_contacts (project_id, name, phone) values ($1, 'Site Super', '555-0199'),
       ($2, 'Hidden Contact', '555-0198')`,
    [P.assigned, P.unassigned],
  );
}
