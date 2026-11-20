/**
 * Removes everything the app keeps on this phone for offline use: the service
 * worker's saved pages and the calculators' remembered entries. Called on the
 * sign-in page, so the next person on a shared or handed-down phone starts clean.
 */
export async function clearOfflineData(): Promise<void> {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("petra.calc.")) window.localStorage.removeItem(key);
    }
  } catch {
    // storage unavailable
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("petra-offline-")).map((k) => caches.delete(k)));
    }
  } catch {
    // ignore
  }
}
