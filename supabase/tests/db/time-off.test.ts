/**
 * Time off: request → crew lead → office; rejections at each stage need a
 * reason; notifications at each step; who sees what; calendar.
 */
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { superuser } from "./harness";
import { E, U, seed } from "./fixtures";

let VACATION = "";

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.time_off_requests, public.notifications cascade");
    await seed(c);
    VACATION = (await c.query("select id from public.leave_types where name = 'Vacation'")).rows[0].id;
  });
});

/** Runs a scenario in one transaction (rolled back), switching between signed-in users. */
async function scenario(fn: (as: (user: string) => Promise<void>, q: (sql: string, p?: unknown[]) => Promise<Record<string, unknown>[]>, c: Client) => Promise<void>) {
  await superuser(async (c) => {
    await c.query("begin");
    const as = async (user: string) => {
      await c.query("reset role");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
      await c.query("set local role authenticated");
    };
    const q = async (sql: string, p: unknown[] = []) => {
      await c.query("savepoint s");
      try {
        const r = await c.query(sql, p);
        await c.query("release savepoint s");
        return r.rows;
      } catch (e) {
        await c.query("rollback to savepoint s");
        throw e;
      }
    };
    try {
      await fn(as, q, c);
    } finally {
      await c.query("rollback");
    }
  });
}

const request = (q: (s: string, p?: unknown[]) => Promise<Record<string, unknown>[]>, start: string, end: string, hours: number | null = null) =>
  q(`select public.request_time_off($1, $2, $3, $4, 'Family trip') as id`, [VACATION, start, end, hours]).then((r) => r[0].id as string);
const notes = (q: (s: string, p?: unknown[]) => Promise<Record<string, unknown>[]>) =>
  q(`select type, data ->> 'status' as status from public.notifications order by created_at, type`);

describe("time off", () => {
  it("full approval: crew lead, then office; each step notifies the next person", async () => {
    await scenario(async (as, q) => {
      await as(U.installer);
      const id = await request(q, "2026-12-21", "2026-12-23");
      expect((await q(`select status from public.time_off_requests where id = $1`, [id]))[0].status).toBe("pending_lead");
      await expect(q(`select public.decide_time_off($1, true)`, [id])).rejects.toThrow(/your own/);

      await as(U.lead);
      expect(await notes(q)).toEqual([{ type: "time_off_requested", status: "pending_lead" }]);
      await as(U.pm); // the job's project manager is told too
      expect(await notes(q)).toEqual([{ type: "time_off_requested", status: "pending_lead" }]);
      await as(U.otherInstaller);
      await expect(q(`select public.decide_time_off($1, true)`, [id])).rejects.toThrow(/crew lead or the office/);
      expect(await q(`select id from public.time_off_requests`)).toEqual([]);

      await as(U.lead);
      expect((await q(`select public.decide_time_off($1, true, 'Fine by me') as s`, [id]))[0].s).toBe("pending_office");
      await expect(q(`select public.decide_time_off($1, true)`, [id])).rejects.toThrow(/office admin gives the final/);

      await as(U.admin);
      expect(await notes(q)).toEqual([{ type: "time_off_requested", status: "pending_office" }]);
      expect((await q(`select public.decide_time_off($1, true) as s`, [id]))[0].s).toBe("approved");
      await expect(q(`select public.decide_time_off($1, false, 'no')`, [id])).rejects.toThrow(/already decided/);

      await as(U.installer);
      expect(await notes(q)).toEqual([{ type: "time_off_decided", status: "approved" }]);
      const r = (await q(`select lead_decision_by, lead_decision_note, office_decision_by from public.time_off_requests where id = $1`, [id]))[0];
      expect(r).toEqual({ lead_decision_by: E.lead, lead_decision_note: "Fine by me", office_decision_by: E.admin });

      // On the calendar: the person and their crew lead see it; others don't.
      const cal = `select title, start_text from public.my_calendar('2026-12-20', '2026-12-24') where kind = 'time_off'`;
      expect(await q(cal)).toHaveLength(3);
      await as(U.lead);
      expect((await q(cal))[0]).toEqual({ title: "Ivan Test: Vacation", start_text: null });
      await as(U.otherInstaller);
      expect(await q(cal)).toHaveLength(0);
    });
  });

  it("rejected by the crew lead (a reason is required)", async () => {
    await scenario(async (as, q) => {
      await as(U.installer);
      const id = await request(q, "2026-12-28", "2026-12-28", 4);
      await as(U.lead);
      await expect(q(`select public.decide_time_off($1, false)`, [id])).rejects.toThrow(/reason/);
      expect((await q(`select public.decide_time_off($1, false, 'We need you on the Xbow job') as s`, [id]))[0].s).toBe("rejected");
      await as(U.installer);
      expect(await notes(q)).toEqual([{ type: "time_off_decided", status: "rejected" }]);
      await as(U.admin);
      expect(await notes(q)).toEqual([]); // the office isn't asked about it
    });
  });

  it("rejected by the office after the crew lead approved", async () => {
    await scenario(async (as, q) => {
      await as(U.installer);
      const id = await request(q, "2027-01-04", "2027-01-05");
      await as(U.lead);
      await q(`select public.decide_time_off($1, true)`, [id]);
      await as(U.admin);
      expect((await q(`select public.decide_time_off($1, false, 'Blackout week') as s`, [id]))[0].s).toBe("rejected");
      await as(U.installer);
      expect((await q(`select status, office_decision_note from public.time_off_requests where id = $1`, [id]))[0]).toEqual({ status: "rejected", office_decision_note: "Blackout week" });
    });
  });

  it("no crew lead: straight to the office; overlaps refused; cancelling", async () => {
    await scenario(async (as, q) => {
      await as(U.otherInstaller); // on no job
      const id = await request(q, "2026-12-14", "2026-12-15");
      expect((await q(`select status from public.time_off_requests where id = $1`, [id]))[0].status).toBe("pending_office");
      await expect(request(q, "2026-12-15", "2026-12-16")).rejects.toThrow(/already asked/);
      await expect(q(`select public.request_time_off($1, '2026-12-20', '2026-12-19')`, [VACATION])).rejects.toThrow(/before the first/);
      await as(U.admin);
      expect(await notes(q)).toEqual([{ type: "time_off_requested", status: "pending_office" }]);
      await as(U.otherInstaller);
      await q(`select public.cancel_time_off($1)`, [id]);
      expect((await q(`select status from public.time_off_requests where id = $1`, [id]))[0].status).toBe("cancelled");
      await expect(q(`select public.cancel_time_off($1)`, [id])).rejects.toThrow(/can't be cancelled/);
      // Days are free again.
      await request(q, "2026-12-15", "2026-12-16");
    });
  });

  it("approved time off that already started can only be cancelled by the office", async () => {
    await scenario(async (as, q, c) => {
      await as(U.otherInstaller);
      const id = await request(q, "2026-01-05", "2026-01-06");
      await c.query("reset role");
      await c.query(`update public.time_off_requests set status = 'approved' where id = $1`, [id]);
      await as(U.otherInstaller);
      await expect(q(`select public.cancel_time_off($1)`, [id])).rejects.toThrow(/can't be cancelled/);
      await as(U.admin);
      await q(`select public.cancel_time_off($1)`, [id]);
    });
  });
});
