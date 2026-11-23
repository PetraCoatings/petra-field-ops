/**
 * Phase 9c security fixes (migration 20261129000100): late clock presses,
 * crew lead reach, corrections on jobs you can't see, work order pointers,
 * product approval metadata, and deleting records that must be kept.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, superuser } from "./harness";
import { E, P, U, seed } from "./fixtures";

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.time_change_requests, public.timesheets, public.time_segments, public.time_events cascade");
    await seed(c);
  });
});

const press = (action: string, at: string, opts: { category?: string; people?: string[]; deviceNow?: string } = {}) => ({
  sql: `select public.clock_action($1, $2::public.time_event_type, ${at}, 'denied', $3::public.time_category, null, null, null, null, $4::uuid[], ${opts.deviceNow ?? "now()"}) as r`,
  params: [randomUUID(), action, opts.category ?? (action === "clock_in" ? "job" : null), opts.people ?? null],
});

describe("late clock presses", () => {
  it("are flagged after 15 minutes and refused after 3 days", async () => {
    await asUser(U.installer, async (q) => {
      const old = press("clock_in", "now() - interval '4 days'");
      expect((await q(old.sql, old.params)).rows[0].r).toEqual([{ employee_id: E.installer, ok: false, error: "too_late" }]);
      const late = press("clock_in", "now() - interval '2 hours'");
      expect((await q(late.sql, late.params)).rows[0].r[0]).toMatchObject({ ok: true });
      // The same press sent again still replays fine.
      expect((await q(late.sql, late.params)).rows[0].r[0]).toMatchObject({ ok: true, replayed: true });
      const out = press("clock_out", "now()");
      await q(out.sql, out.params);
      const flags = (await q(`select event_type::text as t, flags from public.time_events where employee_id = $1 order by effective_at`, [E.installer])).rows;
      expect(flags).toEqual([
        { t: "clock_in", flags: ["late_sync"] },
        { t: "clock_out", flags: [] },
      ]);
    });
  });
});

describe("crew lead reach", () => {
  it("clocking in an office admin once doesn't let a crew lead see or fix their time", async () => {
    await asUser(U.lead, async (q) => {
      const p = press("clock_in", "now() - interval '1 hour'", { people: [E.lead, E.admin, E.otherInstaller] });
      expect((await q(p.sql, p.params)).rows[0].r.every((x: { ok: boolean }) => x.ok)).toBe(true);
      const leads = async (who: string) => (await q(`select app.leads_employee($1) as ok`, [who])).rows[0].ok;
      expect(await leads(E.admin)).toBe(false);
      expect(await leads(E.pm)).toBe(false);
      expect(await leads(E.otherInstaller)).toBe(true); // a helper they clocked in
      expect(await leads(E.lead)).toBe(true); // themselves
      const seg = (await q(`select id from public.time_segments where employee_id = $1`, [E.admin])).rows;
      expect(seg).toEqual([]);
    });
  });

  it("a crew lead can't fix crew time older than last week", async () => {
    const seg = await superuser(async (c) =>
      (await c.query(`insert into public.time_segments (employee_id, kind, category, start_at, end_at)
        values ($1, 'work', 'job', now() - interval '20 days', now() - interval '20 days' + interval '8 hours') returning id`, [E.installer])).rows[0].id as string,
    );
    await asUser(U.lead, async (q) => {
      await expect(
        q(`select public.correct_time($1, 'Worked longer', now() - interval '20 days', now() - interval '20 days' + interval '9 hours', 'work', 'job')`, [seg]),
      ).rejects.toThrow(/too old to fix here/);
    });
    await asUser(U.admin, async (q) => {
      expect((await q(`select public.correct_time($1, 'Per the crew lead', now() - interval '20 days', now() - interval '20 days' + interval '9 hours', 'work', 'job') as id`, [seg])).rows[0].id).toBeTruthy();
    });
  });
});

describe("corrections", () => {
  it("can't put time on a job the person fixing it can't see", async () => {
    await asUser(U.installer, async (q) => {
      await expect(
        q(`select public.correct_time(null, 'Forgot to clock in', now() - interval '5 hours', now() - interval '4 hours', 'work', 'job', $1)`, [P.unassigned]),
      ).rejects.toThrow(/Unknown job/);
      expect(
        (await q(`select public.correct_time(null, 'Forgot to clock in', now() - interval '5 hours', now() - interval '4 hours', 'work', 'job', $1) as id`, [P.assigned])).rows[0].id,
      ).toBeTruthy();
    });
  });
});

describe("work orders", () => {
  it("the office can rename or void a work order, not move it or swap its revision", async () => {
    await asUser(U.pm, async (q) => {
      const id = (await q(`insert into public.field_work_orders (project_id, title) values ($1, 'WO') returning id`, [P.assigned])).rows[0].id;
      await q(`insert into public.fwo_drafts (fwo_id, content) values ($1, $2)`, [id, JSON.stringify({ v: 1, notes: "x", trailerMaterials: [{ item: "A" }] })]);
      await q(`select public.publish_fwo($1)`, [id]); // publishing still works
      await q(`update public.field_work_orders set title = 'Recoat, phase 2' where id = $1`, [id]);
      await expect(q(`update public.field_work_orders set project_id = $2 where id = $1`, [id, P.unassigned])).rejects.toThrow(/renamed or voided/);
      await expect(q(`update public.field_work_orders set current_revision_id = null where id = $1`, [id])).rejects.toThrow(/renamed or voided/);
      await expect(q(`update public.field_work_orders set status = 'draft' where id = $1`, [id])).rejects.toThrow(/renamed or voided/);
      await q(`update public.field_work_orders set status = 'void' where id = $1`, [id]);
      await expect(q(`update public.field_work_orders set status = 'published' where id = $1`, [id])).rejects.toThrow(/renamed or voided/);
    });
  });
});

describe("product approvals", () => {
  it("who approved a product, and when, can't be typed in", async () => {
    await asUser(U.admin, async (q) => {
      const id = (await q(`insert into public.products (name, spec_status) values ('Sikafloor 161', 'approved') returning id, approved_by`)).rows[0];
      expect(id.approved_by).toBe(E.admin);
      const r = (await q(`update public.products set approved_by = $2, approved_at = '2020-01-01', description = 'Primer' where id = $1 returning approved_by, approved_at`, [id.id, E.pm])).rows[0];
      expect(r.approved_by).toBe(E.admin);
      expect(r.approved_at.getFullYear()).toBeGreaterThan(2020);
    });
  });
});

describe("records that must be kept", () => {
  it("an employee with time records, or a job with submitted daily reports, can't be deleted from the app", async () => {
    await superuser(async (c) => {
      await c.query(`insert into public.time_segments (employee_id, kind, category, start_at, end_at)
        values ($1, 'work', 'job', now() - interval '30 days', now() - interval '30 days' + interval '1 hour')`, [E.otherInstaller]);
      const dfr = (await c.query(`insert into public.daily_field_reports (project_id, report_date, status) values ($1, current_date - 30, 'submitted') returning id`, [P.unassigned])).rows[0].id;
      await c.query(`insert into public.dfr_versions (dfr_id, version_number, content) values ($1, 1, '{}')`, [dfr]);
    });
    await asUser(U.admin, async (q) => {
      await expect(q(`delete from public.employees where id = $1`, [E.otherInstaller])).rejects.toThrow(/time records/);
      await expect(q(`delete from public.projects where id = $1`, [P.unassigned])).rejects.toThrow(/daily reports/);
      expect((await q(`delete from public.employees where id = $1`, [E.inactive])).rowCount).toBe(1); // no records: fine
    });
  });

  it("payroll lines are in the audit log", async () => {
    await superuser(async (c) => {
      const r = await c.query(`select 1 from pg_trigger where tgname = 'audit_payroll_lines' and tgrelid = 'public.payroll_lines'::regclass`);
      expect(r.rowCount).toBe(1);
    });
  });
});
