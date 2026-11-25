import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False while a component is only server-rendered HTML, true once React has
 * attached its event handlers ("hydrated"). Used as data-ready on upload
 * boxes, so automated tests wait for them to be usable.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
