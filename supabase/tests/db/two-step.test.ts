/**
 * Office admins need two-step sign-in (aal2) for their admin powers; with a
 * password alone they're treated like an installer. Other roles are unaffected.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserPasswordOnly, superuser } from "./harness";
import { P, U, seed } from "./fixtures";

beforeAll(async () => {
  await superuser(seed);
});

const role = (q: (s: string) => Promise<{ rows: { r: string | null }[] }>) => q("select app.current_app_role()::text as r").then((x) => x.rows[0].r);

describe("two-step sign-in for office admins", () => {
  it("an admin with a password only has no admin powers", async () => {
    await asUserPasswordOnly(U.admin, async (q) => {
      expect(await role(q)).toBe("installer");
      expect((await q("select app.is_office_admin() as a")).rows[0].a).toBe(false);
      expect((await q("select count(*)::int as n from public.employees")).rows[0].n).toBe(1); // only themselves
      expect((await q("select count(*)::int as n from public.projects")).rows[0].n).toBe(0);
      await expect(q("update public.app_settings set minimum_wage = 1")).resolves.toMatchObject({ rowCount: 0 });
      // Their own profile still says office admin, so the app knows to ask for the code.
      expect((await q("select role::text as r from public.get_my_profile()")).rows[0].r).toBe("office_admin");
    });
  });

  it("after the code, full admin powers", async () => {
    await asUser(U.admin, async (q) => {
      expect(await role(q)).toBe("office_admin");
      expect((await q("select count(*)::int as n from public.employees")).rows[0].n).toBeGreaterThan(1);
      expect((await q("select count(*)::int as n from public.projects where id = $1", [P.unassigned])).rows[0].n).toBe(1);
    });
  });

  it("other roles work the same with or without two-step sign-in", async () => {
    for (const u of [U.pm, U.lead, U.installer]) {
      const a = await asUserPasswordOnly(u, role);
      const b = await asUser(u, role);
      expect(a).toBe(b);
    }
  });
});
