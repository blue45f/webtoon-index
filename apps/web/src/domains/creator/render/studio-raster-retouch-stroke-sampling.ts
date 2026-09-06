/**
 * Live-drag sampling for paint-retouch tools (smudge / dodge-burn / wet-mix).
 *
 * These tools must feel like the eraser: pointermove stays O(1), samples respect brush
 * radius spacing, and bake/worker input is capped so long strokes do not freeze the tab.
 */

import {
  appendBrushPoint,
  type SelPoint,
} from "../studio-selection-tools";

/** Hard cap on journaled drag samples (matches pending-retouch gesture budget). */
export const STUDIO_RASTER_RETOUCH_DRAG_MAX_POINTS = 8_192;

/**
 * Cap for worker bake input. Engines already resample internally; denser journals only
 * expand the dirty region and worker cost without improving dab quality.
 */
export const STUDIO_RASTER_RETOUCH_APPLY_MAX_POINTS = 512;

export function appendStudioRasterRetouchDragPoint(
  points: SelPoint[],
  next: SelPoint,
  radiusNorm: number,
): boolean {
  if (points.length === 0) {
    points.push(next);
    return true;
  }
  if (points.length >= STUDIO_RASTER_RETOUCH_DRAG_MAX_POINTS) {
    // Keep first path + latest tip (same contract as pending retouch gesture).
    points[STUDIO_RASTER_RETOUCH_DRAG_MAX_POINTS - 1] = next;
    return true;
  }
  const last = points[points.length - 1]!;
  const tail = appendBrushPoint([last], next, radiusNorm);
  const appended = tail[1];
  if (!appended) return false;
  points.push(appended);
  return true;
}

/**
 * Evenly thin a journal for bake. Always keeps first and last samples so stamp endpoints
 * and stroke direction survive long drags.
 */
export function thinStudioRasterRetouchPointsForApply(
  points: readonly SelPoint[],
  maxPoints: number = STUDIO_RASTER_RETOUCH_APPLY_MAX_POINTS,
): readonly SelPoint[] {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 2) {
    return points.length <= 2 ? points : [points[0]!, points[points.length - 1]!];
  }
  if (points.length <= maxPoints) return points;
  if (maxPoints === 2) return [points[0]!, points[points.length - 1]!];

  const out: SelPoint[] = [points[0]!];
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
