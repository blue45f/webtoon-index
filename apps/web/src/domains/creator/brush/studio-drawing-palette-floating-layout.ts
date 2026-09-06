import {
  loadStudioFloatingSurfaceLayout,
  saveStudioFloatingSurfaceLayout,
  type StudioFloatingSurfaceLayout,
  type StudioFloatingSurfaceStorage,
} from "../studio-floating-surface";

import type { StudioDrawingPaletteId } from "./studio-drawing-palettes";

const STORAGE_PREFIX = "toonspectrum:studio:drawing-palette-floating:v2";

export const DEFAULT_STUDIO_DRAWING_PALETTE_FLOATING_LAYOUTS: Readonly<
  Record<StudioDrawingPaletteId, StudioFloatingSurfaceLayout>
> = Object.freeze({
  "sub-tools": Object.freeze({
    version: 2,
    xRatio: 0,
    yRatio: 0.08,
    width: 320,
    height: 544,
    dock: "left",
    positionLocked: false,
    sizeLocked: false,
  }),
  "tool-properties": Object.freeze({
    version: 2,
    xRatio: 0,
    yRatio: 0.52,
    width: 336,
    height: 560,
    dock: "left",
    positionLocked: false,
    sizeLocked: false,
  }),
});

function browserSessionStorage(): StudioFloatingSurfaceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function studioDrawingPaletteFloatingLayoutKey(
  id: StudioDrawingPaletteId,
): string {
  return `${STORAGE_PREFIX}:${id}`;
}

export function loadStudioDrawingPaletteFloatingLayout(
  id: StudioDrawingPaletteId,
  storage: StudioFloatingSurfaceStorage | null = browserSessionStorage(),
): StudioFloatingSurfaceLayout {
  return loadStudioFloatingSurfaceLayout(
    storage,
    studioDrawingPaletteFloatingLayoutKey(id),
    DEFAULT_STUDIO_DRAWING_PALETTE_FLOATING_LAYOUTS[id],
  );
}

export function saveStudioDrawingPaletteFloatingLayout(
  id: StudioDrawingPaletteId,
  layout: StudioFloatingSurfaceLayout,
  storage: StudioFloatingSurfaceStorage | null = browserSessionStorage(),
): boolean {
  return saveStudioFloatingSurfaceLayout(
    storage,
    studioDrawingPaletteFloatingLayoutKey(id),
    layout,
  );
}
