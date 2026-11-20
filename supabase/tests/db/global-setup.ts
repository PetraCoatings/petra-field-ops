import { rebuildDatabase } from "./harness";

export default async function setup() {
  await rebuildDatabase();
}
