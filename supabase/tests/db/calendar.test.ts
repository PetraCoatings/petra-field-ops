/**
 * Calendar: job days from published work orders (crews see their jobs, office
 * staff all), holidays, and private calendar links (only a hash is stored; a
 * new link replaces the old; the feed is readable by the server only).
 */
import { createHash } from "node:crypto";
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, superuser } from "./harness";
import { E, P, U, seed } from "./fixtures";

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

async function committedAs<T>(c: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  try {
    const r = await fn();
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.calendar_feeds, public.holidays, public.notifications, public.fwo_acknowledgments, public.loading_checklists cascade");
    await c.query("alter table public.fwo_revisions disable trigger fwo_revisions_protect");
    await c.query("update public.field_work_orders set current_revision_id = null, status = 'void'");
    await c.query("delete from public.fwo_revisions");
    await c.query("alter table public.fwo_revisions enable trigger fwo_revisions_protect");
    await c.query("delete from public.field_work_orders");
    await seed(c);
    await c.query(`update public.projects set site_street = '201 Business Pk Blvd', site_city = 'Luling', site_state = 'TX', site_postal_code = '78648' where id = $1`, [P.assigned]);
    // The other job has no work order, only a scheduled start and duration.
    await c.query(`update public.projects set scheduled_start = '2026-12-07', estimated_duration_days = 2 where id = $1`, [P.unassigned]);
    await committedAs(c, U.pm, async () => {
      const fwo = (await c.query("insert into public.field_work_orders (project_id, title) values ($1, 'Recoat') returning id", [P.assigned])).rows[0].id;
      const content = { v: 1, schedule: [
        { title: "Day 1 (Monday)", date: "2026-11-30", startTime: "5am", steps: [{ text: "Load up" }] },
        { title: "Day 2", date: "2026-12-01", steps: [] },
        { title: "Day 3", steps: [] }, // no date: not on the calendar
      ] };
      await c.query("insert into public.fwo_drafts (fwo_id, content) values ($1, $2)", [fwo, JSON.stringify(content)]);
      await c.query("select public.publish_fwo($1)", [fwo]);
    });
    await c.query(`insert into public.holidays (date, name) values ('2026-11-26', 'Thanksgiving')`);
  });
});

const range = (q: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) =>
  q(`select kind, day::text as day, title, start_text, project_name, address from public.my_calendar('2026-11-01', '2026-12-31')`).then((r) => r.rows);

describe("calendar events", () => {
  it("crews see the dated days of their jobs' work orders, plus holidays", async () => {
    await asUser(U.installer, async (q) => {
      expect(await range(q)).toEqual([
        { kind: "holiday", day: "2026-11-26", title: "Thanksgiving", start_text: null, project_name: null, address: null },
        { kind: "job", day: "2026-11-30", title: "Day 1 (Monday)", start_text: "5am", project_name: "Acme Warehouse", address: "201 Business Pk Blvd, Luling, TX 78648" },
        { kind: "job", day: "2026-12-01", title: "Day 2", start_text: null, project_name: "Acme Warehouse", address: "201 Business Pk Blvd, Luling, TX 78648" },
      ]);
    });
  });

  it("office staff see every job; a job without dated days uses its scheduled start and duration", async () => {
    await asUser(U.pm, async (q) => {
      const rows = await range(q);
      expect(rows.filter((r) => r.project_name === "Other Job").map((r) => r.day)).toEqual(["2026-12-07", "2026-12-08"]);
      expect(rows.filter((r) => r.project_name === "Acme Warehouse")).toHaveLength(2);
    });
  });

  it("only office admins manage holidays", async () => {
    await asUser(U.installer, async (q) => {
      await expect(q(`insert into public.holidays (date, name) values ('2026-12-25', 'Christmas')`)).rejects.toThrow(/row-level security/);
    });
    await asUser(U.admin, async (q) => {
      await q(`insert into public.holidays (date, name) values ('2026-12-25', 'Christmas')`);
      expect((await q(`select count(*)::int as n from public.holidays`)).rows[0].n).toBe(2);
    });
  });
});

describe("calendar links", () => {
  it("a link works until a new one is made; only its hash is stored; only the server reads the feed", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      try {
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.installer, role: "authenticated" })]);
        await c.query("set local role authenticated");
        const first = (await c.query(`select public.new_calendar_feed() as t`)).rows[0].t as string;
        expect(first).toMatch(/^[0-9a-f]{64}$/);
        const stored = (await c.query(`select token_hash, scope from public.calendar_feeds`)).rows;
        expect(stored).toEqual([{ token_hash: hash(first), scope: "mine" }]);
        await c.query("savepoint a");
        await expect(c.query(`select * from public.calendar_feed($1)`, [hash(first)])).rejects.toThrow(/permission denied/);
        await c.query("rollback to savepoint a");
        await expect(c.query(`select public.new_calendar_feed('all')`)).rejects.toThrow(/Not allowed/);
        await c.query("rollback to savepoint a");

        await c.query("reset role");
        await c.query("set local role service_role");
        const feed = (await c.query(`select employee_name, kind, day::text as day, title from public.calendar_feed($1) where day between '2026-11-01' and '2026-12-31'`, [hash(first)])).rows;
        expect(feed.map((r) => [r.kind, r.day])).toEqual([
          ["holiday", "2026-11-26"],
          ["job", "2026-11-30"],
          ["job", "2026-12-01"],
        ]);
        expect(feed[0].employee_name).toBe("Ivan Test");

        // A new link replaces the old one.
        await c.query("reset role");
        await c.query("set local role authenticated");
        const second = (await c.query(`select public.new_calendar_feed() as t`)).rows[0].t as string;
        await c.query("reset role");
        await c.query("set local role service_role");
        expect((await c.query(`select * from public.calendar_feed($1)`, [hash(first)])).rows).toHaveLength(0);
        expect((await c.query(`select * from public.calendar_feed($1)`, [hash(second)])).rows.length).toBeGreaterThan(0);

        // Another installer can't turn it off; an office admin can.
        await c.query("reset role");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.otherInstaller, role: "authenticated" })]);
        await c.query("set local role authenticated");
        await c.query("savepoint b");
        await expect(c.query(`select public.revoke_calendar_feed($1)`, [E.installer])).rejects.toThrow(/Not allowed/);
        await c.query("rollback to savepoint b");
        await c.query("reset role");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.admin, role: "authenticated" })]);
        await c.query("set local role authenticated");
        await c.query(`select public.revoke_calendar_feed($1)`, [E.installer]);
        await c.query("reset role");
        await c.query("set local role service_role");
        expect((await c.query(`select * from public.calendar_feed($1)`, [hash(second)])).rows).toHaveLength(0);
      } finally {
        await c.query("rollback");
      }
    });
  });
});
