/**
 * Work order library ("Past work orders"): who can find which work orders,
 * contacts hidden on jobs the person wasn't on, date filing and search.
 */
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, superuser } from "./harness";
import { P, U, seed } from "./fixtures";

const FINISHED = "20000000-0000-4000-8000-0000000000f1"; // completed job nobody in the test cast was on
const UPCOMING = P.unassigned; // scheduled job the installer is not on
let W_FINISHED = "";
let W_UPCOMING = "";
let W_MINE = "";

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

async function publish(c: Client, projectId: string, title: string, content: object): Promise<string> {
  const id = (await c.query("insert into public.field_work_orders (project_id, title) values ($1, $2) returning id", [projectId, title])).rows[0].id;
  await c.query("insert into public.fwo_drafts (fwo_id, content) values ($1, $2)", [id, JSON.stringify(content)]);
  await c.query("select public.publish_fwo($1)", [id]);
  return id;
}

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.notifications, public.fwo_acknowledgments cascade");
    await c.query("alter table public.fwo_revisions disable trigger fwo_revisions_protect");
    await c.query("update public.field_work_orders set current_revision_id = null, status = 'void'");
    await c.query("delete from public.fwo_revisions");
    await c.query("alter table public.fwo_revisions enable trigger fwo_revisions_protect");
    await c.query("delete from public.field_work_orders");
    await seed(c);
    await c.query(
      `insert into public.projects (id, name, site_city, scheduled_start, status) values ($1, 'Crossbow RIB 2', 'Luling', '2026-11-19', 'completed')`,
      [FINISHED],
    );
    await c.query("insert into public.project_contacts (project_id, name, phone) values ($1, 'John Janacek', '512-555-0816')", [FINISHED]);
    await committedAs(c, U.pm, async () => {
      W_FINISHED = await publish(c, FINISHED, "Conductive floor", {
        v: 1,
        summary: [{ label: "System install", value: "6,620 sf Sika 200C Conductive" }],
        mixRatios: [{ product: "Sikafloor 200C", ratio: "2.18A : 1B : .15C : .3Pig" }],
        schedule: [{ title: "Day 1", date: "2026-11-18", steps: [{ text: "Sand 100% of the floor", important: true }] }],
      });
      W_UPCOMING = await publish(c, UPCOMING, "Epoxy broadcast", { v: 1, notes: "Quartz broadcast" });
      W_MINE = await publish(c, P.assigned, "Warehouse coating", { v: 1, notes: "Polyaspartic topcoat" });
    });
  });
});

const names = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe("who finds what", () => {
  it("an installer finds finished jobs and their own current job, not upcoming jobs they're not on", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q("select * from public.search_work_order_library()");
      expect(names(rows)).toEqual(["Conductive floor", "Warehouse coating"]);
      const mine = rows.find((r) => r.fwo_id === W_MINE);
      expect(mine.on_this_job).toBe(true);
      expect((await q("select * from public.get_library_work_order($1)", [W_UPCOMING])).rowCount).toBe(0);
    });
  });

  it("office staff find every published work order", async () => {
    await asUser(U.pm, async (q) => {
      expect(names((await q("select * from public.search_work_order_library()")).rows)).toEqual(["Conductive floor", "Epoxy broadcast", "Warehouse coating"]);
    });
  });

  it("an inactive employee and signed-out callers find nothing", async () => {
    await asUser(U.inactive, async (q) => {
      expect((await q("select * from public.search_work_order_library()")).rowCount).toBe(0);
    });
    await asAnon(async (q) => {
      await expect(q("select * from public.search_work_order_library()")).rejects.toThrow(/permission denied/);
    });
  });

  it("the tables themselves still only show crews their own jobs (the library is read through the functions)", async () => {
    await asUser(U.installer, async (q) => {
      expect((await q("select * from public.fwo_revisions where fwo_id = $1", [W_FINISHED])).rowCount).toBe(0);
    });
  });
});

describe("contacts", () => {
  it("are removed on finished jobs the person wasn't on, everything else is there", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q("select * from public.get_library_work_order($1)", [W_FINISHED]);
      expect(rows[0].project_snapshot.contacts).toEqual([]);
      expect(rows[0].project_snapshot.name).toBe("Crossbow RIB 2");
      expect(rows[0].content.mixRatios[0].ratio).toBe("2.18A : 1B : .15C : .3Pig");
      expect(rows[0].on_this_job).toBe(false);
    });
  });

  it("are kept for office staff and on the person's own jobs", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q("select project_snapshot from public.get_library_work_order($1)", [W_FINISHED]);
      expect(rows[0].project_snapshot.contacts).toEqual([{ name: "John Janacek", title: null, phone: "512-555-0816" }]);
    });
    await asUser(U.installer, async (q) => {
      const { rows } = await q("select project_snapshot from public.get_library_work_order($1)", [W_MINE]);
      expect(rows[0].project_snapshot.contacts).toEqual([{ name: "Site Super", title: null, phone: "555-0199" }]);
    });
  });
});

describe("dates and search", () => {
  it("files a work order under its first scheduled day, else the job's start", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q("select title, job_date::text, system_install, city from public.search_work_order_library()");
      const finished = rows.find((r) => r.title === "Conductive floor");
      expect(finished).toMatchObject({ job_date: "2026-11-18", system_install: "6,620 sf Sika 200C Conductive", city: "Luling" });
    });
  });

  it("filters by date range", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q("select title from public.search_work_order_library(null, '2026-11-01', '2026-11-30')");
      expect(names(rows)).toContain("Conductive floor");
      expect((await q("select * from public.search_work_order_library(null, '2025-01-01', '2025-12-31')")).rowCount).toBe(0);
    });
  });

  it("searches everything in the work order; every word must match; case doesn't matter", async () => {
    await asUser(U.installer, async (q) => {
      expect(names((await q("select title from public.search_work_order_library('200c')")).rows)).toEqual(["Conductive floor"]);
      expect(names((await q("select title from public.search_work_order_library('luling conductive')")).rows)).toEqual(["Conductive floor"]);
      expect(names((await q("select title from public.search_work_order_library('crossbow')")).rows)).toEqual(["Conductive floor"]);
      expect((await q("select * from public.search_work_order_library('luling epoxy')")).rowCount).toBe(0);
      // Search never reveals work orders the person can't open.
      expect((await q("select * from public.search_work_order_library('quartz')")).rowCount).toBe(0);
    });
  });

  it("treats % and _ as ordinary characters", async () => {
    await asUser(U.pm, async (q) => {
      expect(names((await q("select title from public.search_work_order_library('100%')")).rows)).toEqual(["Conductive floor"]);
      expect((await q("select * from public.search_work_order_library('_')")).rowCount).toBe(0); // not "any character"
    });
  });
});
