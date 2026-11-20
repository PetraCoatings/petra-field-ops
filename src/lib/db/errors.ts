/** Map Postgres/PostgREST error codes to user-facing translation keys. */
export function dbErrorKey(
  error: { code?: string; message?: string } | null,
  map: Partial<Record<"unique" | "lastAdmin", string>> = {},
): string {
  if (!error) return "common.genericError";
  if (error.code === "23505" && map.unique) return map.unique;
  if (error.code === "P0001" && /last active office administrator/i.test(error.message ?? "") && map.lastAdmin) {
    return map.lastAdmin;
  }
  return "common.genericError";
}
