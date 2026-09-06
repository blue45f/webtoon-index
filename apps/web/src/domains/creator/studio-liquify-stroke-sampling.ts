/**
 * Live-drag sampling for liquify strokes.
 *
 * Pointermove must stay O(1); journals that feed the Worker must be radius-spaced and
 * capped so long strokes do not freeze the tab on pointerup (same spirit as paint-retouch).
 */

import type { StudioLiquifyPointerPoint } from "./studio-liquify-pointer";
import type { SelPoint } from "./studio-selection-tools";

/** Hard cap on in-gesture journaled samples. */
export const STUDIO_LIQUIFY_DRAG_MAX_POINTS = 4_096;

/**
 * Cap for Worker bake input. The engine resamples by brush radius; denser journals only
 * inflate the dirty ROI and dab visits without improving quality.
 */
export const STUDIO_LIQUIFY_APPLY_MAX_POINTS = 384;

/** Even lighter cap for live preview bakes (drop-frame, lower resolution). */
export const STUDIO_LIQUIFY_PREVIEW_MAX_POINTS = 96;

/** Longest edge (px) for live preview rasterization. */
export const STUDIO_LIQUIFY_PREVIEW_MAX_EDGE = 384;

/**
 * Minimum journal spacing as a fraction of brush radius (normalized 0..1 of element width).
 * Larger than freehand 0.002 so liquify stops packing sub-pixel dabs under the brush.
 */
export function studioLiquifyDragMinDistance(radiusNorm: number): number {
  if (!Number.isFinite(radiusNorm) || radiusNorm <= 0) return 0.004;
  return Math.min(0.08, Math.max(0.003, radiusNorm * 0.22));
}

export function thinStudioLiquifyPointsForApply(
  points: readonly StudioLiquifyPointerPoint[],
  maxPoints: number = STUDIO_LIQUIFY_APPLY_MAX_POINTS,
): readonly StudioLiquifyPointerPoint[] {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 2) {
    return points.length <= 2
      ? points
      : [points[0]!, points[points.length - 1]!];
  }
  if (points.length <= maxPoints) return points;
  if (maxPoints === 2) return [points[0]!, points[points.length - 1]!];

  const out: StudioLiquifyPointerPoint[] = [points[0]!];
  const lastIndex = points.length - 1;
  const middleSlots = maxPoints - 2;
  for (let slot = 1; slot <= middleSlots; slot += 1) {
    const index = Math.round((slot / (middleSlots + 1)) * lastIndex);
    const candidate = points[index]!;
    if (candidate !== out[out.length - 1]) out.push(candidate);
  }
  const last = points[lastIndex]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function thinStudioLiquifyPointsForPreview(
  points: readonly StudioLiquifyPointerPoint[],
): readonly StudioLiquifyPointerPoint[] {
  return thinStudioLiquifyPointsForApply(points, STUDIO_LIQUIFY_PREVIEW_MAX_POINTS);
}

/** Flat document points for a lightweight stroke trail (Konva Line). */
export function studioLiquifyTrailCanvasPoints(
  points: readonly SelPoint[],
  frame: { readonly width: number; readonly height: number },
  maxSamples = 64,
): number[] {
  if (points.length === 0) return [];
  const sampled = thinStudioLiquifyPointsForApply(
    points as StudioLiquifyPointerPoint[],
    Math.max(2, maxSamples),
  );
  const flat: number[] = [];
  for (const point of sampled) {
    flat.push(point.x * frame.width, point.y * frame.height);
  }
  return flat;
}
