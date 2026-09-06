import {
  STUDIO_FLOATING_SURFACE_LAYOUT_VERSION,
  type StudioFloatingSurfaceLayout,
} from "./studio-floating-surface";

export const STUDIO_DETACHABLE_PANEL_IDS = ["page-list", "inspector"] as const;
export type StudioDetachablePanelId = (typeof STUDIO_DETACHABLE_PANEL_IDS)[number];

const SESSION_PREFIX = "toonspectrum:studio:detached-panel:v1";

export const DEFAULT_STUDIO_PAGE_LIST_FLOATING_LAYOUT: StudioFloatingSurfaceLayout = Object.freeze({
  version: STUDIO_FLOATING_SURFACE_LAYOUT_VERSION,
  xRatio: 0.02,
  yRatio: 0.04,
  width: 360,
  height: 760,
  dock: "free",
  positionLocked: false,
  sizeLocked: false,
});

export const DEFAULT_STUDIO_INSPECTOR_FLOATING_LAYOUT: StudioFloatingSurfaceLayout = Object.freeze({
  version: STUDIO_FLOATING_SURFACE_LAYOUT_VERSION,
  xRatio: 0.98,
  yRatio: 0.04,
  width: 440,
  height: 800,
  dock: "free",
  positionLocked: false,
  sizeLocked: false,
});

export const DEFAULT_STUDIO_BRUSH_CATALOG_FLOATING_LAYOUT: StudioFloatingSurfaceLayout = Object.freeze({
  version: STUDIO_FLOATING_SURFACE_LAYOUT_VERSION,
  xRatio: 0.08,
  yRatio: 0.12,
  width: 440,
  height: 680,
  dock: "free",
  positionLocked: false,
  sizeLocked: false,
});

export function studioDetachablePanelSessionKey(id: StudioDetachablePanelId): string {
  return `${SESSION_PREFIX}:${id}`;
}

function browserSessionStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadStudioDetachablePanelState(
  id: StudioDetachablePanelId,
  storage: Pick<Storage, "getItem"> | null = browserSessionStorage(),
): boolean {
  try {
    return storage?.getItem(studioDetachablePanelSessionKey(id)) === "detached";
  } catch {
    return false;
  }
}

export function saveStudioDetachablePanelState(
  id: StudioDetachablePanelId,
  detached: boolean,
  storage: Pick<Storage, "setItem"> | null = browserSessionStorage(),
): boolean {
  try {
    storage?.setItem(
      studioDetachablePanelSessionKey(id),
      detached ? "detached" : "attached",
    );
    return storage !== null;
  } catch {
    return false;
  }
}
