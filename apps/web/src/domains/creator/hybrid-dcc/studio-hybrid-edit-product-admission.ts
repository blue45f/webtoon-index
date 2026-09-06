/**
 * Product admission for hybrid brush/filter/edit strengths.
 *
 * Keeps Studio panels free of provider construction detail while ensuring OpenCV morphology,
 * RBush object pick, perfect-freehand outlines and precision leash samples are reachable from
 * product handlers (not only unit tests).
 */

import { pickObjectIdAtPoint, selectIdsByMarquee } from "../studio-selection";

import {
  createHybridPixiEditOverlayHost,
  runHybridBrushOutlineStroke,
  runHybridFilterPlan,
  runHybridObjectPickAtPoint,
  runHybridPrecisionStabilizeSample,
  runHybridSelectionMaskMorphology,
  STUDIO_HYBRID_BRUSH_FILTER_EDIT_ROUTES,
  type StudioHybridObjectPickCandidate,
} from "./studio-hybrid-brush-filter-edit-runtime";
import {
  applyHybridPixelSelectionBoundaryChange,
  applyHybridPixelSelectionBoundaryChangeSync,
  rasterizePixelSelectionToAlphaMask,
} from "./studio-hybrid-pixel-selection-boundary";

export {
  applyHybridPixelSelectionBoundaryChange,
  applyHybridPixelSelectionBoundaryChangeSync,
  createHybridPixiEditOverlayHost,
  pickObjectIdAtPoint,
  rasterizePixelSelectionToAlphaMask,
  runHybridBrushOutlineStroke,
  runHybridFilterPlan,
  runHybridObjectPickAtPoint,
  runHybridPrecisionStabilizeSample,
  runHybridSelectionMaskMorphology,
  selectIdsByMarquee,
  STUDIO_HYBRID_BRUSH_FILTER_EDIT_ROUTES,
};

export type StudioHybridEditProductSurface =
  | "draw-options-stabilizer"
  | "selection-tools-expand-contract"
  | "filter-dialog-canonical-plan"
  | "object-pick-spatial-index"
  | "pixi-selectable-overlay";

/** Surfaces that already patch real coordinators for hybrid strengths. */
export const STUDIO_HYBRID_EDIT_PRODUCT_SURFACES = Object.freeze({
  "draw-options-stabilizer":
    "StudioDrawOptionsBar stabilizerMode=precision → lazy-brush leash via stroke stabilizer bridge",
  "selection-tools-expand-contract":
    "applyHybridPixelSelectionBoundaryChangeSync (vector geometry + OpenCV morph receipt) — available to callers; the StudioInspectorAside expand/contract buttons still commit the vector geometry alone, because the morph result is a receipt and never becomes the selection",
  "filter-dialog-canonical-plan":
    "StudioFilterDialog / SmartFilters → planStudioCanonicalFilterExecution / WebGPU filter runtime",
  "object-pick-spatial-index":
    "StudioPage marquee → selectIdsByMarquee (RBush primary) · pickObjectIdAtPoint for point hits",
  "pixi-selectable-overlay":
    "createHybridPixiEditOverlayHost → createStudioPixiSceneProvider dedicated overlay",
} as const satisfies Record<StudioHybridEditProductSurface, string>);

/**
 * Product OpenCV morphology for a binary selection mask (expand/contract refine path).
 */
export async function admitHybridSelectionMaskMorph(input: Readonly<{
  width: number;
  height: number;
  mask: Uint8Array | Uint8ClampedArray;
  mode: "erode" | "dilate" | "open" | "close" | "gradient";
  kernelSize?: number;
  iterations?: number;
  runtimeLoader?: Parameters<typeof runHybridSelectionMaskMorphology>[0]["runtimeLoader"];
}>) {
  return runHybridSelectionMaskMorphology({
    width: input.width,
    height: input.height,
    mask: input.mask,
    mode: input.mode,
    kernelSize: input.kernelSize,
    iterations: input.iterations,
    runtimeLoader: input.runtimeLoader,
  });
}

/**
 * Product RBush-backed topmost object pick for edit/transform hit routing.
 */
export function admitHybridObjectPick(
  objects: readonly StudioHybridObjectPickCandidate[],
  point: Readonly<{ x: number; y: number }>,
  options?: Parameters<typeof runHybridObjectPickAtPoint>[2],
) {
  return runHybridObjectPickAtPoint(objects, point, options);
}
