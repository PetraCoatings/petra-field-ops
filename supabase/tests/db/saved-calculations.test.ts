/**
 * Row Level Security tests — Phase 2 saved calculator results ("Save to job").
 * Authorized and forbidden requests for every role, including saving in
 * someone else's name and reaching into projects by id.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, superuser } from "./harness";
import { E, P, U, seed } from "./fixtures";

/** One saved result on each project, made by different people. */
const S = {
  byInstaller: "40000000-0000-4000-8000-000000000001",
  byLead: "40000000-0000-4000-8000-000000000002",
  onUnassigned: "40000000-0000-4000-8000-000000000003",
} as const;

const INSERT = `insert into public.saved_calculations (project_id, type, inputs, outputs, engine_version)
                values ($1, 'square_footage', '{"areas": []}', '{"net": 100}', 'test') returning id, created_by`;

beforeAll(async () => {
  await superuser(async (c) => {
    await seed(c);
    await c.query(
      `insert into public.saved_calculations (id, project_id, type, inputs, outputs, engine_version, created_by)
       values ($1, $4, 'dew_point', '{}', '{}', 'test', $5),
              ($2, $4, 'mix_ratio', '{}', '{}', 'test', $6),
              ($3, $7, 'spread_rate', '{}', '{}', 'test', $8)`,
      [S.byInstaller, S.byLead, S.onUnassigned, P.assigned, E.installer, E.lead, P.unassigned, E.pm],
    );
  });
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe("saved calculations: signed out", () => {
  it("cannot read or save anything", async () => {
    await asAnon(async (q) => {
      await expect(q("select * from public.saved_calculations")).rejects.toThrow(/permission denied/);
      await expect(q(INSERT, [P.assigned])).rejects.toThrow(/permission denied/);
    });
  });
});

describe("saved calculations: installer", () => {
  it("saves to an assigned project, recorded under their own name", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q(INSERT, [P.assigned]);
      expect(rows[0].created_by).toBe(E.installer);
    });
  });

  it("cannot save to a project they aren't assigned to", async () => {
    await asUser(U.installer, async (q) => {
      await expect(q(INSERT, [P.unassigned])).rejects.toThrow(/row-level security/);
    });
  });

  it("cannot save in someone else's name", async () => {
    await asUser(U.installer, async (q) => {
      await expect(
        q(
          `insert into public.saved_calculations (project_id, type, inputs, outputs, engine_version, created_by)
           values ($1, 'square_footage', '{}', '{}', 'test', $2)`,
          [P.assigned, E.lead],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("sees results on assigned projects only (asking by id returns nothing)", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q("select id from public.saved_calculations");
      expect(ids(rows)).toEqual([S.byInstaller, S.byLead].sort());
      const tamper = await q("select * from public.saved_calculations where id = $1", [S.onUnassigned]);
      expect(tamper.rowCount).toBe(0);
    });
  });

  it("can never edit a saved result, not even their own", async () => {
    await asUser(U.installer, async (q) => {
      await expect(
        q(`update public.saved_calculations set outputs = '{"net": 1}' where id = $1`, [S.byInstaller]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("deletes their own result but not a teammate's", async () => {
    await asUser(U.installer, async (q) => {
      const other = await q("delete from public.saved_calculations where id = $1", [S.byLead]);
      expect(other.rowCount).toBe(0);
      const own = await q("delete from public.saved_calculations where id = $1", [S.byInstaller]);
      expect(own.rowCount).toBe(1);
    });
  });

  it("rejects malformed data at the database too", async () => {
    await asUser(U.installer, async (q) => {
      await expect(
        q(
          `insert into public.saved_calculations (project_id, type, inputs, outputs, engine_version)
           values ($1, 'square_footage', '[1,2]', '{}', 'test')`,
          [P.assigned],
        ),
      ).rejects.toThrow(/check constraint/);
      await expect(
        q(
          `insert into public.saved_calculations (project_id, type, inputs, outputs, engine_version)
           values ($1, 'payroll', '{}', '{}', 'test')`,
          [P.assigned],
        ),
      ).rejects.toThrow(/invalid input value for enum/);
    });
  });
});

describe("saved calculations: other roles", () => {
  it("an installer on no projects sees and saves nothing", async () => {
    await asUser(U.otherInstaller, async (q) => {
      expect((await q("select * from public.saved_calculations")).rowCount).toBe(0);
      await expect(q(INSERT, [P.assigned])).rejects.toThrow(/row-level security/);
    });
  });

  it("a crew lead saves to the project they lead", async () => {
    await asUser(U.lead, async (q) => {
      const { rows } = await q(INSERT, [P.assigned]);
      expect(rows[0].created_by).toBe(E.lead);
      await expect(q(INSERT, [P.unassigned])).rejects.toThrow(/row-level security/);
    });
  });

  it("a project manager sees and saves on any project, and can delete anyone's", async () => {
    await asUser(U.pm, async (q) => {
      expect(ids((await q("select id from public.saved_calculations")).rows)).toEqual(Object.values(S).sort());
      await q(INSERT, [P.unassigned]);
      const del = await q("delete from public.saved_calculations where id = $1", [S.byInstaller]);
      expect(del.rowCount).toBe(1);
    });
  });

  it("an inactive employee sees nothing and saves nothing", async () => {
    await asUser(U.inactive, async (q) => {
      expect((await q("select * from public.saved_calculations")).rowCount).toBe(0);
      await expect(q(INSERT, [P.assigned])).rejects.toThrow(/row-level security/);
    });
  });

  it("every save is written to the audit log", async () => {
    // asUser always rolls back, so commit this one insert to check the log.
    await superuser(async (c) => {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.lead, role: "authenticated", aal: "aal2" })]);
      const { rows } = await c.query(INSERT, [P.assigned]);
      await c.query("commit");
      const log = await c.query(
        "select action, actor_employee_id from audit.log where table_name = 'public.saved_calculations' and row_id = $1",
        [rows[0].id],
      );
      expect(log.rows).toEqual([{ action: "INSERT", actor_employee_id: E.lead }]);
    });
  });
});
