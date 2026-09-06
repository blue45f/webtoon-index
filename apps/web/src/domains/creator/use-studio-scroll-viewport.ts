/**
 * React binding for the live scroll-viewport store.
 *
 * Kept in its own module so the subscriber component file exports only a
 * component (fast-refresh boundary) and so leaf components such as the minimap
 * viewport box can read the store directly without a render prop.
 */

import { useSyncExternalStore } from "react";

import type {
  StudioScrollViewport,
  StudioScrollViewportStore,
} from "./studio-scroll-viewport-store";

export function useStudioScrollViewport(
  store: StudioScrollViewportStore,
): StudioScrollViewport {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
