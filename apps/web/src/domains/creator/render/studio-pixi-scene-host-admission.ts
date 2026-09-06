/**
 * Product admission for always-on Pixi selectable-scene overlays.
 *
 * Maps document selection → StudioSceneSelectableOverlay without granting Pixi
 * brush or document authority. Pure helpers only — no pixi.js import here.
 */

import { elBounds } from "../studio-element-geometry";

import type { El } from "../studio-element-model";
import type { StudioSceneSelectableOverlay } from "../studio-scene-provider";

export const STUDIO_PIXI_SCENE_HOST_PRODUCT_ID =
  "studio-pixi-scene-overlay-host" as const;

export const STUDIO_PIXI_SCENE_HOST_ALWAYS_ON = true as const;

const SELECTION_FILL = Object.freeze({ color: 0x2563eb, alpha: 0.07 });
const SELECTION_STROKE = Object.freeze({
  color: 0x2563eb,
  alpha: 0.95,
  width: 1.5,
});

/** Structural subset of document elements that can host a selectable Pixi overlay. */
export type StudioPixiHostElementLike = {
  readonly id: string;
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly points?: readonly number[];
  readonly fontSize?: number;
  readonly hidden?: boolean;
};

/**
 * The page box this overlay set is being built for. Supplying it is what lets the admission reject
 * a selection whose bounds swallow the whole document.
 */
export interface StudioPixiOverlayAdmissionOptions {
  readonly documentWidth?: number;
  readonly documentHeight?: number;
}

/** Half a device pixel of slack so a page-sized element is not missed by float noise. */
const DOCUMENT_COVER_EPSILON = 0.5;

/**
 * True when the bounds contain the whole page.
 *
 * Such an overlay carries no selection information — everything the artist can see is inside it —
 * while its translucent fill recolours every pixel of the work. That is exactly what a transient
 * pixel-selection composite looks like: a full-page raster the tool created for itself, not an
 * object the artist placed. Selection chrome for it is Konva's job (marching ants and the
 * transformer), so the accelerated wash stands down.
 */
export function studioPixiOverlayCoversDocument(
  bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  documentWidth: number | undefined,
  documentHeight: number | undefined,
): boolean {
  if (
    !Number.isFinite(documentWidth ?? Number.NaN)
    || !Number.isFinite(documentHeight ?? Number.NaN)
    || (documentWidth ?? 0) <= 0
    || (documentHeight ?? 0) <= 0
  ) {
    return false;
  }
  return (
    bounds.x <= DOCUMENT_COVER_EPSILON
    && bounds.y <= DOCUMENT_COVER_EPSILON
    && bounds.x + bounds.w >= (documentWidth as number) - DOCUMENT_COVER_EPSILON
    && bounds.y + bounds.h >= (documentHeight as number) - DOCUMENT_COVER_EPSILON
  );
}

export function studioPixiSceneHostIsAlwaysOn(): boolean {
  return STUDIO_PIXI_SCENE_HOST_ALWAYS_ON;
}

export function buildStudioPixiSelectableOverlayFromElement(
  element: StudioPixiHostElementLike,
  zIndex: number,
  options: StudioPixiOverlayAdmissionOptions = {},
): StudioSceneSelectableOverlay | null {
  if (element.hidden) return null;
  const bounds = elBounds(element as El);
  if (
    !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.w)
    || !Number.isFinite(bounds.h)
    || bounds.w <= 0
    || bounds.h <= 0
  ) {
    return null;
  }
  if (
    studioPixiOverlayCoversDocument(
      bounds,
      options.documentWidth,
      options.documentHeight,
    )
  ) {
    return null;
  }

  return {
    documentId: element.id,
    zIndex,
    visible: true,
    selectable: true,
    opacity: 1,
    fill: SELECTION_FILL,
    stroke: SELECTION_STROKE,
    shape: {
      kind: "rect",
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.w,
        height: bounds.h,
      },
    },
  };
}

/**
 * Build overlays for the current selection set. Order follows selection ids so
 * zIndex is stable across frames (last id paints on top).
 */
export function buildStudioPixiSelectableOverlaysForSelection(
  elements: readonly StudioPixiHostElementLike[],
  selectedIds: readonly string[],
  options: StudioPixiOverlayAdmissionOptions = {},
): readonly StudioSceneSelectableOverlay[] {
  if (selectedIds.length === 0) return Object.freeze([]);
  const byId = new Map(elements.map((el) => [el.id, el] as const));
  const overlays: StudioSceneSelectableOverlay[] = [];
  selectedIds.forEach((id, index) => {
    const element = byId.get(id);
    if (!element) return;
    const overlay = buildStudioPixiSelectableOverlayFromElement(
      element,
      index,
      options,
    );
    if (overlay) overlays.push(overlay);
  });
  return Object.freeze(overlays);
}

export function planStudioPixiOverlaySync(
  previousIds: readonly string[],
  nextOverlays: readonly StudioSceneSelectableOverlay[],
): {
  readonly removeIds: readonly string[];
  readonly upsert: readonly StudioSceneSelectableOverlay[];
} {
  const nextIds = new Set(nextOverlays.map((overlay) => overlay.documentId));
  const removeIds = previousIds.filter((id) => !nextIds.has(id));
  return Object.freeze({
    removeIds: Object.freeze([...removeIds]),
    upsert: nextOverlays,
  });
}
