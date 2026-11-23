/**
 * Time Clock: clock_action() builds segments from button presses; overlap is
 * impossible; presses are idempotent and permanent; group actions are
 * attributed to the crew lead with the GPS labelled as the lead's device.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, superuser, type Q } from "./harness";
import { E, P, U, seed } from "./fixtures";

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.time_segments, public.time_events cascade");
    await seed(c);
  });
});

type Opts = {
  category?: string | null;
  project?: string | null;
  gps?: { lat: number; lng: number } | "denied";
  employees?: string[] | null;
  id?: string;
  deviceNow?: string; // SQL expression; defaults to now()
};

async function act(q: Q, action: string, ts: string, o: Opts = {}) {
  const gps = o.gps ?? "denied";
  const r = await q(
    `select public.clock_action($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, ${o.deviceNow ?? "now()"}) as r`,
    [
      o.id ?? randomUUID(),
      action,
      ts,
      gps === "denied" ? "denied" : "captured",
      o.category ?? null,
      o.project ?? null,
      gps === "denied" ? null : gps.lat,
      gps === "denied" ? null : gps.lng,
      gps === "denied" ? null : 8,
      o.employees ?? null,
    ],
  );
  return r.rows[0].r as { employee_id: string; ok: boolean; error?: string; replayed?: boolean }[];
}

/** Yesterday at hh:mm (UTC), as an ISO string: safely in the past for every test. */
async function yesterday(q: Q, hhmm: string, plusDays = 0): Promise<string> {
  const r = await q(`select (date_trunc('day', now()) - interval '1 day' + ($1 || ' days')::interval + $2::time)::timestamptz as t`, [
    String(plusDays),
    hhmm,
  ]);
  return (r.rows[0].t as Date).toISOString();
}

const segments = (q: Q, employee: string) =>
  q(
    `select kind, category, project_id, start_at, end_at, extract(epoch from (end_at - start_at)) / 60 as minutes
     from public.time_segments where employee_id = $1 and status = 'active' order by start_at`,
    [employee],
  ).then((r) => r.rows);

describe("the 6:00 / 7:15 / 4:30 / 5:45 day", () => {
  it("drive in, switch to job, switch to drive, clock out: three correct segments", async () => {
    await asUser(U.installer, async (q) => {
      expect(await act(q, "clock_in", await yesterday(q, "06:00"), { category: "drive" })).toEqual([
        { employee_id: E.installer, ok: true, replayed: false },
      ]);
      expect((await act(q, "switch", await yesterday(q, "07:15"), { category: "job", project: P.assigned }))[0].ok).toBe(true);
      expect((await act(q, "switch", await yesterday(q, "16:30"), { category: "drive" }))[0].ok).toBe(true);
      expect((await act(q, "clock_out", await yesterday(q, "17:45"), { gps: { lat: 29.68, lng: -97.65 } }))[0].ok).toBe(true);

      const segs = await segments(q, E.installer);
      expect(segs.map((s) => [s.kind, s.category, s.project_id, Number(s.minutes)])).toEqual([
        ["work", "drive", null, 75],
        ["work", "job", P.assigned, 555],
        ["work", "drive", null, 75],
      ]);
      // The segments touch end to start: no gaps, no overlaps.
      expect(segs[0].end_at).toEqual(segs[1].start_at);
      expect(segs[1].end_at).toEqual(segs[2].start_at);

      const events = (await q("select event_type, actor_employee_id, gps_status, gps_source from public.time_events where employee_id = $1 order by effective_at", [E.installer])).rows;
      expect(events.map((e) => e.event_type)).toEqual(["clock_in", "switch", "switch", "clock_out"]);
      expect(events.every((e) => e.actor_employee_id === E.installer)).toBe(true);
      expect(events[3]).toMatchObject({ gps_status: "captured", gps_source: "own_device" });
      expect(events[0]).toMatchObject({ gps_status: "denied", gps_source: null });
    });
  });
});

describe("rules", () => {
  it("rejects actions out of order", async () => {
    await asUser(U.installer, async (q) => {
      expect((await act(q, "switch", await yesterday(q, "06:00"), { category: "job" }))[0].error).toBe("not_clocked_in");
      expect((await act(q, "clock_out", await yesterday(q, "06:00")))[0].error).toBe("not_clocked_in");
      expect((await act(q, "clock_in", await yesterday(q, "06:00")))[0].error).toBe("category_required");
      await act(q, "clock_in", await yesterday(q, "06:00"), { category: "job" });
      expect((await act(q, "clock_in", await yesterday(q, "07:00"), { category: "job" }))[0].error).toBe("already_clocked_in");
      expect((await act(q, "switch", await yesterday(q, "07:00"), { category: "job" }))[0].error).toBe("no_change");
      expect((await act(q, "break_end", await yesterday(q, "07:00")))[0].error).toBe("not_on_lunch");
      expect((await act(q, "clock_out", await yesterday(q, "05:00")))[0].error).toBe("before_last_entry");
      await act(q, "clock_out", await yesterday(q, "10:00"));
      // Clocking in again can't start before the last clock-out.
      expect((await act(q, "clock_in", await yesterday(q, "09:00"), { category: "job" }))[0].error).toBe("before_last_entry");
    });
  });

  it("a retried press is recorded once", async () => {
    await asUser(U.installer, async (q) => {
      const id = randomUUID();
      const ts = await yesterday(q, "06:00");
      expect((await act(q, "clock_in", ts, { category: "job", id }))[0]).toMatchObject({ ok: true, replayed: false });
      expect((await act(q, "clock_in", ts, { category: "job", id }))[0]).toMatchObject({ ok: true, replayed: true });
      expect((await q("select count(*)::int as n from public.time_events where employee_id = $1", [E.installer])).rows[0].n).toBe(1);
      expect(await segments(q, E.installer)).toHaveLength(1);
    });
  });

  it("lunch: end lunch resumes the same work; clock out on lunch closes it", async () => {
    await asUser(U.installer, async (q) => {
      await act(q, "clock_in", await yesterday(q, "06:00"), { category: "job", project: P.assigned });
      await act(q, "break_start", await yesterday(q, "11:30"));
      expect((await act(q, "switch", await yesterday(q, "11:40"), { category: "drive" }))[0].error).toBe("on_lunch");
      expect((await act(q, "break_start", await yesterday(q, "11:40")))[0].error).toBe("on_lunch");
      await act(q, "break_end", await yesterday(q, "12:00"));
      await act(q, "break_start", await yesterday(q, "15:00"));
      await act(q, "clock_out", await yesterday(q, "15:20"));
      const segs = await segments(q, E.installer);
      expect(segs.map((s) => [s.kind, s.category, s.project_id, Number(s.minutes)])).toEqual([
        ["work", "job", P.assigned, 330],
        ["lunch", "job", P.assigned, 30],
        ["work", "job", P.assigned, 180],
        ["lunch", "job", P.assigned, 20],
      ]);
    });
  });

  it("a shift past midnight stays one continuous segment", async () => {
    await asUser(U.installer, async (q) => {
      await act(q, "clock_in", await yesterday(q, "22:00", -1), { category: "job" });
      await act(q, "clock_out", await yesterday(q, "02:00"));
      expect((await segments(q, E.installer)).map((s) => Number(s.minutes))).toEqual([240]);
    });
  });

  it("a missing clock-out leaves the segment open and blocks a new clock-in", async () => {
    await asUser(U.installer, async (q) => {
      await act(q, "clock_in", await yesterday(q, "06:00", -1), { category: "job" });
      expect((await act(q, "clock_in", await yesterday(q, "06:00"), { category: "job" }))[0].error).toBe("already_clocked_in");
      const segs = await segments(q, E.installer);
      expect(segs).toHaveLength(1);
      expect(segs[0].end_at).toBeNull();
    });
  });

  it("corrects a phone clock that is wrong, and flags it", async () => {
    await asUser(U.installer, async (q) => {
      // The phone is an hour fast: it says it's now()+1h and the press was 5 minutes before that.
      const r = await q(
        `select public.clock_action(gen_random_uuid(), 'clock_in', now() + interval '55 minutes', 'denied', 'job',
           null, null, null, null, null, now() + interval '1 hour') as r`,
      );
      expect(r.rows[0].r[0].ok).toBe(true);
      const ev = (await q("select flags, effective_at = now() - interval '5 minutes' as corrected from public.time_events where employee_id = $1 order by server_received_at desc limit 1", [E.installer])).rows[0];
      expect(ev.flags).toEqual(["clock_skew"]);
      expect(ev.corrected).toBe(true);
    });
  });

  it("rejects a time in the future and GPS values that disagree with their status", async () => {
    await asUser(U.installer, async (q) => {
      await expect(q(`select public.clock_action(gen_random_uuid(), 'clock_in', now() + interval '5 minutes', 'denied', 'job', null, null, null, null, null, now() + interval '5 minutes')`)).rejects.toThrow(/future/);
      await expect(q(`select public.clock_action(gen_random_uuid(), 'clock_in', now(), 'captured', 'job')`)).rejects.toThrow(/GPS/);
      await expect(q(`select public.clock_action(gen_random_uuid(), 'clock_in', now(), 'denied', 'job', $1)`, [P.unassigned])).rejects.toThrow(/Unknown job/);
    });
  });
});

describe("overlap is impossible", () => {
  it("the database refuses overlapping or second open segments, even written directly", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      try {
        await c.query(`insert into public.time_segments (employee_id, kind, category, start_at, end_at) values ($1, 'work', 'job', '2026-11-02 12:00Z', '2026-11-02 20:00Z')`, [E.otherInstaller]);
        await c.query("savepoint a");
        await expect(c.query(`insert into public.time_segments (employee_id, kind, category, start_at, end_at) values ($1, 'work', 'drive', '2026-11-02 19:00Z', '2026-11-02 21:00Z')`, [E.otherInstaller])).rejects.toThrow(/time_segments_no_overlap/);
        await c.query("rollback to savepoint a");
        // Touching end to start is fine.
        await c.query(`insert into public.time_segments (employee_id, kind, category, start_at, end_at) values ($1, 'work', 'drive', '2026-11-02 20:00Z', '2026-11-02 21:00Z')`, [E.otherInstaller]);
        await c.query(`insert into public.time_segments (employee_id, kind, category, start_at) values ($1, 'work', 'job', '2026-11-03 12:00Z')`, [E.otherInstaller]);
        await c.query("savepoint b");
        await expect(c.query(`insert into public.time_segments (employee_id, kind, category, start_at) values ($1, 'work', 'job', '2026-11-04 12:00Z')`, [E.otherInstaller])).rejects.toThrow(/time_segments_no_overlap|time_segments_one_open/);
        await c.query("rollback to savepoint b");
        // A superseded (replaced) segment doesn't count.
        await c.query(`insert into public.time_segments (employee_id, kind, category, start_at, end_at, status) values ($1, 'work', 'job', '2026-11-02 13:00Z', '2026-11-02 14:00Z', 'superseded')`, [E.otherInstaller]);
      } finally {
        await c.query("rollback");
      }
    });
  });
});

describe("access", () => {
  it("people read only their own time; nobody writes the tables directly", async () => {
    await asUser(U.installer, async (q) => {
      await act(q, "clock_in", await yesterday(q, "06:00"), { category: "job" });
      await expect(q(`insert into public.time_segments (employee_id, kind, category, start_at) values ($1, 'work', 'job', now())`, [E.installer])).rejects.toThrow(/permission denied/);
      await expect(q(`update public.time_segments set start_at = start_at - interval '1 hour'`)).rejects.toThrow(/permission denied/);
      await expect(q(`delete from public.time_events`)).rejects.toThrow(/permission denied/);
    });
    await asUser(U.otherInstaller, async (q) => {
      expect((await q("select count(*)::int as n from public.time_segments where employee_id = $1", [E.installer])).rows[0].n).toBe(0);
      await expect(act(q, "clock_in", await yesterday(q, "06:00"), { category: "job", employees: [E.installer] })).rejects.toThrow(/crew leads/);
    });
  });

  it("events can't be changed or deleted, even by the database owner", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      try {
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.installer, role: "authenticated" })]);
        await c.query("set local role authenticated");
        await c.query(`select public.clock_action(gen_random_uuid(), 'clock_in', now(), 'denied', 'job')`);
        await c.query("reset role");
        await c.query("savepoint a");
        await expect(c.query("update public.time_events set effective_at = effective_at - interval '1 hour'")).rejects.toThrow(/cannot be changed/);
        await c.query("rollback to savepoint a");
        await expect(c.query("delete from public.time_events")).rejects.toThrow(/cannot be deleted/);
        await c.query("rollback to savepoint a");
        // Deleting the employee removes their time records with them.
        await c.query("delete from public.employees where id = $1", [E.installer]);
        expect((await c.query("select count(*)::int as n from public.time_events where employee_id = $1", [E.installer])).rows[0].n).toBe(0);
      } finally {
        await c.query("rollback");
      }
    });
  });

  it("a crew lead's group clock-in is attributed to the lead, with the lead's GPS", async () => {
    await asUser(U.lead, async (q) => {
      const r = await act(q, "clock_in", await yesterday(q, "06:00"), {
        category: "drive",
        employees: [E.lead, E.installer, E.otherInstaller, E.inactive],
        gps: { lat: 29.68, lng: -97.65 },
      });
      expect(r.filter((x) => x.ok).map((x) => x.employee_id).sort()).toEqual([E.installer, E.lead, E.otherInstaller].sort());
      expect(r.find((x) => x.employee_id === E.inactive)).toMatchObject({ ok: false, error: "inactive" });
      const events = (await q("select employee_id, actor_employee_id, is_group_action, gps_source from public.time_events where actor_employee_id = $1", [E.lead])).rows;
      expect(events).toHaveLength(3);
      expect(events.every((e) => e.is_group_action && e.actor_employee_id === E.lead)).toBe(true);
      expect(events.find((e) => e.employee_id === E.installer).gps_source).toBe("group_leader_device");
      expect(events.find((e) => e.employee_id === E.lead).gps_source).toBe("own_device");
    });
  });
});

describe("crew status", () => {
  it("crew leads see who is on the clock right now; installers can't", async () => {
    await asUser(U.lead, async (q) => {
      await act(q, "clock_in", await yesterday(q, "06:00"), { category: "job", project: P.assigned, employees: [E.installer] });
      const rows = (await q("select * from public.crew_clock_status($1)", [[E.installer, E.otherInstaller]])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ employee_id: E.installer, kind: "work", category: "job", project_id: P.assigned });
      // Their crew's time is visible to them (part 3: timesheets); anyone else's isn't.
      expect((await q("select count(*)::int as n from public.time_segments where employee_id = $1", [E.installer])).rows[0].n).toBe(1);
    });
    await asUser(U.installer, async (q) => {
      await expect(q("select * from public.crew_clock_status($1)", [[E.otherInstaller]])).rejects.toThrow(/crew leads/);
    });
  });
});
