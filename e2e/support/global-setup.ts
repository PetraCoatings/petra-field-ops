import { createRoleUsers, signedInTestsEnabled } from "./role-users";

export default async function globalSetup() {
  // The tests create and delete people, jobs and time. They run against the
  // separate TEST project only, never the live one.
  if (signedInTestsEnabled() && (process.env.E2E_SUPABASE_URL ?? "").includes("oledxskbtjiqyyyaoqdd")) {
    throw new Error("E2E_SUPABASE_URL points at the LIVE project. Browser tests run against the test project only (see docs/SETUP.md).");
  }
  if (signedInTestsEnabled()) await createRoleUsers();
}
