"use client";

import { useEffect } from "react";
import { askServiceWorker, serviceWorkerSupported } from "@/lib/offline/service-worker-client";

/**
 * Registers the offline service worker for signed-in users and asks it to
 * refresh the saved calculators (it skips this if it did so recently).
 * Production builds only: in `next dev` a service worker would serve stale code.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !serviceWorkerSupported()) return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => {
        if (!cancelled && navigator.onLine) void askServiceWorker({ type: "warm" });
      })
      .catch(() => {
        // Offline support is a bonus; the app works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
