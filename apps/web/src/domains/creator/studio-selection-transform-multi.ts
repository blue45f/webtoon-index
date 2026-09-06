import { unionStudioSelectionBounds } from "./studio-figma-selection-ux";
import { planStudioGroupUniformResize } from "./studio-group-uniform-resize";
import {
  GROUP_LAYOUT_SOLVE_MAX_STEPS,
  GROUP_LAYOUT_SOLVE_TOLERANCE,
  UNIFORM_SCALE_RELATIVE_EPSILON,
  finiteNumber,
  finitePositive,
  nearlyEqual,
  normalizeRotationDelta,
  resizeAnchorFactors,
  rotateBoxOriginAboutCentre,
  type StudioFigmaSelectionLayoutPatch,
} from "./studio-selection-transform-contract";

import type { El } from "./studio-element-model";
import type { StudioGroupUniformResizeBounds } from "./studio-group-uniform-resize";

/**
 * Atomic multi-selection numeric transform.
 *
 * W/H always resolve to one positive uniform scale, preserving relative layout; rotation is a
 * delta around the transformed selection centre. Unsupported members make the group planner return
 * unchanged references, and this façade converts that verdict to `null` before opacity can leak
 * through as a partial commit.
 */
export function planStudioMultiSelectionLayoutPatch(
  elements: readonly El[],
  selectedIds: readonly string[],
  patch: StudioFigmaSelectionLayoutPatch,
): El[] | null {
  const requestedIds = new Set(selectedIds);
  if (requestedIds.size < 2) return null;
  const targets = elements.filter((element) => requestedIds.has(element.id));
  if (targets.length !== requestedIds.size) return null;
  const bounds = unionStudioSelectionBounds(targets);
  if (!bounds) return null;

  const widthScale = finitePositive(patch.width) ? patch.width / bounds.w : null;
  const heightScale = finitePositive(patch.height) ? patch.height / bounds.h : null;
  if (
    widthScale !== null
    && heightScale !== null
    && !nearlyEqual(widthScale, heightScale, UNIFORM_SCALE_RELATIVE_EPSILON)
  ) {
    return null;
  }
  const scale = widthScale ?? heightScale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const targetWidth = bounds.w * scale;
  const targetHeight = bounds.h * scale;
  const [anchorX, anchorY] = resizeAnchorFactors(patch.resizeAnchor);
  const baseTarget: StudioGroupUniformResizeBounds = {
    x: finiteNumber(patch.x)
      ? patch.x
      : bounds.x + (bounds.w - targetWidth) * anchorX,
    y: finiteNumber(patch.y)
      ? patch.y
      : bounds.y + (bounds.h - targetHeight) * anchorY,
    width: targetWidth,
    height: targetHeight,
  };
  const rotationDeg = normalizeRotationDelta(patch.rotation);
  const transformRequested =
    !nearlyEqual(scale, 1)
    || !nearlyEqual(baseTarget.x, bounds.x)
    || !nearlyEqual(baseTarget.y, bounds.y)
    || rotationDeg !== 0;

  let next: El[] = [...elements];
  if (transformRequested) {
    const sourceBounds: StudioGroupUniformResizeBounds = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.w,
      height: bounds.h,
    };
    const strokeWidthPolicy = patch.strokeWidthPolicy ?? "preserve";
    const plan = (target: StudioGroupUniformResizeBounds) =>
      planStudioGroupUniformResize({
        items: elements,
        selectedIds: [...requestedIds],
        sourceBounds,
        targetBounds: rotateBoxOriginAboutCentre(target, rotationDeg),
        rotationDeg,
        strokeWidthPolicy,
        // The controller performs effective group/element lock validation before calling this pure
        // planner. Keeping this callback total lets isolated tests exercise the geometry directly.
        isLocked: () => false,
      });

    let target = baseTarget;
    next = plan(target);
    const transformed = selectedIds.some(
      (id) =>
        next.find((element) => element.id === id)
        !== elements.find((element) => element.id === id),
    );
    if (!transformed) return null;

    // Preserved line weight means the padded visual box is not perfectly linear in scale: the ink
    // geometry grows while the stroke radius stays fixed. Re-measure through the same authoritative
    // planner and refine the one uniform scale so the dimension the artist typed lands exactly.
    // As with the single-stroke solver, turned AABBs are intentionally excluded.
    if (
      rotationDeg === 0
      && strokeWidthPolicy === "preserve"
      && (widthScale !== null || heightScale !== null)
    ) {
      const canonicalAxis = widthScale !== null ? "width" : "height";
      const desiredSize = canonicalAxis === "width" ? targetWidth : targetHeight;
      const sourceSize = canonicalAxis === "width" ? bounds.w : bounds.h;
      const fixedAnchorX = bounds.x + bounds.w * anchorX;
      const fixedAnchorY = bounds.y + bounds.h * anchorY;

      for (let step = 0; step < GROUP_LAYOUT_SOLVE_MAX_STEPS; step += 1) {
        const measured = unionStudioSelectionBounds(
          next.filter((element) => requestedIds.has(element.id)),
        );
        if (!measured) break;
        const measuredSize = canonicalAxis === "width" ? measured.w : measured.h;
        const sizeError = desiredSize - measuredSize;
        const xError = finiteNumber(patch.x)
          ? patch.x - measured.x
          : fixedAnchorX - (measured.x + measured.w * anchorX);
        const yError = finiteNumber(patch.y)
          ? patch.y - measured.y
          : fixedAnchorY - (measured.y + measured.h * anchorY);
        if (
          Math.abs(sizeError) <= GROUP_LAYOUT_SOLVE_TOLERANCE
          && Math.abs(xError) <= GROUP_LAYOUT_SOLVE_TOLERANCE
          && Math.abs(yError) <= GROUP_LAYOUT_SOLVE_TOLERANCE
        ) {
          break;
        }

        const refinedScale = target.width / bounds.w + sizeError / sourceSize;
        if (!Number.isFinite(refinedScale) || refinedScale <= 0) break;
        target = {
          x: target.x + xError,
          y: target.y + yError,
          width: bounds.w * refinedScale,
          height: bounds.h * refinedScale,
        };
        const refined = plan(target);
        if (
          !selectedIds.some(
            (id) =>
              refined.find((element) => element.id === id)
              !== elements.find((element) => element.id === id),
          )
        ) {
          break;
        }
        next = refined;
      }
    }
  }

  let changed = transformRequested;
  if (finiteNumber(patch.opacity)) {
    if (targets.some((element) => element.type === "frame")) return null;
    const opacity = Math.min(1, Math.max(0, patch.opacity));
    next = next.map((element) => {
      if (!requestedIds.has(element.id)) return element;
      const current =
        typeof element.opacity === "number" && Number.isFinite(element.opacity)
          ? Math.min(1, Math.max(0, element.opacity))
          : 1;
      if (nearlyEqual(current, opacity)) return element;
      changed = true;
      return { ...element, opacity } as El;
    });
  }

  return changed ? next : null;
}
