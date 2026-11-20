"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { askServiceWorker, serviceWorkerSupported } from "@/lib/offline/service-worker-client";

/** "Works without signal" note on the Calculators screen, once every calculator is saved. */
export function OfflineReady({ label }: { label: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!serviceWorkerSupported()) return;
    let cancelled = false;
    // A warm request returns quickly when nothing needs downloading.
    void askServiceWorker({ type: navigator.onLine ? "warm" : "status" }).then((s) => {
      if (!cancelled && s?.ready) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!ready) return null;
  return (
    <p role="status" className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-base font-medium text-green-900">
      <CloudOff aria-hidden className="size-5 shrink-0" />
      {label}
    </p>
  );
}
