"use client";

import { useEffect, useState } from "react";

/**
 * useState that is also kept in this phone's localStorage, so a crew member
 * who locks the screen or switches apps comes back to the numbers they typed.
 * Storage can be unavailable (private mode, blocked site data); the calculator
 * then simply works without remembering.
 */
export function usePersistedState<T>(key: string, initial: T, isValid: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore after hydration
        if (isValid(parsed)) setValue(parsed);
      }
    } catch {
      // ignore unreadable or unavailable storage
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per key
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [key, value, loaded]);

  return [value, setValue] as const;
}
