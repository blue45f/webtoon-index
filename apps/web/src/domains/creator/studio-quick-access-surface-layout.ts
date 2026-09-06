import {
  loadStudioFloatingSurfaceLayout,
  saveStudioFloatingSurfaceLayout,
  type StudioFloatingSurfaceLayout,
  type StudioFloatingSurfaceStorage,
} from "./studio-floating-surface";

/**
 * Floating placement is tab-scoped UI state. It survives close/reopen and same-tab reload without
 * changing the existing owner-scoped Quick Access command model or becoming creative-data
 * authority. The storage key stays stable while the shared codec migrates v1 payloads to v2.
 */
export const STUDIO_QUICK_ACCESS_FLOATING_LAYOUT_SESSION_KEY =
  "toonspectrum:studio:quick-access-floating:v1";

export const DEFAULT_STUDIO_QUICK_ACCESS_FLOATING_LAYOUT: StudioFloatingSurfaceLayout =
  Object.freeze({
    version: 2,
    xRatio: 1,
    yRatio: 0,
    width: 336,
    height: 720,
    dock: "right",
    positionLocked: false,
    sizeLocked: false,
  });

function browserSessionStorage(): StudioFloatingSurfaceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadStudioQuickAccessFloatingLayout(
  storage: StudioFloatingSurfaceStorage | null = browserSessionStorage(),
): StudioFloatingSurfaceLayout {
  return loadStudioFloatingSurfaceLayout(
    storage,
    STUDIO_QUICK_ACCESS_FLOATING_LAYOUT_SESSION_KEY,
    DEFAULT_STUDIO_QUICK_ACCESS_FLOATING_LAYOUT,
  );
}

export function saveStudioQuickAccessFloatingLayout(
  layout: StudioFloatingSurfaceLayout,
  storage: StudioFloatingSurfaceStorage | null = browserSessionStorage(),
): boolean {
  return saveStudioFloatingSurfaceLayout(
    storage,
    STUDIO_QUICK_ACCESS_FLOATING_LAYOUT_SESSION_KEY,
    layout,
  );
}
