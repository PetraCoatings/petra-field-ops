/**
 * Pay rates: office admins manage them; each person reads only their own;
 * crew leads and project managers can't read anyone else's; changes audited.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, superuser } from "./harness";
import { E, U, seed } from "./fixtures";

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.pay_rates cascade");
    await seed(c);
    await c.query(
      `insert into public.pay_rates (employee_id, category, hourly_rate, effective_from)
       values ($1, 'job', 25, '2026-01-01'), ($1, 'drive', 18, '2026-01-01'), ($1, 'ride', 15, '2026-01-01'),
              ($2, 'job', 30, '2026-01-01')`,
      [E.installer, E.lead],
    );
  });
});

describe("pay rates", () => {
  it("a person reads only their own rates", async () => {
    await asUser(U.installer, async (q) => {
      const rows = (await q("select employee_id, category, hourly_rate from public.pay_rates order by category")).rows;
      expect(rows.map((r) => [r.employee_id, r.category, r.hourly_rate])).toEqual([
        [E.installer, "job", "25.00"],
        [E.installer, "drive", "18.00"],
        [E.installer, "ride", "15.00"],
      ]);
      await expect(q("update public.pay_rates set hourly_rate = 99")).resolves.toMatchObject({ rowCount: 0 });
      await expect(q(`insert into public.pay_rates (employee_id, category, hourly_rate, effective_from) values ($1, 'job', 99, '2026-06-01')`, [E.installer])).rejects.toThrow(/row-level security/);
    });
  });

  it("crew leads and project managers can't see anyone else's rates", async () => {
    for (const u of [U.lead, U.pm]) {
      await asUser(u, async (q) => {
        expect((await q("select count(*)::int as n from public.pay_rates where employee_id = $1", [E.installer])).rows[0].n).toBe(0);
      });
    }
  });

  it("office admins add a raise as a new dated rate; every change is audited", async () => {
    await asUser(U.admin, async (q) => {
      await q(`insert into public.pay_rates (employee_id, category, hourly_rate, effective_from, note) values ($1, 'job', 27, '2026-12-07', 'Raise')`, [E.installer]);
      const job = (await q("select hourly_rate, effective_from::text as d, created_by from public.pay_rates where employee_id = $1 and category = 'job' order by effective_from", [E.installer])).rows;
      expect(job.map((r) => [r.hourly_rate, r.d])).toEqual([
        ["25.00", "2026-01-01"],
        ["27.00", "2026-12-07"],
      ]);
      expect(job[1].created_by).toBe(E.admin);
      await expect(q(`insert into public.pay_rates (employee_id, category, hourly_rate, effective_from) values ($1, 'job', 0, '2026-12-08')`, [E.installer])).rejects.toThrow(/check/);
      const audit = (await q("select action from public.audit_log where table_name = 'public.pay_rates' order by id desc limit 1")).rows;
      expect(audit).toEqual([{ action: "INSERT" }]);
    });
  });
});
