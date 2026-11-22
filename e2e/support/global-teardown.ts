import { api, deleteRoleUsers, signedInTestsEnabled } from "./role-users";

export default async function globalTeardown() {
  if (!signedInTestsEnabled()) return;
  await deleteRoleUsers();
  // Remove this run's "E2E…" jobs and products (see migration 20261124000200).
  // Runs once, after every test has finished, so it never removes data a test
  // is still using.
  const res = await api("/rest/v1/rpc/purge_e2e_test_data", { method: "POST", body: "{}" });
  if (res.ok) console.log(`Removed test data: ${await res.text()}`);
}
