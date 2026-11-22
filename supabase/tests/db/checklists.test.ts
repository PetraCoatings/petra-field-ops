/**
 * Loading checklists: built from the work order's trailer list; only the
 * job's crew lead or the office can tick; Missing notifies the project
 * manager; a new revision can be synced without losing ticks.
 */
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, superuser } from "./harness";
import { E, P, U, seed } from "./fixtures";

const REV1 = {
  v: 1,
  trailerMaterials: [
    { item: "Sika 264 (4.5 Gallon kit + Bag)", qty: "10" },
    { item: "Sika 200C (3.31 Gal Kit)", qty: "19 Kits + Partial" },
    { item: "Floor Buffers" },
  ],
};
let FWO = "";
let CHECKLIST = "";
let ITEM_264 = "";
let ITEM_200C = "";

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
    await c.query("truncate public.notifications, public.fwo_acknowledgments, public.loading_checklists cascade");
    await c.query("alter table public.fwo_revisions disable trigger fwo_revisions_protect");
    await c.query("update public.field_work_orders set current_revision_id = null, status = 'void'");
    await c.query("delete from public.fwo_revisions");
    await c.query("alter table public.fwo_revisions enable trigger fwo_revisions_protect");
    await c.query("delete from public.field_work_orders");
    await seed(c);
    await committedAs(c, U.pm, async () => {
      FWO = (await c.query("insert into public.field_work_orders (project_id, title) values ($1, 'Conductive') returning id", [P.assigned])).rows[0].id;
      await c.query("insert into public.fwo_drafts (fwo_id, content) values ($1, $2)", [FWO, JSON.stringify(REV1)]);
      await c.query("select public.publish_fwo($1)", [FWO]);
    });
    await c.query("delete from public.notifications");
    // The crew lead starts the checklist (committed, so later tests share it).
    await committedAs(c, U.lead, async () => {
      CHECKLIST = (await c.query("select public.ensure_loading_checklist($1) as id", [FWO])).rows[0].id;
    });
    const items = (await c.query("select id, item from public.loading_checklist_items where checklist_id = $1", [CHECKLIST])).rows;
    ITEM_264 = items.find((r) => r.item.startsWith("Sika 264")).id;
    ITEM_200C = items.find((r) => r.item.startsWith("Sika 200C")).id;
  });
});

describe("starting a checklist", () => {
  it("copies the work order's trailer list, in order, with quantities", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q("select item, qty, source, status from public.loading_checklist_items where checklist_id = $1 order by position", [CHECKLIST]);
      expect(rows).toEqual([
        { item: "Sika 264 (4.5 Gallon kit + Bag)", qty: "10", source: "work_order", status: "pending" },
        { item: "Sika 200C (3.31 Gal Kit)", qty: "19 Kits + Partial", source: "work_order", status: "pending" },
        { item: "Floor Buffers", qty: null, source: "work_order", status: "pending" },
      ]);
    });
  });

  it("opening it again returns the same checklist", async () => {
    await asUser(U.pm, async (q) => {
      expect((await q("select public.ensure_loading_checklist($1) as id", [FWO])).rows[0].id).toBe(CHECKLIST);
    });
  });

  it("people not on the job can't see or start it", async () => {
    await asUser(U.otherInstaller, async (q) => {
      expect((await q("select * from public.loading_checklist_items")).rowCount).toBe(0);
      await expect(q("select public.ensure_loading_checklist($1)", [FWO])).rejects.toThrow(/not found/);
    });
  });
});

describe("ticking items", () => {
  it("the crew lead marks items loaded or missing, with a note", async () => {
    await asUser(U.lead, async (q) => {
      await q("select public.set_checklist_item($1, 'loaded')", [ITEM_264]);
      await q("select public.set_checklist_item($1, 'missing', 'Only 18 kits in the shop')", [ITEM_200C]);
      const { rows } = await q("select id, status, note, updated_by from public.loading_checklist_items where id in ($1, $2)", [ITEM_264, ITEM_200C]);
      expect(rows.find((r) => r.id === ITEM_264)).toMatchObject({ status: "loaded", note: null, updated_by: E.lead });
      expect(rows.find((r) => r.id === ITEM_200C)).toMatchObject({ status: "missing", note: "Only 18 kits in the shop" });
    });
  });

  it("marking an item missing notifies the project manager, once", async () => {
    await superuser(async (c) => {
      await committedAs(c, U.lead, async () => {
        await c.query("select public.set_checklist_item($1, 'missing', 'Only 18 kits')", [ITEM_200C]);
        await c.query("select public.set_checklist_item($1, 'missing', 'Still 18')", [ITEM_200C]);
      });
      const { rows } = await c.query("select recipient_id, type, data from public.notifications where type = 'checklist_missing'");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ recipient_id: E.pm, data: { item: "Sika 200C (3.31 Gal Kit)", note: "Only 18 kits", projectName: "Acme Warehouse" } });
    });
  });

  it("installers can see the checklist but not tick or add to it", async () => {
    await asUser(U.installer, async (q) => {
      expect((await q("select * from public.loading_checklist_items where checklist_id = $1", [CHECKLIST])).rowCount).toBe(3);
      await expect(q("select public.set_checklist_item($1, 'loaded')", [ITEM_200C])).rejects.toThrow(/Only the crew lead or the office/);
      await expect(q("select public.add_checklist_item($1, 'Extra rollers')", [CHECKLIST])).rejects.toThrow(/Only the crew lead or the office/);
    });
  });

  it("nobody can write to the tables directly", async () => {
    await asUser(U.lead, async (q) => {
      await expect(q("update public.loading_checklist_items set status = 'loaded' where id = $1", [ITEM_200C])).rejects.toThrow(/permission denied/);
      await expect(q("insert into public.loading_checklist_items (checklist_id, position, item, source) values ($1, 1, 'x', 'added')", [CHECKLIST])).rejects.toThrow(/permission denied/);
    });
  });

  it("the crew lead can add items that weren't on the work order", async () => {
    await asUser(U.lead, async (q) => {
      await q("select public.add_checklist_item($1, 'Extra roller covers', '6')", [CHECKLIST]);
      const { rows } = await q("select item, qty, source from public.loading_checklist_items where checklist_id = $1 and source = 'added'", [CHECKLIST]);
      expect(rows).toEqual([{ item: "Extra roller covers", qty: "6", source: "added" }]);
    });
  });

  it("signed-out callers get nothing", async () => {
    await asAnon(async (q) => {
      await expect(q("select * from public.loading_checklist_items")).rejects.toThrow(/permission denied/);
      await expect(q("select public.set_checklist_item($1, 'loaded')", [ITEM_264])).rejects.toThrow(/permission denied/);
    });
  });
});

describe("a new work order revision", () => {
  it("can be synced: new items added, removed ones marked, ticks and notes kept", async () => {
    await superuser(async (c) => {
      await committedAs(c, U.lead, async () => {
        await c.query("select public.set_checklist_item($1, 'loaded')", [ITEM_264]);
      });
      await committedAs(c, U.pm, async () => {
        await c.query("update public.fwo_drafts set content = $2 where fwo_id = $1", [
          FWO,
          JSON.stringify({
            v: 1,
            trailerMaterials: [
              { item: "sika 264 (4.5 gallon kit + bag)", qty: "12" }, // same item, new quantity
              { item: "ESD Pigment", qty: "19 + Partial" }, // new
              { item: "Sika 200C (3.31 Gal Kit)", qty: "20 Kits" },
            ], // Floor Buffers removed
          }),
        ]);
        await c.query("select public.publish_fwo($1, 'More 264, add pigment')", [FWO]);
      });
    });
    await asUser(U.lead, async (q) => {
      const before = (await q("select revision_id from public.loading_checklists where id = $1", [CHECKLIST])).rows[0].revision_id;
      await q("select public.sync_loading_checklist($1)", [CHECKLIST]);
      const after = (await q("select revision_id from public.loading_checklists where id = $1", [CHECKLIST])).rows[0].revision_id;
      expect(after).not.toBe(before);
      const { rows } = await q(
        "select item, qty, status, note, removed_from_work_order as removed from public.loading_checklist_items where checklist_id = $1 and source = 'work_order' order by removed_from_work_order, position",
        [CHECKLIST],
      );
      expect(rows).toEqual([
        { item: "Sika 264 (4.5 Gallon kit + Bag)", qty: "12", status: "loaded", note: null, removed: false },
        { item: "ESD Pigment", qty: "19 + Partial", status: "pending", note: null, removed: false },
        { item: "Sika 200C (3.31 Gal Kit)", qty: "20 Kits", status: "missing", note: "Still 18", removed: false },
        { item: "Floor Buffers", qty: null, status: "pending", note: null, removed: true },
      ]);
    });
  });

  it("installers can't sync", async () => {
    await asUser(U.installer, async (q) => {
      await expect(q("select public.sync_loading_checklist($1)", [CHECKLIST])).rejects.toThrow(/Only the crew lead or the office/);
    });
  });
});
