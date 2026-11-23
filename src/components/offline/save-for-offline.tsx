"use client";
import { useEffect } from "react";
import { askServiceWorker, serviceWorkerSupported } from "@/lib/offline/service-worker-client";

/**
 * Asks the offline helper to keep a fresh copy of this page, so it opens with
 * no signal later. Needed because pages opened by in-app links don't do a full
 * page load, which is when the helper normally saves them.
 */
export function SaveForOffline() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !serviceWorkerSupported() || !navigator.onLine) return;
    void askServiceWorker({ type: "save", path: window.location.pathname }, 15_000);
  }, []);
  return null;
}
