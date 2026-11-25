/**
 * Project managers write daily reports like office admins, and the office can
 * edit a submitted report before accepting it (migration 20261201000100).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { superuser } from "./harness";
import { E, P, U, seed } from "./fixtures";

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.dfr_versions, public.daily_field_reports, public.notifications cascade");
    await seed(c);
  });
});

describe("daily reports: project managers and office edits", () => {
  it("a PM starts, edits and submits a report; the office edits a submitted one, then accepts it", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      const as = async (u: string) => {
        await c.query("reset role");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: "authenticated", aal: "aal2" })]);
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
        // A PM writes a report on a job (no crew lead needed).
        await as(U.pm);
        const id = (await q(`select public.ensure_daily_report($1, current_date - 1) as id`, [P.unassigned]))[0].id as string;
        const v1 = (await q(`select public.save_daily_report($1, '{"notes":"PM wrote this"}', 1) as v`, [id]))[0].v as number;
        await q(`select public.submit_daily_report($1, $2)`, [id, v1]);

        // The crew lead's report on their own job, as before.
        await as(U.lead);
        const leadReport = (await q(`select public.ensure_daily_report($1, current_date - 2) as id`, [P.assigned]))[0].id as string;
        const lv = (await q(`select public.save_daily_report($1, '{"notes":"Primer down, 2 kits"}', 1) as v`, [leadReport]))[0].v as number;
        await q(`select public.submit_daily_report($1, $2)`, [leadReport, lv]);
        // Crew leads and installers can't open a submitted report for editing.
        await expect(q(`select public.edit_submitted_daily_report($1)`, [leadReport])).rejects.toThrow(/Only the office/);
        await as(U.installer);
        await expect(q(`select public.edit_submitted_daily_report($1)`, [leadReport])).rejects.toThrow(/Only the office/);
        await expect(q(`select public.ensure_daily_report($1, current_date - 3)`, [P.assigned])).rejects.toThrow(/crew lead/);

        // The PM fixes it, submits the corrected version and accepts it.
        await as(U.pm);
        const ev = (await q(`select public.edit_submitted_daily_report($1) as v`, [leadReport]))[0].v as number;
        const draft = (await q(`select status, draft from public.daily_field_reports where id = $1`, [leadReport]))[0];
        expect(draft).toEqual({ status: "draft", draft: { notes: "Primer down, 2 kits" } }); // starts from what was submitted
        await expect(q(`select public.save_daily_report($1, '{}', $2)`, [leadReport, lv])).rejects.toThrow(/version_conflict/); // an old phone copy can't overwrite
        const fv = (await q(`select public.save_daily_report($1, '{"notes":"Primer down, 3 kits"}', $2) as v`, [leadReport, ev]))[0].v as number;
        await q(`select public.submit_daily_report($1, $2)`, [leadReport, fv]);
        await q(`select public.accept_daily_report($1)`, [leadReport]);
        const versions = await q(`select version_number, content ->> 'notes' as notes, submitted_by from public.dfr_versions where dfr_id = $1 order by version_number`, [leadReport]);
        expect(versions).toEqual([
          { version_number: 1, notes: "Primer down, 2 kits", submitted_by: E.lead },
          { version_number: 2, notes: "Primer down, 3 kits", submitted_by: E.pm },
        ]);
        expect((await q(`select status, accepted_by from public.daily_field_reports where id = $1`, [leadReport]))[0]).toEqual({ status: "accepted", accepted_by: E.pm });
        // Accepted reports are final, even for the office.
        await expect(q(`select public.edit_submitted_daily_report($1)`, [leadReport])).rejects.toThrow(/Only a submitted report/);
      } finally {
        await c.query("rollback");
      }
    });
  });
});

describe("reopening an accepted report", () => {
  it("the office reopens it with a reason; the accepted version and the reopening are kept", async () => {
    await superuser(async (c) => {
      await c.query("begin");
      const as = async (u: string) => {
        await c.query("reset role");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: "authenticated", aal: "aal2" })]);
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
        await as(U.lead);
        const id = (await q(`select public.ensure_daily_report($1, current_date - 5) as id`, [P.assigned]))[0].id as string;
        const v = (await q(`select public.save_daily_report($1, '{"notes":"Topcoat lot A1"}', 1) as v`, [id]))[0].v as number;
        await q(`select public.submit_daily_report($1, $2)`, [id, v]);
        await as(U.admin);
        await q(`select public.accept_daily_report($1)`, [id]);

        // Crew leads can't reopen; a reason is required.
        await as(U.lead);
        await expect(q(`select public.reopen_daily_report($1, 'Wrong lot')`, [id])).rejects.toThrow(/Only the office/);
        await as(U.pm);
        await expect(q(`select public.reopen_daily_report($1, '')`, [id])).rejects.toThrow(/reason/);
        const rv = (await q(`select public.reopen_daily_report($1, 'Wrong topcoat lot number') as v`, [id]))[0].v as number;
        expect((await q(`select status, accepted_by, draft ->> 'notes' as notes from public.daily_field_reports where id = $1`, [id]))[0]).toEqual({ status: "draft", accepted_by: null, notes: "Topcoat lot A1" });
        const fixed = (await q(`select public.save_daily_report($1, '{"notes":"Topcoat lot B7"}', $2) as v`, [id, rv]))[0].v as number;
        await q(`select public.submit_daily_report($1, $2)`, [id, fixed]);
        await q(`select public.accept_daily_report($1)`, [id]);

        expect(await q(`select accepted_version, accepted_by, reason, reopened_by from public.dfr_reopens where dfr_id = $1`, [id])).toEqual([
          { accepted_version: 1, accepted_by: E.admin, reason: "Wrong topcoat lot number", reopened_by: E.pm },
        ]);
        expect((await q(`select string_agg(content ->> 'notes', ' → ' order by version_number) as h from public.dfr_versions where dfr_id = $1`, [id]))[0].h).toBe("Topcoat lot A1 → Topcoat lot B7");
        // The crew on the job can read the history too.
        await as(U.installer);
        expect((await q(`select count(*)::int as n from public.dfr_reopens where dfr_id = $1`, [id]))[0].n).toBe(1);
        // Only an accepted report can be reopened.
        await as(U.pm);
        await q(`select public.reopen_daily_report($1, 'Again')`, [id]);
        await expect(q(`select public.reopen_daily_report($1, 'Twice')`, [id])).rejects.toThrow(/Only an accepted report/);
      } finally {
        await c.query("rollback");
      }
    });
  });
});
