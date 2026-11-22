/**
 * Row Level Security tests — Phase 3 work order templates (office only), and
 * proof that inserting a template copies it: later edits on either side never
 * reach the other.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, superuser } from "./harness";
import { P, U, seed } from "./fixtures";

const T = "50000000-0000-4000-8000-000000000001";
const CONTENT = { v: 1, mixRatios: [{ product: "Sikafloor 264", ratio: "2A : 1B" }] };

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("delete from public.work_order_templates");
    await seed(c);
    await c.query("insert into public.work_order_templates (id, name, content) values ($1, 'Sika 200C conductive', $2)", [T, JSON.stringify(CONTENT)]);
  });
});

describe("templates", () => {
  it("project managers and office admins manage them", async () => {
    for (const user of [U.pm, U.admin]) {
      await asUser(user, async (q) => {
        expect((await q("select id from public.work_order_templates")).rowCount).toBe(1);
        const ins = await q("insert into public.work_order_templates (name) values ('Epoxy broadcast') returning created_by");
        expect(ins.rows[0].created_by).not.toBeNull();
        expect((await q("update public.work_order_templates set description = 'x' where id = $1", [T])).rowCount).toBe(1);
        expect((await q("delete from public.work_order_templates where id = $1", [T])).rowCount).toBe(1);
      });
    }
  });

  it("names are unique, ignoring case and spaces", async () => {
    await asUser(U.pm, async (q) => {
      await expect(q("insert into public.work_order_templates (name) values ('  SIKA 200C Conductive ')")).rejects.toThrow(/duplicate key/);
    });
  });

  it("crews can't see, create, change or delete them", async () => {
    for (const user of [U.installer, U.lead]) {
      await asUser(user, async (q) => {
        expect((await q("select * from public.work_order_templates")).rowCount).toBe(0);
        await expect(q("insert into public.work_order_templates (name) values ('Mine')")).rejects.toThrow(/row-level security/);
        expect((await q("update public.work_order_templates set name = 'x' where id = $1", [T])).rowCount).toBe(0);
        expect((await q("delete from public.work_order_templates where id = $1", [T])).rowCount).toBe(0);
      });
    }
  });

  it("signed-out callers get nothing", async () => {
    await asAnon(async (q) => {
      await expect(q("select * from public.work_order_templates")).rejects.toThrow(/permission denied/);
    });
  });

  it("a work order built from a template is a copy: editing either never changes the other", async () => {
    await asUser(U.pm, async (q) => {
      // What the app does on "Insert template": read the template, write its content into the draft.
      const tpl = (await q("select content from public.work_order_templates where id = $1", [T])).rows[0].content;
      const fwo = (await q("insert into public.field_work_orders (project_id, title) values ($1, 'From template') returning id", [P.assigned])).rows[0].id;
      await q("insert into public.fwo_drafts (fwo_id, content) values ($1, $2)", [fwo, JSON.stringify(tpl)]);
      // Edit the job's copy…
      await q(`update public.fwo_drafts set content = jsonb_set(content, '{mixRatios,0,ratio}', '"3A : 1B"') where fwo_id = $1`, [fwo]);
      expect((await q("select content from public.work_order_templates where id = $1", [T])).rows[0].content).toEqual(CONTENT);
      // …and edit the template.
      await q(`update public.work_order_templates set content = jsonb_set(content, '{mixRatios,0,product}', '"Changed"') where id = $1`, [T]);
      const draft = (await q("select content from public.fwo_drafts where fwo_id = $1", [fwo])).rows[0].content;
      expect(draft.mixRatios[0]).toEqual({ product: "Sikafloor 264", ratio: "3A : 1B" });
    });
  });
});
