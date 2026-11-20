import { createRoleUsers, signedInTestsEnabled } from "./role-users";

export default async function globalSetup() {
  if (signedInTestsEnabled()) await createRoleUsers();
}
