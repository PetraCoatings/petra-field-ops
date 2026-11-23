/**
 * Removes everything the app keeps on this phone for offline use: the service
 * worker's saved pages and the calculators' remembered entries. Called on the
 * sign-in page, so the next person on a shared or handed-down phone starts clean.
 * That includes data sheets saved "on this phone" and unsaved daily report
 * typing. (Unsent Time Clock presses, report saves and photos are kept: each
 * belongs to the account that made it and is sent only when that person signs in.)
 */
export async function clearOfflineData(): Promise<void> {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("petra.calc.") || key.startsWith("petra.sds.") || key.startsWith("petra.dfr.")) window.localStorage.removeItem(key);
    }
  } catch {
    // storage unavailable
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("petra-offline-") || k.startsWith("petra-sds-")).map((k) => caches.delete(k)));
    }
  } catch {
    // ignore
  }
}
