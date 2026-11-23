import { api, deleteRoleUsers, readRoleUsers, signedInTestsEnabled } from "./role-users";

export default async function globalTeardown() {
  if (!signedInTestsEnabled()) return;
  // Mark what this run's test accounts created as test data (only the server
  // key can), before the accounts are deleted (migration 20261129000100).
  const emails = readRoleUsers().map((u) => `"${u.email}"`).join(",");
  if (emails) {
    const res = await api(`/rest/v1/employees?select=id&email=in.(${encodeURIComponent(emails)})`);
    const ids = res.ok ? ((await res.json()) as { id: string }[]).map((e) => e.id) : [];
    if (ids.length) {
      for (const table of ["projects", "products", "documents"]) {
        await api(`/rest/v1/${table}?created_by=in.(${ids.join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ is_test: true }) });
      }
    }
  }
  await deleteRoleUsers();
  // Remove this run's test jobs and products (see migrations 20261124000200 and 20261129000100).
  // Runs once, after every test has finished, so it never removes data a test
  // is still using.
  const res = await api("/rest/v1/rpc/purge_e2e_test_data", { method: "POST", body: "{}" });
  if (res.ok) console.log(`Removed test data: ${await res.text()}`);
}
