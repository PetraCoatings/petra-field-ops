/**
 * Data sheets saved "on this phone" for use with no signal (safety data sheets
 * above all). The PDF bytes live in Cache Storage; a small list of what's saved
 * lives in localStorage. Both are cleared at sign-in/sign-out with the rest of
 * the offline data (clear-offline-data.ts).
 */
export const SAVED_DOCS_CACHE = "petra-sds-v1";
const LIST_KEY = "petra.sds.saved";

export type SavedDoc = { versionId: string; title: string; savedAt: string };

export const fileUrl = (versionId: string) => `/documents/${versionId}/file`;

export function listSaved(): SavedDoc[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(LIST_KEY) ?? "[]");
    return Array.isArray(v) ? (v as SavedDoc[]).filter((d) => typeof d?.versionId === "string") : [];
  } catch {
    return [];
  }
}

function writeList(list: SavedDoc[]) {
  try {
    window.localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable
  }
}

export async function saveDoc(versionId: string, title: string, bytes?: ArrayBuffer): Promise<boolean> {
  try {
    const cache = await caches.open(SAVED_DOCS_CACHE);
    const res = bytes
      ? new Response(bytes, { headers: { "Content-Type": "application/pdf" } })
      : await fetch(fileUrl(versionId), { credentials: "same-origin" });
    if (!res.ok) return false;
    await cache.put(fileUrl(versionId), res);
    writeList([...listSaved().filter((d) => d.versionId !== versionId), { versionId, title, savedAt: new Date().toISOString() }]);
    return true;
  } catch {
    return false;
  }
}

export async function removeDoc(versionId: string): Promise<void> {
  try {
    const cache = await caches.open(SAVED_DOCS_CACHE);
    await cache.delete(fileUrl(versionId));
  } catch {
    // ignore
  }
  writeList(listSaved().filter((d) => d.versionId !== versionId));
}

/** The PDF bytes: from the network when there's signal, else from the phone if saved. */
export async function loadDocBytes(versionId: string): Promise<{ bytes: ArrayBuffer; fromPhone: boolean } | null> {
  try {
    const res = await fetch(fileUrl(versionId), { credentials: "same-origin" });
    if (res.ok) return { bytes: await res.arrayBuffer(), fromPhone: false };
  } catch {
    // offline: fall through to the saved copy
  }
  try {
    const cache = await caches.open(SAVED_DOCS_CACHE);
    const hit = await cache.match(fileUrl(versionId));
    if (hit) return { bytes: await hit.arrayBuffer(), fromPhone: true };
  } catch {
    // ignore
  }
  return null;
}
