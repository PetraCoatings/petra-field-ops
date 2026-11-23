/**
 * Timesheets: corrections keep the original; who may correct what and when;
 * requests for a fix; lead submit, admin approve (locks), admin reopen.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, superuser, type Q } from "./harness";
import { E, P, U, seed } from "./fixtures";

const WEEK_OF = "2026-11-04T18:00:00Z"; // the week of Monday Nov 2, 2026 (Chicago)
let OLD_SEG = ""; // installer, Tue Nov 3, 6 AM–2 PM Chicago
let OTHER_SEG = ""; // other installer (not on the lead's crew), same day

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.time_change_requests, public.timesheets, public.time_segments, public.time_events cascade");
    await seed(c);
    OLD_SEG = (await c.query(`insert into public.time_segments (employee_id, kind, category, project_id, start_at, end_at)
      values ($1, 'work', 'job', $2, '2026-11-03 12:00Z', '2026-11-03 20:00Z') returning id`, [E.installer, P.assigned])).rows[0].id;
    OTHER_SEG = (await c.query(`insert into public.time_segments (employee_id, kind, category, start_at, end_at)
      values ($1, 'work', 'job', '2026-11-03 12:00Z', '2026-11-03 20:00Z') returning id`, [E.otherInstaller])).rows[0].id;
  });
});

const correct = (q: Q, segment: string | null, reason: string, o: { start?: string; end?: string | null; category?: string; void?: boolean; employee?: string } = {}) =>
  q(`select public.correct_time($1, $2, $3, $4, 'work', $5, null, $6, $7) as id`, [
    segment,
    reason,
    o.start ?? null,
    o.end === undefined ? null : o.end,
    o.category ?? "job",
    o.void ?? false,
    o.employee ?? null,
  ]).then((r) => r.rows[0].id as string | null);

const active = (q: Q, employee: string) =>
  q(`select id, start_at, end_at, source, supersedes_id, correction_reason, corrected_by from public.time_segments
     where employee_id = $1 and status = 'active' order by start_at`, [employee]).then((r) => r.rows);

describe("company workweek", () => {
  it("runs Monday 12:00 AM to Monday 12:00 AM, Chicago time, through daylight saving", async () => {
    await superuser(async (c) => {
      const r = await c.query(`select lower(app.workweek_bounds('2026-11-25 12:00-06')) as s, upper(app.workweek_bounds('2026-11-25 12:00-06')) as e,
        lower(app.workweek_bounds('2026-10-28 12:00-05')) as s2, upper(app.workweek_bounds('2026-10-28 12:00-05')) as e2,
        lower(app.workweek_bounds('2026-11-23 06:00Z')) as exact`);
      expect(r.rows[0].s.toISOString()).toBe("2026-11-23T06:00:00.000Z");
      expect(r.rows[0].e.toISOString()).toBe("2026-11-30T06:00:00.000Z");
      expect(r.rows[0].s2.toISOString()).toBe("2026-10-26T05:00:00.000Z"); // CDT
      expect(r.rows[0].e2.toISOString()).toBe("2026-11-02T06:00:00.000Z"); // back on CST: a 169-hour week
      expect(r.rows[0].exact.toISOString()).toBe("2026-11-23T06:00:00.000Z");
    });
  });
});

describe("fixing your own time", () => {
  it("within 24 hours: replaced by a corrected copy, the original kept", async () => {
    await asUser(U.installer, async (q) => {
      await q(`select public.clock_action(gen_random_uuid(), 'clock_in', now() - interval '3 hours', 'denied', 'job', null, null, null, null, null, now())`);
      await q(`select public.clock_action(gen_random_uuid(), 'clock_out', now() - interval '1 hour', 'denied', null, null, null, null, null, null, now())`);
      const seg = (await q(`select id from public.time_segments where employee_id = $1 and start_at > now() - interval '1 day'`, [E.installer])).rows[0].id;
      await expect(correct(q, seg, "", { start: new Date(Date.now() - 4 * 3_600_000).toISOString(), end: new Date(Date.now() - 3_600_000).toISOString() })).rejects.toThrow(/reason/);
      const r = await q(`select public.correct_time($1, 'Forgot to clock in when I arrived', now() - interval '4 hours', now() - interval '1 hour', 'work', 'job') as id`, [seg]);
      const fixed = (await active(q, E.installer)).find((s) => s.id === r.rows[0].id);
      expect(fixed).toMatchObject({ source: "correction", supersedes_id: seg, correction_reason: "Forgot to clock in when I arrived", corrected_by: E.installer });
      const original = (await q(`select status, source, start_at, end_at from public.time_segments where id = $1`, [seg])).rows[0];
      expect(original.status).toBe("superseded");
      expect(original.source).toBe("events");
      expect(Date.now() - original.start_at.getTime()).toBeGreaterThan(2.9 * 3_600_000); // original times untouched
      expect(Date.now() - original.start_at.getTime()).toBeLessThan(3.1 * 3_600_000);
    });
  });

  it("after 24 hours: refused; the person asks for a fix instead", async () => {
    await asUser(U.installer, async (q) => {
      await expect(correct(q, OLD_SEG, "Wrong end time", { start: "2026-11-03 12:00Z", end: "2026-11-03 21:00Z" })).rejects.toThrow(/Too late/);
      await expect(correct(q, OTHER_SEG, "Not mine", { start: "2026-11-03 12:00Z", end: "2026-11-03 21:00Z" })).rejects.toThrow(/can't change/);
      await q(`select public.request_time_change($1, 'I worked until 3 PM, not 2 PM', $2)`, [WEEK_OF, OLD_SEG]);
      const req = (await q(`select week_start, status from public.time_change_requests`)).rows;
      expect(req).toHaveLength(1);
      expect(req[0].week_start.toISOString()).toBe("2026-11-02T06:00:00.000Z");
      await expect(q(`select public.resolve_time_change(id) from public.time_change_requests`)).rejects.toThrow(/crew lead or the office/);
    });
  });
});

describe("crew leads, project managers and office admins", () => {
  it("a crew lead fixes their crew's time, not anyone else's", async () => {
    await asUser(U.lead, async (q) => {
      const id = await correct(q, OLD_SEG, "Worked until 3 PM", { start: "2026-11-03 12:00Z", end: "2026-11-03 21:00Z" });
      expect((await active(q, E.installer)).map((s) => s.id)).toEqual([id]);
      await expect(correct(q, OTHER_SEG, "Not my crew", { start: "2026-11-03 12:00Z", end: "2026-11-03 21:00Z" })).rejects.toThrow(/can't change/);
      expect(await active(q, E.otherInstaller)).toHaveLength(0); // can't even see it
      // Adding a missed day, and a fix that would overlap, for the crew member
      await correct(q, null, "Forgot to clock in Wednesday", { start: "2026-11-04 12:00Z", end: "2026-11-04 20:00Z", employee: E.installer });
      await expect(correct(q, null, "Duplicate", { start: "2026-11-04 19:00Z", end: "2026-11-04 21:00Z", employee: E.installer })).rejects.toThrow(/overlaps/);
      // Removing an entry needs a reason too, and keeps the row (as void)
      await correct(q, id, "Entered on the wrong day", { void: true });
      const voided = (await q(`select status, correction_reason, corrected_by from public.time_segments where id = $1`, [id])).rows[0];
      expect(voided).toEqual({ status: "void", correction_reason: "Entered on the wrong day", corrected_by: E.lead });
    });
  });

  it("project managers don't see crew time or clock in others", async () => {
    await asUser(U.pm, async (q) => {
      expect((await q(`select count(*)::int as n from public.time_segments where employee_id = $1`, [E.installer])).rows[0].n).toBe(0);
      await expect(correct(q, OLD_SEG, "Fix", { start: "2026-11-03 12:00Z", end: "2026-11-03 21:00Z" })).rejects.toThrow(/can't change/);
      await expect(q(`select public.clock_action(gen_random_uuid(), 'clock_in', now(), 'denied', 'job', null, null, null, null, array[$1]::uuid[], now())`, [E.installer])).rejects.toThrow(/crew leads/);
      await expect(q(`select * from public.crew_clock_status(array[$1]::uuid[])`, [E.installer])).rejects.toThrow(/crew leads/);
    });
  });
});

describe("submit, approve, reopen", () => {
  it("lead submits; then only the office can fix; admin approves and the week locks; reopen needs a reason", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      const as = async (user: string) => {
        await c.query("reset role");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
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
        await as(U.installer);
        await expect(tryQ(`select public.submit_timesheet($1, $2)`, [E.installer, WEEK_OF])).rejects.toThrow(/crew lead/);

        await as(U.lead);
        await tryQ(`select public.submit_timesheet($1, $2)`, [E.installer, WEEK_OF]);
        await expect(tryQ(`select public.submit_timesheet($1, $2)`, [E.installer, WEEK_OF])).rejects.toThrow(/already submitted/);
        await expect(tryQ(`select public.correct_time($1, 'late fix', '2026-11-03 12:00Z', '2026-11-03 21:00Z', 'work', 'job')`, [OLD_SEG])).rejects.toThrow(/already submitted/);
        await expect(tryQ(`select public.approve_timesheet($1, $2)`, [E.installer, WEEK_OF])).rejects.toThrow(/office admin/);
        const ts = (await tryQ(`select status, submitted_by from public.timesheets where employee_id = $1`, [E.installer])).rows[0];
        expect(ts).toEqual({ status: "submitted", submitted_by: E.lead });

        await as(U.admin);
        const fixed = (await tryQ(`select public.correct_time($1, 'Per crew lead text', '2026-11-03 12:00Z', '2026-11-03 21:00Z', 'work', 'job') as id`, [OLD_SEG])).rows[0].id;
        await tryQ(`select public.approve_timesheet($1, $2)`, [E.installer, WEEK_OF]);
        await expect(tryQ(`select public.correct_time($1, 'after approval', '2026-11-03 12:00Z', '2026-11-03 22:00Z', 'work', 'job')`, [fixed])).rejects.toThrow(/approved and locked/);
        await expect(tryQ(`select public.correct_time(null, 'add after approval', '2026-11-05 12:00Z', '2026-11-05 14:00Z', 'work', 'job', null, false, $1)`, [E.installer])).rejects.toThrow(/approved and locked/);
        // Locked even for the database owner.
        await c.query("reset role");
        await expect(tryQ(`update public.time_segments set end_at = end_at + interval '1 hour' where id = $1`, [fixed])).rejects.toThrow(/approved and locked/);
        // Another person's week isn't affected.
        await tryQ(`update public.time_segments set end_at = end_at + interval '1 minute' where id = $1`, [OTHER_SEG]);

        await as(U.admin);
        await expect(tryQ(`select public.reopen_timesheet($1, $2, '')`, [E.installer, WEEK_OF])).rejects.toThrow(/reason/);
        await tryQ(`select public.reopen_timesheet($1, $2, 'Missed a day of drive time')`, [E.installer, WEEK_OF]);
        await tryQ(`select public.correct_time($1, 'after reopening', '2026-11-03 12:00Z', '2026-11-03 22:00Z', 'work', 'job')`, [fixed]);
        const after = (await tryQ(`select status, reopen_reason, approved_by from public.timesheets where employee_id = $1`, [E.installer])).rows[0];
        expect(after).toEqual({ status: "open", reopen_reason: "Missed a day of drive time", approved_by: null });
        // Approve again, then remove the employee: their locked records go with them.
        await tryQ(`select public.approve_timesheet($1, $2)`, [E.installer, WEEK_OF]);
        await c.query("reset role");
        await tryQ(`delete from public.employees where id = $1`, [E.installer]);
        expect((await tryQ(`select count(*)::int as n from public.time_segments where employee_id = $1`, [E.installer])).rows[0].n).toBe(0);
      } finally {
        await c.query("rollback");
      }
    });
  });

  it("a week with a missing clock-out can't be submitted or approved", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      try {
        await c.query(`insert into public.time_segments (employee_id, kind, category, start_at) values ($1, 'work', 'job', '2026-11-05 12:00Z')`, [E.installer]);
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.lead, role: "authenticated" })]);
        await c.query("set local role authenticated");
        await expect(c.query(`select public.submit_timesheet($1, $2)`, [E.installer, WEEK_OF])).rejects.toThrow(/missing clock-out/);
      } finally {
        await c.query("rollback");
      }
    });
  });

  it("requests: the lead sees and resolves their crew's requests", async () => {
    await asUser(U.installer, async (q) => {
      await q(`select public.request_time_change($1, 'Please add Thursday drive time', null)`, [WEEK_OF]);
    }); // rolled back: make a committed one instead
    await superuser((c) => c.query(`insert into public.time_change_requests (id, employee_id, week_start, message) values ($1, $2, '2026-11-02 06:00Z', 'Please add Thursday drive time')`, [randomUUID(), E.installer]));
    await asUser(U.otherInstaller, async (q) => {
      expect((await q(`select count(*)::int as n from public.time_change_requests`)).rows[0].n).toBe(0);
    });
    await asUser(U.lead, async (q) => {
      const [req] = (await q(`select id from public.time_change_requests where status = 'open'`)).rows;
      await q(`select public.resolve_time_change($1, 'Added it')`, [req.id]);
      expect((await q(`select status, resolved_by, resolution_note from public.time_change_requests where id = $1`, [req.id])).rows[0]).toEqual({
        status: "resolved",
        resolved_by: E.lead,
        resolution_note: "Added it",
      });
    });
  });
});
