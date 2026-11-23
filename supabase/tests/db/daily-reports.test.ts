/**
 * Daily field reports: crew lead drafts and submits; versions are permanent;
 * two phones can't overwrite each other; the office sends back or accepts.
 */
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { superuser } from "./harness";
import { E, P, U, seed } from "./fixtures";

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.daily_field_reports, public.notifications cascade");
    await seed(c);
  });
});

async function scenario(fn: (as: (u: string) => Promise<void>, q: (s: string, p?: unknown[]) => Promise<Record<string, unknown>[]>, c: Client) => Promise<void>) {
  await superuser(async (c) => {
    await c.query("begin");
    const as = async (user: string) => {
      await c.query("reset role");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
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
      await fn(as, q, c);
    } finally {
      await c.query("rollback");
    }
  });
}

const draft = (work: string) => JSON.stringify({ v: 1, workPerformed: work });

describe("daily field reports", () => {
  it("draft → submit → sent back → resubmit → accepted, with permanent versions and notifications", async () => {
    await scenario(async (as, q, c) => {
      await as(U.installer);
      await expect(q(`select public.ensure_daily_report($1, '2026-11-09')`, [P.assigned])).rejects.toThrow(/crew lead/);

      await as(U.lead);
      const id = (await q(`select public.ensure_daily_report($1, '2026-11-09') as id`, [P.assigned]))[0].id as string;
      expect((await q(`select public.ensure_daily_report($1, '2026-11-09') as id`, [P.assigned]))[0].id).toBe(id); // same report
      await expect(q(`select public.submit_daily_report($1, 1)`, [id])).rejects.toThrow(/empty/);
      expect((await q(`select public.save_daily_report($1, $2, 1) as v`, [id, draft("Ground the floor")]))[0].v).toBe(2);
      // A second phone still on version 1 can't overwrite.
      await expect(q(`select public.save_daily_report($1, $2, 1)`, [id, draft("Other phone")])).rejects.toThrow(/version_conflict/);
      expect((await q(`select public.submit_daily_report($1, 2) as v`, [id]))[0].v).toBe(1);
      await expect(q(`select public.save_daily_report($1, $2, 2)`, [id, draft("late")])).rejects.toThrow(/already submitted/);

      await as(U.pm);
      expect((await q(`select type, data ->> 'version' as v from public.notifications`))).toEqual([{ type: "dfr_submitted", v: "1" }]);
      await expect(q(`select public.request_daily_report_correction($1, '')`, [id])).rejects.toThrow(/corrected/);
      await q(`select public.request_daily_report_correction($1, 'Add the square footage')`, [id]);

      await as(U.installer);
      await expect(q(`select public.accept_daily_report($1)`, [id])).rejects.toThrow(/office/);
      expect((await q(`select status, correction_note from public.daily_field_reports where id = $1`, [id]))[0]).toEqual({ status: "correction_requested", correction_note: "Add the square footage" });

      await as(U.lead);
      expect((await q(`select type, data ->> 'note' as note from public.notifications`))).toEqual([{ type: "dfr_correction", note: "Add the square footage" }]);
      await q(`select public.save_daily_report($1, $2, 2)`, [id, draft("Ground the floor, 6,620 sf")]);
      expect((await q(`select public.submit_daily_report($1, 3) as v`, [id]))[0].v).toBe(2);

      await as(U.admin);
      await q(`select public.accept_daily_report($1)`, [id]);
      await expect(q(`select public.accept_daily_report($1)`, [id])).rejects.toThrow(/Only a submitted/);
      const versions = await q(`select version_number, content ->> 'workPerformed' as w, submitted_by from public.dfr_versions where dfr_id = $1 order by 1`, [id]);
      expect(versions).toEqual([
        { version_number: 1, w: "Ground the floor", submitted_by: E.lead },
        { version_number: 2, w: "Ground the floor, 6,620 sf", submitted_by: E.lead },
      ]);

      // Versions can't be changed or deleted, even by the database owner.
      await c.query("reset role");
      await expect(q(`update public.dfr_versions set content = '{}' where dfr_id = $1`, [id])).rejects.toThrow(/cannot be changed/);
      await expect(q(`delete from public.dfr_versions where dfr_id = $1`, [id])).rejects.toThrow(/cannot be deleted/);
      // Deleting the whole job removes its reports.
      await q(`delete from public.projects where id = $1`, [P.assigned]);
      expect(await q(`select id from public.dfr_versions where dfr_id = $1`, [id])).toEqual([]);
    });
  });

  it("the crew reads their job's reports; others don't", async () => {
    await scenario(async (as, q) => {
      await as(U.lead);
      const id = (await q(`select public.ensure_daily_report($1, '2026-11-10') as id`, [P.assigned]))[0].id;
      await as(U.installer);
      expect(await q(`select id from public.daily_field_reports`)).toEqual([{ id }]);
      await as(U.otherInstaller);
      expect(await q(`select id from public.daily_field_reports`)).toEqual([]);
      await expect(q(`select public.save_daily_report($1, '{}', 1)`, [id])).rejects.toThrow(/Not allowed/);
      await expect(q(`select public.ensure_daily_report($1, '2030-01-01')`, [P.assigned])).rejects.toThrow(/crew lead|future/);
    });
  });
});
