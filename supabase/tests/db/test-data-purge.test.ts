/**
 * Cleanup of automated test data: removes only "E2E…" jobs and products (even
 * with published work orders and data sheet versions), never real ones, and
 * only the service role can run it.
 */
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, superuser } from "./harness";
import { P, U, seed } from "./fixtures";

const TEST_JOB = "20000000-0000-4000-8000-0000000000e2";

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

async function publish(c: Client, projectId: string): Promise<string> {
  const id = (await c.query("insert into public.field_work_orders (project_id, title) values ($1, 'WO') returning id", [projectId])).rows[0].id;
  await c.query("insert into public.fwo_drafts (fwo_id, content) values ($1, $2)", [id, JSON.stringify({ v: 1, notes: "x", trailerMaterials: [{ item: "A" }] })]);
  await c.query("select public.publish_fwo($1)", [id]);
  return id;
}

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.notifications, public.fwo_acknowledgments, public.loading_checklists cascade");
    await c.query("alter table public.fwo_revisions disable trigger fwo_revisions_protect");
    await c.query("update public.field_work_orders set current_revision_id = null, status = 'void'");
    await c.query("delete from public.fwo_revisions");
    await c.query("alter table public.fwo_revisions enable trigger fwo_revisions_protect");
    await c.query("delete from public.field_work_orders");
    await c.query("alter table public.document_versions disable trigger document_versions_protect");
    await c.query("delete from public.document_versions");
    await c.query("alter table public.document_versions enable trigger document_versions_protect");
    await c.query("delete from public.documents; delete from public.products");
    await seed(c);
    await c.query("insert into public.projects (id, name, status) values ($1, 'E2E Job abc123', 'scheduled')", [TEST_JOB]);
    await c.query("insert into public.project_assignments (project_id, employee_id) select $1, id from public.employees where first_name = 'Ivan'", [TEST_JOB]);
    let testFwo = "";
    await committedAs(c, U.pm, async () => {
      testFwo = await publish(c, TEST_JOB);
      await publish(c, P.assigned); // a real job's work order
      await c.query("insert into public.products (name) values ('E2E 1a2b3c Sikafloor 264'), ('Sikafloor 264')");
      const doc = (await c.query("insert into public.documents (doc_type, name) values ('sds', 'E2E 1a2b3c Acetone SDS') returning id")).rows[0].id;
      await c.query("insert into public.document_versions (document_id, storage_path, file_name, file_size) values ($1, $2, 'a.pdf', 10)", [doc, `${doc}/a.pdf`]);
    });
    await committedAs(c, U.installer, async () => {
      const rev = (await c.query("select current_revision_id from public.field_work_orders where id = $1", [testFwo])).rows[0].current_revision_id;
      await c.query("insert into public.fwo_acknowledgments (fwo_revision_id) values ($1)", [rev]);
    });
  });
});

describe("purge_e2e_test_data", () => {
  it("signed-in users can't run it, not even office admins", async () => {
    await asUser(U.admin, async (q) => {
      await expect(q("select public.purge_e2e_test_data()")).rejects.toThrow(/permission denied/);
    });
  });

  it("removes E2E jobs and products, with their permanent records, and nothing else", async () => {
    await superuser(async (c) => {
      await c.query("set role service_role");
      const { rows } = await c.query("select public.purge_e2e_test_data() as r");
      await c.query("reset role");
      expect(rows[0].r).toEqual({ jobs: 1, products: 1, documents: 1 });
      expect((await c.query("select name from public.projects order by name")).rows.map((r) => r.name)).toEqual(["Acme Warehouse", "Other Job"]);
      expect((await c.query("select count(*)::int as n from public.fwo_revisions")).rows[0].n).toBe(1); // the real job's revision
      expect((await c.query("select name from public.products")).rows.map((r) => r.name)).toEqual(["Sikafloor 264"]);
      expect((await c.query("select count(*)::int as n from public.document_versions")).rows[0].n).toBe(0);
      // Protection is back on afterwards.
      await expect(c.query("delete from public.fwo_revisions")).rejects.toThrow(/cannot be deleted/);
    });
  });
});
