import {
  planStudioSelectionLayoutPatch as planLegacySelectionLayoutPatch,
  resolveStudioFigmaSelectionLayoutMetrics as resolveLegacySelectionLayoutMetrics,
  unionStudioSelectionBounds,
} from "./studio-figma-selection-ux";
import {
  anchorAdjustedOrigin,
  finiteNumber,
  finitePositive,
  nearlyEqual,
  normalizeSignedDegrees,
  supportsPersistentAspectLock,
  type StudioFigmaSelectionLayoutPatch,
} from "./studio-selection-transform-contract";

import type { El } from "./studio-element-model";
import type { StudioGroupUniformResizeBounds } from "./studio-group-uniform-resize";

/**
 * Precision single-selection wrapper. It preserves the established draw bake, adding only the
 * metadata that can be resolved before that planner runs: aspect ratio, resize anchor, stable
 * absolute angles, and the durable `lockAspect` flag.
 */
export function planStudioSelectionLayoutPatch(
  element: El,
  patch: StudioFigmaSelectionLayoutPatch,
): Partial<El> | null {
  const shown = unionStudioSelectionBounds([element]);
  if (!shown) return null;
  const source: StudioGroupUniformResizeBounds = {
    x: shown.x,
    y: shown.y,
    width: shown.w,
    height: shown.h,
  };
  const legacyMetrics = resolveLegacySelectionLayoutMetrics([element]);
  if (!legacyMetrics) return null;
  const canLockAspect = supportsPersistentAspectLock(element, legacyMetrics);
  const currentAspectLock = Boolean(element.lockAspect);
  const nextAspectLock =
    canLockAspect && typeof patch.lockAspect === "boolean"
      ? patch.lockAspect
      : currentAspectLock;

  const widthTyped = finitePositive(patch.width) && legacyMetrics.supportsWidth;
  const heightTyped = finitePositive(patch.height) && legacyMetrics.supportsHeight;
  let goalWidth = widthTyped ? patch.width! : source.width;
  let goalHeight = heightTyped ? patch.height! : source.height;
  if (nextAspectLock && widthTyped !== heightTyped) {
    if (widthTyped) goalHeight = source.height * (goalWidth / source.width);
    else goalWidth = source.width * (goalHeight / source.height);
  } else if (nextAspectLock && widthTyped && heightTyped) {
    // A linked box cannot honour two conflicting scales. Width is the canonical value because the
    // panel commits one field at a time; deriving H keeps programmatic compound patches coherent.
    goalHeight = source.height * (goalWidth / source.width);
  }

  const sizeChanged =
    !nearlyEqual(goalWidth, source.width) || !nearlyEqual(goalHeight, source.height);
  const anchored = sizeChanged
    ? anchorAdjustedOrigin(element, source, goalWidth, goalHeight, patch.resizeAnchor)
    : { x: source.x, y: source.y };
  const layoutPatch: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    opacity?: number;
  } = {
    ...(finiteNumber(patch.x)
      ? { x: patch.x }
      : sizeChanged
        ? { x: anchored.x }
        : {}),
    ...(finiteNumber(patch.y)
      ? { y: patch.y }
      : sizeChanged
        ? { y: anchored.y }
        : {}),
    ...(widthTyped || (nextAspectLock && heightTyped) ? { width: goalWidth } : {}),
    ...(heightTyped || (nextAspectLock && widthTyped) ? { height: goalHeight } : {}),
    ...(finiteNumber(patch.opacity) ? { opacity: patch.opacity } : {}),
  };

  if (finiteNumber(patch.rotation)) {
    if (element.type === "draw") {
      layoutPatch.rotation = patch.rotation;
    } else {
      const current =
        "rotation" in element && typeof element.rotation === "number" && Number.isFinite(element.rotation)
          ? normalizeSignedDegrees(element.rotation)
          : 0;
      const normalized = normalizeSignedDegrees(patch.rotation);
      if (!nearlyEqual(normalized, current)) layoutPatch.rotation = normalized;
    }
  }

  const planningElement =
    nextAspectLock !== currentAspectLock
      ? ({ ...element, lockAspect: nextAspectLock } as El)
      : element;
  const planned = planLegacySelectionLayoutPatch(planningElement, layoutPatch);
  const lockChanged = canLockAspect && nextAspectLock !== currentAspectLock;
  if (!planned && !lockChanged) return null;
  return {
    ...(planned ?? {}),
    ...(lockChanged ? { lockAspect: nextAspectLock } : {}),
  } as Partial<El>;
}
