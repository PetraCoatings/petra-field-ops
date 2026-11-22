/**
 * Product and SDS library: who sees what, the approval rules, and permanent
 * data sheet versions.
 */
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, superuser } from "./harness";
import { E, U, seed } from "./fixtures";

const M = "60000000-0000-4000-8000-000000000001";
const APPROVED = "61000000-0000-4000-8000-000000000001";
const DRAFT = "61000000-0000-4000-8000-000000000002";
const SDS_ACETONE = "62000000-0000-4000-8000-000000000001";

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
    await c.query("alter table public.document_versions disable trigger document_versions_protect");
    await c.query("delete from public.document_versions");
    await c.query("alter table public.document_versions enable trigger document_versions_protect");
    await c.query("delete from public.documents; delete from public.products; delete from public.manufacturers");
    await seed(c);
    await c.query("insert into public.manufacturers (id, name) values ($1, 'Sika')", [M]);
    await committedAs(c, U.admin, async () => {
      await c.query(
        `insert into public.products (id, name, manufacturer_id, category, mix_ratio_a, mix_ratio_b, ratio_basis, volume_solids_pct, spec_status)
         values ($1, 'Sikafloor 264', $2, 'basecoat', 2, 1, 'volume', 100, 'approved')`,
        [APPROVED, M],
      );
    });
    await committedAs(c, U.pm, async () => {
      await c.query("insert into public.products (id, name, manufacturer_id) values ($1, 'Sikafloor 200C', $2)", [DRAFT, M]);
      await c.query("insert into public.documents (id, doc_type, name) values ($1, 'sds', 'Acetone')", [SDS_ACETONE]);
      await c.query(
        "insert into public.document_versions (document_id, storage_path, file_name, file_size) values ($1, 'sds/acetone-v1.pdf', 'acetone.pdf', 1000)",
        [SDS_ACETONE],
      );
    });
  });
});

describe("who sees what", () => {
  it("crews see approved products only, and every document (SDS with no job assignment)", async () => {
    await asUser(U.otherInstaller, async (q) => {
      // otherInstaller is on no jobs at all.
      expect((await q("select id from public.products")).rows.map((r) => r.id)).toEqual([APPROVED]);
      expect((await q("select id from public.documents")).rows.map((r) => r.id)).toEqual([SDS_ACETONE]);
      expect((await q("select * from public.current_document_versions")).rowCount).toBe(1);
      expect((await q("select * from public.manufacturers")).rowCount).toBe(1);
    });
  });

  it("the office sees drafts too", async () => {
    await asUser(U.pm, async (q) => {
      expect((await q("select id from public.products order by name")).rows.map((r) => r.id)).toEqual([DRAFT, APPROVED]);
    });
  });

  it("inactive employees and signed-out callers see nothing", async () => {
    await asUser(U.inactive, async (q) => {
      expect((await q("select * from public.products")).rowCount).toBe(0);
      expect((await q("select * from public.documents")).rowCount).toBe(0);
    });
    await asAnon(async (q) => {
      await expect(q("select * from public.documents")).rejects.toThrow(/permission denied/);
    });
  });

  it("crews can't add or change anything", async () => {
    await asUser(U.lead, async (q) => {
      await expect(q("insert into public.products (name) values ('Mine')")).rejects.toThrow(/row-level security/);
      await expect(q("insert into public.documents (doc_type, name) values ('sds', 'x')")).rejects.toThrow(/row-level security/);
      expect((await q("update public.products set name = 'x' where id = $1", [APPROVED])).rowCount).toBe(0);
    });
  });
});

describe("approval", () => {
  it("a project manager can't approve", async () => {
    await asUser(U.pm, async (q) => {
      await expect(q("update public.products set spec_status = 'approved' where id = $1", [DRAFT])).rejects.toThrow(/Only an office administrator/);
      await expect(q("insert into public.products (name, spec_status) values ('Sneaky', 'approved')")).rejects.toThrow(/Only an office administrator/);
    });
  });

  it("an office admin approves; who and when are recorded", async () => {
    await asUser(U.admin, async (q) => {
      const { rows } = await q("update public.products set spec_status = 'approved' where id = $1 returning spec_status, approved_by, approved_at", [DRAFT]);
      expect(rows[0]).toMatchObject({ spec_status: "approved", approved_by: E.admin });
      expect(rows[0].approved_at).not.toBeNull();
    });
  });

  it("a project manager changing a spec sends the product back to draft", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q("update public.products set mix_ratio_a = 3 where id = $1 returning spec_status, approved_by", [APPROVED]);
      expect(rows[0]).toEqual({ spec_status: "draft", approved_by: null });
    });
  });

  it("…but fixing a typo in the name or description keeps it approved", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q("update public.products set description = 'Epoxy basecoat' where id = $1 returning spec_status", [APPROVED]);
      expect(rows[0].spec_status).toBe("approved");
    });
  });

  it("an office admin's own spec change stays approved", async () => {
    await asUser(U.admin, async (q) => {
      const { rows } = await q("update public.products set volume_solids_pct = 99 where id = $1 returning spec_status", [APPROVED]);
      expect(rows[0].spec_status).toBe("approved");
    });
  });

  it("rejects impossible specs", async () => {
    await asUser(U.admin, async (q) => {
      await expect(q("update public.products set volume_solids_pct = 120 where id = $1", [APPROVED])).rejects.toThrow(/check constraint/);
      await expect(q("update public.products set mix_ratio_b = null where id = $1", [APPROVED])).rejects.toThrow(/check constraint/);
    });
  });
});

describe("data sheet versions", () => {
  it("each upload is the next version; the newest is current", async () => {
    await asUser(U.pm, async (q) => {
      const { rows } = await q(
        "insert into public.document_versions (document_id, storage_path, file_name, file_size) values ($1, 'sds/acetone-v2.pdf', 'acetone-2027.pdf', 2000) returning version",
        [SDS_ACETONE],
      );
      expect(rows[0].version).toBe(2);
      const cur = await q("select version, file_name from public.current_document_versions where document_id = $1", [SDS_ACETONE]);
      expect(cur.rows).toEqual([{ version: 2, file_name: "acetone-2027.pdf" }]);
    });
  });

  it("versions can never be changed or deleted", async () => {
    await asUser(U.admin, async (q) => {
      await expect(q("update public.document_versions set file_name = 'x' where document_id = $1", [SDS_ACETONE])).rejects.toThrow(/permission denied/);
      await expect(q("delete from public.document_versions where document_id = $1", [SDS_ACETONE])).rejects.toThrow(/permission denied/);
    });
    await superuser(async (c) => {
      await expect(c.query("delete from public.document_versions where document_id = $1", [SDS_ACETONE])).rejects.toThrow(/cannot be changed or deleted/);
    });
  });

  it("a product has at most one TDS and one SDS slot", async () => {
    await asUser(U.pm, async (q) => {
      await q("insert into public.documents (doc_type, product_id) values ('tds', $1)", [APPROVED]);
      await expect(q("insert into public.documents (doc_type, product_id) values ('tds', $1)", [APPROVED])).rejects.toThrow(/duplicate key/);
    });
  });

  it("a standalone document must be an SDS with a name", async () => {
    await asUser(U.pm, async (q) => {
      await expect(q("insert into public.documents (doc_type) values ('sds')")).rejects.toThrow(/check constraint/);
      await expect(q("insert into public.documents (doc_type, name) values ('tds', 'Loose TDS')")).rejects.toThrow(/check constraint/);
    });
  });
});

describe("deleting an employee", () => {
  it("clears their name on permanent records instead of failing", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      // The project manager uploaded acetone v1 and v2 above.
      await c.query("delete from public.employees where id = $1", [E.pm]);
      const { rows } = await c.query("select version, uploaded_by, file_name from public.document_versions where document_id = $1 order by version", [SDS_ACETONE]);
      expect(rows.map((r) => r.uploaded_by)).toEqual([null]);
      expect(rows.map((r) => r.file_name)).toEqual(["acetone.pdf"]); // content untouched
      await c.query("rollback");
    });
  });
});
