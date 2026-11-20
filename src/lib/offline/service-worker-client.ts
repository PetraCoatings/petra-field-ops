/** Talking to public/sw.js from the page. */

export type OfflineStatus = { ready: boolean };

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;
}

/** Sends a message to the active service worker and waits for its reply (or null after a timeout). */
export async function askServiceWorker(message: { type: "warm" | "status"; force?: boolean }, timeoutMs = 60_000): Promise<OfflineStatus | null> {
  if (!serviceWorkerSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  const worker = reg.active;
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data as OfflineStatus);
    };
    worker.postMessage(message, [channel.port2]);
  });
}
