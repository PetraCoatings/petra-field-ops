import { deleteRoleUsers, signedInTestsEnabled } from "./role-users";

export default async function globalTeardown() {
  if (signedInTestsEnabled()) await deleteRoleUsers();
}
