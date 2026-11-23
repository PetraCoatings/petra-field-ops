/**
 * Row Level Security and integrity tests — Phase 3 field work orders.
 * Drafts are office-only, publishing is office-only and atomic, published
 * revisions can never change, crews acknowledge only for themselves, and
 * notifications are private.
 */
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, superuser } from "./harness";
import { E, P, U, seed } from "./fixtures";

const CONTENT = JSON.stringify({ v: 1, summary: [{ label: "System install", value: "6,620 sf conductive" }] });
let FWO = ""; // published work order on the assigned project (revision 1)
let REV1 = "";
let DRAFT_ONLY = ""; // never-published work order on the assigned project

/** Run statements as a user and COMMIT (asUser always rolls back). */
async function committedAs<T>(c: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", aal: "aal2" })]);
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
      FWO = (await c.query("insert into public.field_work_orders (project_id, title) values ($1, 'Conductive system') returning id", [P.assigned])).rows[0].id;
      await c.query("insert into public.fwo_drafts (fwo_id, content) values ($1, $2)", [FWO, CONTENT]);
      REV1 = (await c.query("select public.publish_fwo($1) as id", [FWO])).rows[0].id;
      DRAFT_ONLY = (await c.query("insert into public.field_work_orders (project_id, title) values ($1, 'Next phase') returning id", [P.assigned])).rows[0].id;
      await c.query("insert into public.fwo_drafts (fwo_id, content) values ($1, $2)", [DRAFT_ONLY, CONTENT]);
    });
  });
});

describe("work orders: office", () => {
  it("numbers work orders 1, 2, 3… per project", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q("select fwo_number from public.field_work_orders where project_id = $1 order by fwo_number", [P.assigned]);
      expect(rows.map((r) => r.fwo_number)).toEqual([1, 2]);
      const third = await q("insert into public.field_work_orders (project_id, title) values ($1, 'Third') returning fwo_number", [P.assigned]);
      expect(third.rows[0].fwo_number).toBe(3);
      const other = await q("insert into public.field_work_orders (project_id, title) values ($1, 'Other job') returning fwo_number", [P.unassigned]);
      expect(other.rows[0].fwo_number).toBe(1);
    });
  });

  it("publishing freezes the project details, including site contacts", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q("select revision_number, content, project_snapshot, published_by from public.fwo_revisions where id = $1", [REV1]);
      expect(rows[0].revision_number).toBe(1);
      expect(rows[0].content.summary[0].value).toBe("6,620 sf conductive");
      expect(rows[0].project_snapshot).toMatchObject({ name: "Acme Warehouse", customer: "Acme Foods", crewLead: expect.any(String) });
      expect(rows[0].project_snapshot.contacts).toEqual([{ name: "Site Super", title: null, phone: "555-0199" }]);
      expect(rows[0].published_by).toBe(E.pm);
    });
  });

  it("a second revision needs a description of what changed", async () => {
    await asUser(U.pm, async (q) => {
      await expect(q("select public.publish_fwo($1)", [FWO])).rejects.toThrow(/Describe what changed/);
      const r = await q("select public.publish_fwo($1, 'Day 3 rate changed') as id", [FWO]);
      const rev = await q("select revision_number from public.fwo_revisions where id = $1", [r.rows[0].id]);
      expect(rev.rows[0].revision_number).toBe(2);
      const fwo = await q("select current_revision_id from public.field_work_orders where id = $1", [FWO]);
      expect(fwo.rows[0].current_revision_id).toBe(r.rows[0].id);
    });
  });

  it("an empty work order can't be published", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q("insert into public.field_work_orders (project_id, title) values ($1, 'Empty') returning id", [P.assigned]);
      await expect(q("select public.publish_fwo($1)", [rows[0].id])).rejects.toThrow(/empty/);
    });
  });

  it("can't create a work order that pretends to be published", async () => {
    await asUser(U.pm, async (q) => {
      await expect(
        q("insert into public.field_work_orders (project_id, title, status, current_revision_id) values ($1, 'Fake', 'published', $2)", [P.assigned, REV1]),
      ).rejects.toThrow(/row-level security/);
    });
  });
});

describe("work orders: crews", () => {
  it("see published work orders on their projects, never drafts", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q("select id from public.field_work_orders");
      expect(rows.map((r) => r.id)).toEqual([FWO]);
      expect((await q("select * from public.fwo_drafts")).rowCount).toBe(0);
      expect((await q("select * from public.field_work_orders where id = $1", [DRAFT_ONLY])).rowCount).toBe(0);
      expect((await q("select * from public.fwo_revisions where fwo_id = $1", [FWO])).rowCount).toBe(1);
    });
  });

  it("an installer on another job sees nothing", async () => {
    await asUser(U.otherInstaller, async (q) => {
      expect((await q("select * from public.field_work_orders")).rowCount).toBe(0);
      expect((await q("select * from public.fwo_revisions")).rowCount).toBe(0);
    });
  });

  it("can't create, edit drafts or publish", async () => {
    await asUser(U.lead, async (q) => {
      await expect(q("insert into public.field_work_orders (project_id, title) values ($1, 'Mine')", [P.assigned])).rejects.toThrow(/row-level security/);
      const upd = await q("update public.fwo_drafts set content = '{}' where fwo_id = $1", [FWO]);
      expect(upd.rowCount).toBe(0);
      await expect(q("select public.publish_fwo($1, 'x')", [FWO])).rejects.toThrow(/Only project managers/);
      const ren = await q("update public.field_work_orders set title = 'Renamed' where id = $1", [FWO]);
      expect(ren.rowCount).toBe(0);
    });
  });

  it("acknowledge a revision for themselves only, once", async () => {
    await asUser(U.installer, async (q) => {
      const { rows } = await q("insert into public.fwo_acknowledgments (fwo_revision_id) values ($1) returning employee_id", [REV1]);
      expect(rows[0].employee_id).toBe(E.installer);
      await expect(q("insert into public.fwo_acknowledgments (fwo_revision_id) values ($1)", [REV1])).rejects.toThrow(/duplicate key/);
      await expect(
        q("insert into public.fwo_acknowledgments (fwo_revision_id, employee_id) values ($1, $2)", [REV1, E.lead]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("office staff and other crews can't acknowledge", async () => {
    await asUser(U.pm, async (q) => {
      await expect(q("insert into public.fwo_acknowledgments (fwo_revision_id) values ($1)", [REV1])).rejects.toThrow(/row-level security/);
    });
    await asUser(U.otherInstaller, async (q) => {
      await expect(q("insert into public.fwo_acknowledgments (fwo_revision_id) values ($1)", [REV1])).rejects.toThrow(/row-level security/);
    });
  });
});

describe("published revisions can never change", () => {
  it("API users can't update or delete them (no permission at all)", async () => {
    await asUser(U.pm, async (q) => {
      await expect(q("update public.fwo_revisions set content = '{}' where id = $1", [REV1])).rejects.toThrow(/permission denied/);
      await expect(q("delete from public.fwo_revisions where id = $1", [REV1])).rejects.toThrow(/permission denied/);
    });
  });

  it("not even the database owner can rewrite or delete one", async () => {
    await superuser(async (c) => {
      const before = (await c.query("select content::text, project_snapshot::text from public.fwo_revisions where id = $1", [REV1])).rows[0];
      await expect(c.query("update public.fwo_revisions set content = '{}' where id = $1", [REV1])).rejects.toThrow(/cannot be changed/);
      await expect(c.query("delete from public.fwo_revisions where id = $1", [REV1])).rejects.toThrow(/cannot be deleted/);
      // Republishing later never touches revision 1.
      const after = (await c.query("select content::text, project_snapshot::text from public.fwo_revisions where id = $1", [REV1])).rows[0];
      expect(after).toEqual(before);
    });
  });

  it("the PDF location can be recorded once, then is fixed too", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      await c.query("update public.fwo_revisions set pdf_storage_path = 'a.pdf' where id = $1", [REV1]);
      await expect(c.query("update public.fwo_revisions set pdf_storage_path = 'b.pdf' where id = $1", [REV1])).rejects.toThrow(/cannot be changed/);
      await c.query("rollback");
    });
  });
});

describe("notifications", () => {
  it("publishing notified the crew (installer and crew lead), not the publisher", async () => {
    await superuser(async (c) => {
      const { rows } = await c.query("select recipient_id, type, data from public.notifications where entity_id = $1 order by recipient_id", [FWO]);
      expect(rows.map((r) => r.recipient_id).sort()).toEqual([E.lead, E.installer].sort());
      expect(rows[0].data).toMatchObject({ fwoNumber: 1, title: "Conductive system", revision: 1, projectName: "Acme Warehouse" });
    });
  });

  it("people see only their own, and can only mark them read", async () => {
    await asUser(U.installer, async (q) => {
      const mine = await q("select id, recipient_id from public.notifications");
      expect(mine.rows.every((r) => r.recipient_id === E.installer)).toBe(true);
      expect(mine.rowCount).toBe(1);
      const read = await q("update public.notifications set read_at = now() where id = $1", [mine.rows[0].id]);
      expect(read.rowCount).toBe(1);
      await expect(q("update public.notifications set data = '{}' where id = $1", [mine.rows[0].id])).rejects.toThrow(/permission denied/);
      await expect(q("insert into public.notifications (recipient_id, type, dedup_key) values ($1, 'fwo_published', 'x')", [E.lead])).rejects.toThrow(/permission denied/);
    });
    await asUser(U.pm, async (q) => {
      expect((await q("select * from public.notifications")).rowCount).toBe(0);
    });
  });
});

describe("signed out", () => {
  it("can't read work orders or publish", async () => {
    await asAnon(async (q) => {
      await expect(q("select * from public.field_work_orders")).rejects.toThrow(/permission denied/);
      await expect(q("select * from public.fwo_revisions")).rejects.toThrow(/permission denied/);
      await expect(q("select public.publish_fwo($1)", [FWO])).rejects.toThrow(/permission denied/);
    });
  });
});

describe("deleting an employee who published", () => {
  it("clears 'published by' and leaves the revision otherwise identical", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      const before = (await c.query("select content::text, project_snapshot::text, revision_number from public.fwo_revisions where id = $1", [REV1])).rows[0];
      await c.query("delete from public.employees where id = $1", [E.pm]);
      const after = (await c.query("select content::text, project_snapshot::text, revision_number, published_by from public.fwo_revisions where id = $1", [REV1])).rows[0];
      expect(after.published_by).toBeNull();
      expect({ content: after.content, project_snapshot: after.project_snapshot, revision_number: after.revision_number }).toEqual(before);
      // Setting someone else as the publisher is still refused.
      await expect(c.query("update public.fwo_revisions set published_by = $2 where id = $1", [REV1, E.admin])).rejects.toThrow(/cannot be changed/);
      await c.query("rollback");
    });
  });
});
