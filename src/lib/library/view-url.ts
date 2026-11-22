/** Link to the in-app data sheet viewer. */
export function viewUrl(versionId: string, name: string, back: string, type: "tds" | "sds"): string {
  const q = new URLSearchParams({ v: versionId, name, back, type });
  return `/library/view?${q.toString()}`;
}
