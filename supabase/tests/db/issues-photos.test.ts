/**
 * Jobsite issues (PM notified; the office or crew lead resolves) and photos
 * (the job's people add and see them; removal rules).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, superuser } from "./harness";
import { E, P, U, seed } from "./fixtures";

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.photos, public.jobsite_issues, public.notifications cascade");
    await seed(c);
  });
});

describe("jobsite issues", () => {
  it("anyone on the job reports; the PM is notified; the crew lead or office resolves", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      const as = async (u: string) => {
        await c.query("reset role");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: "authenticated", aal: "aal2" })]);
        await c.query("set local role authenticated");
      };
      const tryQ = async (sql: string, p: unknown[] = []) => {
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
        await as(U.otherInstaller);
        await expect(tryQ(`select public.report_issue($1, 'moisture', 'Wet slab')`, [P.assigned])).rejects.toThrow(/Not allowed/);
        await as(U.installer);
        const id = (await tryQ(`select public.report_issue($1, 'moisture', 'Slab reads 5.2 lbs on the CaCl test', true) as id`, [P.assigned]))[0].id;
        await expect(tryQ(`select public.report_issue($1, 'weather', 'x x x')`, [P.assigned])).rejects.toThrow(/check/);
        await expect(tryQ(`select public.resolve_issue($1)`, [id])).rejects.toThrow(/office or the job's crew lead/);
        await as(U.pm);
        expect(await tryQ(`select type, data ->> 'urgent' as urgent, data ->> 'issueType' as t from public.notifications`)).toEqual([{ type: "issue_reported", urgent: "true", t: "moisture" }]);
        await as(U.lead);
        await tryQ(`select public.resolve_issue($1, 'Ran a moisture mitigation primer')`, [id]);
        expect((await tryQ(`select status, resolved_by, resolution_note from public.jobsite_issues where id = $1`, [id]))[0]).toEqual({ status: "resolved", resolved_by: E.lead, resolution_note: "Ran a moisture mitigation primer" });
        await expect(tryQ(`select public.resolve_issue($1)`, [id])).rejects.toThrow(/already resolved/);
        await as(U.otherInstaller);
        expect(await tryQ(`select id from public.jobsite_issues`)).toEqual([]);
      } finally {
        await c.query("rollback");
      }
    });
  });
});

describe("photos", () => {
  const photo = (project: string, extra = "") => {
    const id = randomUUID();
    return {
      sql: `insert into public.photos (client_id, project_id, stage, storage_path, thumb_path, width, height, size_bytes${extra ? ", uploaded_by" : ""})
            values ($1::uuid, $2::uuid, 'before', $2::text || '/' || $1::text || '.jpg', $2::text || '/' || $1::text || '_thumb.jpg', 4000, 3000, 2500000${extra ? ", $3" : ""}) returning id`,
      params: extra ? [id, project, extra] : [id, project],
    };
  };

  it("the job's people add and see photos; others don't; paths must be under the job", async () => {
    await asUser(U.installer, async (q) => {
      const p = photo(P.assigned);
      const [{ id }] = (await q(p.sql, p.params)).rows;
      expect((await q(`select uploaded_by from public.photos where id = $1`, [id])).rows[0].uploaded_by).toBe(E.installer);
      const other = photo(P.unassigned);
      await expect(q(other.sql, other.params)).rejects.toThrow(/row-level security/);
      const spoof = photo(P.assigned, E.lead);
      await expect(q(spoof.sql, spoof.params)).rejects.toThrow(/row-level security/);
      await expect(
        q(`insert into public.photos (client_id, project_id, storage_path, thumb_path) values ($1, $2, 'elsewhere/x.jpg', 'elsewhere/y.jpg')`, [randomUUID(), P.assigned]),
      ).rejects.toThrow(/check/);
      // Same-day removal by the person who took it.
      await q(`delete from public.photos where id = $1`, [id]);
      expect((await q(`select count(*)::int as n from public.photos`)).rows[0].n).toBe(0);
    });
    await asUser(U.otherInstaller, async (q) => {
      expect((await q(`select count(*)::int as n from public.photos`)).rows[0].n).toBe(0);
    });
  });

  it("only the office removes someone else's or an older photo", async () => {
    await superuser(async (c) => {
      const id = randomUUID();
      await c.query(
        `insert into public.photos (client_id, project_id, uploaded_by, storage_path, thumb_path, created_at) values ($1::uuid, $2::uuid, $3, $2::text || '/' || $1::text || '.jpg', $2::text || '/' || $1::text || '_thumb.jpg', now() - interval '2 days')`,
        [id, P.assigned, E.installer],
      );
    });
    await asUser(U.installer, async (q) => {
      expect((await q(`delete from public.photos`)).rowCount).toBe(0); // older than a day
      expect((await q(`update public.photos set stage = 'finished' returning stage`)).rows).toEqual([{ stage: "finished" }]); // can still tag it
    });
    await asUser(U.lead, async (q) => {
      expect((await q(`delete from public.photos`)).rowCount).toBe(0); // not theirs
    });
    await asUser(U.pm, async (q) => {
      expect((await q(`delete from public.photos`)).rowCount).toBe(1);
    });
  });

  it("a photo's files must be its own, and its links must be on the same job", async () => {
    await asUser(U.installer, async (q) => {
      const id = randomUUID();
      // Pointing the record at another photo's file (removing it would delete that file).
      await expect(
        q(`insert into public.photos (client_id, project_id, storage_path, thumb_path) values ($1::uuid, $2::uuid, $2::text || '/' || $3::text || '.jpg', $2::text || '/' || $1::text || '_thumb.jpg')`, [id, P.assigned, randomUUID()]),
      ).rejects.toThrow(/photos_paths_match/);
    });
    const otherReport = await superuser(async (c) =>
      (await c.query(`insert into public.daily_field_reports (project_id, report_date) values ($1, current_date - 40) returning id`, [P.unassigned])).rows[0].id as string,
    );
    await asUser(U.installer, async (q) => {
      const id = randomUUID();
      await expect(
        q(`insert into public.photos (client_id, project_id, storage_path, thumb_path, dfr_id) values ($1::uuid, $2::uuid, $2::text || '/' || $1::text || '.jpg', $2::text || '/' || $1::text || '_thumb.jpg', $3)`, [id, P.assigned, otherReport]),
      ).rejects.toThrow(/row-level security/);
    });
    await superuser((c) => c.query(`delete from public.daily_field_reports where id = $1`, [otherReport]));
  });
});
