/**
 * Payroll runs: office admins only; every week with hours must be approved;
 * a period can't be marked entered twice without a reason; snapshots are permanent.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, superuser } from "./harness";
import { E, U, seed } from "./fixtures";

const line = (employee: string, week: string, hours: number) => ({
  employee_id: employee,
  employee_name: "Ivan Test",
  exempt: false,
  week_start: week,
  entries: [{ category: "job", rate_cents: 2500, hours }],
  total_hours: hours,
  regular_hours: Math.min(40, hours),
  overtime_hours: Math.max(0, hours - 40),
  check_gross_cents: hours * 2500,
  details: {},
});

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.payroll_runs, public.payroll_lines, public.timesheets cascade");
    await seed(c);
  });
});

const record = `select public.record_payroll_run('2026-11-16', '2026-11-29', 'test', 'hash', $1::jsonb, $2) as id`;

describe("payroll runs", () => {
  it("only office admins record or read payroll", async () => {
    for (const u of [U.pm, U.lead, U.installer]) {
      await asUser(u, async (q) => {
        await expect(q(record, [JSON.stringify([]), null])).rejects.toThrow(/office admin/);
        expect((await q("select count(*)::int as n from public.payroll_runs")).rows[0].n).toBe(0);
      });
    }
  });

  it("weeks must be approved; a period is entered once unless replaced with a reason; snapshots are permanent", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      const as = async () => {
        await c.query("reset role");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.admin, role: "authenticated" })]);
        await c.query("set local role authenticated");
      };
      const tryQ = async (sql: string, params: unknown[] = []) => {
        await c.query("savepoint s");
        try {
          const r = await c.query(sql, params);
          await c.query("release savepoint s");
          return r;
        } catch (e) {
          await c.query("rollback to savepoint s");
          throw e;
        }
      };
      try {
        await as();
        const lines = JSON.stringify([line(E.installer, "2026-11-16", 42), line(E.installer, "2026-11-23", 0)]);
        await expect(tryQ(record, [lines, null])).rejects.toThrow(/must be approved/);
        await tryQ(`select public.approve_timesheet($1, '2026-11-18 12:00-06')`, [E.installer]);
        const first = (await tryQ(record, [lines, null])).rows[0].id;
        const saved = (await tryQ(`select employee_name, total_hours, overtime_hours, entries from public.payroll_lines where run_id = $1 order by week_start`, [first])).rows;
        expect(saved.map((r) => [r.total_hours, r.overtime_hours])).toEqual([
          ["42.00", "2.00"],
          ["0.00", "0.00"],
        ]);
        await expect(tryQ(record, [lines, null])).rejects.toThrow(/already marked entered/);
        const second = (await tryQ(record, [lines, "Fixed Tuesday drive hours"])).rows[0].id;
        const runs = (await tryQ(`select id, voided_at is not null as voided, void_reason from public.payroll_runs order by entered_at, voided_at nulls last`)).rows;
        expect(runs.find((r) => r.id === first)).toMatchObject({ voided: true, void_reason: "Fixed Tuesday drive hours" });
        expect(runs.find((r) => r.id === second)).toMatchObject({ voided: false });

        await c.query("reset role");
        await expect(tryQ(`update public.payroll_lines set total_hours = 1 where run_id = $1`, [second])).rejects.toThrow(/cannot be changed/);
        await expect(tryQ(`delete from public.payroll_runs where id = $1`, [second])).rejects.toThrow(/cannot be deleted/);
        await expect(tryQ(`update public.payroll_runs set input_hash = 'x' where id = $1`, [second])).rejects.toThrow(/cannot be changed/);
        await expect(tryQ(`update public.payroll_runs set void_reason = 'other' where id = $1`, [first])).rejects.toThrow(/cannot be changed/);
      } finally {
        await c.query("rollback");
      }
    });
  });
});
