"use client";

import { useEffect } from "react";
import { clearOfflineData } from "@/lib/offline/clear-offline-data";

/** On the sign-in page: wipe offline copies left by whoever used this phone before. */
export function ClearOfflineDataOnMount() {
  useEffect(() => {
    void clearOfflineData();
  }, []);
  return null;
}
