/** Fields that change on every write and add no information to the audit view. */
const IGNORED = new Set(["updated_at", "created_at", "id", "display_name"]);

export type FieldChange = { field: string; before?: string; after?: string };

function show(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** List the fields that differ between the old and new versions of a row. */
export function changedFields(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): FieldChange[] {
  const fields = new Set([...Object.keys(oldData ?? {}), ...Object.keys(newData ?? {})]);
  const out: FieldChange[] = [];
  for (const f of [...fields].sort()) {
    if (IGNORED.has(f)) continue;
    const before = oldData?.[f];
    const after = newData?.[f];
    if (oldData && newData && JSON.stringify(before) === JSON.stringify(after)) continue;
    if (!oldData && (after === null || after === undefined)) continue; // INSERT: skip empty fields
    out.push({
      field: f,
      before: oldData ? show(before) : undefined,
      after: newData ? show(after) : undefined,
    });
  }
  return out;
}
