/**
 * Row Level Security tests — Phase 1.
 *
 * Every test runs SQL as a real role/user combination, exactly as a request
 * through the Supabase API would. Both authorized AND unauthorized requests
 * are tested, including "URL tampering" (asking for a record by id that the
 * user should not be able to see).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, superuser } from "./harness";
import { C, E, P, U, seed } from "./fixtures";

beforeAll(async () => {
  await superuser(seed);
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe("signed-out (anon) callers", () => {
  it("cannot read any table", async () => {
    await asAnon(async (q) => {
      for (const t of ["employees", "projects", "customers", "app_settings", "employee_directory"]) {
        await expect(q(`select * from public.${t}`)).rejects.toThrow(/permission denied/);
      }
    });
  });

  it("cannot call profile or locale functions", async () => {
    await asAnon(async (q) => {
      await expect(q("select * from public.get_my_profile()")).rejects.toThrow(/permission denied/);
      await expect(q("select public.set_my_locale('es')")).rejects.toThrow(/permission denied/);
    });
  });
});

describe("installer", () => {
  it("sees only projects they are assigned to", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q("select id from public.projects");
      expect(ids(rows)).toEqual([P.assigned]);
    });
  });

  it("gets nothing when requesting an unassigned project by id (URL tampering)", async () => {
    await asUser(U.installer, async (q) => {
      const { rowCount } = await q("select * from public.projects where id = $1", [P.unassigned]);
      expect(rowCount).toBe(0);
      const contacts = await q("select * from public.project_contacts where project_id = $1", [P.unassigned]);
      expect(contacts.rowCount).toBe(0);
      const crew = await q("select * from public.project_assignments where project_id = $1", [P.unassigned]);
      expect(crew.rowCount).toBe(0);
    });
  });

  it("sees the customer of an assigned project only", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q("select id from public.customers");
      expect(ids(rows)).toEqual([C.assigned]);
    });
  });

  it("cannot create, modify or delete projects", async () => {
    await asUser(U.installer, async (q) => {
      await expect(q("insert into public.projects (name) values ('Sneaky job')")).rejects.toThrow(
        /row-level security/,
      );
      const upd = await q("update public.projects set name = 'Changed' where id = $1", [P.assigned]);
      expect(upd.rowCount).toBe(0);
      const del = await q("delete from public.projects where id = $1", [P.assigned]);
      expect(del.rowCount).toBe(0);
    });
  });

  it("cannot assign themselves to a project", async () => {
    await asUser(U.installer, async (q) => {
      await expect(
        q("insert into public.project_assignments (project_id, employee_id) values ($1, $2)", [
          P.unassigned,
          E.installer,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("reads only their own full employee record", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q("select id, email, phone from public.employees");
      expect(ids(rows)).toEqual([E.installer]);
    });
  });

  it("sees co-workers only through the directory, without contact details", async () => {
    await asUser(U.installer, async (q) => {
      const { rows, fields } = await q("select * from public.employee_directory");
      expect(rows.length).toBe(6);
      const cols = fields.map((f) => f.name);
      expect(cols).not.toContain("email");
      expect(cols).not.toContain("phone");
      expect(cols).not.toContain("flsa_status");
      expect(cols).not.toContain("hire_date");
    });
  });

  it("cannot promote themselves", async () => {
    await asUser(U.installer, async (q) => {
      const r = await q("update public.employees set role = 'office_admin' where id = $1", [E.installer]);
      expect(r.rowCount).toBe(0);
    });
    await superuser(async (c) => {
      const { rows } = await c.query("select role from public.employees where id = $1", [E.installer]);
      expect(rows[0].role).toBe("installer");
    });
  });

  it("can read company settings but not change them", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q("select workweek_start_dow, company_timezone from public.app_settings");
      expect(rows).toEqual([{ workweek_start_dow: 1, company_timezone: "America/Chicago" }]);
      const upd = await q("update public.app_settings set self_edit_window_hours = 168");
      expect(upd.rowCount).toBe(0);
    });
  });

  it("cannot read the audit log", async () => {
    await asUser(U.installer, async (q) => {
      const { rowCount } = await q("select * from public.audit_log");
      expect(rowCount).toBe(0);
    });
  });

  it("can change only their own language", async () => {
    await asUser(U.installer, async (q) => {
      await q("select public.set_my_locale('es')");
      const { rows } = await q("select preferred_locale from public.get_my_profile()");
      expect(rows[0].preferred_locale).toBe("es");
      await expect(q("select public.set_my_locale('fr')")).rejects.toThrow(/Unsupported language/);
    });
  });
});

describe("crew lead", () => {
  it("sees the project they lead and its crew", async () => {
    await asUser(U.lead, async (q) => {
      const { rows } = await q("select id from public.projects");
      expect(ids(rows)).toEqual([P.assigned]);
      const crew = await q("select employee_id from public.project_assignments");
      expect(crew.rows.map((r) => r.employee_id)).toEqual([E.installer]);
    });
  });

  it("cannot see other employees' private records", async () => {
    await asUser(U.lead, async (q) => {
      const { rows } = await q("select id from public.employees");
      expect(ids(rows)).toEqual([E.lead]);
    });
  });

  it("cannot edit project assignments", async () => {
    await asUser(U.lead, async (q) => {
      await expect(
        q("insert into public.project_assignments (project_id, employee_id) values ($1, $2)", [
          P.assigned,
          E.otherInstaller,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });
});

describe("project manager", () => {
  it("sees all projects and can create and edit them", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q("select id from public.projects");
      expect(ids(rows)).toEqual([P.assigned, P.unassigned].sort());
      const ins = await q("insert into public.projects (name, status) values ('New job', 'draft') returning id");
      expect(ins.rowCount).toBe(1);
      const upd = await q("update public.projects set status = 'in_progress' where id = $1", [P.unassigned]);
      expect(upd.rowCount).toBe(1);
    });
  });

  it("can assign crews", async () => {
    await asUser(U.pm, async (q) => {
      const r = await q(
        "insert into public.project_assignments (project_id, employee_id) values ($1, $2) returning id",
        [P.unassigned, E.otherInstaller],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("cannot delete projects (office admin only)", async () => {
    await asUser(U.pm, async (q) => {
      const r = await q("delete from public.projects where id = $1", [P.unassigned]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("cannot read or change employee records, roles or settings", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q("select id from public.employees");
      expect(ids(rows)).toEqual([E.pm]);
      const upd = await q("update public.employees set role = 'installer' where id = $1", [E.lead]);
      expect(upd.rowCount).toBe(0);
      const s = await q("update public.app_settings set gps_on_category_switch = true");
      expect(s.rowCount).toBe(0);
    });
  });

  it("cannot read the audit log", async () => {
    await asUser(U.pm, async (q) => {
      const { rowCount } = await q("select * from public.audit_log");
      expect(rowCount).toBe(0);
    });
  });
});

describe("office administrator", () => {
  it("manages employees and roles", async () => {
    await asUser(U.admin, async (q) => {
      const all = await q("select id from public.employees");
      expect(all.rowCount).toBe(6);
      const ins = await q(
        `insert into public.employees (first_name, last_name, email, role)
         values ('New', 'Hire', 'new@example.test', 'installer') returning id`,
      );
      expect(ins.rowCount).toBe(1);
      const upd = await q("update public.employees set role = 'crew_lead' where id = $1", [E.installer]);
      expect(upd.rowCount).toBe(1);
    });
  });

  it("changes company settings", async () => {
    await asUser(U.admin, async (q) => {
      const r = await q("update public.app_settings set self_edit_window_hours = 48");
      expect(r.rowCount).toBe(1);
    });
  });

  it("cannot remove the last active office administrator", async () => {
    await asUser(U.admin, async (q) => {
      await expect(
        q("update public.employees set role = 'installer' where id = $1", [E.admin]),
      ).rejects.toThrow(/last active office administrator/);
      await expect(
        q("update public.employees set is_active = false where id = $1", [E.admin]),
      ).rejects.toThrow(/last active office administrator/);
      await expect(q("delete from public.employees where id = $1", [E.admin])).rejects.toThrow(
        /last active office administrator/,
      );
    });
  });

  it("reads the audit log, which records who changed what", async () => {
    await asUser(U.admin, async (q) => {
      await q("update public.projects set status = 'on_hold' where id = $1", [P.assigned]);
      const { rows } = await q(
        `select action, actor_employee_id, old_data->>'status' as old_status, new_data->>'status' as new_status
         from public.audit_log where table_name = 'public.projects' and row_id = $1
         order by id desc limit 1`,
        [P.assigned],
      );
      expect(rows[0]).toEqual({
        action: "UPDATE",
        actor_employee_id: E.admin,
        old_status: "scheduled",
        new_status: "on_hold",
      });
    });
  });

  it("cannot alter or delete audit history", async () => {
    await asUser(U.admin, async (q) => {
      await expect(q("update audit.log set action = 'INSERT'")).rejects.toThrow(/permission denied/);
      await expect(q("delete from audit.log")).rejects.toThrow(/permission denied/);
      await expect(q("delete from public.audit_log")).rejects.toThrow(/permission denied/);
    });
  });
});

describe("accounts without an active employee record", () => {
  it("an inactive employee sees nothing", async () => {
    await asUser(U.inactive, async (q) => {
      expect((await q("select * from public.projects")).rowCount).toBe(0);
      expect((await q("select * from public.employee_directory")).rowCount).toBe(0);
      expect((await q("select * from public.app_settings")).rowCount).toBe(0);
      expect((await q("select * from public.get_my_profile()")).rowCount).toBe(0);
    });
  });

  it("a signed-in user with no employee record sees nothing", async () => {
    await asUser(U.noEmployee, async (q) => {
      expect((await q("select * from public.projects")).rowCount).toBe(0);
      expect((await q("select * from public.employees")).rowCount).toBe(0);
      expect((await q("select * from public.employee_directory")).rowCount).toBe(0);
    });
  });
});
