/**
 * QC: the office sets required tests with optional limits; the crew lead
 * records readings; pass/fail only when a limit exists, frozen at recording.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { superuser } from "./harness";
import { P, U, seed } from "./fixtures";

let RH = "";
let ADHESION = "";
let CSP = "";

beforeAll(async () => {
  await superuser(async (c) => {
    await c.query("truncate public.qc_measurements, public.qc_requirements cascade");
    await seed(c);
    const types = (await c.query("select id, code from public.qc_test_types")).rows;
    RH = types.find((t) => t.code === "moisture_rh").id;
    ADHESION = types.find((t) => t.code === "adhesion").id;
    CSP = types.find((t) => t.code === "csp").id;
  });
});

describe("QC checks", () => {
  it("pass/fail only with a limit; limits frozen on each reading; who can do what", async () => {
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
      const record = (type: string, value: number, where = "Bay 2") =>
        q(`select public.record_qc_measurement($1, $2, $3, $4) as id`, [P.assigned, type, value, where]).then((r) => r[0].id as string);
      const result = (id: string) => q(`select result, criteria_min, criteria_max, unit, method from public.qc_measurements where id = $1`, [id]).then((r) => r[0]);
      try {
        await as(U.installer);
        await expect(q(`insert into public.qc_requirements (project_id, test_type_id, max_value) values ($1, $2, 75)`, [P.assigned, RH])).rejects.toThrow(/row-level security/);
        await expect(record(RH, 70)).rejects.toThrow(/crew lead or the office/);

        await as(U.pm);
        await q(`insert into public.qc_requirements (project_id, test_type_id, max_value) values ($1, $2, 75)`, [P.assigned, RH]); // RH ≤ 75%
        await q(`insert into public.qc_requirements (project_id, test_type_id, min_value) values ($1, $2, 300)`, [P.assigned, ADHESION]); // ≥ 300 psi
        await q(`insert into public.qc_requirements (project_id, test_type_id) values ($1, $2)`, [P.assigned, CSP]); // required, no limit
        await expect(q(`insert into public.qc_requirements (project_id, test_type_id, min_value, max_value) values ($1, (select id from public.qc_test_types where code = 'ph'), 10, 7)`, [P.assigned])).rejects.toThrow(/check/);

        await as(U.lead);
        expect(await result(await record(RH, 72.5))).toEqual({ result: "pass", criteria_min: null, criteria_max: "75", unit: "% RH", method: "ASTM F2170" });
        expect((await result(await record(RH, 81))).result).toBe("fail");
        expect((await result(await record(ADHESION, 450))).result).toBe("pass");
        expect((await result(await record(ADHESION, 250))).result).toBe("fail");
        // No limit → recorded, never judged.
        expect(await result(await record(CSP, 3))).toMatchObject({ result: null, criteria_min: null, criteria_max: null });
        const ph = (await q(`select id from public.qc_test_types where code = 'ph'`))[0].id;
        expect((await result(await record(ph, 9))).result).toBeNull(); // not even required

        // Changing the limit later doesn't change earlier results.
        await as(U.pm);
        await q(`update public.qc_requirements set max_value = 70 where test_type_id = $1`, [RH]);
        await as(U.lead);
        const firstRh = await q(`select result from public.qc_measurements where value = 72.5`);
        expect(firstRh).toEqual([{ result: "pass" }]);
        expect((await result(await record(RH, 72.5))).result).toBe("fail"); // judged against the new limit

        // A "pass" can't exist without a limit, even written directly.
        await c.query("reset role");
        await expect(q(`insert into public.qc_measurements (project_id, test_type_id, value, unit, result) values ($1, $2, 1, 'x', 'pass')`, [P.assigned, CSP])).rejects.toThrow(/check/);

        await as(U.otherInstaller);
        expect(await q(`select id from public.qc_measurements`)).toEqual([]);
        await as(U.installer);
        expect((await q(`select count(*)::int as n from public.qc_measurements`))[0].n).toBe(7);
      } finally {
        await c.query("rollback");
      }
    });
  });
});
